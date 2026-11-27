//! Original service regressions and independent civil-boundary checks.
use super::*;
fn legacy()->V{serde_json::from_str(include_str!("legacy-service-fixture.json")).unwrap()}
fn parse(v:&V)->Result<TemporalPlan>{read_admitted(v,Instant::now()+Duration::from_secs(5),false,true)}
fn night()->V{json!({"id":"night","segments":[
    {"kind":"WORK","start":1200,"end":1440},{"kind":"BREAK","start":1440,"end":1500},
    {"kind":"WORK","start":1500,"end":1740}]})}
fn solve(v:&V)->V{solve_service(&serde_json::to_vec(v).unwrap(),Instant::now(),Duration::from_secs(4))}
#[test]
fn native_refinement_never_worsens_a_reported_component(){
    let mut v=legacy();let template=v["input"]["employees"][0].clone();
    v["input"]["employees"]=json!((0..3).map(|i|{
        let mut p=template.clone();p["id"]=json!(format!("p{i}"));p["preferredOffDays"]=json!([4]);
        for row in p["history"].as_array_mut().unwrap(){row["employeeId"]=json!(format!("p{i}"));}p
    }).collect::<Vec<_>>());
    v["input"]["assignments"]=json!((0..3).flat_map(|i|(2..=8).map(move |d|{
        let mut a=json!({"employeeId":format!("p{i}"),"date":format!("2026-11-{d:02}"),"kind":if d<=6{"WORK"}else{"OFF"}});
        if d<=6{a["shiftId"]=json!("day");}a
    })).collect::<Vec<_>>());
    v["input"]["demands"]=json!([{"date":"2026-11-02","sector":"Reposição","start":480,"end":720,"minimum":2,"estimated":true}]);
    let response=solve(&v);assert_eq!(response["body"]["status"],"FEASIBLE","{response}");
    let before=response["temporal"]["initialCost"].as_array().unwrap();
    let after=response["temporal"]["finalCost"].as_array().unwrap();
    assert!(before.iter().zip(after).all(|(a,b)|b.as_i64()<=a.as_i64()),"{response}");
}
#[test]
fn prior_saturday_occupancy_counts_once_in_sunday_history(){
    let mut v=legacy();v["input"]["endDate"]=json!("2026-11-15");v["input"]["shifts"].as_array_mut().unwrap().push(night());
    let history=v["input"]["employees"][0]["history"].as_array_mut().unwrap();
    let row=history.iter_mut().find(|r|r["date"]=="2026-10-31").unwrap();row["kind"]=json!("WORK");row["shiftId"]=json!("night");
    let plan=parse(&v).expect("historical clocks are not current-day alternatives");let p=&plan.employees[0];
    for pattern in p.catalog.iter(){
        let worked=(0..14).filter(|&d|p.facts.weekday(d)==0&&work(pattern.states[d])).count();
        assert_eq!(pattern.rates[0],Some((worked as i64+1)*10_000/5));
    }
}
#[test]
fn overnight_alternative_cannot_invade_an_absence_or_future_off(){
    for future in [false,true]{
        let mut v=legacy();v["input"]["shifts"].as_array_mut().unwrap().push(night());
        v["input"]["employees"][0]["shiftIds"]=json!(["day","night"]);
        if future{
            v["input"]["employees"][0]["planningFuture"]=json!([{"date":"2026-11-09","kind":"OFF"}]);
            v["input"]["assignments"]=json!([{"employeeId":"p0","date":"2026-11-08","kind":"WORK","shiftId":"night","locked":true}]);
        }else{
            v["input"]["assignments"]=json!([{"employeeId":"p0","date":"2026-11-02","kind":"WORK","shiftId":"night","locked":true},
                {"employeeId":"p0","date":"2026-11-03","kind":"ABSENCE"}]);
        }
        let response=solve(&v);assert_eq!(response["body"]["status"],"INFEASIBLE","{response}");
        assert_eq!(response["body"]["assignments"],json!([]));
    }
}
#[test]
fn historical_carry_in_supplies_only_actual_work_not_the_meal(){
    let mut v=legacy();v["input"]["shifts"].as_array_mut().unwrap().push(night());
    v["input"]["shifts"][1]["segments"][0]["start"]=json!(1140);
    v["input"]["shifts"][1]["segments"][2]["end"]=json!(1680);
    let history=v["input"]["employees"][0]["history"].as_array_mut().unwrap();
    let row=history.iter_mut().find(|r|r["date"]=="2026-11-01").unwrap();row["kind"]=json!("WORK");row["shiftId"]=json!("night");
    // A late day shift respects the actual end of the preceding night.
    for part in v["input"]["shifts"][0]["segments"].as_array_mut().unwrap(){
        part["start"]=json!(part["start"].as_i64().unwrap()+420);part["end"]=json!(part["end"].as_i64().unwrap()+420);
    }
    // Keep earlier historical day clocks unchanged using a separate ID.
    let mut old=legacy()["input"]["shifts"][0].clone();old["id"]=json!("old-day");
    v["input"]["shifts"].as_array_mut().unwrap().push(old);
    for row in v["input"]["employees"][0]["history"].as_array_mut().unwrap(){if row["shiftId"]=="day"{row["shiftId"]=json!("old-day");}}
    v["input"]["demands"]=json!([{"date":"2026-11-02","sector":"Reposição","start":60,"end":120,"minimum":1}]);
    let mut plan=parse(&v).expect("immutable carry-in supplies first civil morning");
    seed::construct(&mut plan,Instant::now()+Duration::from_secs(1));assert_eq!(evaluate(&plan)[0],0);
    v["input"]["demands"][0]["start"]=json!(0);v["input"]["demands"][0]["end"]=json!(60);
    assert!(matches!(parse(&v),Err("INFEASIBLE_COVERAGE_BOUND")),"a meal is not hourly work");
}

fn carry_fixture()->V{
    let mut v=legacy();v["input"]["shifts"].as_array_mut().unwrap().push(night());
    v["input"]["shifts"][1]["segments"][0]["start"]=json!(1140);
    v["input"]["shifts"][1]["segments"][2]["end"]=json!(1680);
    let history=v["input"]["employees"][0]["history"].as_array_mut().unwrap();
    let row=history.iter_mut().find(|r|r["date"]=="2026-11-01").unwrap();row["kind"]=json!("WORK");row["shiftId"]=json!("night");
    // A late day shift respects the actual end of the preceding night.
    for part in v["input"]["shifts"][0]["segments"].as_array_mut().unwrap(){
        part["start"]=json!(part["start"].as_i64().unwrap()+420);part["end"]=json!(part["end"].as_i64().unwrap()+420);
    }
    // Keep earlier historical day clocks unchanged using a separate ID.
    let mut old=legacy()["input"]["shifts"][0].clone();old["id"]=json!("old-day");
    v["input"]["shifts"].as_array_mut().unwrap().push(old);
    for row in v["input"]["employees"][0]["history"].as_array_mut().unwrap(){if row["shiftId"]=="day"{row["shiftId"]=json!("old-day");}}
    v["input"]["demands"]=json!([{"date":"2026-11-02","sector":"Reposição","start":60,"end":120,"minimum":1}]);
    v
}

#[test]
fn carry_in_matches_full_oracle_across_changes_unassignment_and_retraction(){
    use solverforge::stream::collector::Accumulator;
    let mut v=carry_fixture();
    let mut second=v["input"]["employees"][0].clone();second["id"]=json!("p1");
    for row in second["history"].as_array_mut().unwrap(){
        row["employeeId"]=json!("p1");
        if row["date"]=="2026-11-01"{row["kind"]=json!("OFF");row.as_object_mut().unwrap().remove("shiftId");}
    }
    v["input"]["employees"].as_array_mut().unwrap().push(second);
    v["input"]["_coverageServiceProtection"]=json!({"days":[{"date":"2026-11-02","sector":"Reposição"}],
        "bands":[{"sector":"Reposição","role":"Repositor","start":60,"end":120,"scope":"HORIZON","minimum":1}]});
    let mut plan=parse(&v).unwrap();let mut acc=TemporalAccumulator::default();let mut rows=BTreeMap::new();
    for p in &mut plan.employees{p.pattern=Some(0);let row=p.member();acc.accumulate(row.clone());rows.insert(p.id,row);}
    for (id,p) in plan.employees.iter_mut().enumerate(){
        let choices=p.allowed.to_vec();
        for choice in choices.into_iter().map(Some).chain([None]){
            acc.retract(id);rows.remove(&id);assert_eq!(acc.finish(),sector_cost(rows.values()));
            p.pattern=choice;let row=p.member();
            acc.accumulate(row.clone());rows.insert(id,row);assert_eq!(acc.finish(),sector_cost(rows.values()));
        }
    }
    acc.retract(0);acc.retract(1);assert_eq!(acc.finish(),[0;17]);
    acc.accumulate(plan.employees[0].member());acc.reset();assert_eq!(acc.finish(),[0;17]);
}
#[test]
fn carry_in_is_protected_service_but_paid_pause_is_not(){
    let v=carry_fixture();let mut plan=parse(&v).unwrap();
    seed::construct(&mut plan,Instant::now()+Duration::from_secs(1));
    let guard=service_guard::Snapshot::capture(&plan);assert!(guard.preserves(&plan));
    plan.employees[0].carry_in=None;assert!(!guard.preserves(&plan));
    let mut paid=v;paid["input"]["shifts"][1]["segments"][2]["kind"]=json!("PAID_BREAK");
    assert!(matches!(parse(&paid),Err("INFEASIBLE_COVERAGE_BOUND")));
}
#[test]
fn historical_carry_in_never_overrides_a_current_absence_or_fixed_rest(){
    for kind in ["ABSENCE","OFF"]{
        let mut v=carry_fixture();v["input"]["demands"]=json!([]);
        v["input"]["assignments"]=json!([{"employeeId":"p0","date":"2026-11-02","kind":kind,"locked":true}]);
        let out=solve(&v);assert_eq!(out["body"]["status"],"INFEASIBLE","{out}");
        assert_eq!(out["body"]["assignments"],json!([]));
    }
}
#[test]
fn explicit_closing_binds_new_shifts_not_historical_geometry(){
    let mut v=legacy();v["input"]["shifts"].as_array_mut().unwrap().push(night());
    v["input"]["employees"][0]["shiftIds"]=json!(["day","night"]);
    let plan=parse(&v).unwrap();assert!(plan.employees[0].catalog.iter().any(|p|p.states[6]==4));
    v["input"]["storeClosingMinutes"]=json!(1440);
    let plan=parse(&v).unwrap();assert!(plan.employees[0].catalog.iter().all(|p|!p.states[..7].contains(&4)));
    let mut carried=carry_fixture();carried["input"]["storeClosingMinutes"]=json!(1440);
    assert!(parse(&carried).is_ok(),"past clock is not a request to reopen the store");
}

#[test]
fn historical_violations_do_not_reject_an_admissible_current_sunday_rest(){
    let mut v=legacy();let p=&mut v["input"]["employees"][0];
    p["maxConsecutiveSundays"]=json!(2);p["sundayRestRule"]=json!("COMMERCE");
    for row in p["history"].as_array_mut().unwrap(){
        if ["2026-10-18","2026-10-25","2026-11-01"].iter().any(|d|row["date"]==*d){
            row["kind"]=json!("WORK");row["shiftId"]=json!("day");
        }
    }
    let plan=parse(&v).expect("past-only violation must not invalidate a corrective current horizon");
    assert!(plan.employees[0].catalog.iter().all(|p|p.states[6]==OFF));
}

#[test]
fn a_complete_hint_with_a_recoverable_estimated_gap_is_not_a_lock(){
    for locked in [false,true]{
        let mut v=legacy();v["input"]["startDate"]=json!("2026-12-06");v["input"]["endDate"]=json!("2026-12-12");
        v["input"]["planningWeekStartsOn"]=json!("SUNDAY");v["input"]["restRulesVersion"]=json!(2);
        let template=v["input"]["employees"][0].clone();
        v["input"]["employees"]=json!((0..3).map(|i|{let mut p=template.clone();p["id"]=json!(format!("p{i}"));p["history"]=json!([]);p}).collect::<Vec<_>>());
        v["input"]["assignments"]=json!((0..3).flat_map(|i|(6..=12).map(move |d|{
            let mut row=json!({"employeeId":format!("p{i}"),"date":format!("2026-12-{d:02}"),"kind":if d==6||d==11{"OFF"}else{"WORK"}});
            if d!=6&&d!=11{row["shiftId"]=json!("day");}
            if locked&&d==11{row["locked"]=json!(true);}row
        })).collect::<Vec<_>>());
        v["input"]["_initialAssignments"]=v["input"]["assignments"].clone();
        v["input"]["demands"]=json!((7..=12).map(|d|json!({"date":format!("2026-12-{d:02}"),"sector":"Reposição","start":480,"end":720,"minimum":if d==11{1}else{2},"estimated":d==11})).collect::<Vec<_>>());
        let mut plan=parse(&v).unwrap();let before=evaluate(&plan);assert_eq!(before[0],0);assert_eq!(before[1],240);
        seed::construct(&mut plan,Instant::now()+Duration::from_secs(1));let after=evaluate(&plan);
        assert_eq!(after[0],0);assert_eq!(after[1],if locked{240}else{0});
    }
}
