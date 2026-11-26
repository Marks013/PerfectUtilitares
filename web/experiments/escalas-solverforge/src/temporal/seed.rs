//! Bounded greedy seed. Actual WORK segments contribute to mandatory
//! coverage; DUTY only affects daily presence. The native solver still
//! receives the full selected domain and the independent score is recomputed.
use std::{collections::{BTreeMap,BTreeSet},sync::Arc,time::Instant};
use crate::temporal_domain::TemporalPlan;
use super::{Band,Clock,INACTIVE,MAX_DAYS,TemporalFacts,clock,clock_masks,work};

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
// Construction-only tie-break: distribute same-role WORK across real
// civil service intervals. No foreign reference, hard floor or new objective.
struct RoleService{
    parts:Vec<(i64,u16,u16)>,horizon:Vec<i64>,sundays:Vec<i64>,
}
impl RoleService{
    fn new(clocks:&[Clock])->Self{
        let mut edges=BTreeSet::new();
        for c in clocks{for (_,a,b) in c.civil_parts(){edges.insert(a);edges.insert(b);}}
        let edges:Vec<_>=edges.into_iter().collect();
        let parts:Vec<_>=edges.windows(2).filter_map(|w|{
            let (current,previous)=clock_masks(clocks,w[0],w[1]);
            (current|previous!=0).then_some((i64::from(w[1]-w[0]),current,previous))
        }).collect();
        let n=parts.len();
        Self{parts,horizon:vec![0;n],sundays:vec![0;n]}
    }
    fn gains(&self,days:usize,weekday_offset:usize)->[[i64;16];MAX_DAYS]{
        let mut gains=[[0i64;16];MAX_DAYS];
        let peak=self.horizon.iter().copied().max().unwrap_or(0);
        let sunday_peak=self.sundays.iter().copied().max().unwrap_or(0);
        for (i,&(minutes,current,previous)) in self.parts.iter().enumerate(){
            let horizon_gain=(peak-self.horizon[i])*minutes;
            let sunday_gain=(sunday_peak-self.sundays[i])*minutes;
            for day in 0..days{
                let gain=horizon_gain+if (weekday_offset+day).is_multiple_of(7){sunday_gain}else{0};
                for (assignment,mut mask) in [(Some(day),current),(day.checked_sub(1),previous)]{
                    let Some(d)=assignment else{continue;};
                    while mask!=0{
                        let state=mask.trailing_zeros() as usize;mask&=mask-1;
                        gains[d][state]+=gain;
                    }
                }
            }
        }
        gains
    }
    fn insert(&mut self,states:&[u8;MAX_DAYS],days:usize,weekday_offset:usize){
        let serves=|d:usize,mask:u16|states[d]<16&&mask&(1u16<<states[d])!=0;
        for (i,&(_,current,previous)) in self.parts.iter().enumerate(){
            for day in 0..days{
                if serves(day,current)||day>0&&serves(day-1,previous){
                    self.horizon[i]+=1;
                    if (weekday_offset+day).is_multiple_of(7){self.sundays[i]+=1;}
                }
            }
        }
    }
}
struct Sector{
    facts:Arc<TemporalFacts>,counts:Vec<Counts>,presence:[i64;MAX_DAYS],timed:[i64;MAX_DAYS],
    role_service:BTreeMap<usize,RoleService>,
}
pub(super) fn construct(plan:&mut TemporalPlan,deadline:Instant){
    let mut sectors=BTreeMap::<usize,Sector>::new();
    let mut order:Vec<_>=(0..plan.employees.len()).collect();
    order.sort_by_key(|&i|(plan.employees[i].allowed.len(),i));
    for i in order{
        let p=&plan.employees[i];
        let sector=sectors.entry(p.sector).or_insert_with(||Sector{
            facts:Arc::clone(&p.facts),counts:p.facts.bands.iter().map(Counts::new).collect(),presence:[0;MAX_DAYS],timed:[0;MAX_DAYS],role_service:BTreeMap::new()
        });
        let choice=if let Some(index)=p.pattern{index}
        else if Instant::now()>=deadline{0}
        else{
            let mut benefits=[[[0i64;6];16];MAX_DAYS];
            for (b,count) in sector.facts.bands.iter().zip(&sector.counts){
                let gain=count.gain(b,p.role)*i64::from(b.end-b.start);
                if gain==0{continue;}
                for (assignment_day,mask) in [(Some(b.day),b.clock_mask),(b.day.checked_sub(1),b.previous_mask)]{
                    let Some(assignment_day)=assignment_day else{continue;};
                    for (state,benefit) in benefits[assignment_day].iter_mut().enumerate(){
                    if mask&(1u16<<state)==0{continue;}
                    if b.estimated{
                        benefit[1]+=gain;
                        if sector.facts.weekday(b.day)==0{benefit[2]+=gain;}
                        if sector.facts.movement_enabled{benefit[4]+=gain*sector.facts.priority[b.day].unwrap_or(2);}
                        let close=(b.end.min(sector.facts.closing)-b.start.max(sector.facts.closing-60)).max(0);
                        benefit[5]+=count.gain(b,p.role)*i64::from(close);
                    }else{benefit[0]+=gain;}
                    }
                }
            }
            let role_gains=sector.role_service.get(&p.role).map_or([[0i64;16];MAX_DAYS],|service|service.gains(p.facts.days,p.facts.weekday_offset));
            let mut best=None;
            for &index in p.allowed.iter(){
                if index.is_multiple_of(64)&&Instant::now()>=deadline{break;}
                let mut score=p.pattern_cost(index);
                let mut new_timed_days=0i64;let mut sunday_days=0i64;let mut sunday_load=0i64;let mut sunday_minutes=0i64;
                let mut clock_changes=0i64;let mut role_gain=0i64;
                for (day,&state) in p.catalog[index].states.iter().enumerate().take(p.facts.days){
                    if state==INACTIVE{continue;}
                    for (cost,gain) in score[..6].iter_mut().zip(benefits[day][usize::from(state)]){*cost-=gain;}
                    role_gain+=role_gains[day][usize::from(state)];
                    if work(state){
                        score[11]+=sector.presence[day];
                        if sector.facts.weekday(day)==0{sunday_days+=1;sunday_load+=sector.presence[day];}
                    }
                    if let Some(c)=clock(&sector.facts.clocks,state){
                        new_timed_days+=i64::from(sector.timed[day]==0);
                        clock_changes+=i64::from(!p.preferred_clock[usize::from(state)]);
                        if sector.facts.weekday(day)==0{sunday_minutes+=i64::from(c.paid);}
                    }
                }
                // These are construction preferences, not invented hard
                // floors or extra published CP-SAT objectives. Avoid empty
                // timed days and prefer actual, balanced Sunday service
                // before later soft penalties once demand gains tie.
                let coverage:[i64;6]=std::array::from_fn(|j|score[j]);
                let rank=(coverage,-new_timed_days,-sunday_days,sunday_load,-sunday_minutes,-role_gain,clock_changes,score);
                if best.as_ref().is_none_or(|(old,_)|rank<*old){best=Some((rank,index));}
            }
            best.map_or(0,|(_,i)|i)
        };
        let pattern=p.catalog[choice];
        sector.role_service.entry(p.role).or_insert_with(||RoleService::new(&p.facts.clocks))
            .insert(&pattern.states,p.facts.days,p.facts.weekday_offset);
        for (day,&state) in pattern.states.iter().enumerate().take(p.facts.days){
            if work(state){sector.presence[day]+=1;}
            if clock(&sector.facts.clocks,state).is_some(){sector.timed[day]+=1;}
        }
        for (band,count) in sector.facts.bands.iter().zip(&mut sector.counts){
            let serves=|d:usize,mask:u16|work(pattern.states[d])&&mask&(1u16<<pattern.states[d])!=0;
            if serves(band.day,band.clock_mask)||band.day>0&&serves(band.day-1,band.previous_mask){count.insert(band,p.role);}
        }
        plan.employees[i].pattern=Some(choice);
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn role_service_tie_break_uses_real_work_and_preserves_empty_preference(){
        let clocks=[
            Clock{id:"early".into(),segments:vec![(420,660),(720,960)],paid:480,start:420,end:960},
            Clock{id:"late".into(),segments:vec![(480,720),(780,1020)],paid:480,start:480,end:1020},
        ];
        let mut service=RoleService::new(&clocks);
        assert!(service.gains(7,0).iter().flatten().all(|&x|x==0));
        let mut states=[INACTIVE;MAX_DAYS];
        states[0]=3;
        service.insert(&states,7,0);
        let gains=service.gains(7,0);
        assert!(gains[1][4]>gains[1][3]);
        assert!(gains[0][4]>gains[1][4]);
        assert_eq!(gains[1][15],0); // DUTY is not timed WORK.
        // A separate role has no inherited preference.
        assert!(RoleService::new(&clocks).gains(7,0).iter().flatten().all(|&x|x==0));
    }

    #[test]
    fn role_service_counts_overnight_by_civil_date_without_inactive_shifts(){
        let clocks=[Clock{id:"night".into(),segments:vec![(1380,1440),(1500,1560)],paid:120,start:1380,end:1560}];
        let mut service=RoleService::new(&clocks);
        let mut states=[INACTIVE;MAX_DAYS];
        states[0]=3; // Saturday into Sunday (weekday offset 6).
        service.insert(&states,2,6);
        assert_eq!(service.horizon,vec![1,1]);
        assert_eq!(service.sundays,vec![1,0]);
        let mut one_day=RoleService::new(&clocks);
        one_day.insert(&states,1,6);
        assert_eq!(one_day.horizon,vec![0,1]);
        assert_eq!(one_day.sundays,vec![0,0]);
    }
}
