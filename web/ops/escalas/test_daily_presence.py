"""Daily timed presence must not disappear while rest and clock goals improve."""
import time
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model

from optimization import improve
from solver import _preserve_daily_timed_presence, solve
from test_solver import fixture


class DailyTimedPresenceTests(unittest.TestCase):
    def reference(self):
        data = fixture(42, people=4)
        data["employees"][2].update(scheduleMode="UNTIMED", shiftIds=[])
        data["employees"][3].update(scheduleMode="MISSING", shiftIds=[])
        model = cp_model.CpModel()
        day = "2026-11-04"  # Wednesday, not covered by the Sunday guard.
        work = {(person["id"], day): model.new_bool_var(person["id"])
                for person in data["employees"]}
        choices = {}
        for person in data["employees"]:
            key = person["id"], day
            choices[key] = {}
            if person["shiftIds"]:
                shift = model.new_bool_var("shift:" + person["id"])
                choices[key]["day"] = shift
                model.add(work[key] == shift)
        values = {variable.index: int(variable.name in ("p0", "shift:p0", "p2", "p3"))
                  for variable in [model.get_int_var_from_proto_index(index)
                                   for index in range(len(model.proto.variables))]}
        demands = [{"sector": "Reposição", "date": day, "minimum": 1, "estimated": True}]
        return data, model, day, work, choices, values, demands

    def guard(self, data, model, day, work, choices, values, demands):
        _preserve_daily_timed_presence(model, data["employees"], [day], choices,
                                       {shift["id"]: shift for shift in data["shifts"]}, demands, values)

    def test_weekday_timed_staff_cannot_all_take_off_even_with_duty_present(self):
        args = self.reference()
        data, model, day, work, choices, values, demands = args
        self.guard(*args)
        model.add(work["p0", day] == 0)
        model.add(work["p1", day] == 0)
        model.add(work["p2", day] == 1)
        model.add(work["p3", day] == 1)
        self.assertEqual(cp_model.CpSolver().solve(model), cp_model.INFEASIBLE)

    def test_duty_only_incumbent_does_not_invent_timed_presence(self):
        args = self.reference()
        data, model, day, work, choices, values, demands = args
        values[work["p0", day].index] = values[choices["p0", day]["day"].index] = 0
        before = len(model.proto.constraints)
        self.guard(*args)
        self.assertEqual(len(model.proto.constraints), before)
        for pid in ("p0", "p1"):
            model.add(work[pid, day] == 0)
        self.assertEqual(cp_model.CpSolver().solve(model), cp_model.OPTIMAL)

    def test_unmatched_demand_does_not_create_a_hard_floor(self):
        for change in ({"date": "2026-11-05"}, {"sector": "Other"}):
            with self.subTest(change=change):
                args = self.reference()
                data, model, day, work, choices, values, demands = args
                demands[0].update(change)
                self.guard(*args)
                for variable in work.values():
                    model.add(variable == 0)
                self.assertEqual(cp_model.CpSolver().solve(model), cp_model.OPTIMAL)

    def test_zero_target_cannot_erase_existing_timed_presence(self):
        args = self.reference()
        data, model, day, work, choices, values, demands = args
        demands[0]['minimum'] = 0
        self.guard(*args)
        for variable in work.values():
            model.add(variable == 0)
        self.assertEqual(cp_model.CpSolver().solve(model), cp_model.INFEASIBLE)

    def test_active_timed_choices_only_and_no_new_variables(self):
        args = self.reference()
        data, model, day, work, choices, values, demands = args
        choices["p1", day] = {}
        data["employees"].append({"id": "inactive", "sector": "Reposição"})
        before = len(model.proto.variables)
        self.guard(*args)
        self.assertEqual(len(model.proto.variables), before)
        model.add(work["p0", day] == 0)
        model.add(work["p1", day] == 1)
        self.assertEqual(cp_model.CpSolver().solve(model), cp_model.INFEASIBLE)

    def test_same_valid_seed_witnesses_feasibility_with_absence_and_locked_rest(self):
        args = self.reference()
        data, model, day, work, choices, values, demands = args
        # These existing constraints model unavailable/locked staff. The guard
        # adds no new eligibility and never changes those hard decisions.
        model.add(work["p1", day] == 0)
        model.add(work["p2", day] == 1)
        model.add(work["p3", day] == 1)
        self.guard(*args)
        for index, value in values.items():
            model.add(model.get_int_var_from_proto_index(index) == value)
        self.assertEqual(cp_model.CpSolver().solve(model), cp_model.OPTIMAL)

    def test_coverage_repair_cannot_trade_a_staffed_day_for_an_empty_day(self):
        args = self.reference()
        data, model, day, work, choices, values, demands = args
        other = "2026-11-05"
        for pid in ("p0", "p1"):
            variable = model.new_bool_var(pid + ":other")
            work[pid, other] = variable
            choices[pid, other] = {"day": variable}
            values[variable.index] = 0
            model.add(work[pid, day] + variable == 1)
        demands.append({"sector": "Reposição", "date": other, "minimum": 1})
        _preserve_daily_timed_presence(model, data["employees"], [day, other], choices,
                                       {shift["id"]: shift for shift in data["shifts"]}, demands, values)
        objective = 2 * sum(work[pid, day] for pid in ("p0", "p1")) - sum(
            work[pid, other] for pid in ("p0", "p1"))
        result, _, _ = improve(model, [objective], values, time.monotonic() + 2, ["COVERAGE"])
        self.assertGreaterEqual(sum(result[work[pid, day].index] for pid in ("p0", "p1")), 1)
        self.assertEqual(sum(result[work[pid, other].index] for pid in ("p0", "p1")), 1)

    def test_solve_installs_guard_from_verified_seed_before_improve(self):
        data = fixture(42, people=2)
        data["assignments"] = [
            {"employeeId": "p0", "date": "2026-11-04", "kind": "ABSENCE", "locked": True},
            {"employeeId": "p1", "date": "2026-11-05", "kind": "OFF", "locked": True},
        ]
        data["demands"] = [{"sector": "Reposição", "date": "2026-11-04", "minimum": 1,
                            "start": 480, "end": 720, "estimated": True}]
        seeds = []

        def guard(model, employees, dates, choices, shifts, demands, values, control):
            _preserve_daily_timed_presence(model, employees, dates, choices, shifts, demands, values, control)
            seeds.append(dict(values))

        def keep_seed(model, objectives, values, *args, **kwargs):
            self.assertTrue(seeds)
            for index, value in values.items():
                model.add(model.get_int_var_from_proto_index(index) == value)
            self.assertEqual(cp_model.CpSolver().solve(model), cp_model.OPTIMAL)
            return values, False, []

        with patch("solver._preserve_daily_timed_presence", side_effect=guard), \
                patch("solver.improve", side_effect=keep_seed):
            result = solve(data)
        self.assertEqual(result["status"], "FEASIBLE")
        entries = {(entry["employeeId"], entry["date"]): entry for entry in result["assignments"]}
        self.assertEqual(entries["p0", "2026-11-04"]["kind"], "ABSENCE")
        self.assertEqual(entries["p1", "2026-11-05"]["kind"], "OFF")

    def test_overnight_work_preserves_presence_on_the_following_civil_day(self):
        args = self.reference()
        data, model, day, work, choices, values, demands = args
        data["shifts"][0]["segments"] = [{"start": 1380, "end": 1500, "kind": "WORK"}]
        demands[0]["date"] = "2026-11-05"
        _preserve_daily_timed_presence(model, data["employees"], [day, "2026-11-05"], choices,
                                       {shift["id"]: shift for shift in data["shifts"]}, demands, values)
        for pid in ("p0", "p1"):
            model.add(work[pid, day] == 0)
        self.assertEqual(cp_model.CpSolver().solve(model), cp_model.INFEASIBLE)

    def test_overnight_break_does_not_create_work_presence(self):
        args = self.reference()
        data, model, day, work, choices, values, demands = args
        data["shifts"][0]["segments"] = [
            {"start": 1380, "end": 1440, "kind": "WORK"},
            {"start": 1440, "end": 1500, "kind": "BREAK"},
        ]
        demands[0]["date"] = "2026-11-05"
        before = len(model.proto.constraints)
        _preserve_daily_timed_presence(model, data["employees"], [day, "2026-11-05"], choices,
                                       {shift["id"]: shift for shift in data["shifts"]}, demands, values)
        self.assertEqual(len(model.proto.constraints), before)


if __name__ == "__main__":
    unittest.main()
