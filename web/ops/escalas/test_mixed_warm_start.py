from optimization import ImprovementContext
"""Mixed warm starts preserve the incumbent and stagger free weekly rests."""
import copy
import time
import unittest
from collections import Counter
from datetime import date
from unittest.mock import patch

from ortools.sat.python import cp_model
import solver
from hints import balanced_rest_hints, _mixed_week_variants
from optimization import improve
from test_solver import fixture


def mixed_data(people=4, weeks=2):
    data = fixture(42, people=people, weeks=weeks, shift_hours=40)
    data.update(simulation=True, mixed42Sectors=["Reposição"])
    data["shifts"].append({"id": "long", "name": "9h", "segments": [
        {"start": 480, "end": 750, "kind": "WORK"},
        {"start": 750, "end": 930, "kind": "BREAK"},
        {"start": 930, "end": 1200, "kind": "WORK"},
    ]})
    dates = solver.days_between(data["startDate"], data["endDate"])
    for person in data["employees"]:
        person["shiftIds"].append("long")
        for day in dates:
            weekday = date.fromisoformat(day).weekday()
            row = {"employeeId": person["id"], "date": day,
                   "kind": "OFF" if weekday >= 5 else "WORK"}
            if weekday < 5:
                row["shiftId"] = "long" if weekday < 2 else "day"
            data["assignments"].append(row)
    return data, dates


class MixedWarmStartTests(unittest.TestCase):
    def test_staggers_a_synchronized_baseline_without_losing_weekly_shape(self):
        data, dates = mixed_data(weeks=4)
        before = copy.deepcopy(data)
        people = data["employees"]
        metrics = {s["id"]: solver.shift_metrics(s) for s in data["shifts"]}
        baseline = {(a["employeeId"], a["date"]): a for a in data["assignments"]}
        active = {p["id"]: dates for p in people}
        choices = {(p["id"], day): dict.fromkeys(p["shiftIds"])
                   for p in people for day in dates}
        policy = {**data["policy"], "_simulation": True}
        proposals = balanced_rest_hints(
            people, dates, active, baseline, choices, metrics, policy,
            solver.instant, solver.sunday_limit,
            mixed_people={p["id"] for p in people})
        self.assertEqual(set(proposals), set(active))
        for entries in proposals.values():
            for offset in range(0, len(dates), 7):
                week = [entries[day] for day in dates[offset:offset + 7]]
                self.assertEqual(Counter(entry["kind"] for entry in week),
                                 {"WORK": 5, "OFF": 2})
                durations = Counter(metrics[e["shiftId"]][0] for e in week
                                    if e["kind"] == "WORK")
                self.assertEqual(durations, {480: 3, 540: 2})
        empty = [day for day in dates if all(p[day]["kind"] == "OFF"
                                             for p in proposals.values())]
        self.assertEqual(empty, [])
        self.assertEqual(data, before)

    def test_mixed_variants_keep_absence_and_locked_clock(self):
        entries = {f"2026-11-0{day}": {"kind": "WORK", "shiftId": "day"}
                   for day in range(2, 7)}
        entries["2026-11-02"] = {"kind": "ABSENCE"}
        metrics = {"day": (480, 480, 1020), "long": (540, 480, 1200)}
        choices = {("p", day): {"day": None, "long": None} for day in entries}
        baseline = {("p", "2026-11-03"): {"kind": "WORK", "shiftId": "long", "locked": True}}
        variants = list(_mixed_week_variants(entries, choices, metrics, baseline, "p"))
        self.assertTrue(variants)
        for variant in variants:
            self.assertEqual(variant["2026-11-02"], {"kind": "ABSENCE"})
            self.assertEqual(variant["2026-11-03"]["shiftId"], "long")
            self.assertEqual(sum(e.get("shiftId") == "long" for e in variant.values()), 2)

    def test_alternate_hint_cannot_replace_or_relax_the_feasible_reference(self):
        model = cp_model.CpModel()
        sunday = model.new_bool_var("sunday-gap")
        sector = model.new_bool_var("sector-gap")
        objective = model.new_int_var(0, 2, "coverage")
        model.add(objective == sunday + sector)
        values = {sunday.index: 1, sector.index: 0, objective.index: 1}
        actual, _, _ = improve(
            model, [objective], values, time.monotonic() + 1, ["COVERAGE"],
            context=ImprovementContext(protected_groups={"COVERAGE": [sunday, sector]},
            decision_variables={sunday.index: ("p", "2026-11-08"),
                                sector.index: ("q", "2026-11-08")},
            initial_decision_hints={sunday.index: 1, sector.index: 1}))
        self.assertEqual(actual[sector.index], 0)
        self.assertLessEqual(actual[sunday.index], values[sunday.index])
        self.assertLessEqual(actual[objective.index], values[objective.index])

    def test_repair_keeps_other_people_fixed_before_global_search(self):
        model = cp_model.CpModel()
        small = model.new_bool_var("small-gap")
        other = model.new_bool_var("other-gap")
        initial = {small.index: 1, other.index: 1}
        values, _, phases = improve(
            model, [small + other], initial, time.monotonic() + 3, ["COVERAGE"],
            context=ImprovementContext(protected_groups={"COVERAGE": [small, other]},
            decision_variables={small.index: ("small", "2026-11-08"),
                                other.index: ("other", "2026-11-08")},
            initial_repair_people={"small"}))
        self.assertEqual([phase["searchScope"] for phase in phases],
                         ["SELECTED_PEOPLE", "GLOBAL"])
        self.assertEqual([(phase["initialValue"], phase["incumbentValue"])
                          for phase in phases], [(2, 1), (1, 0)])
        self.assertEqual(values, {small.index: 0, other.index: 0})

    def test_solver_keeps_synchronized_baseline_as_values_but_hints_an_alternative(self):
        data, _dates = mixed_data()
        captured = {}

        def inspect(model, objectives, values, deadline, names, **kwargs):
            overrides = kwargs["context"].initial_decision_hints
            captured["changed"] = sum(values[index] != value
                                      for index, value in overrides.items())
            captured["initial"] = copy.deepcopy(values)
            captured["guards"] = kwargs["context"].protected_groups
            return values, False, []

        with patch("solver.improve", side_effect=inspect):
            result = solver.solve(data)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertGreater(captured["changed"], 0)
        self.assertTrue(captured["guards"])
        self.assertEqual(result["assignments"], data["assignments"])


if __name__ == "__main__":
    unittest.main()
