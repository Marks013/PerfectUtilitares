"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
from solver import solve
import copy
import unittest

class RestOnlyTests(unittest.TestCase):
    def test_current_mode_keeps_clock_alternatives_but_rest_only_does_not(self):
        data = fixture(40)
        later = copy.deepcopy(data["shifts"][0])
        later["id"] = "later"
        for segment in later["segments"]:
            segment["start"] += 120
            segment["end"] += 120
        data["shifts"].append(later)
        data["employees"][0]["shiftIds"].append("later")
        data["demands"] = [{"sector": "Reposição", "date": "2026-11-05",
                            "start": 1080, "end": 1140, "minimum": 1}]
        self.assertIn(solve(data)["status"], ("FEASIBLE", "OPTIMAL"))
        data["generationMode"] = "REST_ONLY"
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
