//! Deterministic compound moves for the admitted fixed-clock 5x2 domain.
//! Never forbid a legitimate consecutive pair or modify a user's preferences.
//! Keep all Sunday decisions and preserve exact demand/role/clock coverage
//! for matched peer swaps. A single-person change may only reduce daily gaps.
use std::collections::BTreeMap;
use std::time::Instant;
use crate::domain::{Employee,Plan};
use super::patterns::worked;
use super::presence::Presence;

#[derive(Default,Debug)]
pub struct RestRepairStats{
    pub attempted:usize,
    pub accepted_single:usize,
    pub accepted_pair:usize,
    pub before_pairs:i64,
    pub after_pairs:i64,
    pub deadline_reached:bool,
    pub limit_reached:bool,
}
const MAX_ATTEMPTS:usize=200_000;

fn index(p:&Employee,mask:u32)->Option<usize>{
    p.catalog.binary_search(&mask).ok().filter(|j|p.allowed.binary_search(j).is_ok())
}
fn quality(p:&Employee,mask:u32)->[i64;4]{
    p.rules.rest_quality(mask,p.locked_off,p.facts.days)
}
fn secondary(p:&Employee,mask:u32)->(i64,i64,i64){
    let changes=((p.saved_work^mask)&p.saved_known).count_ones() as i64;
    (i64::from(changes>0),changes,p.rules.preferences(mask,p.facts.days))
}
fn no_personal_regression(p:&Employee,old:u32,new:u32)->bool{
    // Do not erase a lower-ranked user's preferred days or saved work
    // in this optional repair. The native optimizer can still explore them.
    let a=secondary(p,old);let b=secondary(p,new);
    quality(p,new)[0]<=quality(p,old)[0]&&b.0<=a.0&&b.1<=a.1&&b.2<=a.2
}
fn sum_quality(a:[i64;4],b:[i64;4])->[i64;4]{
    std::array::from_fn(|i|a[i]+b[i])
}
fn apply(att:&mut [Presence;28],person:&Employee,mask:u32,insert:bool){
    let bit=Presence::one(person.id);
    for (day,current) in att.iter_mut().enumerate().take(person.facts.days){
        if worked(mask,day){
            if insert{*current|=bit;}else{*current&=!bit;}
        }
    }
}
pub(super) fn total_pairs(plan:&Plan)->i64{
    plan.employees.iter().filter_map(|p|p.mask().map(|m|quality(p,m)[1])).sum()
}
fn single_preserves(p:&Employee,att:&[Presence;28],from:usize,to:usize)->bool{
    let bit=Presence::one(p.id);
    let remaining=att[from]&!bit;
    if remaining.is_empty(){return false;}
    // Fixed work count, identical clock, unchanged Sundays: role/time
    // service across each scope is invariant, including no-demand bands.
    // Exact per-date deficit and individual role floor are nonincreasing.
    p.facts.bands.iter().filter(|b|b.day==from||b.day==to).all(|b|{
        let after=if b.day==from{remaining}else{att[to]|bit};
        b.gap(after)<=b.gap(att[b.day])
            && b.gap_components(after).iter().zip(b.gap_components(att[b.day])).all(|(a,b)|*a<=b)
    })
}
fn attempt(stats:&mut RestRepairStats,deadline:Instant)->bool{
    if stats.attempted>=MAX_ATTEMPTS{stats.limit_reached=true;return false;}
    if stats.attempted%64==0&&Instant::now()>=deadline{stats.deadline_reached=true;return false;}
    stats.attempted+=1;true
}

pub fn polish_rests(plan:&mut Plan,deadline:Instant)->RestRepairStats{
    let mut stats=RestRepairStats::default();
    stats.before_pairs=total_pairs(plan);
    stats.after_pairs=stats.before_pairs;
    if stats.before_pairs==0||plan.employees.iter().any(|p|p.pattern.is_none()){return stats;}
    let mut sectors=BTreeMap::<usize,Vec<usize>>::new();
    for (i,p) in plan.employees.iter().enumerate(){sectors.entry(p.sector).or_default().push(i);}
    'sectors:for group in sectors.values(){
        if Instant::now()>=deadline{stats.deadline_reached=true;break;}
        let mut att=[Presence::EMPTY;28];
        for &i in group{let p=&plan.employees[i];apply(&mut att,p,p.mask().unwrap(),true);}
        for _ in 0..3{
            let mut changed=false;
            for &i in group{
                let p=&plan.employees[i];
                if p.pinned||!p.rules.adjustable(){continue;}
                let old=p.mask().unwrap();
                let before=quality(p,old);
                if before[1]==0{continue;}
                // Only Mon-Fri swaps inside the same Sunday-first week.
                // Both individuals retain their exact number of WORKs and
                // Sundays; Saturday and locks cannot change via legal domains.
                let mut best=None;
                for week in 0..p.facts.days/7{
                    for from in week*7+1..week*7+6{
                        if !worked(old,from){continue;}
                        for to in week*7+1..week*7+6{
                            if worked(old,to){continue;}
                            if !attempt(&mut stats,deadline){break 'sectors;}
                            let flip=(1u32<<from)|(1u32<<to);
                            let new=old^flip;
                            let Some(next)=index(p,new) else{continue;};
                            let after=quality(p,new);
                            if after[1]>before[1]||after>=before||!no_personal_regression(p,old,new){continue;}
                            if single_preserves(p,&att,from,to){
                                if best.as_ref().is_none_or(|(rank,_,_)|after<*rank){
                                    best=Some((after,next,None));
                                }
                            }
                            for &j in group{
                                if i==j{continue;}
                                let peer=&plan.employees[j];
                                if peer.pinned||peer.cohort!=p.cohort||peer.rest_group!=p.rest_group{continue;}
                                if !attempt(&mut stats,deadline){break 'sectors;}
                                let peer_old=peer.mask().unwrap();
                                if worked(peer_old,from)||!worked(peer_old,to){continue;}
                                let peer_new=peer_old^flip;
                                let Some(peer_index)=index(peer,peer_new) else{continue;};
                                let a=Presence::one(p.id);let b=Presence::one(peer.id);
                                if p.facts.bands.iter().filter(|band|band.day==from||band.day==to).any(|band|
                                    (band.eligible&a).is_empty()!=(band.eligible&b).is_empty()
                                    ||band.role_floors.iter().any(|(role,_)|(*role&a).is_empty()!=(*role&b).is_empty())){continue;}
                                if !no_personal_regression(peer,peer_old,peer_new){continue;}
                                let old_pair=quality(peer,peer_old);
                                let new_pair=quality(peer,peer_new);
                                // Product prohibits increasing group pair
                                // count or any person's correctable excess.
                                let total_before=sum_quality(before,old_pair);
                                let total_after=sum_quality(after,new_pair);
                                if total_after[1]>total_before[1]||total_after>=total_before{continue;}
                                // Relative improvement, not the absolute
                                // cost of a different-size candidate.
                                let rank=std::array::from_fn(|k|total_after[k]-old_pair[k]);
                                if best.as_ref().is_none_or(|(prior,_,_)|rank<*prior){
                                    best=Some((rank,next,Some((j,peer_index))));
                                }
                            }
                        }
                    }
                }
                if let Some((_,next,peer))=best{
                    let p=&plan.employees[i];
                    apply(&mut att,p,old,false);
                    apply(&mut att,p,p.catalog[next],true);
                    plan.employees[i].pattern=Some(next);
                    if let Some((j,idx))=peer{
                        let q=&plan.employees[j];
                        apply(&mut att,q,q.mask().unwrap(),false);
                        apply(&mut att,q,q.catalog[idx],true);
                        plan.employees[j].pattern=Some(idx);
                        stats.accepted_pair+=1;
                    }else{stats.accepted_single+=1;}
                    changed=true;
                }
            }
            if !changed{break;}
        }
    }
    stats.after_pairs=total_pairs(plan);
    stats.deadline_reached|=Instant::now()>=deadline;
    stats
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::{model,wire};
    use serde_json::{Value,json};
    use std::time::Duration;
    #[test]
    fn pair_move_breaks_adjacent_rests_with_identical_daily_coverage(){
        let corpus:Value=serde_json::from_str(include_str!("../e2-wire-contract.json")).unwrap();
        let mut input=corpus["base"].clone();
        input["input"]["assignments"]=json!([]);
        let mut peer=input["input"]["employees"][0].clone();
        peer["id"]=json!("person-1");peer["name"]=json!("Synthetic person 1");
        input["input"]["employees"].as_array_mut().unwrap().push(peer);
        // Floor 1 on each civil day. Initial masks have complementary
        // Mon/Tue and Wed/Thu OFF. Any single swap would remove service
        // on a day that only the other person serves; a peer exchange
        // can split both pairs while maintaining the exact service counts.
        input["input"]["demands"]=Value::Array((0..7).map(|i|json!({
            "id":format!("d-{i}"),"date":wire::date(i),"sector":"S",
            "role":"Caixa","start":480,"end":540,"minimum":if i==0||i==5||i==6 {2}else{1},"estimated":false
        })).collect());
        let mut plan=wire::read(&input,Instant::now()+Duration::from_secs(5)).unwrap();
        for (p,off) in plan.employees.iter_mut().zip([6,24]){
            p.pattern=index(p,127^off);
        }
        assert!(model::validate_complete(&plan));
        let before=model::evaluate(&plan);
        let day_counts=|plan:&Plan|(0..7).map(|d|plan.employees.iter().filter(|p|worked(p.mask().unwrap(),d)).count()).collect::<Vec<_>>();
        let original=day_counts(&plan);
        let stats=polish_rests(&mut plan,Instant::now()+Duration::from_secs(2));
        assert_eq!(stats.before_pairs,2);
        assert_eq!(stats.after_pairs,0);
        assert!(stats.accepted_pair>0);
        assert_eq!(day_counts(&plan),original);
        assert!(model::validate_complete(&plan));
        let after=model::evaluate(&plan);
        assert_eq!(&before[..5],&after[..5]);
        assert_eq!(after[6],0);
    }

    #[test]
    fn protected_pairs_are_not_rewritten(){
        let corpus:Value=serde_json::from_str(include_str!("../e2-wire-contract.json")).unwrap();
        let mut input=corpus["base"].clone();
        input["input"]["assignments"]=json!([
            {"employeeId":"person-0","date":"2026-11-02","kind":"OFF","locked":true},
            {"employeeId":"person-0","date":"2026-11-03","kind":"OFF","locked":true}
        ]);
        let mut plan=wire::read(&input,Instant::now()+Duration::from_secs(5)).unwrap();
        assert!(model::seed(&mut plan,Instant::now()+Duration::from_secs(2)).0);
        let old=plan.employees[0].mask();
        let stats=polish_rests(&mut plan,Instant::now()+Duration::from_secs(2));
        assert_eq!(stats.accepted_pair+stats.accepted_single,0);
        assert_eq!(plan.employees[0].mask(),old);
    }
}
