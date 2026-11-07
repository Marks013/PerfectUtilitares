"""Rest-only generation uses one selected clock per duration, except locked dates."""
import copy
import unittest
from solver import solve
from test_solver import fixture
from test_mixed_warm_start import mixed_data


class RestOnlyTests(unittest.TestCase):
    def test_locked_mixed_extra_is_not_an_alternative_for_other_days(self):
        data, _dates = mixed_data(people=1, weeks=2)
        data["generationMode"] = "REST_ONLY"
        for reference, extra in (("day", "later-day"), ("long", "later-long")):
            shift = copy.deepcopy(next(s for s in data["shifts"] if s["id"] == reference))
            shift["id"] = extra
            for segment in shift["segments"]:
                segment["start"] += 30
                segment["end"] += 30
            data["shifts"].append(shift)
            data["employees"][0]["shiftIds"].append(extra)
        locked = next(a for a in data["assignments"] if a["date"] == "2026-11-02")
        locked.update(shiftId="later-long", locked=True)
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        for assignment in result["assignments"]:
            if assignment["date"] == locked["date"]:
                self.assertEqual(assignment, locked)
            elif assignment["kind"] == "WORK":
                self.assertIn(assignment["shiftId"], ("day", "long"))
        durations = {s["id"]: sum(p["end"] - p["start"] for p in s["segments"] if p["kind"] != "BREAK")
                     for s in data["shifts"]}
        for offset in (0, 7):
            work = [a for a in result["assignments"][offset:offset + 7] if a["kind"] == "WORK"]
            self.assertEqual(sorted(durations[a["shiftId"]] for a in work), [480, 480, 480, 540, 540])

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


if __name__ == "__main__":
    unittest.main()
