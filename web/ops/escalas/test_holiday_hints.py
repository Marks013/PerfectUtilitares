"""Synthetic holiday cohorts verify real seed feasibility, not production quality claims."""
import copy
import unittest
from unittest.mock import patch
from datetime import date
from ortools.sat.python import cp_model
import solver
from hints import balanced_rest_hints
from test_solver import fixture


def cohort(start, holidays, closed):
    data = fixture(42, people=30, weeks=4, start_date=start)
    data["simulation"] = True
    data["generationMode"] = "DAYS_AND_HOURS"
    data["policy"].update(holidayDates=holidays, authorizedHolidayDates=holidays,
                          closedDates=closed, paidHolidayDates=closed)
    for index, person in enumerate(data["employees"]):
        person.update(sector=f"Setor {index // 10}", fixedImportedShiftId="day",
                      maxConsecutiveSundays=1, sundayRestRule="PROTECTIVE")
    return data


def hints_for(data):
    dates = solver.days_between(data["startDate"], data["endDate"])
    active = {person["id"]: dates for person in data["employees"]}
    baseline = {(a["employeeId"], a["date"]): a for a in data["assignments"]}
    choices = {(person["id"], day): {"day": 1} for person in data["employees"] for day in dates}
    metrics = {shift["id"]: solver.shift_metrics(shift) for shift in data["shifts"]}
    policy = {**data["policy"], "_simulation": True}
    return balanced_rest_hints(data["employees"], dates, active, baseline, choices, metrics,
                               policy, solver.instant, solver.sunday_limit)


class HolidayHintTests(unittest.TestCase):
    def assert_seed(self, data):
        before = copy.deepcopy(data)
        proposals = hints_for(data)
        self.assertEqual(len(proposals), 30)
        dates = solver.days_between(data["startDate"], data["endDate"])
        closed = set(data["policy"]["paidHolidayDates"])
        for person in data["employees"]:
            entries = proposals[person["id"]]
            self.assertEqual(set(entries), set(dates))
            for offset in range(0, len(dates), 7):
                week = dates[offset:offset + 7]
                closed_weekdays = sum(day in closed and date.fromisoformat(day).weekday() != 6 for day in week)
                closed_sundays = sum(day in closed and date.fromisoformat(day).weekday() == 6 for day in week)
                self.assertEqual(sum(entries[day]["kind"] == "WORK" for day in week), 5 - closed_weekdays)
                self.assertEqual(sum(entries[day]["kind"] == "OFF" for day in week), 2 - closed_sundays)
            for day in dates:
                if day in closed:
                    self.assertEqual(entries[day]["kind"], "HOLIDAY")
                elif day in data["policy"]["holidayDates"] and date.fromisoformat(day).weekday() != 6:
                    self.assertNotEqual(entries[day]["kind"], "OFF")
        fully_off = []
        for day in dates:
            if day in closed:
                continue
            for sector in {p["sector"] for p in data["employees"]}:
                people = [p for p in data["employees"] if p["sector"] == sector]
                if all(proposals[p["id"]][day]["kind"] == "OFF" for p in people):
                    fully_off.append((sector, day))
        self.assertEqual(fully_off, [], fully_off)
        self.assertEqual(data, before)
        # Submit the entire proposed roster to the actual mandatory CP-SAT model.
        # Its first solve fixes every provided hint, proving the seed itself feasible.
        seeded = copy.deepcopy(data)
        seeded["assignments"] = [{"employeeId": pid, "date": day, **entry}
                                 for pid, entries in proposals.items() for day, entry in entries.items()]
        calls = []
        original = cp_model.CpSolver.solve

        def capture(instance, model, *args, **kwargs):
            status = original(instance, model, *args, **kwargs)
            calls.append((instance.parameters.fix_variables_to_their_hinted_value, status))
            return status

        with patch.object(solver, "MAX_SECONDS", 3), patch.object(cp_model.CpSolver, "solve", capture):
            result = solver.solve(seeded)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        self.assertTrue(calls and calls[0][0])
        self.assertIn(calls[0][1], (cp_model.FEASIBLE, cp_model.OPTIMAL), calls)
        self.assertEqual(len(result["assignments"]), 30 * len(dates))
        return proposals

    def test_open_november_holidays_keep_a_complete_staggered_feasible_seed(self):
        self.assert_seed(cohort("2026-11-02", ["2026-11-02", "2026-11-15", "2026-11-20"], []))

    def test_christmas_and_new_year_keep_complete_staggered_feasible_seeds(self):
        self.assert_seed(cohort("2026-12-07", ["2026-12-25", "2027-01-01"], ["2026-12-25", "2027-01-01"]))

    def test_unrelated_calendar_holidays_do_not_disable_an_ordinary_month(self):
        data = cohort("2026-10-05", ["2026-11-02", "2026-12-25"], ["2026-12-25"])
        self.assertEqual(len(hints_for(data)), 30)

    def test_saved_holiday_roster_is_hinted_and_revalidated_not_discarded(self):
        data = fixture(42, start_date="2026-12-21")
        data["simulation"] = True
        data["policy"].update(holidayDates=["2026-12-25"], authorizedHolidayDates=["2026-12-25"],
                              closedDates=["2026-12-25"], paidHolidayDates=["2026-12-25"])
        data["assignments"] = [{"employeeId": "p0", "date": day,
                                "kind": "HOLIDAY" if day == "2026-12-25" else "OFF" if day in ("2026-12-26", "2026-12-27") else "WORK",
                                **({"shiftId": "day"} if day < "2026-12-25" else {})}
                               for day in solver.days_between(data["startDate"], data["endDate"])]
        checked = []
        original = solver._feasibility_hints

        def capture(*args, **kwargs):
            result = original(*args, **kwargs)
            checked.append((result, len(args[0].proto.solution_hint.vars)))
            return result

        with patch.object(solver, "_feasibility_hints", capture):
            result = solver.solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        self.assertTrue(checked[0][0])
        self.assertGreater(checked[0][1], 0)

    def test_absence_and_locked_clocks_remain_exact_in_the_balanced_proposal(self):
        data = cohort("2026-12-07", ["2026-12-25"], ["2026-12-25"])
        data["assignments"] = [{"employeeId": "p0", "date": "2026-12-25", "kind": "ABSENCE", "locked": True},
                               {"employeeId": "p0", "date": "2026-12-08", "kind": "WORK", "shiftId": "day", "locked": True}]
        proposal = hints_for(data)["p0"]
        self.assertEqual(proposal["2026-12-25"]["kind"], "ABSENCE")
        self.assertEqual(proposal["2026-12-08"], {"kind": "WORK", "shiftId": "day"})

    def test_hint_state_distinguishes_empty_partial_and_complete_decisions(self):
        model = cp_model.CpModel()
        off = {"day": model.new_bool_var("off")}
        work = {"day": model.new_bool_var("work")}
        choices = {"day": {"clock": model.new_bool_var("clock")}}
        self.assertEqual(solver._seed_hint_state(model, off, work, choices), "NONE")
        model.add_hint(off["day"], 1)
        self.assertEqual(solver._seed_hint_state(model, off, work, choices), "PARTIAL")
        model.add_hint(work["day"], 0)
        model.add_hint(choices["day"]["clock"], 0)
        self.assertEqual(solver._seed_hint_state(model, off, work, choices), "COMPLETE")

    def tracked_seed(self, data):
        calls, comparable = [], []
        original_solve, original_hints = cp_model.CpSolver.solve, solver._feasibility_hints

        def capture(instance, model, *args, **kwargs):
            status = original_solve(instance, model, *args, **kwargs)
            calls.append((instance.parameters.fix_variables_to_their_hinted_value, status))
            return status

        def capture_hints(*args, **kwargs):
            result = original_hints(*args, **kwargs)
            comparable.append(result)
            return result

        with patch.object(cp_model.CpSolver, "solve", capture), patch.object(solver, "_feasibility_hints", capture_hints):
            result = solver.solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        return result, calls, comparable

    def test_legacy_work_on_new_closed_holiday_uses_a_verified_balanced_seed_first(self):
        data = fixture(42, start_date="2026-12-21")
        data["simulation"] = True
        data["policy"].update(holidayDates=["2026-12-25"], authorizedHolidayDates=["2026-12-25"],
                              closedDates=["2026-12-25"], paidHolidayDates=["2026-12-25"])
        data["assignments"] = [{"employeeId": "p0", "date": day, "kind": "WORK", "shiftId": "day"}
                               if date.fromisoformat(day).weekday() < 5 else {"employeeId": "p0", "date": day, "kind": "OFF"}
                               for day in solver.days_between(data["startDate"], data["endDate"])]
        result, calls, comparable = self.tracked_seed(data)
        self.assertFalse(comparable[0])
        self.assertEqual(calls[0], (True, cp_model.OPTIMAL))
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == "2026-12-25")["kind"], "HOLIDAY")

    def test_legacy_rest_on_an_open_weekday_holiday_is_not_a_comparable_seed(self):
        data = fixture(42, start_date="2026-11-16")
        data["simulation"] = True
        data["policy"].update(holidayDates=["2026-11-20"], authorizedHolidayDates=["2026-11-20"])
        data["assignments"] = [{"employeeId": "p0", "date": day, "kind": "OFF"}
                               if day in ("2026-11-20", "2026-11-22") else {"employeeId": "p0", "date": day, "kind": "WORK", "shiftId": "day"}
                               for day in solver.days_between(data["startDate"], data["endDate"])]
        result, calls, comparable = self.tracked_seed(data)
        self.assertFalse(comparable[0])
        self.assertEqual(calls[0], (True, cp_model.OPTIMAL))
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == "2026-11-20")["kind"], "WORK")

    def test_rejected_baseline_revalidates_the_balanced_fallback_before_unrestricted_search(self):
        data = fixture(42)
        data["employees"][0].update(offMode="FIXED", fixedOffDays=[1, 5])
        data["assignments"] = [{"employeeId": "p0", "date": day, "kind": "WORK", "shiftId": "day"}
                               if date.fromisoformat(day).weekday() < 5 else {"employeeId": "p0", "date": day, "kind": "OFF"}
                               for day in solver.days_between(data["startDate"], data["endDate"])]
        result, calls, comparable = self.tracked_seed(data)
        self.assertTrue(comparable[0])
        self.assertEqual(calls[:2], [(True, cp_model.INFEASIBLE), (True, cp_model.OPTIMAL)])
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == "2026-11-03")["kind"], "OFF")

    def test_three_person_sector_uses_two_person_exposure_during_month_long_absence(self):
        data = fixture(42, people=3, weeks=6, start_date="2026-10-26")
        data["simulation"] = True
        data["policy"].update(holidayDates=["2026-11-02", "2026-11-15", "2026-11-20"],
                              authorizedHolidayDates=["2026-11-02", "2026-11-15", "2026-11-20"])
        for person in data["employees"]:
            person.update(maxConsecutiveSundays=1, sundayRestRule="PROTECTIVE", fixedImportedShiftId="day")
        data["assignments"] = [{"employeeId": "p1", "date": day, "kind": "ABSENCE", "locked": True}
                               for day in solver.days_between("2026-11-03", "2026-12-02")]
        before = copy.deepcopy(data)
        proposed = hints_for(data)
        self.assertEqual(len(proposed), 3)
        for day in solver.days_between("2026-11-01", "2026-11-30"):
            available = [entries[day] for entries in proposed.values() if entries[day]["kind"] != "ABSENCE"]
            self.assertTrue(any(entry["kind"] == "WORK" for entry in available), day)
        self.assertTrue(all(proposed["p1"][a["date"]]["kind"] == "ABSENCE" for a in data["assignments"]))
        dates = solver.days_between(data["startDate"], data["endDate"])
        active = {person["id"]: dates for person in data["employees"]}
        source = {(pid, day): entry for pid, entries in proposed.items() for day, entry in entries.items()}
        source["p0", "2026-11-29"] = {"kind": "OFF"}
        source["p2", "2026-11-29"] = {"kind": "OFF"}
        demand = {"date": "2026-11-29", "sector": "Reposição", "start": 480, "end": 720, "minimum": 1, "estimated": True}
        self.assertEqual(solver._empty_estimated_seed_sectors(data["employees"], active, source, data["policy"], [demand]), {"Reposição"})
        self.assertEqual(solver._empty_estimated_seed_sectors(data["employees"], active, source, data["policy"], []), set())
        self.assertEqual(solver._empty_estimated_seed_sectors(data["employees"], active, source, data["policy"], [{**demand, "minimum": 0}]), set())
        self.assertEqual(solver._empty_estimated_seed_sectors(data["employees"], active, source, {**data["policy"], "closedDates": ["2026-11-29"]}, [demand]), set())
        self.assertEqual(data, before)
        seeded = copy.deepcopy(data)
        seeded["demands"] = [demand]
        seeded["assignments"] = [{"employeeId": pid, "date": day, **entry, **({"locked": True} if entry["kind"] == "ABSENCE" else {})}
                                 for pid, entries in proposed.items() for day, entry in entries.items()]
        result = solver.solve(seeded)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        self.assertTrue(any(a["date"] == "2026-11-29" and a["kind"] == "WORK" for a in result["assignments"]))
        self.assertTrue(all(next(a for a in result["assignments"] if a["employeeId"] == "p1" and a["date"] == original["date"])["kind"] == "ABSENCE"
                            for original in data["assignments"]))


if __name__ == "__main__":
    unittest.main()
