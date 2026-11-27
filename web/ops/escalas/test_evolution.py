"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
from solver import solve
import unittest

class EvolutionTests(unittest.TestCase):
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
