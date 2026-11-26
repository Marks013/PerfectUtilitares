//! Legal personal 5x2 domains for the bounded E2 horizon.

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

// Enumerate only prefixes compatible with the locks, streaks and Sunday
// caps. Keep the original catalogue index and order; the complete legal()
// predicate remains the last word. This is bounded to the current E2 horizon.
pub fn allowed_indices(catalogue: &[u32], days: usize, locked_work: u32, locked_off: u32,
                       cap: usize, comparable: u32, deadline: std::time::Instant) -> Option<Vec<usize>> {
    if !matches!(days, 7 | 28) || !matches!(cap, 1 | 2) { return None; }
    struct Domain<'a> {
        catalogue: &'a [u32], days: usize, work: u32, off: u32, cap: usize, comparable: u32,
        deadline: std::time::Instant, weekly: Vec<u32>, found: Vec<usize>,
    }
    impl Domain<'_> {
        fn visit(&mut self, mask: u32, week: usize) -> Option<()> {
            if std::time::Instant::now() >= self.deadline { return None; }
            if week == self.days / 7 {
                if legal(mask, self.days, self.work, self.off, self.cap, self.comparable) {
                    self.found.push(self.catalogue.binary_search(&mask).expect("catalogue identity"));
                }
                return Some(());
            }
            let shift = week * 7;
            let work = (self.work >> shift) & 127;
            let off = (self.off >> shift) & 127;
            let length = shift + 7;
            for index in 0..self.weekly.len() {
                let part = self.weekly[index];
                if part & work != work || part & off != 0 { continue; }
                let next = mask | (part << shift);
                if (0..length.saturating_sub(5)).any(|i| (next >> i) & 63 == 63) { continue; }
                if (0..length.saturating_sub(2)).any(|i| (next >> i) & 7 == 0 && (self.off >> i) & 7 != 7) { continue; }
                if week >= self.cap && (week-self.cap..=week).all(|i| worked(next, i*7)) { continue; }
                self.visit(next, week + 1)?;
            }
            Some(())
        }
    }
    let mut domain = Domain {catalogue, days, work:locked_work, off:locked_off, cap, comparable,
        deadline, weekly:catalog(7), found:Vec::new()};
    domain.visit(0, 0)?;
    domain.found.sort_unstable();
    Some(domain.found)
}

#[cfg(test)]
mod domain_tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn pruned_domains_are_exactly_the_original_exhaustive_domains() {
        for days in [7, 28] {
            let all = catalog(days);
            for (work, off, cap, comparable) in [(0,0,1,15),(0,0,2,15),(1,2,1,14),
                                                 (64,1,2,13),(0,64,1,0),(0,7,2,15)] {
                let comparable = comparable & full_mask(days/7);
                let expected: Vec<_> = all.iter().enumerate().filter_map(|(i,&m)|
                    legal(m, days, work, off, cap, comparable).then_some(i)).collect();
                assert_eq!(allowed_indices(&all,days,work,off,cap,comparable,
                    Instant::now()+Duration::from_secs(10)).unwrap(),expected);
            }
            assert!(allowed_indices(&all,days,0,0,1,0,Instant::now()).is_none());
        }
    }
}
