import copy
import unittest

from solver import solve
from test_solver import fixture


def mixed_fixture(start="2027-01-04", people=1):
    data = fixture(42, people=people, start_date=start, shift_hours=40)
    data.update(simulation=True, mixed42Sectors=["Reposição"])
    data["policy"]["dailyLimitMinutes"] = 528
    data["shifts"].append({"id": "long", "name": "9h", "segments": [
        {"start": 480, "end": 750, "kind": "WORK"},
        {"start": 750, "end": 930, "kind": "BREAK"},
        {"start": 930, "end": 1200, "kind": "WORK"},
    ]})
    for person in data["employees"]:
        person["shiftIds"].append("long")
    return data


def locked(day, kind="WORK", sid="long"):
    row = {"employeeId": "p0", "date": day, "kind": kind, "locked": True}
    if kind == "WORK":
        row["shiftId"] = sid
    return row


class Mixed42Test(unittest.TestCase):
    def test_two_long_days_cover_late_demand_without_changing_other_sector(self):
        data = mixed_fixture(people=2)
        other = data["employees"][1]
        other["sector"] = "Caixas"
        data["shifts"].append({"id": "uniform", "name": "8h24", "segments": [
            *data["shifts"][0]["segments"][:2], {"start": 780, "end": 1044, "kind": "WORK"},
        ]})
        other["shiftIds"] = ["uniform", "long"]
        days = ["2027-01-05", "2027-01-07"]
        data["demands"] = [{"date": day, "sector": "Reposição", "start": 1140, "end": 1200,
                            "minimum": 1} for day in days]
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        work = [a for a in result["assignments"] if a["kind"] == "WORK"]
        self.assertEqual([a["date"] for a in work if a.get("shiftId") == "long"], days)
        self.assertCountEqual([a["shiftId"] for a in work if a["employeeId"] == "p0"],
                              ["day"] * 3 + ["long"] * 2)
        self.assertEqual([a["shiftId"] for a in work if a["employeeId"] == "p1"], ["uniform"] * 5)

    def test_partial_week_preserves_absence_and_never_allows_three_locked_long_days(self):
        data = mixed_fixture()
        absence = locked("2027-01-06", "ABSENCE")
        data["assignments"] = [absence, locked("2027-01-04"), locked("2027-01-05")]
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        self.assertIn(absence, result["assignments"])
        self.assertEqual(sum(a.get("shiftId") == "long" for a in result["assignments"]), 2)
        data["assignments"].append(locked("2027-01-08"))
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_invalid_break_or_blocks_cannot_override_the_daily_limit(self):
        for start, end in [(750, 900), (735, 915)]:
            with self.subTest(start=start, end=end):
                data = mixed_fixture()
                segments = data["shifts"][1]["segments"]
                segments[0]["end"] = start
                segments[1].update(start=start, end=end)
                segments[2].update(start=end, end=end + 1020 - start)
                data["assignments"] = [locked("2027-01-05")]
                self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_no_override_outside_scope_or_in_40_hour_week(self):
        for field, value in [("mixed42Sectors", ["reposiçao"]),
                             ("defaultWeeklyHours", 44), ("simulationDailyMinutes", 480)]:
            with self.subTest(field=field):
                data = mixed_fixture()
                (data["employees"][0] if field == "simulationDailyMinutes" else data)[field] = value
                data["assignments"] = [locked("2027-01-05")]
                self.assertEqual(solve(data)["status"], "INFEASIBLE")
        operational = mixed_fixture()
        operational["simulation"] = False
        original_policy = copy.deepcopy(operational["policy"])
        self.assertIn(solve(operational)["status"], ("FEASIBLE", "OPTIMAL"))
        self.assertEqual(operational["policy"], original_policy)
        data = mixed_fixture(start="2027-12-13")
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        self.assertEqual([a["shiftId"] for a in result["assignments"] if a["kind"] == "WORK"], ["day"] * 5)
        data["assignments"] = [locked("2027-12-13")]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
