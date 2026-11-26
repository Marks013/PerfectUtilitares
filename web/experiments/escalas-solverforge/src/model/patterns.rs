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
    pub fn rest_quality(self,mask:u32,imposed:u32,days:usize)->[i64;4]{
        if !self.adjustable(){return [0;4];}
        let off=!mask&full_mask(days);
        let pair_starts=(off&(off>>1))&!(imposed&(imposed>>1));
        let pairs=pair_starts.count_ones() as i64;
        let fixed=(off&(off>>1)&imposed&(imposed>>1)).count_ones() as i64;
        let mut weeks=0u32;
        for week in 0..days/7{
            if ((pair_starts<<1)>>(week*7))&127!=0{weeks|=1<<week;}
        }
        [(pairs+fixed-2).max(0)-(fixed-2).max(0),pairs,pairs*(pairs-1)/2,
            (weeks&(weeks>>1)).count_ones() as i64]
    }
    pub fn spacing(self,mask:u32,imposed:u32,days:usize)->(i64,i64){
        let q=self.rest_quality(mask,imposed,days);
        (q[0],q[1])
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

// Enumerate only prefixes compatible with the locks, streaks and Sunday
// caps. Keep the original catalogue index and order; the complete legal()
// predicate remains the last word. This is bounded to the current E2 horizon.
pub fn allowed_indices(catalogue: &[u32], days: usize, locks: (u32,u32),
                       cap: usize, comparable: u32, rules:PersonalRules, deadline: std::time::Instant) -> Option<Vec<usize>> {
    let (locked_work,locked_off)=locks;
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
    fn rest_distribution_counts_imposed_pairs_and_weekly_concentration(){
        let rules=PersonalRules::default();
        let mask=full_mask(28)^((3<<1)|(3<<8)|(3<<15));
        assert_eq!(rules.rest_quality(mask,0,28),[1,3,3,2]);
        assert_eq!(rules.rest_quality(mask,3<<1,28),[1,2,1,1]);
        assert_eq!(rules.rest_quality(mask,(3<<1)|(3<<8),28),[1,1,0,0]);
        assert_eq!(rules.rest_quality(mask,(3<<1)|(3<<8)|(3<<15),28),[0,0,0,0]);
        assert_eq!(PersonalRules{prefer_consecutive:true,..rules}.rest_quality(mask,0,28),[0;4]);
    }
    #[test]
    fn individual_preferences_and_spacing_are_independent(){
        let rules=PersonalRules{prefer_consecutive:true,preferred:1<<2,..Default::default()};
        // Sun and Mon OFF (Tue preferred OFF is not satisfied).
        let paired=127^3;
        // Mon and Tue OFF: pair and preferred weekday satisfied.
        let preferred=127^6;
        assert_eq!(rules.preferences(paired,7),1);
        assert_eq!(rules.preferences(preferred,7),0);
        assert_eq!(rules.spacing(preferred,0,7),(0,0));
        assert_eq!(PersonalRules::default().spacing(preferred,0,7),(0,1));
        let required=PersonalRules{consecutive:true,..Default::default()};
        assert!(legal_profile(preferred,7,0,0,1,1,required));
        assert!(!legal_profile(127^5,7,0,0,1,1,required));
    }

    #[test]
    fn pruned_domains_are_exactly_the_original_exhaustive_domains() {
        for days in [7, 28] {
            let all = catalog(days);
            for (work, off, cap, comparable) in [(0,0,1,15),(0,0,2,15),(1,2,1,14),
                                                 (64,1,2,13),(0,64,1,0),(0,7,2,15)] {
                let comparable = comparable & full_mask(days/7);
                let expected: Vec<_> = all.iter().enumerate().filter_map(|(i,&m)|
                    legal(m, days, work, off, cap, comparable).then_some(i)).collect();
                assert_eq!(allowed_indices(&all,days,(work,off),cap,comparable,PersonalRules::default(),
                    Instant::now()+Duration::from_secs(10)).unwrap(),expected);
            }
            assert!(allowed_indices(&all,days,(0,0),1,0,PersonalRules::default(),Instant::now()).is_none());
        }
    }
}
