//! Restored historical contracts: exercise actual native mapping, scoring and guards.
//! Unit attendance fixtures intentionally isolate coverage algebra, as the original
//! CP coverage-only models did; full-service legality is tested separately.
use super::*;
fn legacy() -> V {
    serde_json::from_str(include_str!("legacy-service-fixture.json")).unwrap()
}
fn parse(v: &V) -> Result<TemporalPlan> {
    read_admitted(v, Instant::now() + Duration::from_secs(5), false, true)
}
fn closed_reference(closing_cap: i32) -> V {
    let mut v = legacy();
    let input = &mut v["input"];
    input["storeClosingMinutes"] = json!(1080);
    for key in ["closedDates", "holidayDates", "paidHolidayDates"] {
        input["policy"][key] = json!(["2026-11-02"]);
    }
    input["demands"] = json!([{"date":"2026-11-02","sector":"Reposição","start":1020,"end":1080,"minimum":1,"estimated":true}]);
    input["_coverageComparison"] = json!({"sectors":[{"sector":"Reposição","horizon":60,"month":60,"sundays":0,"monthSundays":0,"closing":closing_cap,"peak":1}],
        "bands":[{"sector":"Reposição","role":null,"scope":"HORIZON","start":1020,"end":1080,"maximum":1,"peak":1},
                 {"sector":"Reposição","role":null,"scope":"MONTH","start":1020,"end":1080,"maximum":1,"peak":1}]});
    v
}
#[test]
fn closed_estimates_remain_in_private_comparison_totals() {
    let v = closed_reference(0);
    let original = v.clone();
    assert_eq!(parse(&v).err(), Some("INFEASIBLE_COMPARISON_BOUND"));
    assert_eq!(v, original);
    let mut plan =
        parse(&closed_reference(60)).expect("explicit allowance includes the real closed deficit");
    seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
    let cost = evaluate(&plan);
    assert_eq!(cost[0], 0);
    assert_eq!(cost[1], 60);
    assert_eq!(cost[5], 60);
    let mut unguarded = v;
    unguarded["input"]
        .as_object_mut()
        .unwrap()
        .remove("_coverageComparison");
    let mut plan = parse(&unguarded).unwrap();
    seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
    assert_eq!(
        evaluate(&plan)[1],
        0,
        "unprotected paid-holiday estimates retain their original exclusion"
    );
}
#[test]
fn empty_demand_role_is_general_not_a_new_unstaffable_function() {
    let mut v = legacy();
    v["input"]["demands"] = json!([{"date":"2026-11-04","sector":"Reposição","role":"","start":480,"end":540,"minimum":1}]);
    let mut plan = parse(&v).expect("historical empty role is a general reference");
    seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
    assert_eq!(evaluate(&plan)[0], 0);
    assert!(
        plan.employees[0]
            .facts
            .bands
            .iter()
            .all(|b| b.roles.is_empty())
    );
}

// Build native facts through the real decoder, then isolate attendance as the
// original coverage-only CP models did. This is not a whole-roster witness.
fn reference(minimum: i32, start: i32, end: i32, role: Option<&str>, estimated: bool) -> V {
    let mut row = json!({"date":"2026-11-02","sector":"Reposição","start":start,"end":end,"minimum":minimum,"estimated":estimated});
    if let Some(role) = role {
        row["role"] = json!(role);
    }
    row
}
fn request(demands: Vec<V>) -> V {
    let mut v = legacy();
    let t = v["input"]["employees"][0].clone();
    v["input"]["employees"] = json!(
        ["Caixa", "Caixa", "Caixa", "Fiscal"]
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let mut p = t.clone();
                p["id"] = json!(format!("p{i}"));
                p["role"] = json!(r);
                p["history"] = json!([]);
                p
            })
            .collect::<Vec<_>>()
    );
    v["input"]["demands"] = json!(demands);
    v
}
fn members(plan: &TemporalPlan) -> Vec<Member> {
    plan.employees
        .iter()
        .map(|e| {
            let mut m = e.member();
            let mut p = e.catalog[0];
            p.states = [OFF; MAX_DAYS];
            p.personal = [0; 17];
            p.rates = [None; 2];
            p.rest = [0; 5];
            p.civil_work = 0;
            p.sunday_opportunities = 0;
            m.pattern = Some(p);
            m
        })
        .collect()
}
fn select(rows: &mut [Member], person: usize, day: usize, state: u8) {
    let p = rows[person].pattern.as_mut().unwrap();
    p.states[day] = state;
    if work(state) {
        p.civil_work |= 1u64 << day;
    } else {
        p.civil_work &= !(1u64 << day);
    }
}
fn numeric(demands: Vec<V>, staff: &[usize]) -> (Cost, Vec<Band>) {
    let plan = parse(&request(demands)).unwrap();
    let mut rows = members(&plan);
    // Match the original coverage-only closing window without claiming these
    // partial attendance bits form a legal full weekly roster.
    let mut facts = (*rows[0].facts).clone();
    facts.closing = 540;
    let facts = Arc::new(facts);
    for row in &mut rows {
        row.facts = Arc::clone(&facts);
    }
    for &id in staff {
        select(&mut rows, id, 0, 3);
    }
    (
        sector_cost(rows.iter()),
        plan.employees[0].facts.bands.clone(),
    )
}
#[test]
fn test_duplicate_one_hour_estimate_penalizes_one_hour() {
    let row = reference(1, 480, 540, None, true);
    let old = row.clone();
    let (cost, bands) = numeric(vec![row.clone(), row.clone()], &[]);
    assert_eq!(cost[1], 60);
    assert_eq!(cost[5], 60);
    assert_eq!(bands.len(), 1);
    assert_eq!(bands[0].day, 0);
    assert_eq!(
        bands[0].general * i64::from(bands[0].end - bands[0].start),
        60
    );
    assert_eq!(row, old);
    // Closing arithmetic is independently exercised over the original window.
    assert_eq!(
        bands
            .iter()
            .map(|b| b.general * i64::from((b.end.min(540) - b.start.max(480)).max(0)))
            .sum::<i64>(),
        60
    );
}
#[test]
fn test_partial_overlaps_use_highest_floor_only_in_overlap() {
    let (cost, b) = numeric(
        vec![
            reference(2, 480, 540, None, true),
            reference(3, 510, 570, None, true),
        ],
        &[],
    );
    assert_eq!(cost[1], 240);
    assert_eq!(cost[5], 150);
    assert_eq!(
        b.iter()
            .map(|x| (x.start, x.end, x.general))
            .collect::<Vec<_>>(),
        vec![(480, 510, 2), (510, 540, 3), (540, 570, 3)]
    );
    assert_eq!(
        b.iter()
            .map(|b| b.general * i64::from((b.end.min(540) - b.start.max(480)).max(0)))
            .sum::<i64>(),
        150
    );
}
#[test]
fn test_role_maxima_sum_without_adding_general_reference_again() {
    let d = vec![
        reference(2, 480, 540, Some("Caixa"), true),
        reference(1, 480, 540, Some("Caixa"), true),
        reference(1, 480, 540, Some("Fiscal"), true),
        reference(3, 480, 540, None, true),
    ];
    for (staff, expected) in [
        (vec![], 180),
        (vec![0, 3], 60),
        (vec![0, 1], 60),
        (vec![0, 1, 3], 0),
    ] {
        assert_eq!(numeric(d.clone(), &staff).0[1], expected);
    }
}
#[test]
fn test_total_surplus_does_not_cancel_missing_distinct_function() {
    let d = vec![
        reference(1, 480, 540, Some("Caixa"), true),
        reference(1, 480, 540, Some("Fiscal"), true),
        reference(2, 480, 540, None, true),
    ];
    assert_eq!(numeric(d, &[0, 1, 2]).0[1], 60);
}
#[test]
fn test_confirmed_and_estimated_targets_stay_separate_and_immutable() {
    let d = vec![
        reference(1, 480, 540, None, false),
        reference(3, 480, 540, Some("Caixa"), false),
        reference(2, 480, 540, Some("Caixa"), false),
        reference(1, 480, 540, Some("Fiscal"), false),
        reference(8, 480, 540, Some("Caixa"), true),
    ];
    let v = request(d);
    let before = v.clone();
    let plan = parse(&v).unwrap();
    assert_eq!(v, before);
    let bands = &plan.employees[0].facts.bands;
    let hard = bands.iter().find(|b| !b.estimated).unwrap();
    let soft = bands.iter().find(|b| b.estimated).unwrap();
    assert_eq!(hard.general, 4);
    assert_eq!(hard.roles, vec![(0, 3), (1, 1)]);
    assert_eq!(soft.general, 8);
    assert_eq!(soft.roles, vec![(0, 8)]);
}
#[test]
fn test_hard_role_floor_remains_a_constraint_even_with_general_surplus() {
    let mut v = request(vec![reference(1, 480, 540, Some("Fiscal"), false); 2]);
    for p in v["input"]["employees"].as_array_mut().unwrap() {
        p["role"] = json!("Caixa");
    }
    assert_eq!(parse(&v).err(), Some("INFEASIBLE_COVERAGE_BOUND"));
}
#[test]
fn test_same_total_does_not_authorize_moving_deficit_to_a_previously_staffed_day() {
    let first = reference(1, 480, 540, None, true);
    let mut next = first.clone();
    next["date"] = json!("2026-11-03");
    let plan = parse(&request(vec![first, next])).unwrap();
    let mut before = members(&plan);
    select(&mut before, 0, 0, 3);
    let guard = service_guard::Snapshot::capture_members(before.iter());
    let mut after = before.clone();
    select(&mut after, 0, 0, OFF);
    select(&mut after, 0, 1, 3);
    assert_eq!(sector_cost(before.iter())[1], 60);
    assert_eq!(sector_cost(after.iter())[1], 60);
    assert!(!guard.preserves_members(after.iter()));
    assert!(guard.preserves_members(before.iter()));
}
#[test]
fn test_daily_guards_allow_a_real_improvement_without_a_sacrificed_day() {
    let first = reference(1, 480, 540, None, true);
    let mut next = first.clone();
    next["date"] = json!("2026-11-03");
    let plan = parse(&request(vec![first, next])).unwrap();
    let mut before = members(&plan);
    select(&mut before, 0, 0, 3);
    let guard = service_guard::Snapshot::capture_members(before.iter());
    let mut after = before.clone();
    select(&mut after, 0, 1, 3);
    assert_eq!(sector_cost(before.iter())[1], 60);
    assert_eq!(sector_cost(after.iter())[1], 0);
    assert!(guard.preserves_members(after.iter()));
}
#[test]
fn distinct_dates_keep_their_exact_deficit_minutes_without_mutating_facts() {
    let a = reference(2, 480, 540, None, true);
    let mut b = reference(2, 480, 600, None, true);
    b["date"] = json!("2026-11-03");
    let plan = parse(&request(vec![a, b])).unwrap();
    let rows = members(&plan);
    let facts = &plan.employees[0].facts;
    let before = facts.bands.clone();
    assert_eq!(sector_cost(rows.iter())[1], 360);
    assert_eq!(
        facts
            .bands
            .iter()
            .map(|b| b.general * i64::from(b.end - b.start))
            .collect::<Vec<_>>(),
        vec![120, 240]
    );
    assert_eq!(facts.bands, before);
}
#[test]
fn test_weekday_timed_staff_cannot_all_take_off_even_with_duty_present() {
    let plan = parse(&request(vec![])).unwrap();
    let mut before = members(&plan);
    select(&mut before, 0, 2, 3);
    select(&mut before, 2, 2, DUTY);
    select(&mut before, 3, 2, DUTY);
    let guard = service_guard::Snapshot::capture_members(before.iter());
    let mut after = before.clone();
    select(&mut after, 0, 2, OFF);
    assert!(!guard.preserves_members(after.iter()));
    assert!(guard.preserves_members(before.iter()));
}
#[test]
fn test_duty_only_incumbent_does_not_invent_timed_presence() {
    let plan = parse(&request(vec![])).unwrap();
    let mut before = members(&plan);
    select(&mut before, 2, 2, DUTY);
    select(&mut before, 3, 2, DUTY);
    let guard = service_guard::Snapshot::capture_members(before.iter());
    let after = members(&plan);
    assert!(guard.preserves_members(after.iter()));
}
#[test]
fn test_zero_target_cannot_erase_existing_timed_presence() {
    let plan = parse(&request(vec![reference(0, 480, 540, None, true)])).unwrap();
    let mut before = members(&plan);
    select(&mut before, 0, 0, 3);
    assert!(plan.employees[0].facts.bands.is_empty());
    let guard = service_guard::Snapshot::capture_members(before.iter());
    assert!(!guard.preserves_members(members(&plan).iter()));
}
#[test]
fn test_same_valid_seed_witnesses_feasibility_with_absence_and_locked_rest() {
    let mut v = request(vec![]);
    v["input"]["assignments"] = json!([{"employeeId":"p0","date":"2026-11-04","kind":"ABSENCE","locked":true},{"employeeId":"p1","date":"2026-11-05","kind":"OFF","locked":true}]);
    let before = v.clone();
    let mut plan = parse(&v).unwrap();
    seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
    assert_eq!(evaluate(&plan)[0], 0);
    let guard = service_guard::Snapshot::capture(&plan);
    assert!(guard.preserves(&plan));
    assert_eq!(
        plan.employees[0].catalog[plan.employees[0].pattern.unwrap()].states[2],
        ABS
    );
    assert_eq!(
        plan.employees[1].catalog[plan.employees[1].pattern.unwrap()].states[3],
        OFF
    );
    assert_eq!(before, v);
}

fn sector_cap(minutes: i64, peak: i64) -> V {
    json!({"sector":"Reposição","horizon":minutes,"month":minutes,"sundays":minutes,"monthSundays":minutes,"closing":0,"peak":peak})
}
fn band_cap(scope: &str, role: Option<&str>, maximum: i64, peak: i64, start: i32, end: i32) -> V {
    json!({"scope":scope,"sector":"Reposição","role":role,"start":start,"end":end,"maximum":maximum,"peak":peak})
}
fn comparison_input() -> V {
    let mut v = legacy();
    v["input"]["endDate"] = json!("2026-11-15");
    let t = v["input"]["employees"][0].clone();
    v["input"]["employees"] = json!(
        (0..2)
            .map(|i| {
                let mut p = t.clone();
                p["id"] = json!(format!("p{i}"));
                p["history"] = json!([]);
                p
            })
            .collect::<Vec<_>>()
    );
    v["input"]["demands"]=json!(["2026-11-08","2026-11-15"].map(|day|json!({"date":day,"sector":"Reposição","role":"Repositor","start":480,"end":540,"minimum":2,"estimated":true})));
    let bands: Vec<_> = ["HORIZON", "MONTH", "SUNDAYS", "MONTH_SUNDAYS"]
        .into_iter()
        .flat_map(|scope| {
            [None, Some("Repositor")].map(|role| band_cap(scope, role, 3, 2, 480, 540))
        })
        .collect();
    v["input"]["_coverageComparison"] = json!({"sectors":[sector_cap(180,2)],"bands":bands});
    v
}
fn compared(v: &V, selected: &[(usize, usize, u8)]) -> Cost {
    let plan = parse(v).unwrap();
    let mut rows = members(&plan);
    for &(person, day, state) in selected {
        select(&mut rows, person, day, state);
    }
    sector_cost(rows.iter())
}
#[test]
fn test_equal_sunday_deficit_can_move_between_dates() {
    let v = comparison_input();
    for day in [6, 13] {
        let c = compared(&v, &[(0, day, 3)]);
        assert_eq!(c[0], 0);
        assert_eq!(c[1], 180);
    }
}
#[test]
fn test_sunday_scope_and_sector_volume_do_not_increase() {
    let mut v = comparison_input();
    assert!(compared(&v, &[])[0] > 0);
    for component in ["horizon", "sundays"] {
        v["input"]["_coverageComparison"]["sectors"][0] = sector_cap(180, 2);
        v["input"]["_coverageComparison"]["sectors"][0][component] = json!(179);
        assert!(compared(&v, &[(0, 6, 3)])[0] > 0);
    }
}
#[test]
fn test_same_total_cannot_worsen_simultaneous_peak() {
    let mut v = comparison_input();
    v["input"]["_coverageComparison"]["sectors"] = json!([sector_cap(120, 2)]);
    for cap in v["input"]["_coverageComparison"]["bands"]
        .as_array_mut()
        .unwrap()
    {
        cap["maximum"] = json!(2);
        cap["peak"] = json!(1);
    }
    let a = compared(&v, &[(0, 6, 3), (1, 13, 3)]);
    let b = compared(&v, &[(0, 6, 3), (1, 6, 3)]);
    assert_eq!(a[1], 120);
    assert_eq!(b[1], 120);
    assert_eq!(a[0], 0);
    assert!(b[0] > 0);
}
#[test]
fn test_frozen_bands_split_at_candidate_clock_cuts_and_missing_role_caps_are_zero() {
    let mut v = comparison_input();
    for (id, a, b) in [("early", 480, 510), ("late", 510, 540)] {
        v["input"]["shifts"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":id,"segments":[{"kind":"WORK","start":a,"end":b}]}));
    }
    v["input"]["demands"] = json!([{"date":"2026-11-08","sector":"Reposição","role":"Repositor","start":480,"end":540,"minimum":1,"estimated":true}]);
    v["input"]["_coverageComparison"]["sectors"] = json!([sector_cap(30, 2)]);
    for cap in v["input"]["_coverageComparison"]["bands"]
        .as_array_mut()
        .unwrap()
    {
        cap["maximum"] = json!(1);
        cap["peak"] = json!(1);
        cap["end"] = json!(510);
    }
    assert_eq!(compared(&v, &[(0, 6, 5)])[0], 0);
    assert!(compared(&v, &[(0, 6, 4)])[0] > 0);
    v["input"]["_coverageComparison"]["bands"]
        .as_array_mut()
        .unwrap()
        .retain(|cap| cap["role"].is_null());
    assert!(compared(&v, &[(0, 6, 5)])[0] > 0);
}
#[test]
fn test_comparison_is_enforced_in_first_feasibility_call_that_returns_a_roster() {
    let mut v = legacy();
    v["input"]["demands"] = json!([{"date":"2026-11-08","sector":"Reposição","role":"Repositor","start":480,"end":720,"minimum":1,"estimated":true}]);
    v["input"]["_coverageComparison"] = json!({"sectors":[],"bands":[]});
    let before = v.clone();
    let mut plan = parse(&v).unwrap();
    seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
    assert_eq!(evaluate(&plan)[0], 0);
    assert_eq!(evaluate(&plan)[1], 0);
    assert!(work(
        plan.employees[0].catalog[plan.employees[0].pattern.unwrap()].states[6]
    ));
    assert_eq!(v, before);
}
#[test]
fn test_first_feasible_model_preserves_donor_and_can_staff_sunday() {
    let mut v = comparison_input();
    v["input"]["endDate"] = json!("2026-11-08");
    v["input"]["demands"] = json!([]);
    v["input"]
        .as_object_mut()
        .unwrap()
        .remove("_coverageComparison");
    v["input"]["_coverageProtection"]=json!(["2026-11-04","2026-11-08"].map(|date|json!({"date":date,"sector":"Reposição","role":"Repositor","start":480,"end":720,"minimum":1})));
    v["input"]["defaultWeeklyHours"] = json!(42);
    v["input"]["shifts"][0]["segments"][2]["end"] = json!(1044);
    for p in v["input"]["employees"].as_array_mut().unwrap() {
        p["weeklyHours"] = json!(42);
    }
    let before = v.clone();
    let mut plan = parse(&v).unwrap();
    seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
    assert_eq!(evaluate(&plan)[0], 0);
    for day in [2, 6] {
        assert!(
            plan.employees
                .iter()
                .any(|p| work(p.catalog[p.pattern.unwrap()].states[day]))
        );
    }
    assert_eq!(v, before);
}
#[test]
fn test_closing_uses_entire_horizon_and_closed_estimated_deficit_stays_in_totals() {
    for (cap, accepted) in [(0, false), (60, true)] {
        let mut v = closed_reference(cap);
        let input = &mut v["input"];
        input["startDate"] = json!("2026-11-30");
        input["endDate"] = json!("2027-01-03");
        input["visibleMonth"] = json!("2026-12");
        input["employees"][0]["history"] = json!([]);
        for key in ["closedDates", "holidayDates", "paidHolidayDates"] {
            input["policy"][key] = json!(["2026-11-30"]);
        }
        input["demands"][0]["date"] = json!("2026-11-30");
        input["_coverageComparison"]["sectors"][0]["month"] = json!(0);
        if accepted {
            let mut plan = parse(&v).unwrap();
            seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
            let c = evaluate(&plan);
            assert_eq!(c[0], 0);
            assert_eq!(c[1], 60);
            assert_eq!(c[5], 60);
        } else {
            assert_eq!(parse(&v).err(), Some("INFEASIBLE_COMPARISON_BOUND"));
        }
    }
}
#[test]
fn test_monthly_sunday_counts_exclude_the_outer_sunday() {
    for (scope, missing) in [("SUNDAYS", 0), ("MONTH_SUNDAYS", 240)] {
        let mut v = legacy();
        v["input"]["startDate"] = json!("2026-11-30");
        v["input"]["endDate"] = json!("2027-01-03");
        v["input"]["visibleMonth"] = json!("2026-12");
        v["input"]["employees"][0]["history"] = json!([]);
        v["input"]["_coverageServiceProtection"] = json!({"days":[],"bands":[{"sector":"Reposição","role":"Repositor","start":480,"end":720,"scope":scope,"minimum":2}]});
        let plan = parse(&v).unwrap();
        let mut rows = members(&plan);
        select(&mut rows, 0, 6, 3);
        select(&mut rows, 0, 34, 3);
        assert_eq!(sector_cost(rows.iter())[0], missing);
    }
}
#[test]
fn test_spill_and_same_day_work_count_as_one_civil_person_day() {
    let mut v = comparison_input();
    v["input"]["demands"] = json!([]);
    v["input"]
        .as_object_mut()
        .unwrap()
        .remove("_coverageComparison");
    for (id, a, b) in [("overnight", 1320, 1510), ("opening", 30, 90)] {
        v["input"]["shifts"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":id,"segments":[{"kind":"WORK","start":a,"end":b}]}));
    }
    v["input"]["_coverageServiceProtection"] = json!({"days":[],"bands":[{"sector":"Reposição","role":"Repositor","start":50,"end":70,"scope":"SUNDAYS","minimum":2}]});
    // Map facts without an optimistic service proof over unselectable unit clocks.
    let protection = v["input"]
        .as_object_mut()
        .unwrap()
        .remove("_coverageServiceProtection")
        .unwrap();
    let plan = parse(&v).unwrap();
    let mut facts = (*plan.employees[0].facts).clone();
    let calendar = Calendar::aligned("2026-11-02", "2026-11-15", None, 1).unwrap();
    let sectors = BTreeMap::from([("Reposição".to_string(), 0)]);
    let roles = BTreeMap::from([("Repositor".to_string(), 0)]);
    v["input"]["_coverageServiceProtection"] = protection;
    service_bounds::read(
        &v["input"],
        &calendar,
        &sectors,
        &roles,
        std::slice::from_mut(&mut facts),
    )
    .unwrap();
    let mut rows = members(&plan);
    let facts = Arc::new(facts);
    for row in &mut rows {
        row.facts = Arc::clone(&facts);
    }
    select(&mut rows, 0, 5, 4);
    select(&mut rows, 0, 6, 5);
    assert_eq!(sector_cost(rows.iter())[0], 20);
    select(&mut rows, 1, 6, 5);
    assert_eq!(sector_cost(rows.iter())[0], 0);
}
#[test]
fn actual_role_specific_blank_service_key_is_not_general_demand() {
    let mut v = legacy();
    v["input"]["employees"][0]["role"] = json!("");
    v["input"]["_coverageServiceProtection"] = json!({"days":[],"bands":[{"sector":"Reposição","role":"","start":480,"end":540,"scope":"HORIZON","minimum":1}]});
    let mut plan = parse(&v).unwrap();
    seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
    assert_eq!(evaluate(&plan)[0], 0);
}

#[test]
fn overlapping_role_arithmetic_agrees_with_an_independent_minute_oracle() {
    let roles = ["Caixa", "Caixa", "Caixa", "Fiscal"];
    for scenario in 0..32u32 {
        let mut demands = vec![
            reference((scenario % 4) as i32, 480, 540, None, true),
            reference(((scenario / 2) % 4) as i32, 510, 570, Some("Caixa"), true),
            reference(((scenario / 4) % 3) as i32, 495, 555, Some("Fiscal"), true),
        ];
        if scenario & 1 != 0 {
            demands.push(demands[1].clone());
        }
        if scenario & 2 != 0 {
            demands.reverse();
        }
        for mask in [0u8, 1, 3, 7, 8, 9, 11, 15] {
            let staff: Vec<_> = (0..4).filter(|i| mask & (1 << i) != 0).collect();
            let (native, _) = numeric(demands.clone(), &staff);
            let (mut total, mut closing) = (0, 0);
            for minute in 480..600 {
                let mut general = 0i64;
                let mut floors = BTreeMap::<&str, i64>::new();
                for d in &demands {
                    if d["start"].as_i64().unwrap() > minute || d["end"].as_i64().unwrap() <= minute
                    {
                        continue;
                    }
                    let floor = d["minimum"].as_i64().unwrap();
                    if let Some(role) = d.get("role").and_then(V::as_str) {
                        let n = floors.entry(role).or_default();
                        *n = (*n).max(floor);
                    } else {
                        general = general.max(floor);
                    }
                }
                let role_gap: i64 = floors
                    .iter()
                    .map(|(role, n)| {
                        (*n - staff.iter().filter(|&&id| roles[id] == *role).count() as i64).max(0)
                    })
                    .sum();
                let gap = (general.max(floors.values().sum()) - staff.len() as i64)
                    .max(0)
                    .max(role_gap);
                total += gap;
                if minute < 540 {
                    closing += gap;
                }
            }
            assert_eq!(
                (native[1], native[5]),
                (total, closing),
                "scenario {scenario}, staff {mask}"
            );
        }
    }
}
