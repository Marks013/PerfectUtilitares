//! Bounded compound construction repair over legal selected personal domains.
//! No reference solver roster is imported and no constructor gain is native gain.
use std::collections::BTreeMap;
use std::time::Instant;
use crate::temporal_domain::{TemporalEmployee,TemporalPlan};
use super::super::{Cost,Member,clock,work,global_cost,sector_cost};
use super::super::service_guard::Snapshot;

const SHORTLIST:usize=8;
const MAX_EVALUATIONS:usize=200_000;
type Rank=([i64;6],i64,i64,[i64;11],[i64;2]);
fn member_at(person:&TemporalEmployee,index:usize)->Member{
    let mut member=person.member();let mut pattern=person.catalog[index];
    pattern.personal=person.pattern_cost(index);member.pattern=Some(pattern);member
}
fn coupled(member:&Member)->bool{member.leader_label||!member.leader_targets.is_empty()}
fn pairs(rows:&[Member])->i64{rows.iter().filter_map(|r|r.pattern).map(|p|p.rest[1]).sum()}
fn rank(rows:&[Member],all:&[Member],indices:&[usize],global:Cost,
        recompute_global:bool,opportunities:u64)->Rank{
    let facts=&rows[0].facts;let mut cost=sector_cost(rows.iter());
    let global=if recompute_global{
        global_cost(all.iter().enumerate().map(|(i,m)|indices.binary_search(&i).map_or(m,|slot|&rows[slot])))
    }else{global};
    for (a,b) in cost.iter_mut().zip(global){*a+=b;}
    let mut present=0u64;let mut clock_tie=[0i64;2];
    let mut timed_roles=BTreeMap::<usize,usize>::new();
    for row in rows{if !row.untimed{*timed_roles.entry(row.role).or_default()+=1;}}
    for row in rows{
        let Some(p)=row.pattern else{continue;};
        if !row.untimed{present|=p.civil_work;}
        if !timed_roles.get(&row.role).is_some_and(|&count|count>1){continue;}
        for &state in p.states.iter().take(facts.days){
            if let Some(c)=clock(&facts.clocks,state){
                clock_tie[0]+=i64::from(c.end()-c.start()-c.paid);
                clock_tie[1]+=i64::from((facts.closing-c.end()).max(0));
            }
        }
    }
    let missing=opportunities&!present;
    let sundays=(0..facts.days).filter(|&d|facts.weekday(d)==0).fold(0u64,|mask,d|mask|1u64<<d);
    (std::array::from_fn(|i|cost[i]),i64::from((missing&sundays).count_ones()),
        i64::from(missing.count_ones()),std::array::from_fn(|i|cost[i+6]),clock_tie)
}
fn acceptable(before:&Rank,after:&Rank,before_pairs:i64,after_pairs:i64)->bool{
    after<before&&after.0.iter().zip(before.0).all(|(a,b)|*a<=b)
        &&after.1<=before.1&&after.2<=before.2&&after_pairs<=before_pairs
}
fn personal_preserved(old:&Member,new:&Member,critical:u64)->bool{
    let (Some(a),Some(b))=(old.pattern,new.pattern) else{return false;};
    b.rest[0]<=a.rest[0]&&b.rest[3]<=a.rest[3]&&b.rest[4]<=a.rest[4]
        &&(0..old.facts.days).all(|d|critical&(1u64<<d)==0||work(b.states[d]))
}

pub(super) fn improve(plan:&mut TemporalPlan,deadline:Instant){
    if Instant::now()>=deadline||plan.employees.iter().any(|p|p.pattern.is_none()){return;}
    let mut all:Vec<_>=plan.employees.iter().map(TemporalEmployee::member).collect();
    let mut groups=BTreeMap::<usize,Vec<usize>>::new();
    for (i,p) in plan.employees.iter().enumerate(){groups.entry(p.sector).or_default().push(i);}
    let count=groups.len();let mut evaluated=0usize;
    for (number,indices) in groups.into_values().enumerate(){
        if Instant::now()>=deadline||evaluated>=MAX_EVALUATIONS{break;}
        let now=Instant::now();let until=(now+deadline.saturating_duration_since(now)/(count-number) as u32).min(deadline);
        let mut rows:Vec<_>=indices.iter().map(|&i|all[i].clone()).collect();
        let mut selected:Vec<_>=indices.iter().map(|&i|plan.employees[i].pattern.unwrap()).collect();
        let opportunities=indices.iter().fold(0u64,|mask,&i|{
            let p=&plan.employees[i];
            if p.untimed{mask}else{p.allowed.iter().fold(mask,|bits,&index|bits|p.catalog[index].civil_work)}
        });
        let critical:Vec<u64>=rows.iter().map(|row|{
            let p=row.pattern.unwrap();
            (0..row.facts.days).filter(|&d|work(p.states[d])&&row.leader_targets.iter().any(|target|
                all.iter().find(|m|m.sector==*target).is_some_and(|m|!m.facts.closed[d]&&m.facts.priority[d]==Some(3))))
                .fold(0,|mask,d|mask|1u64<<d)
        }).collect();
        let mut global=global_cost(all.iter());
        let mut service_guard=Snapshot::capture_members(rows.iter());
        for _ in 0..2{
            let mut changed=false;let mut shortlist=vec![Vec::<(Rank,usize)>::new();indices.len()];
            for (slot,&i) in indices.iter().enumerate(){
                if plan.employees[i].pinned{continue;}
                let before=rank(&rows,&all,&indices,global,false,opportunities);let before_pairs=pairs(&rows);
                let old=rows[slot].clone();let mut best=None;
                for &index in plan.employees[i].allowed.iter(){
                    if evaluated>=MAX_EVALUATIONS||Instant::now()>=until{break;}
                    evaluated+=1;let next=member_at(&plan.employees[i],index);
                    if !personal_preserved(&old,&next,critical[slot]){continue;}
                    rows[slot]=next;
                    let after=rank(&rows,&all,&indices,global,coupled(&old),opportunities);
                    let options=&mut shortlist[slot];let at=options.partition_point(|(r,_)|r<=&after);
                    if at<SHORTLIST{options.insert(at,(after,index));options.truncate(SHORTLIST);}
                    // Keep unguarded individual alternatives in the shortlist:
                    // a partner may repair their intermediate service loss.
                    // Only the complete candidate can be accepted.
                    if acceptable(&before,&after,before_pairs,pairs(&rows))
                        &&best.as_ref().is_none_or(|(r,_)|after<*r)
                        &&service_guard.preserves_members(rows.iter()){
                        best=Some((after,index));
                    }
                }
                rows[slot]=old;
                if let Some((_,index))=best{
                    selected[slot]=index;rows[slot]=member_at(&plan.employees[i],index);all[i]=rows[slot].clone();
                    plan.employees[i].pattern=Some(index);global=global_cost(all.iter());
                    service_guard=Snapshot::capture_members(rows.iter());changed=true;
                }
            }
            if Instant::now()>=until||evaluated>=MAX_EVALUATIONS{break;}
            for (slot,options) in shortlist.iter_mut().enumerate(){
                if !options.iter().any(|(_,j)|*j==selected[slot]){
                    options.push((rank(&rows,&all,&indices,global,false,opportunities),selected[slot]));
                }
            }
            let before=rank(&rows,&all,&indices,global,false,opportunities);let before_pairs=pairs(&rows);let mut best=None;
            // Do not prune an affordable complete two-person neighborhood.
            // Small mixed/partial teams can need a partner absent from the
            // eight best individual moves. Large teams retain the shortlist.
            let mut pair_volume=0usize;
            for (a,&i) in indices.iter().enumerate(){
                if plan.employees[i].pinned{continue;}
                for &j in indices.iter().skip(a+1){
                    if !plan.employees[j].pinned{
                        pair_volume=pair_volume.saturating_add(plan.employees[i].allowed.len()
                            .saturating_mul(plan.employees[j].allowed.len()));
                    }
                }
            }
            if pair_volume<=MAX_EVALUATIONS.saturating_sub(evaluated){
                for (slot,&i) in indices.iter().enumerate(){
                    shortlist[slot]=plan.employees[i].allowed.iter().map(|&index|(before,index)).collect();
                }
            }
            'pairs: for (a,&person_a) in indices.iter().enumerate(){
                if plan.employees[person_a].pinned{continue;}
                for (b,&person_b) in indices.iter().enumerate().skip(a+1){
                    if plan.employees[person_b].pinned{continue;}
                    let old_a=rows[a].clone();let old_b=rows[b].clone();
                    for &(_,ia) in &shortlist[a]{
                        for &(_,ib) in &shortlist[b]{
                            if evaluated>=MAX_EVALUATIONS||Instant::now()>=until{rows[a]=old_a;rows[b]=old_b;break 'pairs;}
                            if ia==selected[a]&&ib==selected[b]{continue;}
                            evaluated+=1;
                            let next_a=member_at(&plan.employees[person_a],ia);let next_b=member_at(&plan.employees[person_b],ib);
                            if !personal_preserved(&old_a,&next_a,critical[a])||!personal_preserved(&old_b,&next_b,critical[b]){continue;}
                            rows[a]=next_a;rows[b]=next_b;
                            let after=rank(&rows,&all,&indices,global,coupled(&old_a)||coupled(&old_b),opportunities);
                            if acceptable(&before,&after,before_pairs,pairs(&rows))
                                &&best.as_ref().is_none_or(|(r,_,_,_,_)|after<*r)
                                &&service_guard.preserves_members(rows.iter()){
                                best=Some((after,a,ia,b,ib));
                            }
                        }
                    }
                    rows[a]=old_a;rows[b]=old_b;
                }
            }
            if let Some((_,a,ia,b,ib))=best{
                for (slot,index) in [(a,ia),(b,ib)]{
                    let i=indices[slot];selected[slot]=index;rows[slot]=member_at(&plan.employees[i],index);
                    all[i]=rows[slot].clone();plan.employees[i].pattern=Some(index);
                }
                global=global_cost(all.iter());
                service_guard=Snapshot::capture_members(rows.iter());changed=true;
            }
            if !changed{break;}
        }
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::time::Duration;
    use serde_json::{Value,json};
    use super::super::super::{read,evaluate};
    fn fixture()->Value{
        json!({"input":{"schemaVersion":1,"branchCode":"SYNTH","simulation":true,"timeZone":"America/Sao_Paulo",
            "planningWeekStartsOn":"SUNDAY","restRulesVersion":3,"startDate":"2026-11-01","endDate":"2026-11-07",
            "defaultWeeklyHours":40,"storeClosingMinutes":1200,"generationMode":"DAYS_AND_HOURS",
            "policy":{"calendarMode":"MANUAL","normativeProfile":"CUSTOM","weeklyLimit":44,"dailyLimitMinutes":528,
                "minMealMinutes":60,"minInterShiftMinutes":660,"minWeeklyRestMinutes":2100,"maxConsecutiveWorkDays":5,
                "closedDates":[],"holidayDates":[],"authorizedHolidayDates":[],"paidHolidayDates":[]},
            "shifts":[{"id":"day","segments":[{"kind":"WORK","start":420,"end":660},
                {"kind":"BREAK","start":660,"end":720},{"kind":"WORK","start":720,"end":960}]}],
            "employees":(0..3).map(|i|json!({"id":format!("person-{i}"),"name":format!("Synthetic person {i}"),
                "sector":if i==2{"T"}else{"S"},"role":if i==0{"Gerente"}else{"Repositor"},"weeklyHours":40,
                "shiftIds":if i==0{Vec::<&str>::new()}else{vec!["day"]},"scheduleMode":if i==0{"UNTIMED"}else{"TIMED"},
                "activeFrom":"","offMode":"VARIABLE","fixedOffDays":[],"preferredOffDays":[],"offPattern":"ANY",
                "maxConsecutiveSundays":1,"history":[]})).collect::<Vec<_>>(),
            "assignments":[{"employeeId":"person-0","date":"2026-11-04","kind":"DUTY","locked":true}],
            "demands":[{"id":"s","date":"2026-11-04","sector":"S","start":480,"end":540,"minimum":1,"estimated":false},
                {"id":"t","date":"2026-11-04","sector":"T","start":480,"end":540,"minimum":1,"estimated":false}],
            "movementPriorities":[{"startDate":"2026-11-04","endDate":"2026-11-04","level":"HIGH"}]}})
    }
    fn trapped()->TemporalPlan{
        let mut data=fixture();data["input"]["employees"][0]["leadership"]=json!({"source":"MANUAL","role":"BRANCH","sectors":["S","T"]});
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        for (p,off) in plan.employees.iter_mut().zip([[1,5],[2,4],[1,4]]){
            p.pattern=p.catalog.iter().position(|path|(0..7).all(|d|if off.contains(&d){path.states[d]==0}else{work(path.states[d])}));
            assert!(p.pattern.is_some());
        }
        plan
    }
    fn timed_people(data:&mut Value,hours:i32,clocks:&[&str]){
        for p in data["input"]["employees"].as_array_mut().unwrap(){
            p["sector"]=json!("S");p["role"]=json!("Repositor");p["weeklyHours"]=json!(hours);
            p["scheduleMode"]=json!("TIMED");p["shiftIds"]=json!(clocks);
        }
        data["input"]["defaultWeeklyHours"]=json!(hours);data["input"]["assignments"]=json!([]);data["input"]["movementPriorities"]=json!([]);
    }
    #[test]
    fn compound_manager_worker_repair_preserves_existing_timed_dates(){
        let mut plan=trapped();let before=evaluate(&plan);assert_eq!(before[16],135);
        let guard=super::super::super::service_guard::Snapshot::capture(&plan);
        improve(&mut plan,Instant::now()+Duration::from_secs(2));let after=evaluate(&plan);
        // The former expected tie gain (135 -> 125) removed the only timed
        // worker from Friday in sector S. That is not an admissible gain.
        assert!(guard.preserves(&plan));
        assert!(after<=before);
        let worker=&plan.employees[1];let path=worker.catalog[worker.pattern.unwrap()];
        assert!(work(path.states[5]));
        assert!(plan.employees.iter().all(|p|p.pattern.is_some_and(|i|p.allowed.binary_search(&i).is_ok())));
        assert!(work(plan.employees[0].catalog[plan.employees[0].pattern.unwrap()].states[3]));
    }
    #[test]
    fn expired_deadline_and_complete_hint_are_nonmutating(){
        let mut plan=trapped();let old:Vec<_>=plan.employees.iter().map(|p|p.pattern).collect();
        improve(&mut plan,Instant::now());assert_eq!(plan.employees.iter().map(|p|p.pattern).collect::<Vec<_>>(),old);
        super::super::construct(&mut plan,Instant::now()+Duration::from_secs(1));
        assert_eq!(plan.employees.iter().map(|p|p.pattern).collect::<Vec<_>>(),old);
    }
    #[test]
    fn hours_only_stability_precedes_clock_geometry(){
        let mut data=fixture();timed_people(&mut data,40,&["day","late"]);data["input"]["generationMode"]=json!("HOURS_ONLY");
        data["input"]["shifts"].as_array_mut().unwrap().push(json!({"id":"late","segments":[
            {"kind":"WORK","start":480,"end":720},{"kind":"BREAK","start":720,"end":780},{"kind":"WORK","start":780,"end":1020}]}));
        data["input"]["demands"]=json!([{"id":"d","date":"2026-11-04","sector":"S","start":480,"end":540,"minimum":1,"estimated":false}]);
        data["input"]["assignments"]=Value::Array((0..3).flat_map(|i|(0..7).map(move |d|{
            let mut row=json!({"employeeId":format!("person-{i}"),"date":format!("2026-11-{:02}",d+1),
                "kind":if [1,4].contains(&d){"OFF"}else{"WORK"},"locked":d==6});
            if ![1,4].contains(&d){row["shiftId"]=json!("day");}row
        })).collect());
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        super::super::construct(&mut plan,Instant::now()+Duration::from_secs(2));
        let cost=evaluate(&plan);assert_eq!(cost[13],0);assert_eq!(cost[14],0);
        assert!(plan.employees.iter().all(|p|p.catalog[p.pattern.unwrap()].states[..7].iter().all(|&s|s==0||s==3)));
    }
    #[test]
    fn mixed_clock_service_keeps_exact_weekly_minutes(){
        let mut data=fixture();timed_people(&mut data,42,&["eight","nine","late"]);data["input"]["mixed42Sectors"]=json!(["S"]);
        data["input"]["shifts"]=Value::Array([("eight",420,240,60),("nine",420,270,180),("late",480,240,60)]
            .into_iter().map(|(id,a,n,meal)|json!({"id":id,"segments":[
                {"kind":"WORK","start":a,"end":a+n},{"kind":"BREAK","start":a+n,"end":a+n+meal},
                {"kind":"WORK","start":a+n+meal,"end":a+2*n+meal}]})).collect());
        data["input"]["demands"]=json!([{"id":"d","date":"2026-11-04","sector":"S","start":1050,"end":1140,"minimum":1,"estimated":false}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        super::super::construct(&mut plan,Instant::now()+Duration::from_secs(3));assert_eq!(evaluate(&plan)[0],0);
        for p in &plan.employees{
            let path=p.catalog[p.pattern.unwrap()];assert_eq!(path.states[..7].iter().filter(|&&s|s==4).count(),2);
            assert_eq!(path.states[..7].iter().filter(|&&s|s==5).count(),3);
        }
    }
    #[test]
    fn december_neighbors_remove_adjustable_pairs_without_hard_loss(){
        let mut data=fixture();timed_people(&mut data,44,&["before","after"]);
        data["input"]["startDate"]=json!("2026-12-01");data["input"]["endDate"]=json!("2026-12-31");data["input"]["visibleMonth"]=json!("2026-12");
        for key in ["closedDates","holidayDates","paidHolidayDates"]{data["input"]["policy"][key]=json!(["2026-12-25"]);}
        data["input"]["shifts"]=Value::Array([("before",264),("after",252)].into_iter().map(|(id,n)|json!({"id":id,"segments":[
            {"kind":"WORK","start":420,"end":420+n},{"kind":"BREAK","start":420+n,"end":480+n},
            {"kind":"WORK","start":480+n,"end":480+2*n}]})).collect());
        data["input"]["demands"]=json!([{"id":"d","date":"2026-12-16","sector":"S","start":480,"end":540,"minimum":1,"estimated":false}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        super::super::construct(&mut plan,Instant::now()+Duration::from_secs(3));assert_eq!(evaluate(&plan)[0],0);
        assert_eq!(plan.employees.iter().map(|p|p.catalog[p.pattern.unwrap()].rest[1]).sum::<i64>(),0);
        assert!(plan.employees.iter().all(|p|p.catalog[p.pattern.unwrap()].states[24]==2));
    }
    #[test]
    fn partial_employment_sunday_service_does_not_count_duty(){
        let mut data=fixture();timed_people(&mut data,40,&["day"]);data["input"]["endDate"]=json!("2026-11-21");
        data["input"]["employees"][0]["activeFrom"]=json!("2026-11-01");
        data["input"]["employees"][1]["activeFrom"]=json!("2026-11-04");data["input"]["employees"][1]["activeUntil"]=json!("2026-11-17");
        data["input"]["employees"][2]["activeFrom"]=json!("2026-11-08");data["input"]["employees"][2]["scheduleMode"]=json!("UNTIMED");
        data["input"]["employees"][2]["shiftIds"]=json!([]);
        data["input"]["assignments"]=json!([{"employeeId":"person-1","date":"2026-11-05","kind":"WORK","shiftId":"day","locked":true}]);
        data["input"]["demands"]=json!([{"id":"d","date":"2026-11-05","sector":"S","start":480,"end":540,"minimum":1,"estimated":false}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        super::super::construct(&mut plan,Instant::now()+Duration::from_secs(3));assert_eq!(evaluate(&plan)[0],0);
        for day in [0,7,14]{
            assert!(plan.employees.iter().filter(|p|!p.untimed).any(|p|clock(&p.facts.clocks,p.catalog[p.pattern.unwrap()].states[day]).is_some()),
                "uncovered Sunday {day}; domains {:?}; selected {:?}; cost {:?}",
                plan.employees.iter().map(|p|p.allowed.len()).collect::<Vec<_>>(),
                plan.employees.iter().map(|p|p.catalog[p.pattern.unwrap()].states[..21].to_vec()).collect::<Vec<_>>(),evaluate(&plan));
        }
        let p=&plan.employees[1];let path=p.catalog[p.pattern.unwrap()];
        assert!(path.states[..3].iter().chain(&path.states[17..21]).all(|&s|s==super::super::INACTIVE));assert_eq!(path.states[4],3);
        assert_eq!(p.lock_flags[4],Some(true));
    }

    #[test]
    fn member_snapshot_agrees_with_native_plan_snapshot(){
        let plan=trapped();let members:Vec<_>=plan.employees.iter().map(TemporalEmployee::member).collect();
        let native=super::super::super::service_guard::Snapshot::capture(&plan);
        let construction=super::super::super::service_guard::Snapshot::capture_members(members.iter());
        assert!(native.preserves_members(members.iter()));
        assert!(construction.preserves(&plan));
    }
    #[test]
    fn unchanged_day_count_cannot_hide_a_lost_date(){
        let plan=trapped();let mut rows:Vec<_>=plan.employees.iter().map(TemporalEmployee::member).collect();
        let guard=super::super::super::service_guard::Snapshot::capture_members(rows.iter());
        // Swap the worker's Thursday OFF with Friday WORK: same number of
        // covered days and weekly minutes, but Friday service disappears.
        rows[1].pattern.as_mut().unwrap().states.swap(4,5);
        assert!(!guard.preserves_members(rows.iter()));
    }
    #[test]
    fn individual_loss_is_allowed_only_when_the_compound_restores_service(){
        let plan=trapped();let mut rows:Vec<_>=plan.employees.iter().map(TemporalEmployee::member).collect();
        rows[2].sector=rows[1].sector;rows[2].role=rows[1].role;
        rows[2].facts=std::sync::Arc::clone(&rows[1].facts);
        // Align actual worker service and then move a clock between peers.
        rows[2].pattern=rows[1].pattern;
        rows[2].pattern.as_mut().unwrap().states[5]=super::super::super::OFF;
        let guard=super::super::super::service_guard::Snapshot::capture_members(rows.iter());
        let state=rows[1].pattern.unwrap().states[5];
        rows[1].pattern.as_mut().unwrap().states[5]=super::super::super::OFF;
        assert!(!guard.preserves_members(rows.iter()));
        rows[2].pattern.as_mut().unwrap().states[5]=state;
        assert!(guard.preserves_members(rows.iter()));
        rows[2].pattern.as_mut().unwrap().states[5]=super::super::super::DUTY;
        assert!(!guard.preserves_members(rows.iter()));
    }
    #[test]
    fn sunday_service_loss_is_rejected_even_without_a_sunday_demand(){
        let mut data=fixture();timed_people(&mut data,42,&["eight","nine"]);
        data["input"]["mixed42Sectors"]=json!(["S"]);
        data["input"]["shifts"]=Value::Array([("eight",240,60),("nine",270,180)]
            .into_iter().map(|(id,n,meal)|json!({"id":id,"segments":[
                {"kind":"WORK","start":420,"end":420+n},
                {"kind":"BREAK","start":420+n,"end":420+n+meal},
                {"kind":"WORK","start":420+n+meal,"end":420+2*n+meal}]})).collect());
        data["input"]["demands"]=json!([{"id":"d","date":"2026-11-04","sector":"S",
            "start":480,"end":540,"minimum":1,"estimated":false}]);
        let mut plan=read(&data,Instant::now()+Duration::from_secs(5)).unwrap();
        for p in &mut plan.employees{
            p.pattern=p.catalog.iter().position(|path|path.states[..7]==[4,0,3,4,0,3,3]);
            assert!(p.pattern.is_some());
        }
        let guard=super::super::super::service_guard::Snapshot::capture(&plan);
        improve(&mut plan,Instant::now()+Duration::from_secs(2));
        assert!(guard.preserves(&plan));assert_eq!(evaluate(&plan)[0],0);
    }
}
