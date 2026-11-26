//! Bounded, deterministic constructor; does not import another engine's output.
use std::collections::BTreeMap;
use std::time::Instant;
use crate::domain::Plan;
use super::patterns::worked;
use super::presence::Presence;

// Greedy seed: only legal personal patterns, no CP-SAT/Timefold output.
// Precompute marginal coverage gains for each civil day. Do not mutate the
// plan if the bounded constructor cannot finish.
fn greedy(plan: &mut Plan, deadline: Instant) -> bool {
    if plan.employees.iter().all(|p| p.pattern.is_some()) { return true; }
    let mut selected = Vec::with_capacity(plan.employees.len());
    let mut attendance = BTreeMap::<usize, [Presence; 28]>::new();
    for person in &plan.employees {
        if let Some(mask) = person.mask() {
            let sector = attendance.entry(person.sector).or_insert([Presence::EMPTY; 28]);
            for (day, present) in sector.iter_mut().enumerate().take(person.facts.days) {
                if worked(mask, day) { *present |= Presence::one(person.id); }
            }
        }
    }
    for person in &plan.employees {
        if Instant::now() >= deadline { return false; }
        if let Some(index) = person.pattern { selected.push(index); continue; }
        let sector = attendance.entry(person.sector).or_insert([Presence::EMPTY; 28]);
        let bit = Presence::one(person.id);
        let mut hard = [0i64; 28];
        let mut gap = [0i64; 28];
        for band in &person.facts.bands {
            let present = sector[band.day];
            let gain = (band.gap(present) - band.gap(present | bit)) * band.minutes;
            if band.estimated { gap[band.day] += gain; } else { hard[band.day] += gain; }
        }
        let mut best: Option<([i64; 8], usize)> = None;
        for (n, &index) in person.allowed.iter().enumerate() {
            if n % 128 == 0 && Instant::now() >= deadline { return false; }
            let mask = person.catalog[index];
            let mut rank = [0i64; 8];
            for day in 0..person.facts.days {
                if !worked(mask, day) { continue; }
                rank[0] += hard[day];
                if day % 7 == 0 { rank[1] += gap[day]; }
                rank[2] += if sector[day].is_empty() { 1 } else { 0 };
                rank[3] += gap[day];
                rank[5] -= sector[day].count_ones() as i64;
            }
            rank[4] = -person.rules.spacing(mask,person.locked_off,person.facts.days).1;
            rank[6] = -(((person.saved_work ^ mask) & person.saved_known).count_ones() as i64);
            rank[7] = -person.rules.preferences(mask,person.facts.days);
            if best.as_ref().is_none_or(|(old, _)| rank > *old) { best = Some((rank, index)); }
        }
        let Some((_, index)) = best else { return false; };
        selected.push(index);
        for (day, present) in sector.iter_mut().enumerate().take(person.facts.days) {
            if worked(person.catalog[index], day) { *present |= bit; }
        }
    }
    if Instant::now() >= deadline { return false; }
    for (person, index) in plan.employees.iter_mut().zip(selected) { person.pattern = Some(index); }
    true
}

// Preserve a complete greedy roster if optional repair is interrupted.
pub fn seed(plan: &mut Plan, deadline: Instant) -> (bool,super::sunday_repair::RepairStats) {
    if !greedy(plan,deadline) {return (false,super::sunday_repair::RepairStats{deadline_reached:Instant::now()>=deadline,..Default::default()});}
    let mut stats=super::sunday_repair::repair(plan,deadline);
    stats.rest=super::rest_repair::polish_rests(plan,deadline);
    stats.peak=super::peak_repair::polish_peaks(plan,deadline);
    (true,stats)
}
