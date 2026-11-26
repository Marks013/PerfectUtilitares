//! Compact automaton for the fixed-clock 5x2 domain, independent of the
//! search engine. Six-week counting does not materialize the Cartesian product.
//! E2 wire still admits only the separately validated 7/28-day cases.
use std::collections::BTreeMap;
use std::time::Instant;
use super::patterns::PersonalRules;

#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
struct State {
    worked_run:u8,
    rest_run:u8,
    sunday_run:u8,
    common_off:u8,
}
impl Default for State{
    fn default()->Self{Self{worked_run:0,rest_run:0,sunday_run:0,common_off:127}}
}
pub struct WeeklyDomain{
    weeks:usize,
    locked_work:u64,
    locked_off:u64,
    cap:usize,
    comparable:u32,
    rules:PersonalRules,
    weekly:Vec<u8>,
}
impl WeeklyDomain{
    pub fn new(weeks:usize,locked_work:u64,locked_off:u64,cap:usize,comparable:u32,rules:PersonalRules)->Option<Self>{
        if !(1..=6).contains(&weeks)||!matches!(cap,1|2)||comparable>>weeks!=0||!(1..=5).contains(&rules.max_run){return None;}
        Some(Self{weeks,locked_work,locked_off,cap,comparable,rules,
            weekly:(0u8..128).filter(|m|m&64!=0&&m.count_ones()==5&&(!rules.consecutive||((!*m&127)&((!*m&127)>>1))!=0)).collect()})
    }
    fn transition(&self,week:usize,mut state:State,pattern:u8)->Option<State>{
        let shift=week*7;
        let work=((self.locked_work>>shift)&127) as u8;
        let off=((self.locked_off>>shift)&127) as u8;
        if pattern&work!=work||pattern&off!=0{return None;}
        state.sunday_run=if pattern&1!=0 {state.sunday_run+1}else{0};
        if state.sunday_run as usize>self.cap{return None;}
        for day in 0..7{
            if pattern&(1<<day)!=0{
                state.worked_run+=1;state.rest_run=0;
                if state.worked_run>self.rules.max_run{return None;}
            }else{
                state.worked_run=0;state.rest_run=(state.rest_run+1).min(3);
                // The original rule exempts ONLY a fully imposed three-day
                // OFF window. Check actual absolute days across week boundaries.
                if self.rules.variable&&state.rest_run==3{
                    let absolute=shift+day;
                    if absolute<2||(self.locked_off>>(absolute-2))&7!=7{return None;}
                }
            }
        }
        if self.comparable&(1<<week)!=0{state.common_off&=!pattern&127;}
        if week+1==self.weeks&&self.comparable.count_ones()>=2&&state.common_off.count_ones()>1{return None;}
        Some(state)
    }
    /// Count paths via equivalent suffix states, returning count and peak
    /// number of distinct states in a layer. No list of full masks.
    pub fn count(&self,deadline:Instant)->Option<(usize,usize)>{
        if Instant::now()>=deadline{return None;}
        if self.locked_work>>(self.weeks*7)!=0{return Some((0,0));}
        let mut states=BTreeMap::from([(State::default(),1usize)]);
        let mut peak=states.len();
        for week in 0..self.weeks{
            let mut next=BTreeMap::<State,usize>::new();
            for (state,count) in states{
                if Instant::now()>=deadline{return None;}
                for &pattern in &self.weekly{
                    if let Some(child)=self.transition(week,state,pattern){
                        let entry=next.entry(child).or_default();
                        *entry=entry.checked_add(count)?;
                    }
                }
            }
            peak=peak.max(next.len());states=next;
        }
        Some((states.values().sum(),peak))
    }
    /// Enumerate only legal paths when a caller explicitly needs them.
    /// Production E2 retains the original pattern IDs and independent legal().
    pub fn visit(&self,deadline:Instant,visitor:impl FnMut(u64))->Option<()>{
        if Instant::now()>=deadline{return None;}
        if self.locked_work>>(self.weeks*7)!=0{return Some(());}
        fn walk(domain:&WeeklyDomain,week:usize,state:State,mask:u64,deadline:Instant,
                visitor:&mut impl FnMut(u64))->Option<()>{
            if Instant::now()>=deadline{return None;}
            if week==domain.weeks{visitor(mask);return Some(());}
            for &pattern in &domain.weekly{
                if let Some(child)=domain.transition(week,state,pattern){
                    walk(domain,week+1,child,mask|((pattern as u64)<<(week*7)),deadline,visitor)?;
                }
            }
            Some(())
        }
        let mut visitor=visitor;
        walk(self,0,State::default(),0,deadline,&mut visitor)
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::model::patterns::{catalog,legal,full_mask};
    use std::time::Duration;
    #[test]
    fn six_week_count_uses_compact_states(){
        let until=Instant::now()+Duration::from_secs(5);
        for (cap,expected) in [(1,587620),(2,1854611)]{
            let (count,states)=WeeklyDomain::new(6,0,0,cap,63,PersonalRules::default()).unwrap().count(until).unwrap();
            assert_eq!(count,expected);
            assert!(states<128,"state-space growth: {states}");
        }
        assert!(WeeklyDomain::new(6,0,0,1,63,PersonalRules::default()).unwrap().count(Instant::now()).is_none());
    }

    #[test]
    fn configured_rules_match_exhaustive_legal_profiles(){
        use crate::model::patterns::legal_profile;
        let until=Instant::now()+Duration::from_secs(10);
        for days in [7,28] {
            let raw=catalog(days);
            for rules in [
                PersonalRules{max_run:4,..Default::default()},
                PersonalRules{variable:false,..Default::default()},
                PersonalRules{consecutive:true,..Default::default()},
                PersonalRules{prefer_consecutive:true,preferred:8,..Default::default()},
            ] {
                let comparable=if rules.consecutive{0}else{full_mask(days/7)};
                let off=(0..days/7).fold(0,|m,w|m|(2<<(w*7)));
                let domain=WeeklyDomain::new(days/7,0,off as u64,1,comparable,rules).unwrap();
                let mut actual=Vec::new();
                domain.visit(until,|m|actual.push(m as u32)).unwrap();
                actual.sort_unstable();
                let expected:Vec<_>=raw.iter().copied().filter(|&m|legal_profile(m,days,0,off,1,comparable,rules)).collect();
                assert_eq!(actual,expected);
                assert_eq!(domain.count(until).unwrap().0,expected.len());
            }
        }
    }

    #[test]
    fn exact_domain_and_count_match_exhaustive_oracle_with_boundary_locks(){
        let until=Instant::now()+Duration::from_secs(10);
        for days in [7,28]{
            let raw=catalog(days);
            // Deterministic locks include boundary Sundays/Saturdays and
            // comparable-week exclusions. Existing legal() is the oracle.
            for (work,off,cap,comparable) in [(0,0,1,15),(0,0,2,15),(1,2,1,14),
                (64,1,2,13),(0,64,1,0),(0,7,2,15),(0,384,2,15),(64,128,1,7)]{
                let work=work&full_mask(days);let off=off&full_mask(days);
                let comparable=comparable&full_mask(days/7);
                let domain=WeeklyDomain::new(days/7,work as u64,off as u64,cap,comparable,PersonalRules::default()).unwrap();
                let mut actual=Vec::new();
                domain.visit(until,|mask|actual.push(mask as u32)).unwrap();
                actual.sort_unstable();
                let expected:Vec<_>=raw.iter().copied().filter(|&mask|legal(mask,days,work,off,cap,comparable)).collect();
                assert_eq!(actual,expected);
                assert_eq!(domain.count(until).unwrap().0,expected.len());
            }
        }
    }
}
