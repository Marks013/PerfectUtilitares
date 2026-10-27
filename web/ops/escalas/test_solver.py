import copy
import json
import unittest
from unittest.mock import patch
from datetime import date, timedelta

from solver import admissible, certificate_authorizes, effective_weekly_hours, legal_weekly_hours, shift_metrics, solve, sunday_limit


def fixture(hours=42, people=1, weeks=1, start_date="2026-11-02", shift_hours=None):
    start = date.fromisoformat(start_date)
    minutes = (shift_hours if shift_hours is not None else hours) * 12
    data = {
        "schemaVersion": 1, "branchCode": "01", "branchName": "Filial de teste",
        "startDate": start.isoformat(), "endDate": (start + timedelta(days=weeks * 7 - 1)).isoformat(),
        "defaultWeeklyHours": hours, "timeZone": "America/Sao_Paulo",
        "policy": {"source": "Norma de teste", "validFrom": "2026-01-01", "validUntil": "2026-12-31",
                   "reviewed": True, "reviewedBy": "Teste", "weeklyLimit": 44,
                   "dailyLimitMinutes": 600, "compensationAuthorized": True,
                   "minInterShiftMinutes": 660, "minWeeklyRestMinutes": 2100, "minMealMinutes": 60,
                   "maxConsecutiveWorkDays": 6, "closedDates": [], "holidayDates": [],
                   "authorizedHolidayDates": [], "holidayRestAllowed": False, "nightWorkReviewed": False},
        "shifts": [{"id": "day", "name": "Diurno", "segments": [
            {"start": 480, "end": 720, "kind": "WORK"},
            {"start": 720, "end": 780, "kind": "BREAK"},
            {"start": 780, "end": 780 + minutes - 240, "kind": "WORK"}]}],
        "employees": [], "demands": [], "assignments": [],
    }
    for index in range(people):
        pid = f"p{index}"
        person = {"id": pid, "registration": f"00{index}", "name": f"Colaborador {index}",
                  "sector": "Reposição", "role": "Repositor", "weeklyHours": hours,
                  "shiftIds": ["day"], "activeFrom": "2020-01-01", "offMode": "VARIABLE",
                  "fixedOffDays": [], "offPattern": "ANY", "maxConsecutiveSundays": 2, "sundayRestRule": "COMMERCE",
                  "preferredOffDays": [], "historyKnown": True, "history": []}
        for offset in range(-21, 0):
            current = start + timedelta(days=offset)
            item = {"employeeId": pid, "date": current.isoformat(),
                    "kind": "OFF" if current.weekday() in (5, 6) else "WORK"}
            if item["kind"] == "WORK":
                item["shiftId"] = "day"
            person["history"].append(item)
        data["employees"].append(person)
    return data


def authorize_transition(data, valid_from="2026-12-16", valid_until="2027-12-15"):
    data["policy"]["collectiveAgreement"] = {
        "source": "Acordo coletivo assinado no cenário de teste",
        "validFrom": valid_from, "validUntil": valid_until,
        "reviewedBy": "Responsável de teste", "reviewed": True,
    }


def weekly_totals(data, result):
    shifts = {shift["id"]: shift for shift in data["shifts"]}
    totals = {}
    for entry in result["assignments"]:
        day = date.fromisoformat(entry["date"])
        monday = (day - timedelta(days=day.weekday())).isoformat()
        totals.setdefault(monday, 0)
        if entry["kind"] == "WORK":
            totals[monday] += shift_metrics(shifts[entry["shiftId"]])[0]
    return totals


def make_untimed(person):
    person.update(scheduleMode="UNTIMED", shiftIds=[])
    for entry in person["history"]:
        if entry["kind"] == "WORK":
            entry["kind"] = "DUTY"
            entry.pop("shiftId", None)


class SolverTests(unittest.TestCase):
    def assert_feasible(self, result):
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"), result)

    def test_untimed_without_shifts_gets_five_duties_two_rests_zero_minutes(self):
        data = fixture()
        make_untimed(data["employees"][0])
        data["employees"][0]["weeklyHours"] = 0
        data["shifts"] = []
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(sum(a["kind"] == "DUTY" for a in result["assignments"]), 5)
        self.assertEqual(sum(a["kind"] == "OFF" for a in result["assignments"]), 2)
        self.assertTrue(all("shiftId" not in a for a in result["assignments"]))
        self.assertEqual(weekly_totals(data, result), {"2026-11-02": 0})

    def test_untimed_does_not_supply_timed_coverage(self):
        data = fixture(40, people=2)
        make_untimed(data["employees"][1])
        data["assignments"] = [{"employeeId": "p0", "date": "2026-11-02", "kind": "WORK", "shiftId": "day", "locked": True}]
        demand = {"sector": "Reposição", "date": "2026-11-02", "start": 480, "end": 600, "minimum": 1}
        data["demands"] = [demand]
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(sum(a["kind"] == "WORK" for a in result["assignments"]), 5)
        self.assertEqual(sum(a["kind"] == "DUTY" for a in result["assignments"]), 5)
        demand["minimum"] = 2
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_untimed_locked_duty_is_preserved(self):
        data = fixture()
        make_untimed(data["employees"][0])
        locked = {"employeeId": "p0", "date": "2026-11-02", "kind": "DUTY", "locked": True}
        data["assignments"] = [locked]
        result = solve(data)
        self.assert_feasible(result)
        self.assertIn(locked, result["assignments"])

    def test_untimed_history_duty_enforces_quinzenal_sunday_rest(self):
        data = fixture(weeks=2)
        person = data["employees"][0]
        make_untimed(person)
        person["sundayRestRule"] = "CLT_386"
        person["history"][-1]["kind"] = "DUTY"
        result = solve(data)
        self.assert_feasible(result)
        self.assertIn({"employeeId": "p0", "date": "2026-11-08", "kind": "OFF"}, result["assignments"])
        data["assignments"] = [{"employeeId": "p0", "date": "2026-11-08", "kind": "DUTY", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_untimed_six_prior_duties_require_boundary_rest(self):
        data = fixture()
        person = data["employees"][0]
        make_untimed(person)
        for entry in person["history"][-6:]:
            entry["kind"] = "DUTY"
        result = solve(data)
        self.assert_feasible(result)
        self.assertIn({"employeeId": "p0", "date": "2026-11-02", "kind": "OFF"}, result["assignments"])
        data["assignments"] = [{"employeeId": "p0", "date": "2026-11-02", "kind": "DUTY", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_untimed_cct_sunday_needs_certificate_without_hourly_scope(self):
        data = fixture()
        make_untimed(data["employees"][0])
        policy = data["policy"]
        policy["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
        policy["operationalCertificate"] = {"identifier": "test", "reviewed": True, "reviewedBy": "DP",
                                            "validFrom": "2026-06-01", "validUntil": "2027-05-31",
                                            "sundays": False, "holidays": False, "after20": False}
        data["assignments"] = [{"employeeId": "p0", "date": "2026-11-08", "kind": "DUTY", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        policy["operationalCertificate"]["sundays"] = True
        self.assert_feasible(solve(data))

    def test_untimed_fixed_rests_absence_and_closed_date(self):
        data = fixture()
        person = data["employees"][0]
        make_untimed(person)
        person.update(offMode="FIXED", fixedOffDays=[1, 2], offPattern="CONSECUTIVE")
        data["policy"]["closedDates"] = ["2026-11-03"]
        absence = {"employeeId": "p0", "date": "2026-11-05", "kind": "ABSENCE", "locked": True}
        data["assignments"] = [absence]
        result = solve(data)
        self.assert_feasible(result)
        self.assertIn(absence, result["assignments"])
        for day in ("2026-11-03", "2026-11-04"):
            self.assertIn({"employeeId": "p0", "date": day, "kind": "OFF"}, result["assignments"])

    def test_untimed_rest_does_not_invent_hourly_intervals(self):
        data = fixture()
        make_untimed(data["employees"][0])
        data["policy"].update(minInterShiftMinutes=10000, minWeeklyRestMinutes=20000)
        data["assignments"] = [{"employeeId": "p0", "date": day, "kind": kind, "locked": True}
                               for day, kind in (("2026-11-03", "DUTY"), ("2026-11-04", "OFF"), ("2026-11-05", "DUTY"))]
        self.assert_feasible(solve(data))

    def test_untimed_actual_history_overrides_planned_sunday_duty(self):
        data = fixture()
        person = data["employees"][0]
        make_untimed(person)
        person["sundayRestRule"] = "CLT_386"
        person["planningHistory"] = [{"employeeId": "p0", "date": "2026-11-01", "kind": "DUTY"}]
        data["assignments"] = [{"employeeId": "p0", "date": "2026-11-08", "kind": "DUTY", "locked": True}]
        self.assert_feasible(solve(data))
        person["history"] = [a for a in person["history"] if a["date"] != "2026-11-01"]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_untimed_cct_holiday_needs_both_operating_authorizations(self):
        data = fixture()
        make_untimed(data["employees"][0])
        policy = data["policy"]
        policy.update(normativeProfile="SINDECOMU_SUPERMARKETS_2026_2027", holidayDates=["2026-11-02"])
        policy["operationalCertificate"] = {"identifier": "test", "reviewed": True, "reviewedBy": "DP",
                                            "validFrom": "2026-06-01", "validUntil": "2027-05-31",
                                            "sundays": False, "holidays": False, "after20": False}
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        policy["authorizedHolidayDates"] = ["2026-11-02"]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        policy["operationalCertificate"]["holidays"] = True
        self.assert_feasible(solve(data))

    def test_seventy_six_untimed_employees_need_no_shifts(self):
        data = fixture(people=76)
        for person in data["employees"]:
            make_untimed(person)
        data["shifts"] = []
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(len(result["assignments"]), 76 * 7)
        for person in data["employees"]:
            assignments = [a for a in result["assignments"] if a["employeeId"] == person["id"]]
            self.assertEqual(sum(a["kind"] == "DUTY" for a in assignments), 5)
            self.assertEqual(sum(a["kind"] == "OFF" for a in assignments), 2)

    def test_exact_contracts(self):
        for hours in (40, 42, 44):
            data = fixture(hours)
            result = solve(data)
            self.assert_feasible(result)
            self.assertEqual(sum(a["kind"] == "WORK" for a in result["assignments"]), 5)
            self.assertEqual(sum(a["kind"] == "OFF" for a in result["assignments"]), 2)
            self.assertEqual(5 * hours * 12, hours * 60)

    def test_weekly_ceiling_changes_on_exact_effective_dates(self):
        for day, expected in (("2026-12-15", 44), ("2026-12-16", 42),
                              ("2027-12-15", 42), ("2027-12-16", 40)):
            self.assertEqual(legal_weekly_hours(day), expected)
        for day in ("2026-12-13", "2026-12-20", "2027-12-19"):
            self.assertEqual(effective_weekly_hours({"weeklyHours": 40}, day), 40)

    def test_reference_contract_reduces_after_each_transition(self):
        for day, reference, shift_hours, expected in (
                ("2026-12-07", 44, 44, 2640),
                ("2026-12-21", 44, 42, 2520),
                ("2027-12-20", 44, 40, 2400),
                ("2027-12-20", 42, 40, 2400),
                ("2026-12-21", 40, 40, 2400)):
            with self.subTest(day=day, reference=reference):
                data = fixture(reference, start_date=day, shift_hours=shift_hours)
                authorize_transition(data)
                result = solve(data)
                self.assert_feasible(result)
                self.assertEqual(weekly_totals(data, result), {day: expected})

    def test_transition_weeks_use_lower_target_without_proportional_hours(self):
        for day, reference, shift_hours, expected in (
                ("2026-12-14", 44, 42, 2520), ("2027-12-13", 42, 40, 2400)):
            data = fixture(reference, start_date=day, shift_hours=shift_hours)
            authorize_transition(data)
            result = solve(data)
            self.assert_feasible(result)
            self.assertEqual(weekly_totals(data, result), {day: expected})

    def test_targets_change_per_week_in_same_proposal(self):
        data = fixture(44, weeks=2, start_date="2026-12-07")
        shift42 = copy.deepcopy(fixture(42)["shifts"][0])
        shift42["id"] = "day42"
        data["shifts"].append(shift42)
        data["employees"][0]["shiftIds"].append("day42")
        authorize_transition(data)
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(weekly_totals(data, result), {"2026-12-07": 2640, "2026-12-14": 2520})

    def test_8h24_transition_requires_reviewed_current_collective_agreement(self):
        data = fixture(42, start_date="2026-12-21")
        for document in (None, {"source": "Acordo", "validFrom": "2026-12-16", "validUntil": "2027-12-15", "reviewedBy": "DP", "reviewed": False},
                         {"source": " ", "validFrom": "2026-12-16", "validUntil": "2027-12-15", "reviewedBy": "DP", "reviewed": True}):
            with self.subTest(document=document):
                data["policy"]["collectiveAgreement"] = document
                self.assertEqual(solve(data)["status"], "INFEASIBLE")
        authorize_transition(data, valid_until="2026-12-20")
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        authorize_transition(data)
        self.assert_feasible(solve(data))

    def test_daily_limits_are_applied_to_each_date(self):
        data = fixture(44)
        self.assertTrue(admissible(data["shifts"][0], data["policy"], "2026-12-15"))
        authorize_transition(data)
        self.assertFalse(admissible(data["shifts"][0], data["policy"], "2026-12-16"))
        shift42 = fixture(42)["shifts"][0]
        self.assertTrue(admissible(shift42, data["policy"], "2027-12-15"))
        self.assertFalse(admissible(shift42, data["policy"], "2027-12-16"))
        self.assertTrue(admissible(fixture(40)["shifts"][0], data["policy"], "2027-12-16"))

    def test_old_44_hour_shift_cannot_satisfy_new_42_hour_regime(self):
        data = fixture(44, start_date="2026-12-21")
        authorize_transition(data)
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_normative_limit_remains_binding(self):
        data = fixture(42, start_date="2026-12-21")
        authorize_transition(data)
        data["policy"]["weeklyLimit"] = 40
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_women_and_unreviewed_rules_cannot_work_two_consecutive_sundays(self):
        for rule in ("CLT_386", "UNREVIEWED", None):
            data = fixture(40)
            person = data["employees"][0]
            person["sundayRestRule"] = rule
            person["history"][-1].update(kind="WORK", shiftId="day")
            data["assignments"] = [{"employeeId": "p0", "date": "2026-11-08", "kind": "WORK", "shiftId": "day", "locked": True}]
            self.assertEqual(sunday_limit(person), 1)
            self.assertEqual(solve(data)["status"], "INFEASIBLE")
        data["employees"][0]["sundayRestRule"] = "COMMERCE"
        self.assert_feasible(solve(data))

    def test_commerce_can_keep_stricter_quinzenal_rotation(self):
        person = fixture()["employees"][0]
        self.assertEqual(sunday_limit(person), 2)
        person["maxConsecutiveSundays"] = 1
        self.assertEqual(sunday_limit(person), 1)

    def test_cct_requires_certificate_for_sunday_and_holiday_work(self):
        data = fixture(40)
        policy = data["policy"]
        policy["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
        shift = data["shifts"][0]
        self.assertFalse(admissible(shift, policy, "2026-11-08"))
        policy["holidayDates"] = ["2026-11-02"]
        self.assertFalse(admissible(shift, policy, "2026-11-02"))
        policy["operationalCertificate"] = {
            "identifier": "Certidão de cenário", "validFrom": "2026-06-01", "validUntil": "2027-05-31",
            "reviewedBy": "DP", "reviewed": True, "sundays": True, "holidays": True, "after20": False,
        }
        self.assertTrue(admissible(shift, policy, "2026-11-08"))
        self.assertTrue(admissible(shift, policy, "2026-11-02"))
        policy["operationalCertificate"]["reviewed"] = False
        self.assertFalse(admissible(shift, policy, "2026-11-08"))
        policy["operationalCertificate"].update(reviewed=True, validUntil="2026-11-01")
        self.assertFalse(admissible(shift, policy, "2026-11-08"))

    def test_cct_normal_evening_shift_is_not_extraordinary_night_extension(self):
        data = fixture(40)
        policy = data["policy"]
        policy["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
        evening = {"id": "evening", "segments": [
            {"start": 720, "end": 960, "kind": "WORK"},
            {"start": 960, "end": 1020, "kind": "BREAK"},
            {"start": 1020, "end": 1260, "kind": "WORK"}]}
        self.assertTrue(admissible(evening, policy, "2026-11-03"))
        evening["segments"][-1]["end"] = 1284
        self.assertFalse(admissible(evening, policy, "2026-11-03"))
        policy["operationalCertificate"] = {
            "identifier": "Certidão de cenário", "validFrom": "2026-06-01", "validUntil": "2027-05-31",
            "reviewedBy": "DP", "reviewed": True, "sundays": False, "holidays": False, "after20": True,
        }
        self.assertTrue(admissible(evening, policy, "2026-11-03"))
        self.assertFalse(admissible(evening, policy, "2027-06-01"))

    def test_cct_certificate_follows_real_civil_sunday_in_overnight_shift(self):
        data = fixture(40)
        policy = data["policy"]
        policy["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
        overnight = {"id": "night", "segments": [
            {"start": 1260, "end": 1500, "kind": "WORK"},
            {"start": 1500, "end": 1560, "kind": "BREAK"},
            {"start": 1560, "end": 1800, "kind": "WORK"}]}
        policy["operationalCertificate"] = {
            "identifier": "Certidão de cenário", "validFrom": "2026-06-01", "validUntil": "2027-05-31",
            "reviewedBy": "DP", "reviewed": True, "sundays": False, "holidays": False, "after20": True,
        }
        self.assertFalse(admissible(overnight, policy, "2026-11-07"))
        policy["operationalCertificate"]["sundays"] = True
        self.assertTrue(admissible(overnight, policy, "2026-11-07"))

    def test_cct_solver_cannot_fill_sunday_demand_without_valid_certificate(self):
        data = fixture(40)
        data["policy"]["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
        data["demands"] = [{"id": "sunday", "date": "2026-11-08", "sector": "Reposição", "start": 480, "end": 720, "minimum": 1}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        data["policy"]["operationalCertificate"] = {
            "identifier": "Certidão de cenário", "validFrom": "2026-06-01", "validUntil": "2027-05-31",
            "reviewedBy": "DP", "reviewed": True, "sundays": True, "holidays": False, "after20": False,
        }
        self.assert_feasible(solve(data))

    def test_cct_does_not_turn_holiday_into_dsr_even_if_generic_flag_allows_it(self):
        data = fixture(40)
        data["policy"].update(normativeProfile="SINDECOMU_SUPERMARKETS_2026_2027",
                              holidayDates=["2026-11-02"], holidayRestAllowed=True)
        data["assignments"] = [{"employeeId": "p0", "date": "2026-11-02", "kind": "OFF", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_certificate_cannot_extend_expired_cct_validity(self):
        policy = fixture(40)["policy"]
        policy["operationalCertificate"] = {
            "identifier": "Certidão de cenário", "validFrom": "2026-01-01", "validUntil": "2028-12-31",
            "reviewedBy": "DP", "reviewed": True, "sundays": True, "holidays": True, "after20": True,
        }
        self.assertTrue(certificate_authorizes(policy, "2027-05-31", "after20"))
        self.assertFalse(certificate_authorizes(policy, "2027-06-01", "after20"))
        self.assertFalse(certificate_authorizes(policy, "2026-05-31", "after20"))

    def test_incompatible_shift_is_not_filled_with_extra_day(self):
        data = fixture(40)
        data["employees"][0]["weeklyHours"] = 44
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_does_not_relax_closed_date_or_locked_work(self):
        data = fixture()
        data["policy"]["closedDates"] = [data["startDate"]]
        data["assignments"] = [{"employeeId": "p0", "date": data["startDate"], "kind": "WORK", "shiftId": "day", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_locked_and_absence_preserved(self):
        data = fixture()
        data["assignments"] = [
            {"employeeId": "p0", "date": "2026-11-03", "kind": "OFF", "locked": True},
            {"employeeId": "p0", "date": "2026-11-04", "kind": "ABSENCE"},
        ]
        result = solve(data)
        self.assert_feasible(result)
        values = {a["date"]: a for a in result["assignments"]}
        self.assertEqual(values["2026-11-03"]["kind"], "OFF")
        self.assertTrue(values["2026-11-03"]["locked"])
        self.assertEqual(values["2026-11-04"]["kind"], "ABSENCE")

    def test_six_days_from_history_cannot_continue(self):
        data = fixture()
        for entry in data["employees"][0]["history"][-6:]:
            entry.update(kind="WORK", shiftId="day")
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(result["assignments"][0]["kind"], "OFF")

    def test_two_valid_weekly_pairs_can_still_form_ten_day_streak(self):
        data = fixture(weeks=2)
        data["assignments"] = [
            {"employeeId": "p0", "date": d, "kind": "OFF", "locked": True}
            for d in ("2026-11-02", "2026-11-03", "2026-11-14", "2026-11-15")
        ]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_coverage_does_not_count_meal(self):
        data = fixture(people=4)
        data["demands"] = [{"id": "lunch", "date": "2026-11-02", "sector": "Reposição",
                            "start": 720, "end": 780, "minimum": 1}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_suggestions_consume_same_reserve(self):
        data = fixture(people=4)
        data["demands"] = [{"id": "peak", "date": "2026-11-02", "sector": "Reposição",
                            "start": 600, "end": 660, "minimum": 3}]
        for pid in ("p0", "p1"):
            self.assert_feasible(solve(data, {"employeeId": pid, "offDates": ["2026-11-02"]}))
        data["assignments"] = [{"employeeId": p, "date": "2026-11-02", "kind": "OFF", "locked": True} for p in ("p0", "p1")]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_fixed_and_consecutive(self):
        data = fixture()
        data["employees"][0].update(offMode="FIXED", fixedOffDays=[1, 2], offPattern="CONSECUTIVE")
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual([a["date"] for a in result["assignments"] if a["kind"] == "OFF"], ["2026-11-03", "2026-11-04"])

    def test_no_compensation_no_8h24(self):
        data = fixture()
        data["policy"]["compensationAuthorized"] = False
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_sunday_monday_fixed_pair_reserves_next_monday(self):
        data = fixture(weeks=2)
        person = data["employees"][0]
        person.update(offMode="FIXED", fixedOffDays=[0, 6], offPattern="CONSECUTIVE")
        for entry in person["history"]:
            if date.fromisoformat(entry["date"]).weekday() in (0, 6):
                entry.update(kind="OFF"); entry.pop("shiftId", None)
            else:
                entry.update(kind="WORK", shiftId="day")
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual([a["date"] for a in result["assignments"] if a["kind"] == "OFF"],
                         ["2026-11-02", "2026-11-08", "2026-11-09", "2026-11-15"])
        data["policy"]["holidayDates"] = ["2026-11-16"]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_input_order_and_names_do_not_change_rights(self):
        data = fixture(people=3)
        original = solve(data)
        self.assert_feasible(original)
        changed = copy.deepcopy(data)
        changed["employees"].reverse()
        for index, person in enumerate(changed["employees"]):
            person["name"] = f"Outro nome {index}"
        result = solve(changed)
        self.assert_feasible(result)
        self.assertEqual(sorted((a["employeeId"], a["kind"]) for a in original["assignments"]),
                         sorted((a["employeeId"], a["kind"]) for a in result["assignments"]))

    def test_budget_before_first_solve_is_unknown_not_empty_success(self):
        with patch("solver.time.monotonic", side_effect=[0, 0, 11.95, 12]):
            result = solve(fixture(40))
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertEqual(result["assignments"], [])

    def test_absent_sundays_are_not_rotation_debt(self):
        data = fixture(people=2, weeks=2)
        for entry in data["employees"][0]["history"]:
            if entry["date"] in ("2026-10-18", "2026-10-25"):
                entry.update(kind="WORK", shiftId="day")
        for entry in data["employees"][1]["history"]:
            if date.fromisoformat(entry["date"]).weekday() == 6:
                entry["kind"] = "ABSENCE"
                entry.pop("shiftId", None)
        data["demands"] = [{"id": f"s{i}", "date": day, "sector": "Reposição", "start": 480, "end": 720, "minimum": 1}
                           for i, day in enumerate(("2026-11-08", "2026-11-15"))]
        result = solve(data)
        self.assert_feasible(result)
        counts = {pid: sum(a["employeeId"] == pid and a["kind"] == "WORK" and date.fromisoformat(a["date"]).weekday() == 6
                           for a in result["assignments"]) for pid in ("p0", "p1")}
        self.assertEqual(counts, {"p0": 1, "p1": 1})

    def test_suggestion_excludes_previous_pair_without_preselecting_invalid_pairs(self):
        data = fixture()
        first = solve(data, {"employeeId": "p0", "weekStart": "2026-11-02"})
        self.assert_feasible(first)
        pair = [a["date"] for a in first["assignments"] if a["kind"] == "OFF"]
        second = solve(data, {"employeeId": "p0", "weekStart": "2026-11-02", "excludedOffPairs": [pair]})
        self.assert_feasible(second)
        self.assertNotEqual(pair, [a["date"] for a in second["assignments"] if a["kind"] == "OFF"])


class SingleImportTests(unittest.TestCase):
    def test_unknown_admission_and_protective_rotation_work_without_fabricated_history(self):
        data = fixture(40)
        person = data["employees"][0]
        person.update(activeFrom="", history=[], historyKnown=False, sundayRestRule="PROTECTIVE")
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"))
        self.assertEqual(len(result["assignments"]), 7)
        self.assertEqual(person["history"], [])

    def test_excluded_person_never_appears_in_solver_assignments(self):
        data = fixture(40, people=2)
        data["employees"][1].update(planningEnabled=False, shiftIds=[])
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"))
        self.assertEqual({item["employeeId"] for item in result["assignments"]}, {"p0"})

    def test_published_planning_history_is_used_but_actual_records_override_it(self):
        data = fixture(40)
        person = data["employees"][0]
        person.update(history=[], historyKnown=False, sundayRestRule="PROTECTIVE", planningHistory=[
            {"employeeId": "p0", "date": "2026-11-01", "kind": "WORK", "shiftId": "day"}])
        force = {"employeeId": "p0", "offDates": ["2026-11-02", "2026-11-03"]}
        self.assertEqual(solve(data, force)["status"], "INFEASIBLE")
        person["history"] = [{"employeeId": "p0", "date": "2026-11-01", "kind": "OFF"}]
        self.assertIn(solve(data, force)["status"], ("FEASIBLE", "OPTIMAL"))

    def test_blank_reviewed_document_dates_never_authorize_extension(self):
        data = fixture(42, start_date="2027-01-04")
        authorize_transition(data, valid_from="")
        self.assertFalse(admissible(data["shifts"][0], data["policy"], data["startDate"]))


if __name__ == "__main__":
    import sys
    if "--fixture" in sys.argv:
        data = fixture(people=4, weeks=2)
        data["demands"] = [{"id": f"d{index}", "date": (date(2026, 11, 2) + timedelta(days=index)).isoformat(),
                            "sector": "Reposição", "start": 480, "end": 720, "minimum": 1}
                           for index in range(14)]
        result = solve(data)
        print(json.dumps({"input": data, "result": result}))
    else:
        unittest.main()
