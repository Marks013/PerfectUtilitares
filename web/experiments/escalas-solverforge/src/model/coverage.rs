//! Nine-level score and independent full recomputation.
use std::collections::BTreeMap;
use std::sync::Arc;
use crate::domain::Plan;
use super::patterns::{PersonalRules, legal_profile, worked};
use super::presence::Presence;

// Only November E2, 7 or 28 days, <=50 synthetic people, fixed clock.
// Each legal value is an index into the common enumerated pattern catalogue.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Band {
    pub day: usize,
    pub minutes: i64,
    pub estimated: bool,
    pub minimum: i64,
    pub eligible: Presence,
    pub role_floors: Vec<(Presence, i64)>,
}

impl Band {
    // The first entry is the general/combined headcount deficit; subsequent
    // entries preserve every role floor independently for selection guards.
    pub fn gap_components(&self, attended:Presence)->Vec<i64>{
        let presence=attended&self.eligible;
        std::iter::once((self.minimum-presence.count_ones() as i64).max(0))
            .chain(self.role_floors.iter().map(|(eligible,minimum)|
                (*minimum-(presence&*eligible).count_ones() as i64).max(0))).collect()
    }
    pub fn gap(&self, attended: Presence) -> i64 {
        let presence = attended & self.eligible;
        let total = (self.minimum - presence.count_ones() as i64).max(0);
        let roles: i64 = self.role_floors.iter()
            .map(|(eligible, minimum)| (*minimum - (presence & *eligible).count_ones() as i64).max(0))
            .sum();
        total.max(roles)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Sector {
    pub days: usize,
    pub members: usize,
    pub bands: Vec<Band>,
}

#[derive(Clone, Debug)]
pub struct Member {
    pub id: usize,
    pub cohort: usize,
    pub rules:PersonalRules,
    pub mask: Option<u32>,
    pub locked_off: u32,
    pub saved_known: u32,
    pub saved_work: u32,
    pub facts: Arc<Sector>,
}

pub type Cost = [i64; 11];

pub fn group_cost<'a>(rows: impl IntoIterator<Item = &'a Member>) -> Cost {
    let mut rows = rows.into_iter();
    let Some(first) = rows.next() else { return [0; 11]; };
    let facts = &first.facts;
    let mut attendance = [Presence::EMPTY; 28];
    let mut cost = [0i64; 11];
    // Compare equivalent roles and admissible clocks, as CP-SAT does.
    let mut cohorts = BTreeMap::<usize, (Vec<i64>, [i64;4], [i64;4], usize)>::new();
    for member in std::iter::once(first).chain(rows) {
        let Some(mask) = member.mask else { continue; };
        for day in 0..facts.days {
            if worked(mask, day) { attendance[day] |= Presence::one(member.id); }
        }
        let (excess,pairs)=member.rules.spacing(mask,member.locked_off,facts.days);
        cost[5]+=excess;cost[6]+=pairs;
        let changes=((member.saved_work^mask)&member.saved_known).count_ones() as i64;
        cost[8]+=i64::from(changes>0);
        cost[9]+=changes;
        cost[10]+=member.rules.preferences(mask,facts.days);
        let stats = cohorts.entry(member.cohort).or_default();
        stats.3 += 1;
        let mut available = 0;
        let mut used = 0;
        for week in 0..facts.days / 7 {
            let day = week * 7;
            if worked(member.locked_off, day) { continue; }
            available += 1;
            stats.1[week] += 1;
            if worked(mask, day) { used += 1; stats.2[week] += 1; }
        }
        if available > 0 {
            let rate = used * 10_000 / available;
            stats.0.push(rate);
        }
    }
    for band in &facts.bands {
        let gap = band.gap(attendance[band.day]);
        if band.estimated {
            cost[3] += gap * band.minutes;
            if band.day % 7 == 0 { cost[1] += gap * band.minutes; }
            cost[4] = cost[4].max(gap);
        } else { cost[0] += gap * band.minutes; }
    }
    if facts.members >= 2 { cost[2] = attendance[..facts.days].iter().filter(|v| v.is_empty()).count() as i64; }
    for (rates, eligible, worked, members) in cohorts.values() {
        if *members < 2 { continue; }
        if let (Some(lo),Some(hi))=(rates.iter().min(),rates.iter().max()) { cost[7] += hi-lo; }
        let mut min = i64::MAX;
        let mut max = 0;
        for week in 0..facts.days/7 {
            if eligible[week] == 0 { continue; }
            let rate = worked[week] * 10_000 / eligible[week];
            min = min.min(rate); max = max.max(rate);
        }
        if min != i64::MAX { cost[7] += max - min; }
    }
    cost
}

pub fn evaluate(plan: &Plan) -> Cost {
    let mut groups = BTreeMap::<usize, Vec<Member>>::new();
    let mut total = [0i64; 11];
    for person in &plan.employees {
        if person.pattern.is_none() { total[0] += 1; }
        groups.entry(person.sector).or_default().push(person.member());
    }
    for group in groups.values() {
        let cost = group_cost(group.iter());
        for i in 0..11 { total[i] += cost[i]; }
    }
    total
}

pub fn validate_complete(plan: &Plan) -> bool {
    plan.employees.iter().all(|p| p.pattern.is_some_and(|index| {
        p.allowed.binary_search(&index).is_ok()
        && p.mask().is_some_and(|mask| legal_profile(mask, p.facts.days, p.locked_work, p.locked_off, p.sunday_cap, p.comparable_weeks,p.rules))
    })) && evaluate(plan)[0] == 0
}
