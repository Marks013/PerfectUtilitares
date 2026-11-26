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
