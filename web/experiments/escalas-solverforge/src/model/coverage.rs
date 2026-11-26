//! Nine-level score and independent full recomputation.
use std::collections::BTreeMap;
use std::sync::Arc;
use crate::domain::Plan;
use super::patterns::{legal, rest_pairs, worked};

// Only November E2, 7 or 28 days, <=50 synthetic people, fixed clock.
// Each legal value is an index into the common enumerated pattern catalogue.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Band {
    pub day: usize,
    pub minutes: i64,
    pub estimated: bool,
    pub minimum: i64,
    pub eligible: u64,
    pub role_floors: Vec<(u64, i64)>,
}

impl Band {
    pub fn gap(&self, attended: u64) -> i64 {
        let presence = attended & self.eligible;
        let total = (self.minimum - presence.count_ones() as i64).max(0);
        let roles: i64 = self.role_floors.iter()
            .map(|(eligible, minimum)| (*minimum - (presence & eligible).count_ones() as i64).max(0))
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
    pub mask: Option<u32>,
    pub locked_off: u32,
    pub saved_known: u32,
    pub saved_work: u32,
    pub sunday_cap: usize,
    pub facts: Arc<Sector>,
}

pub type Cost = [i64; 9];

pub fn group_cost<'a>(rows: impl IntoIterator<Item = &'a Member>) -> Cost {
    let mut rows = rows.into_iter();
    let Some(first) = rows.next() else { return [0; 9]; };
    let facts = &first.facts;
    let mut attendance = [0u64; 28];
    let mut cost = [0i64; 9];
    let mut low = [i64::MAX; 3];
    let mut high = [0i64; 3];
    let mut date_eligible = [[0i64; 4]; 3];
    let mut date_worked = [[0i64; 4]; 3];
    for member in std::iter::once(first).chain(rows) {
        let Some(mask) = member.mask else { continue; };
        for day in 0..facts.days {
            if worked(mask, day) { attendance[day] |= 1u64 << member.id; }
        }
        let pairs = rest_pairs(mask, member.locked_off, facts.days);
        let imposed_pairs = (member.locked_off & (member.locked_off >> 1)).count_ones() as i64;
        cost[5] += (pairs + imposed_pairs - 2).max(0) - (imposed_pairs - 2).max(0);
        cost[6] += pairs;
        cost[8] += ((member.saved_work ^ mask) & member.saved_known).count_ones() as i64;
        let cap = member.sunday_cap;
        let mut available = 0;
        let mut used = 0;
        for week in 0..facts.days / 7 {
            let day = week * 7;
            if worked(member.locked_off, day) { continue; }
            available += 1;
            date_eligible[cap][week] += 1;
            if worked(mask, day) { used += 1; date_worked[cap][week] += 1; }
        }
        if available > 0 {
            let rate = used * 10_000 / available;
            low[cap] = low[cap].min(rate);
            high[cap] = high[cap].max(rate);
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
    if facts.members >= 2 { cost[2] = attendance[..facts.days].iter().filter(|&&v| v == 0).count() as i64; }
    for cap in 1..=2 {
        if low[cap] != i64::MAX { cost[7] += high[cap] - low[cap]; }
        let mut min = i64::MAX;
        let mut max = 0;
        for week in 0..facts.days/7 {
            if date_eligible[cap][week] == 0 { continue; }
            let rate = date_worked[cap][week] * 10_000 / date_eligible[cap][week];
            min = min.min(rate); max = max.max(rate);
        }
        if min != i64::MAX { cost[7] += max - min; }
    }
    cost
}

pub fn evaluate(plan: &Plan) -> Cost {
    let mut groups = BTreeMap::<usize, Vec<Member>>::new();
    let mut total = [0i64; 9];
    for person in &plan.employees {
        if person.pattern.is_none() { total[0] += 1; }
        groups.entry(person.sector).or_default().push(person.member());
    }
    for group in groups.values() {
        let cost = group_cost(group.iter());
        for i in 0..9 { total[i] += cost[i]; }
    }
    total
}

pub fn validate_complete(plan: &Plan) -> bool {
    plan.employees.iter().all(|p| p.pattern.is_some_and(|index| {
        p.allowed.binary_search(&index).is_ok()
        && p.mask().is_some_and(|mask| legal(mask, p.facts.days, p.locked_work, p.locked_off, p.sunday_cap, p.comparable_weeks))
    })) && evaluate(plan)[0] == 0
}
