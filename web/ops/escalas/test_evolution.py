"""Regressions for documentary references and explainable production solving."""
import copy
import unittest

from solver import admissible, maximum_meal_minutes, solve
from test_solver import fixture


class EvolutionTests(unittest.TestCase):
    def test_expired_collective_reference_does_not_prevent_planning(self):
        data = fixture(40, start_date="2027-06-07")
        data["policy"]["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
        data["policy"]["reviewed"] = False
        data["policy"]["source"] = ""
        before = copy.deepcopy(data)
        self.assertTrue(admissible(data["shifts"][0], data["policy"], data["startDate"]))
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        self.assertEqual(data, before)
        self.assertEqual(len(result["assignments"]), 7)

    def test_selected_long_meal_is_not_blocked_by_documentary_metadata(self):
        policy = fixture()["policy"]
        policy["mealIntervalAgreement"] = {"maximumMinutes": 180, "reviewed": False,
                                            "source": "", "reviewedBy": "",
                                            "validFrom": "2026-01-01", "validUntil": "2026-05-31"}
        self.assertEqual(maximum_meal_minutes(policy, "2026-11-03"), 180)
        policy["mealIntervalAgreement"]["maximumMinutes"] = 361
        self.assertEqual(maximum_meal_minutes(policy, "2026-11-03"), 120)

    def test_fixed_rests_conflicting_with_five_days_have_a_safe_diagnosis(self):
        data = fixture(40)
        data["employees"][0]["fixedOffDays"] = list(range(7))
        result = solve(data)
        self.assertEqual(result["status"], "INFEASIBLE", result)
        self.assertTrue(result.get("solverDiagnostics"), result)
        families = {item["family"] for item in result["solverDiagnostics"]}
        self.assertTrue(families & {"DAYS_WORKED", "AVAILABILITY", "BLOCKS"}, families)
        self.assertNotIn("Colaborador", str(result["solverDiagnostics"]))
        self.assertLessEqual(result["wallTimeSeconds"], 12.5)

    def test_operational_daily_ceiling_is_not_relaxed(self):
        data = fixture(42)
        data["policy"]["dailyLimitMinutes"] = 480
        result = solve(data)
        self.assertEqual(result["status"], "INFEASIBLE")

    def test_solver_reports_stage_timings_without_claiming_a_global_optimum(self):
        result = solve(fixture(40))
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"))
        metadata = result["optimization"]
        for key in ("constructionSeconds", "feasibilitySeconds", "refinementSeconds"):
            self.assertGreaterEqual(metadata[key], 0)
        self.assertIn(metadata["stopReason"], ("OBJECTIVES_PROVEN", "BOUNDED_REFINEMENT", "TIME_BUDGET"))


if __name__ == "__main__":
    unittest.main()
