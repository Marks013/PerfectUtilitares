//! Bounded greedy seed. Actual WORK segments contribute to mandatory
//! coverage; DUTY only affects daily presence. The native solver still
//! receives the full selected domain and the independent score is recomputed.
use std::{collections::BTreeMap,sync::Arc,time::Instant};
use crate::temporal_domain::TemporalPlan;
mod polish;
use super::{Band,INACTIVE,MAX_DAYS,TemporalFacts,clock,work};

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
// Allocate immutable entries first, then people whose legal timed paths
// are the only source of service on some civil dates. A small UNTIMED or
// partial domain must not consume the remaining worker's exclusive dates.
fn construction_order(plan:&TemporalPlan)->Vec<usize>{
    let available:Vec<u64>=plan.employees.iter().map(|p|{
        if p.untimed{return 0;}
        if let Some(index)=p.pattern{return p.catalog[index].civil_work;}
        p.allowed.iter().fold(0,|days,&index|days|p.catalog[index].civil_work)
    }).collect();
    let mut suppliers=BTreeMap::<usize,[u16;MAX_DAYS]>::new();
    for (p,&available) in plan.employees.iter().zip(&available){
        let counts=suppliers.entry(p.sector).or_insert([0;MAX_DAYS]);
        for (day,count) in counts.iter_mut().enumerate().take(p.facts.days){
            if available&(1u64<<day)!=0{*count+=1;}
        }
    }
    let mut order:Vec<_>=(0..plan.employees.len()).collect();
    order.sort_by_key(|&i|{
        let p=&plan.employees[i];
        let exclusive=(0..p.facts.days).filter(|&d|
            available[i]&(1u64<<d)!=0&&suppliers[&p.sector][d]==1).count();
        (p.pattern.is_none(),std::cmp::Reverse(exclusive),p.allowed.len(),i)
    });
    order
}
pub(super) fn construct(plan:&mut TemporalPlan,deadline:Instant){
    let complete=plan.employees.iter().all(|p|p.pattern.is_some());
    let mut sectors=BTreeMap::<usize,Sector>::new();
    let mut timed_roles=BTreeMap::<(usize,usize),usize>::new();
    for person in &plan.employees{
        if !person.untimed{*timed_roles.entry((person.sector,person.role)).or_default()+=1;}
    }
    let order=construction_order(plan);
    for i in order{
        let p=&plan.employees[i];
        // Clock reach is a collective service tie. Without another timed
        // colleague in this role, keep the configured reference on ties.
        let pooled=timed_roles.get(&(p.sector,p.role)).is_some_and(|&count|count>1);
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
            let mut best=None;
            for &index in p.allowed.iter(){
                if index.is_multiple_of(64)&&Instant::now()>=deadline{break;}
                let mut score=p.pattern_cost(index);
                let mut new_timed_days=0i64;let mut sunday_days=0i64;let mut sunday_load=0i64;let mut sunday_minutes=0i64;
                let mut clock_preference=[0i64;3];
                for (day,&state) in p.catalog[index].states.iter().enumerate().take(p.facts.days){
                    if state==INACTIVE{continue;}
                    for (cost,gain) in score[..6].iter_mut().zip(benefits[day][usize::from(state)]){*cost-=gain;}
                    if work(state){
                        score[11]+=sector.presence[day];
                        if sector.facts.weekday(day)==0{sunday_days+=1;sunday_load+=sector.presence[day];}
                    }
                    if let Some(c)=clock(&sector.facts.clocks,state){
                        new_timed_days+=i64::from(sector.timed[day]==0);
                        if pooled{
                            clock_preference[0]+=i64::from(c.end()-c.start()-c.paid);
                            clock_preference[1]+=i64::from((sector.facts.closing-c.end()).max(0));
                        }
                        clock_preference[2]+=i64::from(!p.preferred_clock[usize::from(state)]);
                        if sector.facts.weekday(day)==0{sunday_minutes+=i64::from(c.paid);}
                    }
                }
                // These are construction preferences, not invented hard
                // floors or extra published CP-SAT objectives. Avoid empty
                // timed days and prefer actual, balanced Sunday service
                // before later soft penalties once demand gains tie.
                let coverage:[i64;6]=std::array::from_fn(|j|score[j]);
                // Geometry is a final tie, never a reason to sacrifice saved
                // HOURS_ONLY clocks or an existing personal objective.
                let rank=(coverage,-new_timed_days,-sunday_days,sunday_load,-sunday_minutes,score,clock_preference);
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
            let serves=|d:usize,mask:u16|work(pattern.states[d])&&mask&(1u16<<pattern.states[d])!=0;
            if serves(band.day,band.clock_mask)||band.day>0&&serves(band.day-1,band.previous_mask){count.insert(band,p.role);}
        }
        plan.employees[i].pattern=Some(choice);
    }
    if !complete { polish::improve(plan,deadline); }
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::time::Duration;
    use serde_json::{Value,json};
    use super::super::read;

    fn order_fixture(partial:bool)->TemporalPlan{
        let corpus:Value=serde_json::from_str(include_str!("../e2-wire-contract.json")).unwrap();
        let mut data=corpus["base"].clone();
        data["input"]["endDate"]=json!("2026-11-21");
        data["input"]["assignments"]=json!([]);data["input"]["demands"]=json!([]);
        let template=data["input"]["employees"][0].clone();
        data["input"]["employees"]=Value::Array((0..3).map(|i|{
            let mut p=template.clone();
            p["id"]=json!(format!("person-{i}"));p["name"]=json!(format!("Synthetic person {i}"));
            if partial&&i==1{
                p["activeFrom"]=json!("2026-11-04");p["activeUntil"]=json!("2026-11-17");
            }
            if partial&&i==2{
                p["activeFrom"]=json!("2026-11-08");p["scheduleMode"]=json!("UNTIMED");p["shiftIds"]=json!([]);
            }
            p
        }).collect());
        read(&data,Instant::now()+Duration::from_secs(5)).unwrap()
    }
    #[test]
    fn exclusive_timed_dates_precede_smaller_partial_and_untimed_domains(){
        let mut plan=order_fixture(true);
        assert!(plan.employees[2].untimed);
        assert!(plan.employees[2].allowed.len()<plan.employees[0].allowed.len());
        let before:Vec<_>=plan.employees.iter().map(|p|p.pattern).collect();
        let order=construction_order(&plan);assert_eq!(order[0],0);
        assert_eq!(order,construction_order(&plan));
        assert_eq!(plan.employees.iter().map(|p|p.pattern).collect::<Vec<_>>(),before);
        // A complete admitted choice is counted before an uninitialized
        // exclusive worker. No saved or pinned pattern is modified by sorting.
        let selected=plan.employees[1].allowed[0];plan.employees[1].pattern=Some(selected);
        assert_eq!(construction_order(&plan)[0],1);
        assert_eq!(plan.employees[1].pattern,Some(selected));
    }
    #[test]
    fn interchangeable_timed_people_keep_the_original_order(){
        let plan=order_fixture(false);
        assert!(plan.employees.iter().all(|p|!p.untimed&&p.pattern.is_none()));
        let mut expected:Vec<_>=(0..plan.employees.len()).collect();
        expected.sort_by_key(|&i|(plan.employees[i].allowed.len(),i));
        assert_eq!(construction_order(&plan),expected);
    }
}
