"""Regression cases for supermarket model limits, independent of branch identifiers."""
import copy
import unittest
from datetime import date, timedelta

from solver import admissible, solve
from test_solver import fixture


class ModelRuleTests(unittest.TestCase):
    def test_legacy_six_day_cap_cannot_allow_six_across_weeks(self):
        data = fixture(42, weeks=2)
        data["policy"]["maxConsecutiveWorkDays"] = 6
        # Thursday through the following Tuesday: each calendar week could still have five days.
        data["assignments"] = [{"employeeId": "p0", "date": (date(2026, 11, 5) + timedelta(days=offset)).isoformat(),
                                "kind": "WORK", "shiftId": "day", "locked": True} for offset in range(6)]
        before = copy.deepcopy(data)
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        self.assertEqual(data, before)

    def test_known_previous_month_five_days_force_a_rest_on_first_day(self):
        data = fixture(42, start_date="2026-11-02")
        person = data["employees"][0]
        person["history"] = [{"employeeId": "p0", "date": (date(2026, 10, 28) + timedelta(days=offset)).isoformat(),
                               "kind": "WORK", "shiftId": "day"} for offset in range(5)]
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(result["assignments"][0]["kind"], "OFF")

    def test_short_pause_opt_in_is_simulation_only_and_not_a_daily_cap(self):
        policy = fixture()["policy"]
        shift = {"id": "short", "name": "Curto", "segments": [{"start": 480, "end": 780, "kind": "WORK"}]}
        self.assertFalse(admissible(shift, policy, "2026-11-02"))
        policy["allowShortMealSimulation"] = True
        self.assertFalse(admissible(shift, policy, "2026-11-02"))
        policy["_simulation"] = True
        self.assertTrue(admissible(shift, policy, "2026-11-02"))
        shift["segments"][0]["end"] = 840  # Exactly six hours is still the short-journey threshold.
        self.assertTrue(admissible(shift, policy, "2026-11-02"))
        shift["segments"][0]["end"] = 841
        self.assertFalse(admissible(shift, policy, "2026-11-02"))
        policy["allowShortMealSimulation"] = False
        shift["segments"][0]["end"] = 720
        self.assertTrue(admissible(shift, policy, "2026-11-02"))

    def test_short_pause_opt_in_produces_real_complete_assignments(self):
        data = fixture(42)
        data["simulation"] = True
        data["employees"][0]["simulationDailyMinutes"] = 300
        data["shifts"][0]["segments"] = [{"start": 480, "end": 780, "kind": "WORK"}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        data["policy"]["allowShortMealSimulation"] = True
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(sum(entry["kind"] == "WORK" for entry in result["assignments"]), 5)
        self.assertEqual(sum(entry["kind"] == "OFF" for entry in result["assignments"]), 2)
        data["assignments"] = [{"employeeId": "p0", "date": data["startDate"], "kind": "ABSENCE"}]
        result = solve(data)
        self.assertEqual(result["assignments"][0]["kind"], "ABSENCE")

    def test_absent_week_remains_absent_without_fictitious_rest(self):
        data = fixture(42)
        data["assignments"] = [{"employeeId": "p0", "date": (date(2026, 11, 2) + timedelta(days=offset)).isoformat(),
                                "kind": "ABSENCE"} for offset in range(7)]
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertTrue(all(entry["kind"] == "ABSENCE" for entry in result["assignments"]))


if __name__ == "__main__":
    unittest.main()
