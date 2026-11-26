//! Bounded, deterministic constructor; does not import another engine's output.
use std::collections::BTreeMap;
use std::time::Instant;
use crate::domain::Plan;
use super::patterns::{rest_pairs, worked};

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
