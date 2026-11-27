//! Restored historical rules evaluated by the real native mapper and calendar.
use super::*;
fn input() -> V {
    serde_json::from_str(include_str!("legacy-service-fixture.json")).unwrap()
}
fn parsed(v: &V) -> Result<TemporalPlan> {
    read_admitted(v, Instant::now() + Duration::from_secs(5), false, true)
}
fn conflict(v: &mut V) {
    v["input"]["employees"][0]["history"][20] =
        json!({"employeeId":"p0","date":"2026-11-01","kind":"WORK","shiftId":"day"});
    v["input"]["assignments"] = json!([{"employeeId":"p0","date":"2026-11-08","kind":"WORK","shiftId":"day","locked":true}]);
}
#[test]
fn test_women_and_unreviewed_rules_cannot_work_two_consecutive_sundays() {
    for rule in [json!("CLT_386"), json!("UNREVIEWED"), V::Null] {
        let mut v = input();
        v["input"]["employees"][0]["sundayRestRule"] = rule;
        conflict(&mut v);
        let before = v.clone();
        assert!(matches!(parsed(&v), Err("INFEASIBLE_PERSONAL_DOMAIN")));
        assert_eq!(v, before);
    }
    let mut v = input();
    conflict(&mut v);
    let mut plan = parsed(&v).unwrap();
    seed::construct(&mut plan, Instant::now() + Duration::from_secs(1));
    assert_eq!(evaluate(&plan)[0], 0);
    assert!(work(
        plan.employees[0].catalog[plan.employees[0].pattern.unwrap()].states[6]
    ));
}
#[test]
fn test_commerce_can_keep_stricter_quinzenal_rotation() {
    let mut v = input();
    conflict(&mut v);
    assert!(parsed(&v).is_ok());
    v["input"]["employees"][0]["maxConsecutiveSundays"] = json!(1);
    assert!(matches!(parsed(&v), Err("INFEASIBLE_PERSONAL_DOMAIN")));
}
#[test]
fn missing_and_null_protective_rules_are_identical_and_malformed_values_stay_rejected() {
    let mut missing = input();
    missing["input"]["employees"][0]
        .as_object_mut()
        .unwrap()
        .remove("sundayRestRule");
    let a = parsed(&missing).unwrap();
    let mut null = missing.clone();
    null["input"]["employees"][0]["sundayRestRule"] = V::Null;
    let b = parsed(&null).unwrap();
    assert_eq!(*a.employees[0].catalog, *b.employees[0].catalog);
    for bad in [
        json!(false),
        json!(0),
        json!([]),
        json!({}),
        json!("UNKNOWN"),
        json!(""),
    ] {
        let mut v = missing.clone();
        v["input"]["employees"][0]["sundayRestRule"] = bad;
        assert!(parsed(&v).is_err());
    }
}
#[test]
fn test_weekly_ceiling_changes_on_exact_effective_dates() {
    for (d, expected) in [
        ("2026-12-15", 44),
        ("2026-12-16", 42),
        ("2027-12-15", 42),
        ("2027-12-16", 40),
    ] {
        assert_eq!(calendar::weekly_ceiling(d), expected);
    }
    for d in ["2026-12-13", "2026-12-20", "2027-12-19"] {
        assert_eq!(40.min(calendar::weekly_ceiling(d)), 40);
    }
}
#[test]
fn test_daily_limits_are_applied_to_each_date() {
    for (paid, day, expected) in [
        (528, "2026-12-15", true),
        (528, "2026-12-16", false),
        (504, "2027-12-15", true),
        (504, "2027-12-16", false),
        (480, "2027-12-16", true),
    ] {
        let row = json!({"id":"day","segments":[{"start":480,"end":720,"kind":"WORK"},{"start":720,"end":780,"kind":"BREAK"},{"start":780,"end":780+paid-240,"kind":"WORK"}]});
        let (clock, admission) = service_clocks::read(&row).unwrap();
        let policy = service_clocks::Policy {
            closing: 2880,
            daily: 600.min(calendar::daily_ceiling(day)),
            meal: 60,
            max_meal: 120,
            simulation: false,
            compensation: true,
            short_pause: false,
            limit_blocks: false,
        };
        assert_eq!(
            admission.allowed(&clock, policy, false),
            expected,
            "{paid} {day}"
        );
    }
}
