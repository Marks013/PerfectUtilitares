//! Public legacy request contracts, independent of optimizer-selected rosters.
use super::*;
fn legacy()->V{serde_json::from_str(include_str!("legacy-service-fixture.json")).unwrap()}
fn parse(v:&V)->Result<TemporalPlan>{read_admitted(v,Instant::now()+Duration::from_secs(5),false,true)}
#[test]
fn service_legacy_monday_defaults_keep_the_actual_calendar(){
    let v=legacy();let original=v.clone();let mut plan=parse(&v).expect("valid legacy public request");
    assert_eq!(plan.employees[0].facts.weekday(0),1);
    assert_eq!(plan.employees[0].facts.dates[0],"2026-11-02");
    seed::construct(&mut plan,Instant::now()+Duration::from_secs(1));
    assert_eq!(evaluate(&plan)[0],0);assert_eq!(v,original);
    let p=&plan.employees[0];let pat=p.catalog[p.pattern.unwrap()];
    assert_eq!(pat.states[..7].iter().filter(|&&s|work(s)).count(),5);
    assert!(read(&v,Instant::now()+Duration::from_secs(1)).is_err());
}
#[test]
fn service_legacy_fixed_saturday_is_not_silently_upgraded_to_v3(){
    let mut v=legacy();let p=&mut v["input"]["employees"][0];p["offMode"]=json!("FIXED");p["fixedOffDays"]=json!([5,6]);
    let plan=parse(&v).expect("v1 permits configured Saturday rest");let p=&plan.employees[0];
    assert!(p.allowed.iter().all(|&i|p.catalog[i].states[5]==OFF&&p.catalog[i].states[6]==OFF));
    v["input"]["restRulesVersion"]=json!(3);
    assert!(parse(&v).is_err(),"v3 must not silently relax Saturday rule");
}
#[test]
fn service_explicit_monday_v3_does_not_shift_sunday_or_saturday(){
    let mut v=legacy();v["input"]["planningWeekStartsOn"]=json!("MONDAY");v["input"]["restRulesVersion"]=json!(3);
    let plan=parse(&v).unwrap();let p=&plan.employees[0];
    assert_eq!(p.facts.weekday(5),6);assert_eq!(p.facts.weekday(6),0);
    assert!(p.allowed.iter().all(|&i|p.catalog[i].states[5]!=OFF));
}
#[test]
fn service_metadata_defaults_never_accept_malformed_explicit_values(){
    for (field,value) in [("planningWeekStartsOn",V::Null),("planningWeekStartsOn",json!("TUESDAY")),("restRulesVersion",V::Null),("restRulesVersion",json!(4)),("storeClosingMinutes",json!(true))]{
        let mut v=legacy();v["input"][field]=value;assert!(parse(&v).is_err(),"{field}");
    }
}
#[test]
fn service_v3_numeric_branch_two_closes_sundays_without_mutating_input(){
    let mut v=legacy();v["input"]["branchCode"]=json!("002");v["input"]["restRulesVersion"]=json!(3);
    let original=v.clone();let plan=parse(&v).unwrap();let p=&plan.employees[0];
    assert!(p.facts.closed[6]);assert!(p.allowed.iter().all(|&i|p.catalog[i].states[6]==OFF));assert_eq!(v,original);
}

#[test]
fn service_unauthorized_compensation_has_a_proven_empty_personal_domain(){
    let mut v=legacy();v["input"]["defaultWeeklyHours"]=json!(42);
    v["input"]["employees"][0]["weeklyHours"]=json!(42);
    v["input"]["shifts"][0]["segments"][2]["end"]=json!(1044);
    v["input"]["policy"]["compensationAuthorized"]=json!(false);
    let output=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(output["body"]["status"],"INFEASIBLE");
    assert!(output["body"]["assignments"].as_array().unwrap().is_empty());
}
#[test]
fn service_terminal_fixed_rest_cannot_invent_a_forbidden_future_holiday_off(){
    let mut v=legacy();v["input"]["endDate"]=json!("2026-11-15");
    let cal=Calendar::aligned("2026-11-02","2026-11-15",None,1).unwrap();
    let p=&mut v["input"]["employees"][0];p["offMode"]=json!("FIXED");p["fixedOffDays"]=json!([0,6]);p["offPattern"]=json!("CONSECUTIVE");
    for row in p["history"].as_array_mut().unwrap(){
        let day=cal.relative(row["date"].as_str().unwrap()).unwrap();
        if matches!((cal.offset as i32+day).rem_euclid(7),0|1){row["kind"]=json!("OFF");row.as_object_mut().unwrap().remove("shiftId");}
        else{row["kind"]=json!("WORK");row["shiftId"]=json!("day");}
    }
    assert!(parse(&v).is_ok());
    v["input"]["policy"]["holidayDates"]=json!(["2026-11-16"]);
    let output=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(output["body"]["status"],"INFEASIBLE");
    assert!(output["body"]["assignments"].as_array().unwrap().is_empty());
}
