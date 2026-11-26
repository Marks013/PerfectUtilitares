//! Bounded greedy seed. Actual WORK segments contribute to mandatory
//! coverage; DUTY only affects daily presence. The native solver still
//! receives the full selected domain and the independent score is recomputed.
use std::{collections::BTreeMap,sync::Arc,time::Instant};
use crate::temporal_domain::TemporalPlan;
use super::{Band,MAX_DAYS,TemporalFacts,clock,work};

struct Counts{
    total:i64,roles:Vec<i64>,
}
impl Counts{
    fn new(band:&Band)->Self{Self{total:0,roles:vec![0;band.roles.len()]}}
    fn gain(&self,band:&Band,role:usize)->i64{
        let general=(band.general-self.total).max(0);
        let roles:i64=band.roles.iter().zip(&self.roles).map(|((_,floor),count)|(*floor-*count).max(0)).sum();
        let role_gain=i64::from(band.roles.iter().zip(&self.roles).any(|((r,floor),count)|*r==role&&count<floor));
        general.max(roles)-(general-1).max(0).max(roles-role_gain)
    }
    fn insert(&mut self,band:&Band,role:usize){
        self.total+=1;
        for ((r,_),count) in band.roles.iter().zip(&mut self.roles){if *r==role{*count+=1;}}
    }
}
struct Sector{
    facts:Arc<TemporalFacts>,counts:Vec<Counts>,presence:[i64;MAX_DAYS],timed:[i64;MAX_DAYS],
}
pub(super) fn construct(plan:&mut TemporalPlan,deadline:Instant){
    let mut sectors=BTreeMap::<usize,Sector>::new();
    let mut order:Vec<_>=(0..plan.employees.len()).collect();
    order.sort_by_key(|&i|(plan.employees[i].allowed.len(),i));
    for i in order{
        let p=&plan.employees[i];
        let sector=sectors.entry(p.sector).or_insert_with(||Sector{
            facts:Arc::clone(&p.facts),counts:p.facts.bands.iter().map(Counts::new).collect(),presence:[0;MAX_DAYS],timed:[0;MAX_DAYS]
        });
        let choice=if let Some(index)=p.pattern{index}
        else if Instant::now()>=deadline{0}
        else{
            let mut benefits=[[[0i64;6];16];MAX_DAYS];
            for (b,count) in sector.facts.bands.iter().zip(&sector.counts){
                let gain=count.gain(b,p.role)*i64::from(b.end-b.start);
                if gain==0{continue;}
                for (state,benefit) in benefits[b.day].iter_mut().enumerate(){
                    if b.clock_mask&(1u16<<state)==0{continue;}
                    if b.estimated{
                        benefit[1]+=gain;
                        if b.day.is_multiple_of(7){benefit[2]+=gain;}
                        if sector.facts.movement_enabled{benefit[4]+=gain*sector.facts.priority[b.day].unwrap_or(2);}
                        let close=(b.end.min(sector.facts.closing)-b.start.max(sector.facts.closing-60)).max(0);
                        benefit[5]+=count.gain(b,p.role)*i64::from(close);
                    }else{benefit[0]+=gain;}
                }
            }
            let mut best=None;
            for &index in p.allowed.iter(){
                if index.is_multiple_of(64)&&Instant::now()>=deadline{break;}
                let mut score=p.pattern_cost(index);
                let mut new_timed_days=0i64;let mut sunday_days=0i64;let mut sunday_load=0i64;let mut sunday_minutes=0i64;
                let mut clock_changes=0i64;
                for (day,&state) in p.catalog[index].states.iter().enumerate().take(p.facts.days){
                    for (cost,gain) in score[..6].iter_mut().zip(benefits[day][usize::from(state)]){*cost-=gain;}
                    if work(state){
                        score[11]+=sector.presence[day];
                        if day.is_multiple_of(7){sunday_days+=1;sunday_load+=sector.presence[day];}
                    }
                    if let Some(c)=clock(&sector.facts.clocks,state){
                        new_timed_days+=i64::from(sector.timed[day]==0);
                        clock_changes+=i64::from(!p.preferred_clock[usize::from(state)]);
                        if day.is_multiple_of(7){sunday_minutes+=i64::from(c.paid);}
                    }
                }
                // These are construction preferences, not invented hard
                // floors or extra published CP-SAT objectives. Avoid empty
                // timed days and prefer actual, balanced Sunday service
                // before later soft penalties once demand gains tie.
                let coverage:[i64;6]=std::array::from_fn(|j|score[j]);
                let rank=(coverage,-new_timed_days,-sunday_days,sunday_load,-sunday_minutes,clock_changes,score);
                if best.as_ref().is_none_or(|(old,_)|rank<*old){best=Some((rank,index));}
            }
            best.map_or(0,|(_,i)|i)
        };
        let pattern=p.catalog[choice];
        for (day,&state) in pattern.states.iter().enumerate().take(p.facts.days){
            if work(state){sector.presence[day]+=1;}
            if clock(&sector.facts.clocks,state).is_some(){sector.timed[day]+=1;}
        }
        for (band,count) in sector.facts.bands.iter().zip(&mut sector.counts){
            if band.clock_mask&(1u16<<pattern.states[band.day])!=0{count.insert(band,p.role);}
        }
        plan.employees[i].pattern=Some(choice);
    }
}
