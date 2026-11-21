from optimization import ImprovementContext
"""Sector repair targets real empty operating days without weakening protection."""
import time
import unittest
from unittest.mock import patch
from ortools.sat.python import cp_model
from optimization import Snapshot, improve
from solver import _repair_clock_fixes, _rest_repair_groups, days_between, solve
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

    def test_empty_sunday_repair_starts_from_saved_service_and_preserves_priorities(self):
        data = fixture(40, people=2)
        data["restRulesVersion"] = 3
        data["employees"][1]["role"] = "Atendente"
        days = days_between(data["startDate"], data["endDate"])
        data["assignments"] = [
            {"employeeId": person["id"], "date": day, "kind": "OFF"}
            if index in (1, 6) else
            {"employeeId": person["id"], "date": day, "kind": "WORK", "shiftId": "day"}
            for person in data["employees"] for index, day in enumerate(days)]
        data["assignments"][0]["locked"] = True
        data["demands"] = [
            {"id": str(index), "date": day, "sector": "Reposição", "start": 480,
             "end": 720, "minimum": 2 if index == 4 else 1, "estimated": True}
            for index, day in enumerate(days) if index != 1]
        data["movementPriorities"] = [{"startDate": days[4], "endDate": days[4], "level": "HIGH"}]

        def inspect(model, objectives, values, deadline, names, *, context):
            # An empty Sunday used to replace the complete saved sector before
            # this point and freeze coverage relative to a different baseline.
            self.assertEqual(Snapshot(values).value(sum(context.sunday_coverage["Reposição"])), 240)
            self.assertIn(("Reposição", days[6]), context.sunday_recovery)
            return improve(model, objectives, values, deadline, names, context=context)

        with patch("solver.improve", side_effect=inspect) as refine:
            result = solve(data)
        refine.assert_called_once()
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertIn(data["assignments"][0], result["assignments"])
        for demand in data["demands"]:
            work = sum(entry["kind"] == "WORK" and entry["date"] == demand["date"]
                       for entry in result["assignments"])
            self.assertGreaterEqual(work, demand["minimum"], demand["date"])

    def test_repair_gives_empty_open_sunday_a_slot_before_ordinary_shortages(self):
        data = fixture(40, people=10)
        people = data["employees"]
        people[-1]["sector"] = "Padaria"
        model = cp_model.CpModel()
        day = "2026-11-08"
        work = {(person["id"], day): model.new_bool_var(person["id"]) for person in people}
        values = {variable.index: int(person != "p9") for (person, _), variable in work.items()}
        demands = [{"sector": sector, "date": day, "minimum": 2}
                   for sector in ("Reposição", "Padaria")]
        groups = _rest_repair_groups(people, [day], work, {}, values, data["policy"], demands,
                                     sector_shortages={"Reposição": [2000], "Padaria": [500]},
                                     priority_sundays={("Padaria", day)})
        self.assertEqual(groups[0], {"p9"})

    def test_later_preference_cannot_undo_recovered_timed_service(self):
        model = cp_model.CpModel()
        sunday, weekday = [model.new_bool_var(day) for day in ("sunday", "weekday")]
        model.add(sunday + weekday <= 1)

        class ChooseSundayOnCoverage:
            first = True

            def checkpoint(self):
                pass

            def solve(self, engine, search_model):
                if self.first:
                    self.first = False
                    # Select one of two equally good coverage outcomes with a
                    # real solver, without relying on its tie-breaking order.
                    search_model = search_model.clone()
                    search_model.add(sunday == 1)
                return engine.solve(search_model)

        values, _, phases = improve(
            model, [1 - sunday - weekday, sunday], {sunday.index: 0, weekday.index: 0},
            time.monotonic() + 3, ["COVERAGE", "PREFERENCES"],
            context=ImprovementContext(control=ChooseSundayOnCoverage(),
                                       sunday_recovery={("Padaria", "2026-11-08"): sunday}))
        self.assertEqual([phase["objective"] for phase in phases], ["COVERAGE", "PREFERENCES"])
        self.assertEqual(values, {sunday.index: 1, weekday.index: 0})

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
