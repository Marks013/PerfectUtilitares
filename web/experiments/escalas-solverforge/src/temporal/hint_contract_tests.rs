//! Historical initial-suggestion contracts against the real native mapper.
//! HTTP schema remains independently strict; suggestions are never saved authority.
use super::*;
fn data() -> V {
    let mut v: V = serde_json::from_str(include_str!("legacy-service-fixture.json")).unwrap();
    v["input"]["assignments"]=json!((2..=8).map(|d|{
        let mut row=json!({"employeeId":"p0","date":format!("2026-11-{d:02}"),"kind":if d<=6{"WORK"}else{"OFF"}});
        if d<=6{row["shiftId"]=json!("day");}row
    }).collect::<Vec<_>>());
    v["input"]["_initialAssignments"] = v["input"]["assignments"].clone();
    v["input"]["_initialAssignments"][3] =
        json!({"employeeId":"p0","date":"2026-11-05","kind":"OFF"});
    v["input"]["_initialAssignments"][5] =
        json!({"employeeId":"p0","date":"2026-11-07","kind":"WORK","shiftId":"day"});
    v
}
fn parse(v: &V) -> Result<TemporalPlan> {
    read_admitted(v, Instant::now() + Duration::from_secs(5), false, true)
}
fn constructed(v: &V) -> TemporalPlan {
    let mut p =
        parse(v).expect("optional suggestion must not invalidate the authoritative request");
    seed::construct(&mut p, Instant::now() + Duration::from_secs(1));
    assert_eq!(evaluate(&p)[0], 0);
    p
}
fn assert_saved(v: &V, plan: &TemporalPlan) {
    let p = &plan.employees[0];
    let states = p.catalog[p.pattern.unwrap()].states;
    for (d, row) in v["input"]["assignments"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["employeeId"] == "p0")
        .enumerate()
    {
        let expected = match row["kind"].as_str().unwrap() {
            "OFF" => OFF,
            "ABSENCE" => ABS,
            "HOLIDAY" => HOL,
            "DUTY" => DUTY,
            _ => 3,
        };
        assert_eq!(states[d], expected, "date {}", row["date"]);
    }
    assert_eq!(&evaluate(plan)[13..15], &[0, 0]);
}
#[test]
fn test_preferred_two_day_exchange_still_counts_against_original_saved_roster() {
    let v = data();
    let original = v.clone();
    let p = constructed(&v);
    let e = &p.employees[0];
    let states = e.catalog[e.pattern.unwrap()].states;
    assert_eq!(&states[..7], &[3, 3, 3, OFF, 3, 3, OFF]);
    assert_eq!(&evaluate(&p)[13..15], &[1, 2]);
    assert!(!e.pinned && e.allowed.len() > 1);
    assert!(e.lock_flags.iter().all(Option::is_none));
    assert_eq!(v, original);
}
#[test]
fn test_fixed_weekday_violation_falls_back_to_original_not_infeasibility() {
    let mut v = data();
    v["input"]["employees"][0]["fixedOffDays"] = json!([5]);
    let before = v.clone();
    assert_saved(&v, &constructed(&v));
    assert_eq!(v, before);
}
#[test]
fn test_incomplete_duplicate_unknown_and_over_limit_hints_are_ignored() {
    for case in [
        "incomplete",
        "duplicate",
        "unknown",
        "over-limit",
        "wrong-shape",
        "outside",
        "wrong-record",
    ] {
        let mut v = data();
        let hints = v["input"]["_initialAssignments"].as_array_mut().unwrap();
        match case {
            "incomplete" => {
                hints.pop();
            }
            "duplicate" => hints.push(hints[0].clone()),
            "unknown" => hints[0]["employeeId"] = json!("other-tenant"),
            "over-limit" => {
                let row = hints[0].clone();
                *hints = vec![row; 10501];
            }
            "outside" => hints[0]["date"] = json!("2026-11-09"),
            "wrong-record" => hints[0] = json!(false),
            _ => v["input"]["_initialAssignments"] = json!({"not":"a list"}),
        }
        let original = v.clone();
        assert_saved(&v, &constructed(&v));
        assert_eq!(v, original, "{case}");
    }
}
#[test]
fn test_hint_cannot_erase_absence_or_create_a_new_one() {
    for erase in [false, true] {
        let mut v = data();
        let key = if erase {
            "assignments"
        } else {
            "_initialAssignments"
        };
        v["input"][key][2] = json!({"employeeId":"p0","date":"2026-11-04","kind":"ABSENCE"});
        let before = v.clone();
        assert_saved(&v, &constructed(&v));
        assert_eq!(v, before);
    }
}
#[test]
fn test_hint_cannot_change_a_locked_assignment() {
    let mut v = data();
    v["input"]["assignments"][3]["locked"] = json!(true);
    let p = constructed(&v);
    assert_saved(&v, &p);
    assert_eq!(p.employees[0].lock_flags[3], Some(true));
}
#[test]
fn test_unknown_shift_is_ignored_without_replacing_the_current_reference() {
    for shift in [json!("retired"), json!(["day"])] {
        let mut v = data();
        v["input"]["_initialAssignments"][5]["shiftId"] = shift;
        let original = v.clone();
        assert_saved(&v, &constructed(&v));
        assert_eq!(v, original);
    }
}
#[test]
fn test_legacy_call_without_private_hint_preserves_original_contract() {
    let mut v = data();
    v["input"]
        .as_object_mut()
        .unwrap()
        .remove("_initialAssignments");
    assert_saved(&v, &constructed(&v));
}
#[test]
fn unchanged_disabled_records_do_not_discard_a_valid_active_hint() {
    let mut v = data();
    let mut excluded = v["input"]["employees"][0].clone();
    excluded["id"] = json!("disabled");
    excluded["planningEnabled"] = json!(false);
    excluded["history"] = json!([]);
    v["input"]["employees"]
        .as_array_mut()
        .unwrap()
        .push(excluded);
    let saved = json!({"employeeId":"disabled","date":"2026-11-03","kind":"OFF","locked":true});
    v["input"]["assignments"]
        .as_array_mut()
        .unwrap()
        .push(saved.clone());
    v["input"]["_initialAssignments"]
        .as_array_mut()
        .unwrap()
        .push(saved);
    let p = constructed(&v);
    assert_eq!(p.employees.len(), 1);
    assert_eq!(&evaluate(&p)[13..15], &[1, 2]);
    v["input"]["_initialAssignments"][7]["locked"] = json!(false);
    assert_saved(&v, &constructed(&v));
}
#[test]
fn hours_only_and_hint_lock_flags_never_redefine_saved_authority() {
    let mut v = data();
    v["input"]["generationMode"] = json!("HOURS_ONLY");
    assert_saved(&v, &constructed(&v));
    v["input"]["generationMode"] = json!("DAYS_AND_HOURS");
    for row in v["input"]["_initialAssignments"].as_array_mut().unwrap() {
        row["locked"] = json!(true);
    }
    let p = constructed(&v);
    assert_eq!(&evaluate(&p)[13..15], &[1, 2]);
    assert!(!p.employees[0].pinned);
    assert!(p.employees[0].lock_flags.iter().all(Option::is_none));
}
#[test]
fn optional_hint_never_hides_a_mandatory_error_or_expiry() {
    let mut v = data();
    v["input"]["_initialAssignments"] = json!(false);
    v["input"]["assignments"][0]["shiftId"] = json!("invalid");
    assert!(parse(&v).is_err());
    let v = data();
    assert_eq!(
        read_admitted(&v, Instant::now(), false, true).err(),
        Some("MAPPING_TIMEOUT")
    );
}

#[test]
fn globally_infeasible_unsampled_hint_does_not_change_the_original_domain() {
    let mut v = data();
    v["input"]
        .as_object_mut()
        .unwrap()
        .remove("_initialAssignments");
    v["input"]["assignments"] = json!([]);
    v["input"]["endDate"] = json!("2026-12-13");
    let mut twin = v["input"]["shifts"][0].clone();
    twin["id"] = json!("same-hours");
    v["input"]["shifts"].as_array_mut().unwrap().push(twin);
    v["input"]["employees"][0]["shiftIds"] = json!(["day", "same-hours"]);
    let p = parse(&v).unwrap();
    let e = &p.employees[0];
    let mut states = e.catalog[0].states;
    let work_days: Vec<_> = (0..42).filter(|&d| work(states[d])).collect();
    assert_eq!(work_days.len(), 30);
    let known: BTreeSet<_> = e.catalog.iter().map(|p| p.states).collect();
    let mut missing = false;
    for counter in 0..=e.catalog.len() {
        for (bit, &d) in work_days.iter().enumerate() {
            states[d] = if counter & (1usize << bit) != 0 { 4 } else { 3 };
        }
        if !known.contains(&states) {
            missing = true;
            break;
        }
    }
    assert!(
        missing,
        "there are more legal identical-clock paths than the bounded catalogue"
    );
    let off = (0..42)
        .find(|&d| states[d] == OFF && e.catalog.iter().any(|p| work(p.states[d])))
        .unwrap();
    v["input"]["demands"] =
        json!([{"date":e.facts.dates[off],"sector":"Reposição","start":480,"end":540,"minimum":1}]);
    let before = parse(&v).unwrap();
    let e = &before.employees[0];
    v["input"]["_initialAssignments"]=json!((0..42).map(|d|{
        let mut row=json!({"employeeId":"p0","date":e.facts.dates[d],"kind":if states[d]==OFF{"OFF"}else{"WORK"}});
        if states[d]!=OFF{row["shiftId"]=json!(if states[d]==3{"day"}else{"same-hours"});}row
    }).collect::<Vec<_>>());
    let after = parse(&v).unwrap();
    let a = &before.employees[0];
    let b = &after.employees[0];
    assert!(
        a.catalog == b.catalog,
        "rejected hints must not add/remove sampled legal alternatives"
    );
    assert_eq!(a.allowed, b.allowed);
    assert_eq!(a.tie_costs, b.tie_costs);
    assert_eq!(a.pattern, b.pattern);
    assert_eq!(a.pinned, b.pinned);
    // The same personally legal witness is usable once the real conflicting
    // demand is absent; no assertion turns it into a mandatory assignment.
    v["input"]["demands"] = json!([]);
    let accepted = parse(&v).unwrap();
    let e = &accepted.employees[0];
    assert_eq!(e.catalog[e.pattern.unwrap()].states, states);
    assert!(!e.pinned && e.allowed.len() > 1);
    assert_eq!(evaluate(&accepted)[0], 0);
}

#[test]
fn every_private_coverage_guard_remains_authoritative_over_hints() {
    for guard in [
        "confirmed",
        "_coverageProtection",
        "_coverageServiceProtection",
        "_coverageComparison",
    ] {
        let mut v = data();
        let band = json!({"date":"2026-11-05","sector":"Reposição","role":"Repositor","start":480,"end":540,"minimum":1});
        match guard {
            "confirmed" => v["input"]["demands"] = json!([band]),
            "_coverageProtection" => v["input"][guard] = json!([band]),
            "_coverageServiceProtection" => {
                v["input"][guard] =
                    json!({"days":[{"date":"2026-11-05","sector":"Reposição"}],"bands":[]})
            }
            _ => {
                let mut band = band;
                band["estimated"] = json!(true);
                v["input"]["demands"] = json!([band]);
                v["input"][guard] = json!({"sectors":[],"bands":[]});
            }
        }
        let original = v.clone();
        assert_saved(&v, &constructed(&v));
        assert_eq!(v, original, "{guard}");
    }
}
#[test]
fn service_hints_are_order_independent_and_partial_employment_is_not_filled() {
    let v = data();
    let a = constructed(&v);
    let mut permuted = v.clone();
    permuted["input"]["_initialAssignments"]
        .as_array_mut()
        .unwrap()
        .reverse();
    let b = constructed(&permuted);
    assert_eq!(evaluate(&a), evaluate(&b));
    assert_eq!(
        a.employees[0].catalog[a.employees[0].pattern.unwrap()].states,
        b.employees[0].catalog[b.employees[0].pattern.unwrap()].states
    );
    let mut partial = data();
    partial["input"]["employees"][0]["activeFrom"] = json!("2026-11-04");
    partial["input"]["employees"][0]["history"] = json!([]);
    partial["input"]["assignments"]
        .as_array_mut()
        .unwrap()
        .drain(..2);
    partial["input"]["_initialAssignments"]
        .as_array_mut()
        .unwrap()
        .drain(..2);
    let p = constructed(&partial);
    let e = &p.employees[0];
    let states = e.catalog[e.pattern.unwrap()].states;
    assert_eq!(&states[..2], &[INACTIVE, INACTIVE]);
    assert_eq!(&states[2..7], &[3, OFF, 3, 3, OFF]);
    assert_eq!(&evaluate(&p)[13..15], &[1, 2]);
}
#[test]
fn test_v2_balanced_seed_preserves_saturday_absence_and_holiday() {
    for kind in ["ABSENCE", "HOLIDAY"] {
        let mut v = data();
        v["input"]["restRulesVersion"] = json!(2);
        v["input"]["assignments"] = json!([{"employeeId":"p0","date":"2026-11-07","kind":kind}]);
        v["input"]
            .as_object_mut()
            .unwrap()
            .remove("_initialAssignments");
        let before = v.clone();
        let p = constructed(&v);
        let e = &p.employees[0];
        assert_eq!(
            e.catalog[e.pattern.unwrap()].states[5],
            if kind == "ABSENCE" { ABS } else { HOL }
        );
        assert_eq!(v, before);
    }
}
#[test]
fn test_existing_holiday_is_hintable_without_calendar_reclassification() {
    let mut v = data();
    v["input"]["generationMode"] = json!("HOURS_ONLY");
    v["input"]["assignments"][2] = json!({"employeeId":"p0","date":"2026-11-04","kind":"HOLIDAY"});
    v["input"]["_initialAssignments"] = v["input"]["assignments"].clone();
    let before = v.clone();
    let p = constructed(&v);
    assert_saved(&v, &p);
    assert_eq!(v, before);
    assert_eq!(
        p.employees[0].catalog[p.employees[0].pattern.unwrap()].states[2],
        HOL
    );
}
#[test]
fn bounded_hint_admission_keeps_expiry_and_synthetic_validation_distinct() {
    let v = data();
    let cal = Calendar::service("2026-11-02", "2026-11-08", None, 1).unwrap();
    let ids = BTreeMap::from([("day".to_string(), 3)]);
    assert_eq!(
        initial_hint::read(&v["input"], &cal, &ids, true, Instant::now()).err(),
        Some("MAPPING_TIMEOUT")
    );
    let mut v = v;
    let duplicate = v["input"]["assignments"][0].clone();
    v["input"]["_initialAssignments"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert_eq!(
        initial_hint::read(
            &v["input"],
            &cal,
            &ids,
            false,
            Instant::now() + Duration::from_secs(1)
        )
        .err(),
        Some("DUPLICATE_HINT")
    );
}

#[test]
fn identical_unsampled_hints_reuse_one_catalogue_without_sharing_personal_ties() {
    let mut v = data();
    v["input"]
        .as_object_mut()
        .unwrap()
        .remove("_initialAssignments");
    v["input"]["assignments"] = json!([]);
    v["input"]["employees"][0]["history"] = json!([]);
    v["input"]["endDate"] = json!("2026-12-13");
    let mut twin = v["input"]["shifts"][0].clone();
    twin["id"] = json!("same-hours");
    v["input"]["shifts"].as_array_mut().unwrap().push(twin);
    v["input"]["employees"][0]["shiftIds"] = json!(["day", "same-hours"]);
    let seed = parse(&v).unwrap();
    let e = &seed.employees[0];
    let mut states = e.catalog[0].states;
    let work_days: Vec<_> = (0..42).filter(|&d| work(states[d])).collect();
    let known: BTreeSet<_> = e.catalog.iter().map(|p| p.states).collect();
    let mut missing = false;
    for counter in 0..=e.catalog.len() {
        for (bit, &d) in work_days.iter().enumerate() {
            states[d] = if counter & (1usize << bit) != 0 { 4 } else { 3 };
        }
        if !known.contains(&states) {
            missing = true;
            break;
        }
    }
    assert!(missing);
    let template = v["input"]["employees"][0].clone();
    v["input"]["employees"] = json!(
        (0..4)
            .map(|i| {
                let mut p = template.clone();
                p["id"] = json!(format!("p{i}"));
                p
            })
            .collect::<Vec<_>>()
    );
    let before = parse(&v).unwrap();
    assert!(
        before
            .employees
            .iter()
            .all(|p| Arc::ptr_eq(&before.employees[0].catalog, &p.catalog))
    );
    let mut hints = Vec::new();
    for i in 0..4 {
        for (d, &state) in states.iter().enumerate().take(42) {
            let mut row = json!({"employeeId":format!("p{i}"),"date":e.facts.dates[d],"kind":if state==OFF{"OFF"}else{"WORK"}});
            if state != OFF {
                row["shiftId"] = json!(if state == 3 { "day" } else { "same-hours" });
            }
            hints.push(row);
        }
    }
    v["input"]["_initialAssignments"] = json!(hints);
    let after = parse(&v).unwrap();
    assert_eq!(evaluate(&after)[0], 0);
    let unique: BTreeSet<_> = after
        .employees
        .iter()
        .map(|p| Arc::as_ptr(&p.catalog) as usize)
        .collect();
    assert_eq!(
        unique.len(),
        1,
        "equal legal hints must not clone the same bounded catalogue per person"
    );
    for p in &after.employees {
        assert_eq!(p.catalog[p.pattern.unwrap()].states, states);
        assert!(!p.pinned);
        let expected: u16 = states
            .iter()
            .enumerate()
            .take(42)
            .filter(|(_, s)| **s == OFF)
            .map(|(d, _)| tie_rank::rank(&p.name_id, &p.facts.dates[d]) as u16)
            .sum();
        assert_eq!(p.tie_costs[p.pattern.unwrap()], expected);
    }
    // A different suggestion must not inherit the first family's choice.
    let changed = work_days[0];
    let other = if states[changed] == 3 { 4 } else { 3 };
    for i in 2..4 {
        v["input"]["_initialAssignments"][i * 42 + changed]["shiftId"] =
            json!(if other == 3 { "day" } else { "same-hours" });
    }
    let mixed = parse(&v).unwrap();
    let people = &mixed.employees;
    assert!(Arc::ptr_eq(&people[0].catalog, &people[1].catalog));
    assert!(Arc::ptr_eq(&people[2].catalog, &people[3].catalog));
    assert!(!Arc::ptr_eq(&people[0].catalog, &people[2].catalog));
    assert_eq!(
        people[0].catalog[people[0].pattern.unwrap()].states[changed],
        states[changed]
    );
    assert_eq!(
        people[2].catalog[people[2].pattern.unwrap()].states[changed],
        other
    );
    assert_eq!(evaluate(&mixed)[0], 0);
}
