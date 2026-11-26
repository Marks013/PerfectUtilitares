use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;
use crate::domain::Plan;

// Only November E2, 7 or 28 days, <=50 synthetic people, fixed clock.
// Each legal value is an index into the common enumerated pattern catalogue.
#[derive(Clone, Debug)]
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

#[derive(Clone, Debug)]
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
pub fn full_mask(days: usize) -> u32 { (1u32 << days) - 1 }
pub fn worked(mask: u32, day: usize) -> bool { mask & (1u32 << day) != 0 }

pub fn legal(mask: u32, days: usize, locked_work: u32, locked_off: u32, cap: usize, comparable: u32) -> bool {
    if (days != 7 && days != 28) || (cap != 1 && cap != 2)
        || mask & !full_mask(days) != 0 || mask & locked_work != locked_work || mask & locked_off != 0 {
        return false;
    }
    let weeks = days / 7;
    for week in 0..weeks {
        let m = (mask >> (week * 7)) & 127;
        if m.count_ones() != 5 || m & 64 == 0 { return false; }
    }
    for i in 0..days - 5 { if (mask >> i) & 63 == 63 { return false; } }
    for i in 0..days - 2 {
        if (mask >> i) & 7 == 0 && (locked_off >> i) & 7 != 7 { return false; }
    }
    if weeks > cap {
        for first in 0..weeks-cap {
            if (first..=first+cap).all(|week| worked(mask, week * 7)) { return false; }
        }
    }
    if comparable.count_ones() >= 2 {
        let mut common_off = 127u32;
        for week in 0..weeks {
            if worked(comparable, week) { common_off &= !(mask >> (week * 7)) & 127; }
        }
        if common_off.count_ones() > 1 { return false; }
    }
    true
}

pub fn catalog(days: usize) -> Vec<u32> {
    let weekly: Vec<u32> = (0u32..128).filter(|m| m & 64 != 0 && m.count_ones() == 5).collect();
    let mut result = vec![0u32];
    for week in 0..days/7 {
        result = result.iter().flat_map(|base| weekly.iter().map(move |m| *base | (*m << (7 * week)))).collect();
    }
    result.sort_unstable();
    result
}

pub fn rest_pairs(mask: u32, imposed: u32, days: usize) -> i64 {
    let off = !mask & full_mask(days);
    ((off & (off >> 1)) & !(imposed & (imposed >> 1))).count_ones() as i64
}

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

// Greedy seed: only legal personal patterns, no CP-SAT/Timefold output.
// Precompute marginal coverage gains for each civil day. Do not mutate the
// plan if the bounded constructor cannot finish.
pub fn seed(plan: &mut Plan, deadline: Instant) -> bool {
    if plan.employees.iter().all(|p| p.pattern.is_some()) { return true; }
    let mut selected = Vec::with_capacity(plan.employees.len());
    let mut attendance = BTreeMap::<usize, [u64; 28]>::new();
    for person in &plan.employees {
        if let Some(mask) = person.mask() {
            let sector = attendance.entry(person.sector).or_insert([0; 28]);
            for day in 0..person.facts.days {
                if worked(mask, day) { sector[day] |= 1u64 << person.id; }
            }
        }
    }
    for person in &plan.employees {
        if Instant::now() >= deadline { return false; }
        if let Some(index) = person.pattern { selected.push(index); continue; }
        let sector = attendance.entry(person.sector).or_insert([0; 28]);
        let bit = 1u64 << person.id;
        let mut hard = [0i64; 28];
        let mut gap = [0i64; 28];
        for band in &person.facts.bands {
            let present = sector[band.day];
            let gain = (band.gap(present) - band.gap(present | bit)) * band.minutes;
            if band.estimated { gap[band.day] += gain; } else { hard[band.day] += gain; }
        }
        let mut best: Option<([i64; 7], usize)> = None;
        for (n, &index) in person.allowed.iter().enumerate() {
            if n % 128 == 0 && Instant::now() >= deadline { return false; }
            let mask = person.catalog[index];
            let mut rank = [0i64; 7];
            for day in 0..person.facts.days {
                if !worked(mask, day) { continue; }
                rank[0] += hard[day];
                if day % 7 == 0 { rank[1] += gap[day]; }
                rank[2] += if sector[day] == 0 { 1 } else { 0 };
                rank[3] += gap[day];
                rank[5] -= sector[day].count_ones() as i64;
            }
            rank[4] = -rest_pairs(mask, person.locked_off, person.facts.days);
            rank[6] = -(((person.saved_work ^ mask) & person.saved_known).count_ones() as i64);
            if best.as_ref().is_none_or(|(old, _)| rank > *old) { best = Some((rank, index)); }
        }
        let Some((_, index)) = best else { return false; };
        selected.push(index);
        for day in 0..person.facts.days {
            if worked(person.catalog[index], day) { sector[day] |= bit; }
        }
    }
    if Instant::now() >= deadline { return false; }
    for (person, index) in plan.employees.iter_mut().zip(selected) { person.pattern = Some(index); }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_and_legal_domain() {
        let week = catalog(7);
        assert_eq!(week.len(), 15);
        assert!(week.iter().all(|&m| legal(m, 7, 0, 0, 1, 1)));
        let four = catalog(28);
        assert_eq!(four.len(), 50_625);
        assert_eq!(four.iter().filter(|&&m| legal(m, 28, 0, 0, 1, 15)).count(), 8020);
        assert!(!legal(127, 7, 0, 0, 1, 1));
        assert!(!legal(week[0], 7, 0, 64, 1, 1));
    }

    #[test]
    fn role_and_general_floors_are_not_additive() {
        let b = Band { day: 0, minutes: 60, estimated: true, minimum: 2, eligible: 3,
            role_floors: vec![(1, 1), (2, 1)] };
        assert_eq!(b.gap(1) * b.minutes, 60);
        assert_eq!(b.gap(0) * b.minutes, 120);
        assert_eq!(b.gap(3), 0);
    }
}
