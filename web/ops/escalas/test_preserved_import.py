"""Compatible imported clocks are fixed; shortages never authorize replacement."""
import copy
import unittest
from solver import solve
from test_solver import fixture


def imported_data():
    data = fixture(40)
    data["generationMode"] = "DAYS_AND_HOURS"
    later = copy.deepcopy(data["shifts"][0])
    later["id"] = "later"
    for segment in later["segments"]:
        segment["start"] += 120
        segment["end"] += 120
    data["shifts"].append(later)
    data["employees"][0]["shiftIds"] = ["later", "day"]
    data["employees"][0]["fixedImportedShiftId"] = "day"
    return data


class PreservedImportTests(unittest.TestCase):
    def test_estimated_shortage_does_not_move_an_imported_clock(self):
        data = imported_data()
        data["demands"] = [{"sector": "Reposição", "date": "2026-11-05",
                            "start": 1080, "end": 1140, "minimum": 1, "estimated": True}]
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        self.assertTrue(all(a["shiftId"] == "day" for a in result["assignments"] if a["kind"] == "WORK"))
        self.assertEqual(data, before)
        demand = data["demands"][0]
        shifts = {s["id"]: s for s in data["shifts"]}
        present = sum(1 for a in result["assignments"] if a["date"] == demand["date"] and a["kind"] == "WORK"
                      and any(p["kind"] == "WORK" and p["start"] <= demand["start"] and p["end"] >= demand["end"]
                              for p in shifts[a["shiftId"]]["segments"]))
        self.assertEqual(present, 0)

    def test_required_coverage_reports_conflict_instead_of_substituting_the_clock(self):
        data = imported_data()
        data["demands"] = [{"sector": "Reposição", "date": "2026-11-05",
                            "start": 1080, "end": 1140, "minimum": 1}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_different_locked_clock_is_allowed_only_on_the_locked_date(self):
        data = imported_data()
        locked = {"employeeId": "p0", "date": "2026-11-02", "kind": "WORK", "shiftId": "later", "locked": True}
        absent = {"employeeId": "p0", "date": "2026-11-03", "kind": "ABSENCE", "locked": True}
        data["assignments"] = [locked, absent]
        data["demands"] = [{"sector": "Reposição", "date": "2026-11-05",
                            "start": 1080, "end": 1140, "minimum": 1, "estimated": True}]
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        assignments = {a["date"]: a for a in result["assignments"]}
        self.assertEqual(assignments[locked["date"]], locked)
        self.assertEqual(assignments[absent["date"]], absent)
        for assignment in result["assignments"]:
            if assignment["kind"] == "WORK" and assignment["date"] != locked["date"]:
                self.assertEqual(assignment["shiftId"], "day")


if __name__ == "__main__":
    unittest.main()
