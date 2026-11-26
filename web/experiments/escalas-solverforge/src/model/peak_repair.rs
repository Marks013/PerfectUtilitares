//! Bounded sector-local weekday repair. Never borrow another engine's roster.
//! Exact civil intervals, estimated/confirmed demand, role floors and legal
//! personal domains remain distinct. A reduced peak may redistribute a
//! deficit between weekdays, but not increase any protected interval sum
//! or peak. Unmatched intervals must individually be nonincreasing.
use std::collections::BTreeMap;
use std::time::Instant;
use crate::domain::{Employee,Plan};
use super::coverage::{Band,Sector};
use super::patterns::worked;
use super::presence::Presence;

const MAX_ATTEMPTS:usize=100_000;
const PASSES:usize=4;

#[derive(Default,Debug)]
pub struct PeakRepairStats{
    pub attempted:usize,
    pub accepted:usize,
    pub before_peak_sum:i64,
    pub after_peak_sum:i64,
    pub before_pairs:i64,
    pub after_pairs:i64,
    pub deadline_reached:bool,
    pub limit_reached:bool,
}

// A key retains the exact civil interval, even for adjacent equal floors.
// For each interval there is at most one band per day and demand class.
type Key=(i32,i64,bool);
type DayBands<'a>=BTreeMap<Key,&'a Band>;
fn day_bands(facts:&Sector)->Vec<DayBands<'_>>{
    let mut out=vec![BTreeMap::new();facts.days];
    for b in &facts.bands{
        out[b.day].insert((b.start,b.minutes,b.estimated),b);
    }
    out
}
fn peak_sum(plan:&Plan)->i64{super::coverage::evaluate(plan)[4]}

fn gaps(b:Option<&&Band>,att:Presence)->(i64,i64,BTreeMap<Presence,i64>){
    let Some(b)=b else{return (0,0,BTreeMap::new());};
    let parts=b.gap_components(att);
    let roles=b.role_floors.iter().zip(parts.iter().skip(1))
        .map(|((mask,_),gap)|(*mask,*gap)).collect();
    (b.gap(att),parts[0],roles)
}
fn pair_preserved(a:i64,b:i64,c:i64,d:i64)->bool{
    c+d<=a+b&&c.max(d)<=a.max(b)
}

// Only the two affected days are scored. Equal-clock work is transferred
// within the same person/week and never between Sunday and weekday.
fn transfer_gain(days:&[DayBands<'_>],from:usize,to:usize,
                 old_from:Presence,old_to:Presence,bit:Presence)->Option<i64>{
    let new_from=old_from&!bit;
    let new_to=old_to|bit;
    if new_from.is_empty(){return None;}
    let mut gain=0i64;
    for key in days[from].keys().chain(days[to].keys().filter(|k|!days[from].contains_key(*k))){
        let a=days[from].get(key);
        let b=days[to].get(key);
        let (old_a,gen_a,role_a)=gaps(a,old_from);
        let (old_b,gen_b,role_b)=gaps(b,old_to);
        let (new_a,gen_c,role_c)=gaps(a,new_from);
        let (new_b,gen_d,role_d)=gaps(b,new_to);
        if !pair_preserved(old_a,old_b,new_a,new_b)||!pair_preserved(gen_a,gen_b,gen_c,gen_d){return None;}
        // Hard demand cannot acquire a deficit on either date.
        if !key.2&&(new_a>old_a||new_b>old_b||gen_c>gen_a||gen_d>gen_b){return None;}
        for mask in role_a.keys().chain(role_b.keys().filter(|m|!role_a.contains_key(*m))){
            let a=*role_a.get(mask).unwrap_or(&0);
            let b=*role_b.get(mask).unwrap_or(&0);
            let c=*role_c.get(mask).unwrap_or(&0);
            let d=*role_d.get(mask).unwrap_or(&0);
            if !pair_preserved(a,b,c,d)||!key.2&&(c>a||d>b){return None;}
        }
        if key.2{gain+=(old_a*old_a+old_b*old_b-new_a*new_a-new_b*new_b)*key.1;}
    }
    // A strictly decreasing squared-gap potential allows plateaus in the
    // sector maximum without accepting cycles or a new interval peak.
    (gain>0).then_some(gain)
}

fn personal_preserved(p:&Employee,old:u32,new:u32)->bool{
    let before=p.rules.rest_quality(old,p.locked_off,p.facts.days);
    let after=p.rules.rest_quality(new,p.locked_off,p.facts.days);
    after.iter().zip(before).all(|(a,b)|*a<=b)
        &&((p.saved_work^new)&p.saved_known).count_ones()<=((p.saved_work^old)&p.saved_known).count_ones()
        &&p.rules.preferences(new,p.facts.days)<=p.rules.preferences(old,p.facts.days)
}
fn allowed_swap(p:&Employee,old:u32,from:usize,to:usize)->Option<usize>{
    let mask=old^((1u32<<from)|(1u32<<to));
    let index=p.catalog.binary_search(&mask).ok()?;
    (p.allowed.binary_search(&index).is_ok()&&personal_preserved(p,old,mask)).then_some(index)
}

pub fn polish_peaks(plan:&mut Plan,deadline:Instant)->PeakRepairStats{
    let mut stats=PeakRepairStats::default();
    if plan.employees.iter().any(|p|p.pattern.is_none()){return stats;}
    stats.before_peak_sum=peak_sum(plan);
    stats.after_peak_sum=stats.before_peak_sum;
    stats.before_pairs=super::rest_repair::total_pairs(plan);
    stats.after_pairs=stats.before_pairs;
    let mut sectors=BTreeMap::<usize,Vec<usize>>::new();
    for (i,p) in plan.employees.iter().enumerate(){sectors.entry(p.sector).or_default().push(i);}
    'sectors:for group in sectors.values(){
        let facts=plan.employees[group[0]].facts.clone();
        let bands=day_bands(&facts);
        let mut att=[Presence::EMPTY;28];
        for &i in group{
            let p=&plan.employees[i];
            let mask=p.mask().unwrap();
            for (day,a) in att.iter_mut().enumerate().take(facts.days){
                if worked(mask,day){*a|=Presence::one(p.id);}
            }
        }
        for _ in 0..PASSES{
            let mut changed=false;
            for &i in group{
                if Instant::now()>=deadline{stats.deadline_reached=true;break 'sectors;}
                let p=&plan.employees[i];
                if p.pinned{continue;}
                let old=p.mask().unwrap();
                let bit=Presence::one(p.id);
                let mut best=None;
                for week in 0..facts.days/7{
                    for from in week*7+1..week*7+6{
                        if !worked(old,from){continue;}
                        for to in week*7+1..week*7+6{
                            if worked(old,to){continue;}
                            if stats.attempted>=MAX_ATTEMPTS{stats.limit_reached=true;break 'sectors;}
                            if stats.attempted%32==0&&Instant::now()>=deadline{stats.deadline_reached=true;break 'sectors;}
                            stats.attempted+=1;
                            let Some(index)=allowed_swap(p,old,from,to) else{continue;};
                            let Some(gain)=transfer_gain(&bands,from,to,att[from],att[to],bit) else{continue;};
                            if best.as_ref().is_none_or(|(prior,_,_,_)|gain>*prior){
                                best=Some((gain,index,from,to));
                            }
                        }
                    }
                }
                if let Some((_,index,from,to))=best{
                    att[from]&=!bit;att[to]|=bit;
                    plan.employees[i].pattern=Some(index);
                    stats.accepted+=1;changed=true;
                }
            }
            if !changed{break;}
        }
    }
    stats.after_peak_sum=peak_sum(plan);
    stats.after_pairs=super::rest_repair::total_pairs(plan);
    stats.deadline_reached|=Instant::now()>=deadline;
    stats
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::{model,wire};
    use serde_json::{Value,json};
    use std::time::Duration;

    fn sector(start:i32,role:bool)->Sector{
        let eligible=Presence::from_low(7);
        Sector{days:7,members:3,bands:vec![
            Band{day:1,start:480,minutes:60,estimated:true,minimum:3,eligible,role_floors:vec![]},
            Band{day:3,start,minutes:60,estimated:true,minimum:3,eligible,
                role_floors:if role{vec![(Presence::one(0),1)]}else{vec![]}},
        ]}
    }
    #[test]
    fn balances_two_missing_into_one_on_each_day_without_growing_total(){
        let facts=sector(480,false);
        let bands=day_bands(&facts);
        assert_eq!(transfer_gain(&bands,1,3,Presence::from_low(7),Presence::one(2),Presence::one(0)),Some(120));
        // A different civil interval must not receive a transferred deficit.
        let facts=sector(540,false);
        assert_eq!(transfer_gain(&day_bands(&facts),1,3,Presence::from_low(7),Presence::one(2),Presence::one(0)),None);
    }
    #[test]
    fn refuses_new_role_deficit_even_if_general_peak_improves(){
        let mut facts=sector(480,false);
        facts.bands[0].role_floors=vec![(Presence::one(0),1)];
        facts.bands[1].role_floors=vec![(Presence::one(0),0)];
        assert_eq!(transfer_gain(&day_bands(&facts),1,3,Presence::from_low(7),Presence::one(2),Presence::one(0)),None);
    }
    #[test]
    fn repairs_a_sector_with_zero_sunday_and_rest_pairs(){
        let corpus:Value=serde_json::from_str(include_str!("../e2-wire-contract.json")).unwrap();
        let mut input=corpus["base"].clone();
        input["input"]["assignments"]=json!([]);
        for n in 1..3{
            let mut p=input["input"]["employees"][0].clone();
            p["id"]=json!(format!("person-{n}"));p["name"]=json!(format!("Synthetic {n}"));
            input["input"]["employees"].as_array_mut().unwrap().push(p);
        }
        // Two people take Sunday/Tuesday OFF, the third Monday/Friday.
        // The weekday deficit total is invariant, but Tuesday's peak is 2.
        // All five weekdays have an equal estimated floor; the third
        // employee keeps Sunday presence. All rest pairs start at zero.
        input["input"]["demands"]=Value::Array((1..6).map(|d|json!({
            "id":format!("weekday-{d}"),"date":wire::date(d),"sector":"S",
            "start":480,"end":540,"minimum":3,"estimated":true
        })).collect());
        let mut plan=wire::read(&input,Instant::now()+Duration::from_secs(5)).unwrap();
        for (p,off) in plan.employees.iter_mut().zip([5u32,5,34]){
            p.pattern=p.catalog.binary_search(&(127^off)).ok();
            assert!(p.allowed.binary_search(&p.pattern.unwrap()).is_ok());
        }
        assert!(model::validate_complete(&plan));
        let before=model::evaluate(&plan);
        assert_eq!(before[1],0);assert_eq!(before[4],2);assert_eq!(before[6],0);
        let stats=polish_peaks(&mut plan,Instant::now()+Duration::from_secs(2));
        assert!(stats.accepted>0);
        assert_eq!((stats.before_peak_sum,stats.after_peak_sum),(2,1));
        let after=model::evaluate(&plan);
        assert_eq!(after[3],before[3]);assert_eq!(after[6],0);
        assert!(model::validate_complete(&plan));
    }
}
