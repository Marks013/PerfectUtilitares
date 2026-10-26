import copy
import json
import unittest
from unittest.mock import patch
from datetime import date, timedelta

from solver import solve


def fixture(hours=42, people=1, weeks=1):
    start = date(2026, 11, 2)
    minutes = hours * 12
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
                  "fixedOffDays": [], "offPattern": "ANY", "maxConsecutiveSundays": 2,
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


class SolverTests(unittest.TestCase):
    def assert_feasible(self, result):
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"), result)

    def test_exact_contracts(self):
        for hours in (40, 42, 44):
            data = fixture(hours)
            result = solve(data)
            self.assert_feasible(result)
            self.assertEqual(sum(a["kind"] == "WORK" for a in result["assignments"]), 5)
            self.assertEqual(sum(a["kind"] == "OFF" for a in result["assignments"]), 2)
            self.assertEqual(5 * hours * 12, hours * 60)

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
