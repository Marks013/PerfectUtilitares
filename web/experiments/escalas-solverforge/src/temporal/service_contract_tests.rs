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

#[test]
fn service_untimed_distinct_roles_do_not_empty_a_shared_sector(){
    let mut v=legacy();v["input"]["endDate"]=json!("2026-11-29");
    let template=v["input"]["employees"][0].clone();
    v["input"]["employees"]=json!((0..4).map(|i|{
        let mut p=template.clone();p["id"]=json!(format!("p{i}"));p["role"]=json!(format!("Responsabilidade {i}"));
        p["scheduleMode"]=json!("UNTIMED");p["shiftIds"]=json!([]);p["history"]=json!([]);p["historyKnown"]=json!(false);
        p["sundayRestRule"]=json!("PROTECTIVE");p
    }).collect::<Vec<_>>());
    let plan=parse(&v).unwrap();let p=&plan.employees[0];let best=p.catalog.iter().map(|p|p.personal[6]).min().unwrap();
    let masks:BTreeSet<_>=p.catalog.iter().filter(|p|p.personal[6]==best).map(|p|(0..4).fold(0u8,|m,w|m|if work(p.states[w*7+6]){1<<w}else{0})).collect();
    println!("best rotation cost={best}; available Sunday masks={masks:?}");
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(4));
    assert_eq!(answer["body"]["status"],"FEASIBLE","{answer}");
    let rows=answer["body"]["assignments"].as_array().unwrap();
    for d in 2..=29{
        let date=format!("2026-11-{d:02}");
        assert!(rows.iter().filter(|r|r["date"]==date&&r["kind"]=="DUTY").count()>=2,"{date}");
    }
    assert!(rows.iter().all(|r|r.get("shiftId").is_none()));
}

#[test]
fn service_disallowed_manual_clock_can_be_off_but_cannot_supply_required_coverage(){
    let mut v=legacy();let mut bad=v["input"]["shifts"][0].clone();bad["id"]=json!("too-long");bad["segments"][2]["end"]=json!(1080);
    v["input"]["policy"]["dailyLimitMinutes"]=json!(480);v["input"]["shifts"].as_array_mut().unwrap().push(bad);
    v["input"]["employees"][0]["manualShiftByDate"]=json!({"2026-11-04":"too-long"});
    let original=v.clone();let plan=parse(&v).unwrap();let p=&plan.employees[0];
    assert!(p.catalog.iter().all(|x|x.states[2]==OFF));assert_eq!(v,original);
    v["input"]["demands"]=json!([{ "date":"2026-11-04","sector":"Reposição","start":480,"end":540,"minimum":1 }]);
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE");assert!(answer["body"]["assignments"].as_array().unwrap().is_empty());
}
#[test]
fn service_paid_pause_is_neither_a_meal_nor_hourly_service(){
    let mut v=legacy();v["input"]["shifts"][0]["segments"][1]["kind"]=json!("PAID_BREAK");
    v["input"]["shifts"][0]["segments"][2]["end"]=json!(960);
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE");
}
#[test]
fn service_short_simulation_still_requires_the_explicit_meal_opt_in(){
    let mut v=legacy();v["input"]["simulation"]=json!(true);v["input"]["employees"][0]["simulationDailyMinutes"]=json!(300);
    v["input"]["shifts"][0]["segments"]=json!([{ "kind":"WORK","start":480,"end":780 }]);
    assert!(parse(&v).is_err());v["input"]["policy"]["allowShortMealSimulation"]=json!(true);
    let plan=parse(&v).unwrap();let p=&plan.employees[0];assert!(p.catalog.iter().all(|x|x.states[..7].iter().filter(|&&s|work(s)).count()==5));
    v["input"]["simulation"]=json!(false);assert!(parse(&v).is_err());
}

#[test]
fn service_disabled_records_are_preserved_but_never_supply_coverage(){
    let mut v=legacy();let mut disabled=v["input"]["employees"][0].clone();
    disabled["id"]=json!("disabled");disabled["planningEnabled"]=json!(false);disabled["sector"]=json!("Excluded");
    v["input"]["employees"].as_array_mut().unwrap().push(disabled);
    let saved=json!({"employeeId":"disabled","date":"2026-11-03","kind":"WORK","shiftId":"day","locked":true,"note":"untouched"});
    v["input"]["assignments"]=json!([saved.clone(),{"employeeId":"disabled","date":"2026-11-04","kind":"OFF"}]);
    let response=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(4));
    assert_eq!(response["body"]["status"],"FEASIBLE","{response}");
    let rows=response["body"]["assignments"].as_array().unwrap();
    assert_eq!(rows.len(),8);assert_eq!(rows.iter().find(|r|r["employeeId"]=="disabled"),Some(&saved));
    v["input"]["demands"]=json!([{ "date":"2026-11-03","sector":"Excluded","start":480,"end":540,"minimum":1 }]);
    let response=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(response["body"]["status"],"INFEASIBLE");assert_eq!(response["body"]["assignments"],json!([]));
}

#[test]
fn service_configured_closed_holiday_is_not_an_ordinary_rest_or_a_schema_error(){
    let mut v=legacy();
    for key in ["closedDates","holidayDates","paidHolidayDates"]{v["input"]["policy"][key]=json!(["2026-11-04"]);}
    let plan=parse(&v).expect("explicit closed paid holiday in original public contract");
    assert!(plan.employees[0].catalog.iter().all(|p|p.states[2]==HOL));
    v["input"]["assignments"]=json!([{ "employeeId":"p0","date":"2026-11-04","kind":"WORK","shiftId":"day","locked":true }]);
    let response=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(response["body"]["status"],"INFEASIBLE");assert_eq!(response["body"]["assignments"],json!([]));
    v["input"]["policy"]["closedDates"]=json!([]);assert!(parse(&v).is_err());
}
#[test]
fn service_large_untimed_week_shares_its_domain_without_inventing_clocks(){
    let mut v=legacy();let template=v["input"]["employees"][0].clone();
    v["input"]["employees"]=json!((0..76).map(|i|{
        let mut p=template.clone();p["id"]=json!(format!("p{i}"));p["scheduleMode"]=json!("UNTIMED");
        p["shiftIds"]=json!([]);p["history"]=json!([]);p["historyKnown"]=json!(false);p
    }).collect::<Vec<_>>());v["input"]["shifts"]=json!([]);
    let plan=parse(&v).unwrap();assert_eq!(plan.employees.len(),76);
    assert!(plan.employees.iter().all(|p|Arc::ptr_eq(&p.catalog,&plan.employees[0].catalog)));
    assert!(plan.employees[0].catalog.iter().all(|p|p.states[..7].iter().all(|&s|s==DUTY||s==OFF)));
}

#[test]
fn service_informational_documents_never_grant_or_remove_operational_permission(){
    let mut v=legacy();
    for document in [V::Null,json!({"reviewed":false,"validUntil":"2020-01-01"}),json!({"source":" ","reviewed":true})]{
        v["input"]["policy"]["collectiveAgreement"]=document;
        let before=v.clone();assert!(parse(&v).is_ok());assert_eq!(v,before);
    }
    v["input"]["policy"]["operationalCertificate"]=json!({"reviewed":false});
    assert!(parse(&v).is_ok());
    v["input"]["policy"]["dailyLimitMinutes"]=json!(300);
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE");
}
#[test]
fn service_named_profile_keeps_open_holiday_rest_restriction(){
    let mut v=legacy();v["input"]["policy"]["normativeProfile"]=json!("SINDECOMU_SUPERMARKETS_2026_2027");
    assert!(parse(&v).is_ok());
    v["input"]["policy"]["holidayDates"]=json!(["2026-11-02"]);
    v["input"]["policy"]["holidayRestAllowed"]=json!(true);
    v["input"]["assignments"]=json!([{"employeeId":"p0","date":"2026-11-02","kind":"OFF","locked":true}]);
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE");assert_eq!(answer["body"]["assignments"],json!([]));
    v["input"]["policy"]["normativeProfile"]=json!("UNKNOWN_PROFILE");assert!(parse(&v).is_err());
}
#[test]
fn service_target_above_weekly_limit_is_a_constraint_conflict(){
    let mut v=legacy();v["input"]["employees"][0]["weeklyHours"]=json!(42);
    v["input"]["policy"]["weeklyLimit"]=json!(40);
    v["input"]["shifts"][0]["segments"][2]["end"]=json!(1044);
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE");assert_eq!(answer["body"]["assignments"],json!([]));
}
#[test]
fn service_mixed_scope_is_exact_and_inactive_outside_branch_target(){
    let mut v=legacy();v["input"]["mixed42Sectors"]=json!(["reposiçao"]);
    assert!(parse(&v).is_ok());
    v["input"]["defaultWeeklyHours"]=json!(44);v["input"]["mixed42Sectors"]=json!(["Reposição"]);
    assert!(parse(&v).is_ok());
}

#[test]
fn service_visible_month_clips_to_real_requested_dates_without_padding(){
    let c=Calendar::service("2026-12-06","2026-12-12",Some("2026-12"),0).unwrap();
    assert_eq!(c.labels.len(),7);assert_eq!(c.visible.iter().filter(|&&x|x).count(),7);
    let c=Calendar::service("2026-11-29","2026-12-05",Some("2026-12"),0).unwrap();
    assert_eq!(&c.visible[..7],&[false,false,true,true,true,true,true]);
    assert!(Calendar::service("2026-12-06","2026-12-12",Some("2027-01"),0).is_err());
    assert!(Calendar::new("2026-12-06","2026-12-12",Some("2026-12")).is_err());
}
#[test]
fn service_legacy_overconstrained_rest_days_have_a_proven_domain_conflict(){
    let mut v=legacy();v["input"]["employees"][0]["fixedOffDays"]=json!([0,1,2,3,4,5,6]);
    let answer=solve_service(&serde_json::to_vec(&v).unwrap(),Instant::now(),Duration::from_secs(3));
    assert_eq!(answer["body"]["status"],"INFEASIBLE");assert_eq!(answer["body"]["assignments"],json!([]));
    v["input"]["employees"][0]["fixedRestSlots"]=json!([{"enabled":true,"weekday":0},{"enabled":true,"weekday":1}]);
    assert!(parse(&v).is_err());
}

#[test]
fn service_open_holiday_documentation_does_not_create_a_closure(){
    let mut v=legacy();let person=&mut v["input"]["employees"][0];
    person["scheduleMode"]=json!("UNTIMED");person["shiftIds"]=json!([]);person["history"]=json!([]);
    v["input"]["policy"]["normativeProfile"]=json!("SINDECOMU_SUPERMARKETS_2026_2027");
    v["input"]["policy"]["holidayDates"]=json!(["2026-11-02"]);
    v["input"]["policy"]["operationalCertificate"]=json!({"holidays":false,"reviewed":false});
    let before=v.clone();let plan=parse(&v).unwrap();
    assert!(plan.employees[0].catalog.iter().all(|p|p.states[0]==DUTY));assert_eq!(v,before);
    v["input"]["policy"]["closedDates"]=json!(["2026-11-02"]);
    assert!(parse(&v).is_err(),"document cannot reopen a configured closure");
}
#[test]
fn service_meal_extension_uses_numeric_limit_not_document_review_flags(){
    let mut v=legacy();v["input"]["shifts"][0]["segments"][1]["end"]=json!(900);
    v["input"]["shifts"][0]["segments"][2]["start"]=json!(900);
    v["input"]["shifts"][0]["segments"][2]["end"]=json!(1140);
    assert!(parse(&v).is_err());
    v["input"]["policy"]["mealIntervalAgreement"]=json!({"maximumMinutes":180,"reviewed":false});
    assert!(parse(&v).is_ok());
    v["input"]["policy"]["mealIntervalAgreement"]["maximumMinutes"]=json!(true);
    assert!(parse(&v).is_err());
}

#[test]
fn service_presence_only_preserves_days_without_inventing_hourly_intervals(){
    let mut v=legacy();let p=&mut v["input"]["employees"][0];
    p["scheduleMode"]=json!("UNTIMED");p["shiftIds"]=json!([]);p["history"]=json!([]);
    v["input"]["policy"]["minInterShiftMinutes"]=json!(10000);
    v["input"]["policy"]["minWeeklyRestMinutes"]=json!(20000);
    let before=v.clone();let plan=parse(&v).unwrap();
    assert!(plan.employees[0].catalog.iter().all(|p|p.states[..7].iter().all(|&s|s==DUTY||s==OFF)));
    assert_eq!(v,before);v["input"]["employees"][0]["scheduleMode"]=json!("TIMED");
    assert!(matches!(parse(&v),Err("POLICY_LIMIT")));
}
#[test]
fn service_metadata_excludes_closing_without_overlapping_estimated_service(){
    let mut v=legacy();v["input"]["demands"]=json!([{"date":"2026-11-03","sector":"Reposição","start":480,"end":720,"minimum":1,"estimated":true}]);
    let mut p=parse(&v).unwrap();seed::construct(&mut p,Instant::now()+Duration::from_secs(1));
    let cost=evaluate(&p);let metadata=report::metadata(&p,cost,cost,[0.0;3],false,false);
    let names:Vec<_>=metadata["phases"].as_array().unwrap().iter().map(|p|p["objective"].as_str().unwrap()).collect();
    assert!(names.contains(&"COVERAGE"));assert!(!names.contains(&"CLOSING_COVERAGE"));
    v["input"]["storeClosingMinutes"]=json!(1020);
    v["input"]["demands"][0]["start"]=json!(960);v["input"]["demands"][0]["end"]=json!(1020);
    let mut p=parse(&v).unwrap();seed::construct(&mut p,Instant::now()+Duration::from_secs(1));let cost=evaluate(&p);
    let metadata=report::metadata(&p,cost,cost,[0.0;3],false,false);
    assert!(metadata["phases"].as_array().unwrap().iter().any(|p|p["objective"]=="CLOSING_COVERAGE"));
}
