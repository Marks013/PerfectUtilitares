"""Historical whole-roster contracts; assert paid minutes independently of the engine."""
import copy
from datetime import date, timedelta
import unittest
from contract_fixtures import fixture, make_untimed, authorize_transition
from solver import solve


def weekly_totals(data, result):
    shifts = {shift["id"]: shift for shift in data["shifts"]}
    totals = {}
    for entry in result["assignments"]:
        day = date.fromisoformat(entry["date"])
        monday = (day - timedelta(days=day.weekday())).isoformat()
        totals.setdefault(monday, 0)
        if entry["kind"] == "WORK":
            totals[monday] += sum(segment["end"] - segment["start"]
                                  for segment in shifts[entry["shiftId"]]["segments"]
                                  if segment["kind"] in ("WORK", "PAID_BREAK"))
    return totals


class SolverTests(unittest.TestCase):
    def assert_feasible(self, result):
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)

    def test_null_protective_sunday_rule_cannot_weaken_a_locked_sunday_conflict(self):
        for rule in ("CLT_386", "UNREVIEWED", None):
            with self.subTest(rule=rule):
                data = fixture(40)
                data["employees"][0]["sundayRestRule"] = rule
                data["employees"][0]["history"][-1].update(kind="WORK", shiftId="day")
                data["assignments"] = [{"employeeId":"p0", "date":"2026-11-08", "kind":"WORK", "shiftId":"day", "locked":True}]
                before = copy.deepcopy(data)
                self.assertEqual(solve(data)["status"], "INFEASIBLE")
                self.assertEqual(data, before)
                data["employees"][0]["sundayRestRule"] = "COMMERCE"
                self.assert_feasible(solve(data))

    def test_missing_clock_reference_plans_presence_without_fabricating_hours(self):
            data = fixture(40)
            make_untimed(data["employees"][0])
            data["employees"][0]["scheduleMode"] = "MISSING"
            data["shifts"] = []
            result = solve(data)
            self.assert_feasible(result)
            self.assertEqual(sum(a["kind"] == "DUTY" for a in result["assignments"]), 5)
            self.assertEqual(sum(a["kind"] == "OFF" for a in result["assignments"]), 2)
            self.assertTrue(all("shiftId" not in a for a in result["assignments"]))
            self.assertEqual(weekly_totals(data, result), {"2026-11-02": 0})

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



class SupportSimulationTests(unittest.TestCase):
    def test_simulation_can_distribute_42h_without_fabricating_compensation(self):
            data = fixture(hours=42)
            data["policy"]["compensationAuthorized"] = False
            data["simulation"] = True
            before = copy.deepcopy(data)
            result = solve(data)
            self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
            self.assertEqual(weekly_totals(data, result), {"2026-11-02": 2520})
            self.assertEqual(data, before)

    def test_short_reference_keeps_five_days_and_two_rests_without_full_time_hours(self):
            data = fixture(hours=42)
            data["simulation"] = True
            data["employees"][0]["simulationDailyMinutes"] = 240
            data["shifts"][0]["segments"] = [{"start": 480, "end": 720, "kind": "WORK"}]
            result = solve(data)
            self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
            self.assertEqual(weekly_totals(data, result), {"2026-11-02": 1200})
            self.assertEqual(sum(a["kind"] == "OFF" for a in result["assignments"]), 2)
