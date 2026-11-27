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

#[test]
fn service_coverage_certificate_proves_six_required_dates_exceed_one_person_week(){
    let mut v=legacy();
    v["input"]["_coverageProtection"]=json!([2,3,4,5,6,8].map(|d|json!({
        "date":format!("2026-11-{d:02}"),"sector":"Reposição","role":"Repositor","start":480,"end":540,"minimum":1})));
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE","{answer}");
    assert_eq!(answer["body"]["solverDiagnostics"][0]["family"],"COVERAGE");
    assert!(answer["body"]["assignments"].as_array().unwrap().is_empty());
}
#[test]
fn service_coverage_certificate_never_counts_breaks_as_timed_service(){
    let mut v=legacy();v["input"]["_coverageServiceProtection"]=json!({"days":[],"bands":[{
        "sector":"Reposição","role":"Repositor","start":719,"end":721,"scope":"HORIZON","minimum":1}]});
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE","{answer}");
    assert_eq!(answer["body"]["solverDiagnostics"][0]["family"],"COVERAGE");
}
#[test]
fn service_demand_identifiers_are_optional_but_malformed_explicit_ids_are_not(){
    let mut v=legacy();v["input"]["demands"]=json!([{"date":"2026-11-04","sector":"Reposição",
        "start":480,"end":540,"minimum":1,"estimated":true}]);
    assert!(parse(&v).is_ok());
    v["input"]["demands"][0]["id"]=json!(false);assert!(parse(&v).is_err());
}
#[test]
fn service_metadata_describes_actual_lexicographic_search_not_proven_phases(){
    let answer=solve_service(&serde_json::to_vec(&legacy()).unwrap(),Instant::now(),Duration::from_secs(4));
    assert_eq!(answer["body"]["status"],"FEASIBLE","{answer}");
    let metadata=&answer["body"]["optimization"];
    assert_eq!(metadata["method"],"BOUNDED_LEXICOGRAPHIC_SEARCH");
    assert_eq!(metadata["globalOptimalityProven"],false);
    assert_eq!(metadata["constructionSeconds"],answer["temporal"]["mapSeconds"]);
    assert_eq!(metadata["feasibilitySeconds"],answer["temporal"]["seedSeconds"]);
    assert_eq!(metadata["refinementSeconds"],answer["temporal"]["searchSeconds"]);
    let phases=metadata["phases"].as_array().unwrap();assert!(!phases.is_empty());
    for p in phases{assert_eq!(p["execution"],"LEXICOGRAPHIC_SCORE_LEVEL");assert_eq!(p["proven"],false);}
    assert!(metadata.get("leadership").is_none());
}

#[test]
fn service_capacity_certificates_agree_with_all_one_week_exact_personal_paths(){
    let baseline=legacy();let plan=parse(&baseline).unwrap();let person=&plan.employees[0];
    let legal:Vec<u8>=person.allowed.iter().map(|&i|person.catalog[i].states[..7].iter().enumerate()
        .fold(0,|mask,(d,&state)|mask|if work(state){1<<d}else{0})).collect();
    let mut rejected=0;
    for needed in 0u8..128{
        let mut input=baseline.clone();input["input"]["_coverageProtection"]=json!((0..7)
            .filter(|d|needed&(1<<d)!=0).map(|d|json!({"date":format!("2026-11-{:02}",d+2),
                "sector":"Reposição","role":"Repositor","start":480,"end":540,"minimum":1})).collect::<Vec<_>>());
        match parse(&input){
            Err("INFEASIBLE_COVERAGE_BOUND")=>{rejected+=1;assert!(!legal.iter().any(|mask|mask&needed==needed),"{needed}");},
            Ok(_)=>{},Err(e)=>panic!("unexpected {needed}: {e}"),
        }
    }
    assert!(rejected>0);
}
#[test]
fn service_capacity_certificate_uses_presampling_options_and_honors_expiry(){
    let mut input=legacy();input["input"]["endDate"]=json!("2026-11-15");
    input["input"]["_coverageServiceProtection"]=json!({"days":[{"date":"2026-11-08","sector":"Reposição"}],"bands":[]});
    let mut plan=parse(&input).unwrap();let p=&mut plan.employees[0];
    let off=*p.catalog.iter().find(|p|p.states[6]==OFF).unwrap();
    p.catalog=Arc::new(vec![off]);p.allowed=Arc::from([0usize]);
    let calendar=Calendar::aligned("2026-11-02","2026-11-15",None,1).unwrap();
    let raw=vec![vec![OFF,3];14];let mut upper=feasibility::Upper::default();
    upper.observe(p,&raw,Instant::now()+Duration::from_secs(1)).unwrap();
    assert!(upper.verify(&[Arc::clone(&p.facts)],&calendar,Instant::now()+Duration::from_secs(1),&mut None).is_ok());
    assert_eq!(upper.verify(&[Arc::clone(&p.facts)],&calendar,Instant::now(),&mut None),Err("MAPPING_TIMEOUT"));
}

#[test]
fn service_optional_display_metadata_never_rewrites_the_public_payload(){
    let mut value=legacy();value["input"].as_object_mut().unwrap().remove("schemaVersion");
    value["input"].as_object_mut().unwrap().remove("timeZone");
    value["input"]["employees"][0].as_object_mut().unwrap().remove("name");
    let original=value.clone();let p=parse(&value).expect("metadata omitted in original validated public contracts");
    assert_eq!(p.employees[0].name_id,"p0");assert_eq!(value,original);
    value["input"]["schemaVersion"]=json!(true);assert!(parse(&value).is_err());
    value["input"]["schemaVersion"]=json!(1);value["input"]["timeZone"]=json!("UTC");assert!(parse(&value).is_err());
}

#[test]
fn service_monday_six_weeks_maps_last_sunday_inside_the_six_week_array(){
    let mut v=legacy();v["input"]["endDate"]=json!("2026-12-13");
    v["input"]["demands"]=json!([{"date":"2026-12-13","sector":"Reposição","start":480,"end":540,"minimum":1,"estimated":true}]);
    let plan=parse(&v).expect("six aligned Monday weeks");let f=&plan.employees[0].facts;
    assert_eq!(f.weekday(41),0);assert_eq!(f.week(41),5);
    assert!((0..42).all(|d|f.week(d)<6));
}

#[test]
fn service_certificate_identifies_the_actual_uncovered_meal_interval(){
    let mut v=legacy();v["input"]["demands"]=json!([{"date":"2026-11-02","sector":"Reposição",
        "start":720,"end":780,"minimum":1}]);
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE");
    let message=answer["body"]["message"].as_str().unwrap();
    assert!(message.contains("2026-11-02"));assert!(message.contains("12:00"));
    assert!(message.contains("13:00"));assert!(message.contains("intervalos de refeição"));
}
