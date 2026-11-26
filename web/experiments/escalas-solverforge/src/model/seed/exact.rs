//! Bounded exact neighbors for fixed-clock six-week construction.
//! Sample membership is not legality: admit independently checked exchanges
//! while retaining the incumbent and the existing native-domain size limit.
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;
use crate::domain::{Employee,Plan};
use super::super::coverage::{Cost,Member,Sector,group_cost};
use super::super::patterns::{SCALE_DOMAIN_LIMIT,legal_profile,worked};
use super::super::presence::Presence;

const MAX_TRIALS:usize=100_000;
type Attendance=[Presence;42];
fn apply(att:&mut Attendance,person:&Employee,old:u64,new:u64){
    let bit=Presence::one(person.id);
    for (day,present) in att.iter_mut().enumerate().take(person.facts.days){
        if worked(old,day){*present&=!bit;}
        if worked(new,day){*present|=bit;}
    }
}
fn legal(person:&Employee,mask:u64)->bool{
    legal_profile(mask,42,person.locked_work,person.locked_off,person.sunday_cap,
        person.comparable_weeks,person.rules)
}
fn personal(person:&Employee,old:u64,new:u64)->bool{
    let changes=|m:u64|((person.saved_work^m)&person.saved_known).count_ones();
    person.rules.rest_quality(new,person.locked_off,42)[0]
        <=person.rules.rest_quality(old,person.locked_off,42)[0]
        &&changes(new)<=changes(old)
        &&person.rules.preferences(new,42)<=person.rules.preferences(old,42)
}

fn coverage_preserved(facts:&Sector,before:&Attendance,after:&Attendance)->bool{
    if (0..facts.days).any(|d|!before[d].is_empty()&&after[d].is_empty()){return false;}
    type Key=(bool,i32,i64,Option<Presence>,bool);
    let mut bands=BTreeMap::<Key,[i64;4]>::new();
    for band in &facts.bands{
        let a=band.gap_components(before[band.day]);
        let b=band.gap_components(after[band.day]);
        if (!band.estimated||band.day.is_multiple_of(7))&&a.iter().zip(&b).any(|(a,b)|b>a){return false;}
        let entries=std::iter::once((None,band.gap(before[band.day]),band.gap(after[band.day])))
            .chain(band.role_floors.iter().enumerate().map(|(i,(role,_))|(Some(*role),a[i+1],b[i+1])));
        for (role,old,new) in entries{
            for sunday in [false,true]{
                if sunday&&!band.day.is_multiple_of(7){continue;}
                let v=bands.entry((band.estimated,band.start,band.minutes,role,sunday)).or_default();
                v[0]+=old*band.minutes;v[1]+=new*band.minutes;
                v[2]=v[2].max(old);v[3]=v[3].max(new);
            }
        }
    }
    bands.values().all(|v|v[1]<=v[0]&&v[3]<=v[2])
}
fn changed_cost(rows:&[Member],first:(usize,u64),second:Option<(usize,u64)>)->Cost{
    let mut candidate=rows.to_vec();candidate[first.0].mask=Some(first.1);
    if let Some((slot,mask))=second{candidate[slot].mask=Some(mask);}
    group_cost(candidate.iter())
}
fn acceptable(before:Cost,after:Cost)->bool{
    after[1]<before[1]&&after.iter().zip(before).all(|(a,b)|*a<=b)
}
fn admit(person:&mut Employee,mask:u64){
    assert!(legal(person,mask),"unchecked exact witness");
    if let Some(index)=person.catalog.binary_search(&mask).ok().filter(|i|person.allowed.binary_search(i).is_ok()){
        person.pattern=Some(index);return;
    }
    let incumbent=person.mask().expect("complete fixed seed");
    let mut catalog:Vec<_>=person.allowed.iter().map(|&i|person.catalog[i]).collect();
    catalog.push(mask);catalog.sort_unstable();catalog.dedup();
    while catalog.len()>SCALE_DOMAIN_LIMIT{
        let remove=catalog.iter().rposition(|&m|m!=incumbent&&m!=mask).expect("bounded witness slot");
        catalog.remove(remove);
    }
    person.pattern=Some(catalog.binary_search(&mask).unwrap());
    person.allowed=Arc::from((0..catalog.len()).collect::<Vec<_>>());
    person.catalog=Arc::new(catalog);person.pinned=person.allowed.len()==1;
}

pub(super) fn improve(plan:&mut Plan,deadline:Instant)->usize{
    if Instant::now()>=deadline||plan.employees.iter().any(|p|p.pattern.is_none()){return 0;}
    let mut groups=BTreeMap::<usize,Vec<usize>>::new();
    for (i,p) in plan.employees.iter().enumerate(){
        if p.facts.days==42{groups.entry(p.sector).or_default().push(i);}
    }
    let count=groups.len();let mut trials=0usize;let mut accepted=0usize;
    for (number,group) in groups.into_values().enumerate(){
        if Instant::now()>=deadline||trials>=MAX_TRIALS{break;}
        let now=Instant::now();let until=(now+deadline.saturating_duration_since(now)/(count-number) as u32).min(deadline);
        let facts=Arc::clone(&plan.employees[group[0]].facts);
        let mut att=[Presence::EMPTY;42];
        for &i in &group{let p=&plan.employees[i];apply(&mut att,p,0,p.mask().unwrap());}
        for _ in 0..4{
            let mut changed=false;
            for (slot,&i) in group.iter().enumerate(){
                if Instant::now()>=until||trials>=MAX_TRIALS{break;}
                let p=&plan.employees[i];if p.pinned{continue;}
                let rows:Vec<_>=group.iter().map(|&j|plan.employees[j].member()).collect();
                let before=group_cost(rows.iter());if before[1]==0{break;}
                let old=p.mask().unwrap();let bit=Presence::one(p.id);let mut best=None;
                'neighbors: for add in (0..42).step_by(7){
                    if worked(old,add)||!facts.bands.iter().any(|b|b.estimated&&b.day==add
                        &&b.gap(att[add]|bit)<b.gap(att[add])){continue;}
                    for remove in (0..42).step_by(7){
                        if !worked(old,remove){continue;}
                        for from in add+1..add+6{
                            if !worked(old,from){continue;}
                            for to in remove+1..remove+6{
                                if worked(old,to){continue;}
                                if trials>=MAX_TRIALS||Instant::now()>=until{break 'neighbors;}
                                trials+=1;
                                let mask=old^(1u64<<add)^(1u64<<remove)^(1u64<<from)^(1u64<<to);
                                if !legal(p,mask)||!personal(p,old,mask){continue;}
                                let mut trial=att;apply(&mut trial,p,old,mask);
                                let after=changed_cost(&rows,(slot,mask),None);
                                if after[1]>=before[1]{continue;}
                                if acceptable(before,after)&&coverage_preserved(&facts,&att,&trial){
                                    if best.as_ref().is_none_or(|(c,_,_)|after<*c){best=Some((after,mask,None));}
                                    continue;
                                }
                                // Validate the entire compound move, never its
                                // intermediate state. Same cohort fixes geometry.
                                for (peer_slot,&j) in group.iter().enumerate(){
                                    let peer=&plan.employees[j];
                                    if j==i||peer.pinned||peer.cohort!=p.cohort||peer.rest_group!=p.rest_group{continue;}
                                    let peer_old=peer.mask().unwrap();if worked(peer_old,from){continue;}
                                    for spare in add+1..add+6{
                                        if !worked(peer_old,spare){continue;}
                                        if trials>=MAX_TRIALS||Instant::now()>=until{break 'neighbors;}
                                        trials+=1;let peer_new=peer_old^(1u64<<from)^(1u64<<spare);
                                        if !legal(peer,peer_new)||!personal(peer,peer_old,peer_new){continue;}
                                        let after=changed_cost(&rows,(slot,mask),Some((peer_slot,peer_new)));
                                        if !acceptable(before,after)||best.as_ref().is_some_and(|(c,_,_)|after>=*c){continue;}
                                        let mut compound=trial;apply(&mut compound,peer,peer_old,peer_new);
                                        if coverage_preserved(&facts,&att,&compound){best=Some((after,mask,Some((j,peer_new))));}
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some((_,mask,peer))=best{
                    apply(&mut att,&plan.employees[i],old,mask);admit(&mut plan.employees[i],mask);
                    if let Some((j,next))=peer{
                        let old=plan.employees[j].mask().unwrap();apply(&mut att,&plan.employees[j],old,next);
                        admit(&mut plan.employees[j],next);
                    }
                    plan.score=None;accepted+=1;changed=true;
                }
            }
            if !changed{break;}
        }
    }
    accepted
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::time::Duration;
    use serde_json::{Value,json};
    use crate::{wire,model};
    use super::super::super::coverage::Band;
    fn fixture()->Plan{
        let corpus:Value=serde_json::from_str(include_str!("../../e2-wire-contract.json")).unwrap();
        let mut value=corpus["base"].clone();
        value["input"]["endDate"]=json!("2026-12-12");value["input"]["assignments"]=json!([]);
        let template=value["input"]["employees"][0].clone();
        value["input"]["employees"]=Value::Array((0..12).map(|i|{
            let mut p=template.clone();p["id"]=json!(format!("person-{i}"));p["name"]=json!(format!("Synthetic person {i}"));p
        }).collect());
        value["input"]["demands"]=Value::Array((0..6).map(|w|json!({"id":format!("s-{w}"),
            "date":wire::date(w*7),"sector":"S","role":"Caixa","start":480,"end":540,"minimum":6,"estimated":true})).collect());
        let mut plan=wire::read(&value,Instant::now()+Duration::from_secs(5)).unwrap();
        let mask=(0..6).fold(0u64,|m,w|m|((if w%2==0{121u64}else{122u64})<<(w*7)));
        for p in &mut plan.employees{
            assert!(legal(p,mask));
            p.catalog=Arc::new(vec![mask]);p.allowed=Arc::from(vec![0usize]);p.pattern=Some(0);p.pinned=false;
        }
        plan
    }
    #[test]
    fn exact_witness_repairs_sundays_outside_the_sample(){
        let mut plan=fixture();let before=model::evaluate(&plan);assert!(before[1]>0);
        assert!(improve(&mut plan,Instant::now()+Duration::from_secs(5))>0);
        assert!(model::validate_complete(&plan));let after=model::evaluate(&plan);
        assert_eq!(after[1],0);assert!(after.iter().zip(before).all(|(a,b)|*a<=b));
        assert!(plan.employees.iter().all(|p|p.allowed.len()<=SCALE_DOMAIN_LIMIT));
    }
    #[test]
    fn locks_and_expired_deadlines_are_preserved(){
        let mut plan=fixture();let old:Vec<_>=plan.employees.iter().map(Employee::mask).collect();
        assert_eq!(improve(&mut plan,Instant::now()),0);
        for p in &mut plan.employees{
            for d in (0..42).step_by(7){if worked(p.mask().unwrap(),d){p.locked_work|=1u64<<d;}}
        }
        assert_eq!(improve(&mut plan,Instant::now()+Duration::from_secs(1)),0);
        assert_eq!(plan.employees.iter().map(Employee::mask).collect::<Vec<_>>(),old);
    }
    #[test]
    fn sector_total_cannot_hide_a_role_loss(){
        let a=Presence::one(0);let b=Presence::one(1);
        let facts=Sector{days:42,members:2,bands:vec![Band{day:1,start:480,minutes:60,
            estimated:true,minimum:1,eligible:a|b,role_floors:vec![(a,1)]}]};
        let mut before=[Presence::EMPTY;42];before[1]=a;let mut after=before;after[1]=b;
        assert!(!coverage_preserved(&facts,&before,&after));
    }
}
