//! Legal personal 5x2 domains for the bounded E2 horizon.

/// Fixed-clock personal profile. Masks are Sunday-first internally.
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord,Hash)]
pub struct PersonalRules {
    pub max_run:u8,
    pub variable:bool,
    pub consecutive:bool,
    pub prefer_consecutive:bool,
    pub preferred:u8,
}
impl Default for PersonalRules {
    fn default()->Self{Self{max_run:5,variable:true,consecutive:false,prefer_consecutive:false,preferred:0}}
}
impl PersonalRules {
    pub fn adjustable(self)->bool{self.variable&&!self.consecutive&&!self.prefer_consecutive}
    pub fn preferences(self,mask:u32,days:usize)->i64{
        let mut penalty=0;
        for week in 0..days/7 {
            let pattern=(mask>>(week*7))&127;
            penalty+=(pattern&self.preferred as u32).count_ones() as i64;
            if self.prefer_consecutive {
                let off=!pattern&127;
                // Constant minus adjacent pairs, since Saturday is WORK.
                penalty+=i64::from(off&(off>>1)==0);
            }
        }
        penalty
    }
    pub fn spacing(self,mask:u32,imposed:u32,days:usize)->(i64,i64){
        if !self.adjustable(){return (0,0);}
        let pairs=rest_pairs(mask,imposed,days);
        let fixed=(imposed&(imposed>>1)).count_ones() as i64;
        ((pairs+fixed-2).max(0)-(fixed-2).max(0),pairs)
    }
}

pub fn full_mask(days: usize) -> u32 { (1u32 << days) - 1 }
pub fn worked(mask: u32, day: usize) -> bool { mask & (1u32 << day) != 0 }

#[cfg(test)]
pub fn legal(mask:u32,days:usize,locked_work:u32,locked_off:u32,cap:usize,comparable:u32)->bool{
    legal_profile(mask,days,locked_work,locked_off,cap,comparable,PersonalRules::default())
}
pub fn legal_profile(mask: u32, days: usize, locked_work: u32, locked_off: u32, cap: usize, comparable: u32, rules:PersonalRules) -> bool {
    if (days != 7 && days != 28) || (cap != 1 && cap != 2)
        || mask & !full_mask(days) != 0 || mask & locked_work != locked_work || mask & locked_off != 0 {
        return false;
    }
    let weeks = days / 7;
    for week in 0..weeks {
        let m = (mask >> (week * 7)) & 127;
        if m.count_ones() != 5 || m & 64 == 0 { return false; }
    }
    if !(1..=5).contains(&rules.max_run){return false;}
    let maximum=rules.max_run as usize;
    let window=full_mask(maximum+1);
    for i in 0..days-maximum {if (mask>>i)&window==window{return false;}}
    if rules.variable {
        for i in 0..days-2 {
            if (mask>>i)&7==0&&(locked_off>>i)&7!=7{return false;}
        }
    }
    if rules.consecutive {
        let off=!mask&full_mask(days);
        if off&!((off<<1)|(off>>1))!=0{return false;}
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
                       cap: usize, comparable: u32, rules:PersonalRules, deadline: std::time::Instant) -> Option<Vec<usize>> {
    if !matches!(days, 7 | 28) || !matches!(cap, 1 | 2) { return None; }
    let domain=super::weekly_domain::WeeklyDomain::new(days/7,locked_work as u64,locked_off as u64,cap,comparable,rules)?;
    let (expected,_)=domain.count(deadline)?;
    let mut found=Vec::with_capacity(expected);
    domain.visit(deadline,|candidate|{
        let mask=candidate as u32;
        // Independent original E2 predicate remains the final check.
        if legal_profile(mask,days,locked_work,locked_off,cap,comparable,rules){
            found.push(catalogue.binary_search(&mask).expect("catalogue identity"));
        }
    })?;
    assert_eq!(found.len(),expected,"weekly domain drift");
    found.sort_unstable();
    Some(found)
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
                assert_eq!(allowed_indices(&all,days,work,off,cap,comparable,PersonalRules::default(),
                    Instant::now()+Duration::from_secs(10)).unwrap(),expected);
            }
            assert!(allowed_indices(&all,days,0,0,1,0,PersonalRules::default(),Instant::now()).is_none());
        }
    }
}
