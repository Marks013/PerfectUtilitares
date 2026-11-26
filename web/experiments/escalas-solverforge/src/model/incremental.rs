//! Reversible sector score for the native collector. The original full
//! group_cost remains a separate oracle in coverage.rs.
use std::collections::BTreeMap;
use std::sync::Arc;
use super::coverage::{Cost, Member, Sector};
use super::patterns::worked;
use super::presence::Presence;
use solverforge::stream::collector::Accumulator;

#[derive(Clone, Copy, Default)]
struct DayCost { hard:i64, estimated:i64, peak:i64 }

#[derive(Default)]
struct CohortStats {
    rates: BTreeMap<i64,usize>,
    eligible: [i64;6],
    sundays: [i64;6],
    members: usize,
}

pub struct SectorAccumulator {
    rows: BTreeMap<usize, Member>,
    facts: Option<Arc<Sector>>,
    bands_by_day: [Vec<usize>; 42],
    attendance: [Presence; 42],
    day_costs: [DayCost; 42],
    personal: Cost,
    cohorts: BTreeMap<usize,CohortStats>,
}

impl Default for SectorAccumulator {
    fn default()->Self{
        Self{rows:BTreeMap::new(),facts:None,bands_by_day:std::array::from_fn(|_|Vec::new()),
            attendance:[Presence::EMPTY;42],day_costs:[DayCost::default();42],personal:[0;13],cohorts:BTreeMap::new()}
    }
}

impl SectorAccumulator {
    fn refresh(&mut self, day:usize) {
        let facts = self.facts.as_ref().expect("sector initialized");
        let mut cost=DayCost::default();
        for &index in &self.bands_by_day[day] {
            let band=&facts.bands[index];
            let gap=band.gap(self.attendance[day]);
            if band.estimated {
                cost.estimated += gap * band.minutes;
                cost.peak=cost.peak.max(gap);
            } else { cost.hard += gap * band.minutes; }
        }
        self.day_costs[day]=cost;
    }

    fn apply(&mut self, member:&Member, insert:bool) {
        let Some(mask)=member.mask else {return;};
        let days=member.facts.days;
        let bit=Presence::one(member.id);
        let sign=if insert {1} else {-1};
        for day in 0..days {
            if !worked(mask,day) {continue;}
            if insert { self.attendance[day] |= bit; }
            else { self.attendance[day] &= !bit; }
            self.refresh(day);
        }
        let rest=member.rules.rest_quality(mask,member.locked_off,days);
        for (i,value) in rest.into_iter().enumerate(){self.personal[5+i]+=sign*value;}
        let changes=((member.saved_work^mask)&member.saved_known).count_ones() as i64;
        self.personal[10]+=sign*i64::from(changes>0);
        self.personal[11]+=sign*changes;
        self.personal[12]+=sign*member.rules.preferences(mask,days);
        let stats=self.cohorts.entry(member.cohort).or_default();
        if insert {stats.members+=1;} else {stats.members-=1;}
        let mut available=0;
        let mut used=0;
        for week in 0..days/7 {
            let day=week*7;
            if worked(member.locked_off,day) {continue;}
            available+=1;
            stats.eligible[week]+=sign;
            if worked(mask,day) {used+=1; stats.sundays[week]+=sign;}
        }
        if available>0 {
            let rate=used*10_000/available;
            let rates=&mut stats.rates;
            if insert {*rates.entry(rate).or_default()+=1;}
            else {
                let count=rates.get_mut(&rate).expect("missing Sunday rate");
                *count-=1;
                if *count==0 {rates.remove(&rate);}
            }
        }
    }

    fn cost(&self)->Cost {
        let Some(facts)=&self.facts else{return [0;13];};
        let mut cost=self.personal;
        for day in 0..facts.days {
            let d=self.day_costs[day];
            cost[0]+=d.hard;
            cost[3]+=d.estimated;
            if day%7==0 {cost[1]+=d.estimated;}
            cost[4]=cost[4].max(d.peak);
            if facts.members>=2 && self.attendance[day].is_empty() {cost[2]+=1;}
        }
        for stats in self.cohorts.values() {
            if stats.members<2 {continue;}
            if let (Some((&lo,_)),Some((&hi,_)))=(stats.rates.first_key_value(),stats.rates.last_key_value()) {
                cost[9]+=hi-lo;
            }
            let mut lo=i64::MAX;
            let mut hi=0;
            for week in 0..facts.days/7 {
                let n=stats.eligible[week];
                if n==0 {continue;}
                let rate=stats.sundays[week]*10_000/n;
                lo=lo.min(rate);
                hi=hi.max(rate);
            }
            if lo!=i64::MAX {cost[9]+=hi-lo;}
        }
        cost
    }
}

impl Accumulator<Member, Cost> for SectorAccumulator {
    type Retraction=usize;
    fn accumulate(&mut self, value:Member)->usize {
        let id=value.id;
        assert!(!self.rows.contains_key(&id),"duplicate score row");
        if let Some(facts)=&self.facts {assert!(Arc::ptr_eq(facts,&value.facts),"sector facts drift");}
        else {
            self.facts=Some(Arc::clone(&value.facts));
            for (i,band) in value.facts.bands.iter().enumerate() {self.bands_by_day[band.day].push(i);}
            for day in 0..value.facts.days {self.refresh(day);}
        }
        self.apply(&value,true);
        self.rows.insert(id,value);
        id
    }
    fn retract(&mut self,id:usize) {
        let value=self.rows.remove(&id).expect("missing score row");
        if self.rows.is_empty() {*self=Self::default();}
        else {self.apply(&value,false);}
    }
    fn with_result<T>(&self,f:impl FnOnce(&Cost)->T)->T {f(&self.cost())}
    fn reset(&mut self) {*self=Self::default();}
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::coverage::{Band,group_cost};
    use super::super::patterns::catalog;
    fn check(acc:&SectorAccumulator,rows:&BTreeMap<usize,Member>) {
        assert_eq!(acc.finish(),group_cost(rows.values()));
    }
    #[test]
    fn large_presence_component_agrees_with_full_score() {
        for members in [115,250]{
            let eligible=(0..members).fold(Presence::EMPTY,|a,id|a|Presence::one(id));
            let role=(0..members).step_by(2).fold(Presence::EMPTY,|a,id|a|Presence::one(id));
            let facts=Arc::new(Sector{days:7,members,bands:(0..7).map(|day|
                Band{day,start:480,minutes:60,estimated:true,minimum:members as i64/2,eligible,
                    role_floors:vec![(role,members as i64/4)]}).collect()});
            let patterns=catalog(7);
            let mut acc=SectorAccumulator::default();
            let mut rows=BTreeMap::new();
            for id in 0..members{
                let member=Member{id,cohort:id%2,rules:Default::default(),mask:Some(patterns[id%patterns.len()]),
                    locked_off:0,saved_known:0,saved_work:0,facts:Arc::clone(&facts)};
                acc.accumulate(member.clone());rows.insert(id,member);check(&acc,&rows);
            }
            for id in [0,63,64,members-1]{
                acc.retract(id);let mut m=rows.remove(&id).unwrap();check(&acc,&rows);
                m.mask=Some(patterns[(id+3)%patterns.len()]);
                acc.accumulate(m.clone());rows.insert(id,m);check(&acc,&rows);
            }
            acc.reset();rows.clear();check(&acc,&rows);
        }
    }
    #[test]
    fn every_incremental_state_matches_independent_full_score() {
        for days in [7,28] {
            let facts=Arc::new(Sector{days,members:5,bands:(0..days).flat_map(|day| [
                Band{day,start:480,minutes:60,estimated:true,minimum:3,eligible:Presence::from_low(31),role_floors:vec![(Presence::from_low(3),1),(Presence::from_low(28),1)]},
                Band{day,start:480,minutes:30,estimated:false,minimum:1,eligible:Presence::from_low(15),role_floors:vec![]}
            ]).collect()});
            let all=catalog(days);
            let mut acc=SectorAccumulator::default();
            let mut rows=BTreeMap::new();
            check(&acc,&rows);
            for id in 0..5 {
                let m=Member{id,cohort:if id<3 {0} else {1},rules:super::super::patterns::PersonalRules{prefer_consecutive:id%2==0,preferred:4,..Default::default()},mask:if id==4 {None} else {Some(all[id*3])},locked_off:if id%2==0 {1} else {0},
                    saved_known:127,saved_work:all[id],facts:Arc::clone(&facts)};
                acc.accumulate(m.clone());rows.insert(id,m);check(&acc,&rows);
            }
            for step in 0..100 {
                let id=step%5;
                acc.retract(id);
                let mut m=rows.remove(&id).unwrap();check(&acc,&rows);
                m.mask=if step%7==0 {None} else {Some(all[(step*137+id)%all.len()])};
                acc.accumulate(m.clone());rows.insert(id,m);check(&acc,&rows);
            }
            for id in 0..5 {acc.retract(id);rows.remove(&id);check(&acc,&rows);}
            acc.reset();check(&acc,&rows);
        }
    }
}
