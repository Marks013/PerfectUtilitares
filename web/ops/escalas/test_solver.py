"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import days_between
from datetime import date
from datetime import timedelta
from solver import solve
import copy
import unittest

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

def make_untimed(person):
    person.update(scheduleMode="UNTIMED", shiftIds=[])
    for entry in person["history"]:
        if entry["kind"] == "WORK":
            entry["kind"] = "DUTY"
            entry.pop("shiftId", None)

class SolverTests(unittest.TestCase):
    def assert_feasible(self, result):
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"), result)

    def test_future_six_published_duties_require_last_current_day_off(self):
        data = fixture(40)
        person = data["employees"][0]
        make_untimed(person)
        person["scheduleMode"] = "MISSING"
        person["planningFuture"] = [{"employeeId": person["id"], "date": (date.fromisoformat(data["endDate"]) + timedelta(days=offset)).isoformat(),
                                     "kind": "DUTY"} for offset in range(1, 7)]
        original = copy.deepcopy(person["planningFuture"])
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == data["endDate"])["kind"], "OFF")
        self.assertEqual(len(result["assignments"]), 7)
        self.assertEqual(person["planningFuture"], original)
        self.assertTrue(all(a["date"] <= data["endDate"] for a in result["assignments"]))
        data["assignments"] = [{"employeeId": person["id"], "date": data["endDate"], "kind": "DUTY", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_next_published_sunday_protects_the_current_sunday(self):
        data = fixture(40)
        person = data["employees"][0]
        make_untimed(person)
        person["sundayRestRule"] = "PROTECTIVE"
        person["planningFuture"] = [{"employeeId": person["id"], "date": "2026-11-15", "kind": "DUTY"}]
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == "2026-11-08")["kind"], "OFF")
        data["assignments"] = [{"employeeId": person["id"], "date": "2026-11-08", "kind": "DUTY", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_published_future_shift_preserves_intershift_rest(self):
        data = fixture(40)
        person = data["employees"][0]
        data["shifts"].append({"id": "late", "name": "Tarde", "segments": [
            {"start": 780, "end": 1020, "kind": "WORK"}, {"start": 1020, "end": 1080, "kind": "BREAK"},
            {"start": 1080, "end": 1320, "kind": "WORK"}]})
        person["shiftIds"] = ["day", "late"]
        person["planningFuture"] = [{"employeeId": person["id"], "date": "2026-11-09", "kind": "WORK", "shiftId": "day"}]
        result = solve(data)
        self.assert_feasible(result)
        last = next(a for a in result["assignments"] if a["date"] == data["endDate"])
        self.assertNotEqual(last.get("shiftId"), "late")
        data["assignments"] = [{"employeeId": person["id"], "date": data["endDate"], "kind": "WORK", "shiftId": "late", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_published_future_rest_cannot_shorten_weekly_interval(self):
        data = fixture(40)
        person = data["employees"][0]
        data["shifts"].append({"id": "late", "name": "Tarde", "segments": [
            {"start": 780, "end": 1020, "kind": "WORK"}, {"start": 1020, "end": 1080, "kind": "BREAK"},
            {"start": 1080, "end": 1320, "kind": "WORK"}]})
        person["shiftIds"] = ["day", "late"]
        person["planningFuture"] = [{"employeeId": person["id"], "date": "2026-11-09", "kind": "OFF"},
                                     {"employeeId": person["id"], "date": "2026-11-10", "kind": "WORK", "shiftId": "day"}]
        data["assignments"] = [{"employeeId": person["id"], "date": data["endDate"], "kind": "WORK", "shiftId": "late", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_future_work_overrides_an_inferred_consecutive_rest_reservation(self):
        data = fixture(40)
        person = data["employees"][0]
        make_untimed(person)
        person.update(offMode="FIXED", fixedOffDays=[0, 6], offPattern="CONSECUTIVE")
        person["planningFuture"] = [{"employeeId": person["id"], "date": "2026-11-09", "kind": "DUTY"}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_consecutive_boundary_pair_does_not_authorize_three_variable_rests(self):
        data = fixture(40)
        person = data["employees"][0]
        make_untimed(person)
        person["offPattern"] = "CONSECUTIVE"
        person["planningFuture"] = [{"employeeId": person["id"], "date": "2026-11-09", "kind": "OFF"},
                                     {"employeeId": person["id"], "date": "2026-11-10", "kind": "DUTY"}]
        # Prior Saturday/Sunday OFF plus mandatory next Monday OFF leave no
        # two-rest weekly pair without creating a three-OFF boundary block.
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_first_future_consecutive_rest_preserves_its_current_neighbor(self):
        data = fixture(40)
        person = data["employees"][0]
        make_untimed(person)
        person["offPattern"] = "CONSECUTIVE"
        # An absence is not an OFF: Sunday/Monday remains a valid two-day pair.
        next(entry for entry in person["history"] if entry["date"] == "2026-10-31")["kind"] = "ABSENCE"
        person["planningFuture"] = [{"employeeId": person["id"], "date": "2026-11-09", "kind": "OFF"},
                                     {"employeeId": person["id"], "date": "2026-11-10", "kind": "DUTY"}]
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == data["endDate"])["kind"], "OFF")
        data["assignments"] = [{"employeeId": person["id"], "date": data["endDate"], "kind": "DUTY", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_current_overnight_work_cannot_occupy_a_published_future_rest(self):
        data = fixture(40)
        person = data["employees"][0]
        data["shifts"].append({"id": "night", "name": "Noturno", "segments": [
            {"start": 1200, "end": 1440, "kind": "WORK"}, {"start": 1440, "end": 1500, "kind": "BREAK"},
            {"start": 1500, "end": 1740, "kind": "WORK"}]})
        person["shiftIds"].append("night")
        person["planningFuture"] = [{"employeeId": person["id"], "date": "2026-11-09", "kind": "OFF"}]
        data["assignments"] = [{"employeeId": person["id"], "date": data["endDate"], "kind": "WORK", "shiftId": "night", "locked": True}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_untimed_leaders_rotate_weekends_without_emptying_the_sector(self):
        data = fixture(40, people=4, weeks=4)
        for index, person in enumerate(data["employees"]):
            make_untimed(person)
            person.update(history=[], historyKnown=False, role=f"Responsabilidade {index}",
                          sundayRestRule="PROTECTIVE")
        result = solve(data)
        self.assert_feasible(result)
        for day in days_between(data["startDate"], data["endDate"]):
            entries = [a for a in result["assignments"] if a["date"] == day]
            self.assertGreaterEqual(sum(a["kind"] == "DUTY" for a in entries), 2)
        for person in data["employees"]:
            entries = [a for a in result["assignments"] if a["employeeId"] == person["id"]]
            for start in range(0, len(entries), 7):
                self.assertEqual(sum(a["kind"] == "DUTY" for a in entries[start:start + 7]), 5)
                self.assertEqual(sum(a["kind"] == "OFF" for a in entries[start:start + 7]), 2)
            sundays = [a for a in entries if date.fromisoformat(a["date"]).weekday() == 6]
            self.assertEqual(sum(a["kind"] == "DUTY" for a in sundays), 2)
            self.assertTrue(all("shiftId" not in a for a in entries))

    def test_single_untimed_leader_does_not_receive_every_weekend_automatically(self):
        data = fixture(40, weeks=4)
        person = data["employees"][0]
        make_untimed(person)
        person.update(history=[], historyKnown=False, sundayRestRule="PROTECTIVE")
        result = solve(data)
        self.assert_feasible(result)
        sundays = [a for a in result["assignments"] if date.fromisoformat(a["date"]).weekday() == 6]
        saturdays = [a for a in result["assignments"] if date.fromisoformat(a["date"]).weekday() == 5]
        self.assertGreater(sum(a["kind"] == "DUTY" for a in sundays), 0)
        self.assertGreater(sum(a["kind"] == "DUTY" for a in saturdays), 0)
        self.assertGreater(sum(a["kind"] == "OFF" for a in sundays), 0)

    def test_fixed_separated_rests_are_normal_and_do_not_require_consecutive_pair(self):
        data = fixture(40)
        data["employees"][0].update(offMode="FIXED", fixedOffDays=[1, 6], offPattern="ANY")
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual([a["date"] for a in result["assignments"] if a["kind"] == "OFF"],
                         ["2026-11-03", "2026-11-08"])

    def test_locked_weekend_rests_override_soft_operational_balance(self):
        data = fixture(40, people=3, weeks=2)
        for person in data["employees"]:
            make_untimed(person)
        locked = [{"employeeId": person["id"], "date": "2026-11-08", "kind": "OFF", "locked": True}
                  for person in data["employees"]]
        data["assignments"] = locked
        result = solve(data)
        self.assert_feasible(result)
        for entry in locked:
            self.assertIn(entry, result["assignments"])

    def test_equivalent_inputs_have_reproducible_daily_assignments(self):
        data = fixture(40, people=3, weeks=2)
        for person in data["employees"]:
            make_untimed(person)
            person.update(history=[], historyKnown=False)
        first = solve(data)
        second = solve(copy.deepcopy(data))
        self.assert_feasible(first)
        self.assert_feasible(second)
        self.assertEqual(first["assignments"], second["assignments"])

    def test_unconfirmed_estimate_does_not_invent_staff_or_override_a_locked_rest(self):
        data = fixture(40)
        data["policy"]["coverageReview"] = "SUGGESTED"
        data["assignments"] = [{"employeeId": "p0", "date": data["startDate"], "kind": "OFF", "locked": True}]
        data["demands"] = [{"date": data["startDate"], "sector": "Reposição", "start": 480, "end": 720,
                            "minimum": 1, "estimated": True}]
        result = solve(data)
        self.assert_feasible(result)
        self.assertIn(data["assignments"][0], result["assignments"])
        self.assertEqual(len(result["assignments"]), 7)

    def test_coverage_estimate_precedes_soft_sector_rest_distribution(self):
        data = fixture(40, people=4, weeks=2)
        data["policy"]["coverageReview"] = "SUGGESTED"
        data["demands"] = [{"date": data["startDate"], "sector": "Reposição", "start": 480, "end": 720,
                            "minimum": 4, "estimated": True}]
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(sum(a["kind"] == "WORK" for a in result["assignments"]
                             if a["date"] == data["startDate"]), 4)

    def test_saturday_rotation_uses_actual_history_opportunities(self):
        data = fixture(40, people=2, weeks=2)
        for entry in data["employees"][0]["history"]:
            if entry["date"] in ("2026-10-17", "2026-10-24"):
                entry.update(kind="WORK", shiftId="day")
        data["demands"] = [{"date": day, "sector": "Reposição", "start": 480, "end": 720, "minimum": 1}
                           for day in ("2026-11-07", "2026-11-14")]
        result = solve(data)
        self.assert_feasible(result)
        counts = {pid: sum(a["kind"] == "WORK" and a["employeeId"] == pid
                           and date.fromisoformat(a["date"]).weekday() == 5 for a in result["assignments"])
                  for pid in ("p0", "p1")}
        self.assertEqual(counts, {"p0": 0, "p1": 2})

    def test_estimated_coverage_is_prioritized_when_a_legal_solution_can_fill_it(self):
        data = fixture(40)
        data["policy"]["coverageReview"] = "SUGGESTED"
        data["employees"][0]["preferredOffDays"] = [0]
        data["demands"] = [{"date": data["startDate"], "sector": "Reposição", "start": 480, "end": 720,
                            "minimum": 1, "estimated": True}]
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == data["startDate"])["kind"], "WORK")

    def test_explicit_minimums_are_hard_and_estimate_provenance_is_not_overridden_by_a_global_flag(self):
        for provenance, review in ((False, "SUGGESTED"), (True, "CONFIRMED"), (True, None)):
            with self.subTest(estimated=provenance, review=review):
                data = fixture(40)
                data["policy"]["coverageReview"] = review
                data["assignments"] = [{"employeeId": "p0", "date": data["startDate"], "kind": "OFF", "locked": True}]
                data["demands"] = [{"date": data["startDate"], "sector": "Reposição", "start": 480, "end": 720,
                                    "minimum": 1, "estimated": provenance}]
                result = solve(data)
                if provenance:
                    self.assert_feasible(result)
                    self.assertEqual(next(a for a in result["assignments"] if a["date"] == data["startDate"])["kind"], "OFF")
                else:
                    self.assertEqual(result["status"], "INFEASIBLE")

    def test_estimate_without_any_matching_timed_person_stays_a_visible_gap(self):
        data = fixture(40)
        make_untimed(data["employees"][0])
        data["policy"]["coverageReview"] = "SUGGESTED"
        data["demands"] = [{"date": data["startDate"], "sector": "Reposição", "start": 480, "end": 720,
                            "minimum": 1, "estimated": True}]
        result = solve(data)
        self.assert_feasible(result)
        self.assertFalse(any(a["kind"] == "WORK" for a in result["assignments"]))

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

    def test_untimed_cct_sunday_needs_certificate_without_hourly_scope_is_informative_only(self):
        data = fixture()
        make_untimed(data["employees"][0])
        policy = data["policy"]
        policy["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
        policy["operationalCertificate"] = {"identifier": "test", "reviewed": True, "reviewedBy": "DP",
                                            "validFrom": "2026-06-01", "validUntil": "2027-05-31",
                                            "sundays": False, "holidays": False, "after20": False}
        data["assignments"] = [{"employeeId": "p0", "date": "2026-11-08", "kind": "DUTY", "locked": True}]
        self.assert_feasible(solve(data))
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

    def test_untimed_cct_holiday_needs_both_operating_authorizations_is_informative_only(self):
        data = fixture()
        make_untimed(data["employees"][0])
        policy = data["policy"]
        policy.update(normativeProfile="SINDECOMU_SUPERMARKETS_2026_2027", holidayDates=["2026-11-02"])
        policy["operationalCertificate"] = {"identifier": "test", "reviewed": True, "reviewedBy": "DP",
                                            "validFrom": "2026-06-01", "validUntil": "2027-05-31",
                                            "sundays": False, "holidays": False, "after20": False}
        self.assert_feasible(solve(data))
        policy["authorizedHolidayDates"] = ["2026-11-02"]
        self.assert_feasible(solve(data))
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

    def test_8h24_transition_requires_reviewed_current_collective_agreement_is_informative_only(self):
        data = fixture(42, start_date="2026-12-21")
        for document in (None, {"source": "Acordo", "validFrom": "2026-12-16", "validUntil": "2027-12-15", "reviewedBy": "DP", "reviewed": False},
                         {"source": " ", "validFrom": "2026-12-16", "validUntil": "2027-12-15", "reviewedBy": "DP", "reviewed": True}):
            with self.subTest(document=document):
                data["policy"]["collectiveAgreement"] = document
                self.assert_feasible(solve(data))
        authorize_transition(data, valid_until="2026-12-20")
        self.assert_feasible(solve(data))
        authorize_transition(data)
        self.assert_feasible(solve(data))

    def test_old_44_hour_shift_cannot_satisfy_new_42_hour_regime(self):
        data = fixture(44, start_date="2026-12-21")
        authorize_transition(data)
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_normative_limit_remains_binding(self):
        data = fixture(42, start_date="2026-12-21")
        authorize_transition(data)
        data["policy"]["weeklyLimit"] = 40
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_cct_solver_cannot_fill_sunday_demand_without_valid_certificate_is_informative_only(self):
        data = fixture(40)
        data["policy"]["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
        data["demands"] = [{"id": "sunday", "date": "2026-11-08", "sector": "Reposição", "start": 480, "end": 720, "minimum": 1}]
        self.assert_feasible(solve(data))
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
        result = solve(data)
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertIn("12:00", result["message"])
        self.assertIn("intervalos de refeição", result["message"])

    def test_locked_rests_share_the_whole_branch_coverage_reserve(self):
        data = fixture(people=4)
        data["demands"] = [{"id": "peak", "date": "2026-11-02", "sector": "Reposição",
                            "start": 600, "end": 660, "minimum": 3}]
        for pid in ("p0", "p1"):
            data["assignments"] = [{"employeeId": pid, "date": "2026-11-02", "kind": "OFF", "locked": True}]
            self.assert_feasible(solve(data))
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

    def test_fair_sunday_distribution_counts_previous_saturday_overnight_work(self):
        data = fixture(40, people=2, weeks=2)
        night = {"id": "night", "segments": [{"start": 1200, "end": 1440, "kind": "WORK"},
                                               {"start": 1440, "end": 1500, "kind": "BREAK"},
                                               {"start": 1500, "end": 1740, "kind": "WORK"}]}
        data["shifts"].append(night)
        previous = data["employees"][0]["history"][-2]
        previous.update(kind="WORK", shiftId="night")
        data["demands"] = [{"date": day, "sector": "Reposição", "start": 480, "end": 720, "minimum": 1}
                           for day in ("2026-11-08", "2026-11-15")]
        result = solve(data)
        self.assert_feasible(result)
        totals = {pid: sum(a["employeeId"] == pid and a["kind"] == "WORK" and date.fromisoformat(a["date"]).weekday() == 6
                           for a in result["assignments"]) for pid in ("p0", "p1")}
        self.assertEqual(totals["p0"] + 1, totals["p1"])

    def test_six_week_whole_branch_mixes_timed_and_untimed_without_losing_days(self):
        data = fixture(40, people=81, weeks=6, start_date="2026-10-26")
        data["policy"]["compensationAuthorized"] = False
        for index, person in enumerate(data["employees"]):
            person.update(sundayRestRule="PROTECTIVE", history=[], historyKnown=False, activeFrom="")
            if index < 12:
                make_untimed(person)
            elif index >= 75:
                person.update(planningEnabled=False, shiftIds=[])
        data["demands"] = [{"date": day, "sector": "Reposição", "start": 480, "end": 720, "minimum": 25}
                           for day in days_between(data["startDate"], data["endDate"])]
        locked = {"employeeId": "p12", "date": "2026-10-26", "kind": "WORK", "shiftId": "day", "locked": True}
        absence = {"employeeId": "p0", "date": "2026-10-26", "kind": "ABSENCE", "locked": True}
        data["assignments"] = [locked, absence]
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(len(result["assignments"]), 75 * 42)
        self.assertIn(locked, result["assignments"])
        self.assertIn(absence, result["assignments"])
        for person in data["employees"][:75]:
            assignments = [a for a in result["assignments"] if a["employeeId"] == person["id"]]
            streak = sunday_streak = 0
            for entry in assignments:
                streak = streak + 1 if entry["kind"] in ("WORK", "DUTY") else 0
                self.assertLessEqual(streak, 6)
                if date.fromisoformat(entry["date"]).weekday() == 6:
                    sunday_streak = sunday_streak + 1 if entry["kind"] in ("WORK", "DUTY") else 0
                    self.assertLessEqual(sunday_streak, 1)
            for week in range(6):
                entries = assignments[week * 7:week * 7 + 7]
                if any(a["kind"] == "ABSENCE" for a in entries):
                    continue
                self.assertEqual(sum(a["kind"] in ("WORK", "DUTY") for a in entries), 5)
                self.assertEqual(sum(a["kind"] == "OFF" for a in entries), 2)

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
        data["assignments"] = [{"employeeId": "p0", "date": day, "kind": "OFF", "locked": True}
                               for day in ("2026-11-02", "2026-11-03")]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        person["history"] = [{"employeeId": "p0", "date": "2026-11-01", "kind": "OFF"}]
        self.assertIn(solve(data)["status"], ("FEASIBLE", "OPTIMAL"))

class SupermarketRoleBalanceTests(unittest.TestCase):
    def test_leaders_in_distinct_sectors_are_not_concentrated_on_the_same_rests(self):
        data = fixture(hours=40, people=4, weeks=2)
        roles = ["ENC. PADARIA", "GERENTE", "ENC. FRENTE DE CAIXA", "ENC. ACOUGUE"]
        for index, person in enumerate(data["employees"]):
            person["role"] = roles[index]
            person["sector"] = f"Setor {index}"
            make_untimed(person)
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        for day in days_between(data["startDate"], data["endDate"]):
            present = sum(a["kind"] == "DUTY" and a["date"] == day for a in result["assignments"])
            self.assertGreaterEqual(present, 2)
        for person in data["employees"]:
            self.assertEqual(sum(a["kind"] == "OFF" and a["employeeId"] == person["id"] for a in result["assignments"]), 4)

class SupportSimulationTests(unittest.TestCase):
    def test_thousands_of_optional_role_targets_cannot_starve_initial_feasibility(self):
        data = fixture(hours=42, people=150, weeks=6)
        data["simulation"] = True
        data["policy"]["compensationAuthorized"] = False
        data["policy"]["coverageReview"] = "SUGGESTED"
        for index, person in enumerate(data["employees"]):
            person["role"] = f"role-{index}"
            person.update(history=[], historyKnown=False)
        data["demands"] = [{"date": day, "sector": person["sector"], "role": person["role"], "start": 480, "end": 720, "minimum": 1, "estimated": True}
                           for day in days_between(data["startDate"], data["endDate"]) for person in data["employees"]]
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(len(result["assignments"]), 6300)
        rests_by_weekday = [sum(entry["kind"] == "OFF" and date.fromisoformat(entry["date"]).weekday() == weekday for entry in result["assignments"]) for weekday in range(7)]
        self.assertTrue(all(total > 0 for total in rests_by_weekday), rests_by_weekday)

    def test_large_supermarket_gets_a_complete_feasible_incumbent_before_soft_optimization(self):
        data = fixture(hours=42, people=150, weeks=6)
        data["simulation"] = True
        data["policy"]["compensationAuthorized"] = False
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(len(result["assignments"]), 150 * 42)
        for person in data["employees"]:
            rows = [a for a in result["assignments"] if a["employeeId"] == person["id"]]
            self.assertEqual(sum(a["kind"] == "WORK" for a in rows), 30)
            self.assertEqual(sum(a["kind"] == "OFF" for a in rows), 12)
