from optimization import ImprovementContext
"""Sector repair targets real empty operating days without weakening protection."""
import time
import unittest
from ortools.sat.python import cp_model
from optimization import improve
from solver import _repair_clock_fixes, _rest_repair_groups
from test_solver import fixture


class SectorRepairTests(unittest.TestCase):
    def test_large_uniform_sector_is_not_excluded_by_the_old_mixed_size_limit(self):
        data = fixture(42, people=26)
        model = cp_model.CpModel()
        day = "2026-11-08"
        work = {(p["id"], day): model.new_bool_var(p["id"]) for p in data["employees"]}
        values = {v.index: 0 for v in work.values()}
        groups = _rest_repair_groups(data["employees"], [day], work, {}, values,
                                     data["policy"], [{"sector": "Reposição", "date": day, "minimum": 3}])
        self.assertEqual(groups, [{p["id"] for p in data["employees"]}])

    def test_presence_only_manager_does_not_hide_an_empty_timed_sector(self):
        data = fixture(42, people=3)
        data["employees"][-1].update(scheduleMode="UNTIMED", shiftIds=[])
        model = cp_model.CpModel()
        day = "2026-11-08"
        work = {(p["id"], day): model.new_bool_var(p["id"]) for p in data["employees"]}
        values = {v.index: int(pid == "p2") for (pid, _), v in work.items()}
        groups = _rest_repair_groups(data["employees"], [day], work, {}, values,
                                     data["policy"], [{"sector": "Reposição", "date": day, "minimum": 2}])
        self.assertEqual(groups, [{"p0", "p1", "p2"}])
        data["employees"][0]["scheduleMode"] = "MISSING"
        self.assertEqual(_rest_repair_groups(data["employees"], [day], work, {}, values,
                                            data["policy"], [{"sector": "Reposição", "date": day, "minimum": 2}]), [{"p0", "p1", "p2"}])

    def test_zero_demand_absences_and_explicit_rests_do_not_create_a_repair(self):
        data = fixture(42, people=3)
        model = cp_model.CpModel()
        day = "2026-11-08"
        work = {(p["id"], day): model.new_bool_var(p["id"]) for p in data["employees"]}
        values = {v.index: 0 for v in work.values()}
        demand = {"sector": "Reposição", "date": day, "minimum": 0}
        self.assertEqual(_rest_repair_groups(data["employees"], [day], work, {}, values,
                                            data["policy"], [demand]), [])
        demand["minimum"] = 1
        baseline = {(p["id"], day): {"kind": "ABSENCE"} for p in data["employees"]}
        self.assertEqual(_rest_repair_groups(data["employees"], [day], work, baseline, values,
                                            data["policy"], [demand]), [])
        for person in data["employees"]:
            person["fixedOffDays"] = [6]
        self.assertEqual(_rest_repair_groups(data["employees"], [day], work, {}, values,
                                            data["policy"], [demand]), [])

    def test_clock_repair_preserves_the_incumbent_and_one_choice_per_duration(self):
        model = cp_model.CpModel()
        options = {sid: model.new_bool_var(sid) for sid in ("early", "late", "long")}
        values = {options["early"].index: 0, options["late"].index: 1,
                  options["long"].index: 0}
        fixes = _repair_clock_fixes({("p", "2026-11-08"): options},
                                   {"early": (480, 480, 1020), "late": (480, 540, 1080),
                                    "long": (540, 480, 1200)}, values)
        self.assertEqual(fixes, {options["early"].index: 0})
        self.assertTrue(all(values[index] == value for index, value in fixes.items()))

    def test_large_repair_does_not_apply_clock_fixes_to_another_sector(self):
        model = cp_model.CpModel()
        first = model.new_bool_var("first")
        other = model.new_bool_var("other")
        initial = {first.index: 0, other.index: 1}
        values, _, phases = improve(
            model, [other - first], initial, time.monotonic() + 4, ["COVERAGE"],
            context=ImprovementContext(protected_groups={"COVERAGE": [-first, other]},
            decision_variables={first.index: ("first", "2026-11-08"),
                                other.index: ("other", "2026-11-08")},
            initial_repair_groups=[{"first"}, {"other", *(f"peer{i}" for i in range(16))}],
            repair_clock_fixes={first.index: 0}))
        self.assertEqual([p["incumbentValue"] for p in phases[:2]], [0, -1])
        self.assertEqual(values, {first.index: 1, other.index: 0})

    def test_separate_neighborhoods_keep_every_prior_sector_and_sunday_bound(self):
        model = cp_model.CpModel()
        a, b, protected = [model.new_bool_var(name) for name in ("a", "b", "protected")]
        initial = {a.index: 1, b.index: 1, protected.index: 0}
        values, _, phases = improve(
            model, [a + b - protected], initial, time.monotonic() + 4, ["COVERAGE"],
            context=ImprovementContext(protected_groups={"COVERAGE": [a, b, protected]},
            decision_variables={v.index: (v.name, "2026-11-08") for v in (a, b, protected)},
            initial_repair_groups=[{"a"}, {"b"}]))
        self.assertEqual([p["searchScope"] for p in phases[:2]],
                         ["SELECTED_PEOPLE", "SELECTED_PEOPLE"])
        self.assertEqual([p["incumbentValue"] for p in phases[:2]], [1, 0])
        self.assertEqual(values, {a.index: 0, b.index: 0, protected.index: 0})


if __name__ == "__main__":
    unittest.main()
