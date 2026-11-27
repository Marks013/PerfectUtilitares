use super::*;

fn legacy()->V{serde_json::from_str(include_str!("legacy-service-fixture.json")).unwrap()}
fn admitted(v:&V)->Result<TemporalPlan>{read_admitted(v,Instant::now()+Duration::from_secs(5),false,true)}
fn wide_catalog()->V{
    let mut v=legacy();
    let original=v["input"]["shifts"][0].clone();
    let entries=v["input"]["shifts"].as_array_mut().unwrap();
    for index in 1..SERVICE_CLOCKS{
        let mut shift=original.clone();
        shift["id"]=json!(format!("day-{index}"));
        if index==SERVICE_CLOCKS-1{
            for s in shift["segments"].as_array_mut().unwrap(){
                s["start"]=json!(s["start"].as_i64().unwrap()+60);
                s["end"]=json!(s["end"].as_i64().unwrap()+60);
            }
        }
        entries.push(shift);
    }
    let mut options=vec!["day".to_owned()];
    options.extend((SERVICE_CLOCKS-11..SERVICE_CLOCKS).map(|i|format!("day-{i}")));
    v["input"]["employees"][0]["shiftIds"]=json!(options);
    v
}

#[test]
fn service_accepts_full_catalog_and_all_twelve_personal_choices(){
    let v=wide_catalog();
    let p=admitted(&v).unwrap();
    let row=&p.employees[0];
    assert_eq!(row.facts.clocks.len(),120);
    let actual:BTreeSet<_>=row.catalog.iter().flat_map(|pat|pat.states[..7].iter().copied())
        .filter_map(|s|clock(&row.facts.clocks,s).map(|c|c.id.as_str())).collect();
    assert_eq!(actual,v["input"]["employees"][0]["shiftIds"].as_array().unwrap().iter().map(|v|v.as_str().unwrap()).collect());
    assert!(!actual.contains("day-1"));
}

#[test]
fn highest_catalog_state_remains_fixed_and_satisfies_confirmed_coverage(){
    let mut v=wide_catalog();
    v["input"]["employees"][0]["fixedImportedShiftId"]=json!("day-119");
    v["input"]["demands"]=json!([{"id":"last-hour","date":"2026-11-03","sector":"Reposição",
        "role":"Repositor","start":1020,"end":1080,"minimum":1,"estimated":false}]);
    let mut p=admitted(&v).unwrap();
    seed::construct(&mut p,Instant::now()+Duration::from_secs(1));
    assert_eq!(evaluate(&p)[0],0);
    let row=&p.employees[0];let values=&row.catalog[row.pattern.unwrap()].states;
    assert_eq!(values[1],122);
    assert!(values[..7].iter().copied().filter(|&s|work(s)).all(|s|s==122));
    assert_ne!(values[1],DUTY);
}

#[test]
fn service_rejects_catalog_and_person_limits_above_public_contract(){
    let mut v=wide_catalog();
    v["input"]["employees"][0]["shiftIds"].as_array_mut().unwrap().push(json!("day-1"));
    assert_eq!(admitted(&v).err(),Some("TEMPORAL_CLOCK_OPTIONS"));
    let mut v=wide_catalog();
    let mut extra=v["input"]["shifts"][0].clone();extra["id"]=json!("overflow");
    v["input"]["shifts"].as_array_mut().unwrap().push(extra);
    assert_eq!(admitted(&v).err(),Some("CLOCK_LIMIT"));
}

fn manual_fixture()->V{
    let mut v=legacy();
    v["input"]["shifts"].as_array_mut().unwrap().push(json!({"id":"period","name":"Seleção de período",
        "segments":[{"start":540,"end":780,"kind":"WORK"},{"start":780,"end":840,"kind":"BREAK"},
                    {"start":840,"end":1080,"kind":"WORK"}]}));
    let person=&mut v["input"]["employees"][0];
    person["scheduleMode"]=json!("TIMED");
    person["fixedImportedShiftId"]=json!("day");
    person["manualShiftBaseIds"]=json!(["day"]);
    person["manualShiftOverrides"]=json!([{"catalogCode":1500,"shiftId":"period",
        "markings":["09:00","13:00","14:00","18:00"],"effectiveFrom":"2026-11-04","effectiveUntil":"2026-11-05"}]);
    person["manualShiftByDate"]=json!({"2026-11-04":"period","2026-11-05":"period"});
    v
}

#[test]
fn service_manual_period_preserves_base_clock_on_ordinary_days(){
    let v=manual_fixture();let before=v.clone();
    let p=admitted(&v).unwrap();let row=&p.employees[0];
    for pat in row.catalog.iter(){
        for (d,&s) in pat.states[..7].iter().enumerate(){
            if let Some(c)=clock(&row.facts.clocks,s){
                assert_eq!(c.id,if [2,3].contains(&d){"period"}else{"day"});
            }
        }
    }
    assert!(row.catalog.iter().any(|pat|pat.states[2]==4));
    assert_eq!(v,before);
}

#[test]
fn service_manual_period_rejects_inconsistent_base_map_and_geometry(){
    let mut v=manual_fixture();
    v["input"]["employees"][0]["manualShiftBaseIds"]=json!(["day","period"]);
    assert_eq!(admitted(&v).err(),Some("MANUAL_SHIFT_BASE"));
    let mut v=manual_fixture();
    v["input"]["employees"][0]["manualShiftByDate"]["2026-11-03"]=json!("period");
    assert_eq!(admitted(&v).err(),Some("MANUAL_SHIFT_PROJECTION"));
    let mut v=manual_fixture();
    v["input"]["employees"][0]["manualShiftOverrides"][0]["markings"][0]=json!("08:00");
    assert_eq!(admitted(&v).err(),Some("MANUAL_SHIFT_GEOMETRY"));
}

fn resolved_local_calendar()->V{
    let mut v=legacy();
    let input=&mut v["input"];
    input["startDate"]=json!("2026-12-21");
    input["endDate"]=json!("2026-12-27");
    input["employees"][0]["history"]=json!([]);
    input["employees"][0]["historyKnown"]=json!(false);
    let policy=&mut input["policy"];
    policy["calendarMode"]=json!("LOCAL");
    policy["holidayDates"]=json!(["2026-12-22","2026-12-25"]);
    policy["authorizedHolidayDates"]=json!(["2026-12-22"]);
    policy["closedDates"]=json!(["2026-12-24","2026-12-25"]);
    policy["paidHolidayDates"]=json!(["2026-12-25"]);
    v
}

#[test]
fn service_local_uses_resolved_dates_without_expanding_paid_closures(){
    let v=resolved_local_calendar();
    let mut explicit=v.clone();
    explicit["input"]["policy"]["calendarMode"]=json!("MANUAL");
    let local=admitted(&v).unwrap();
    let manual=admitted(&explicit).unwrap();
    let person=&local.employees[0];
    assert_eq!(person.catalog,manual.employees[0].catalog);
    assert!(!person.catalog.is_empty());
    assert!(person.catalog.iter().all(|p|work(p.states[1])&&p.states[3]==OFF&&p.states[4]==HOL));
}

#[test]
fn service_local_refuses_missing_lists_unknown_modes_and_incoherent_dates(){
    let mut v=resolved_local_calendar();
    v["input"]["policy"].as_object_mut().unwrap().remove("paidHolidayDates");
    assert_eq!(admitted(&v).err(),Some("LOCAL_CALENDAR_UNRESOLVED"));
    let mut v=resolved_local_calendar();
    v["input"]["policy"]["authorizedHolidayDates"]=json!(["2026-12-23"]);
    assert_eq!(admitted(&v).err(),Some("HOLIDAY_POLICY"));
    let mut v=resolved_local_calendar();
    v["input"]["policy"]["closedDates"]=json!(["2026-12-24"]);
    assert_eq!(admitted(&v).err(),Some("HOLIDAY_POLICY"));
    let mut v=resolved_local_calendar();
    v["input"]["policy"]["paidHolidayDates"]=json!(["2026-12-24"]);
    assert_eq!(admitted(&v).err(),Some("PAID_HOLIDAY_DATE"));
    let mut v=resolved_local_calendar();
    v["input"]["policy"]["calendarMode"]=json!("UNKNOWN");
    assert_eq!(admitted(&v).err(),Some("POLICY"));
}

#[test]
fn local_calendar_is_not_admitted_on_the_synthetic_path(){
    let mut v=resolved_local_calendar();
    let input=&mut v["input"];
    input["branchCode"]=json!("SYNTH");
    input["simulation"]=json!(true);
    input["planningWeekStartsOn"]=json!("SUNDAY");
    input["restRulesVersion"]=json!(3);
    input["startDate"]=json!("2026-12-20");
    input["endDate"]=json!("2026-12-26");
    assert_eq!(read(&v,Instant::now()+Duration::from_secs(5)).err(),Some("POLICY"));
}
