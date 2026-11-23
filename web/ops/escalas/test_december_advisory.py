"""December startup estimates steer search without deciding feasibility."""
import copy
import time
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model

from model_input import DECEMBER_ADVISORY_DATES, ModelInputError, validate_model_input
from solver import _coverage, solve
from test_december_cutover import fixture


def data_with_estimate(day="2026-12-02", minimum=2, *, estimated=True):
    data = fixture()
    data["demands"] = [{
        "id": "floor", "date": day, "sector": "Reposição", "role": "Repositor",
        "start": 480, "end": 540, "minimum": minimum, "estimated": estimated,
    }]
    data["_coverageComparison"] = {
        "sectors": [], "bands": [], "dailyBands": [],
        "advisoryEstimateDates": sorted(DECEMBER_ADVISORY_DATES),
    }
    return data


class DecemberAdvisoryCoverageTests(unittest.TestCase):
    def test_startup_estimate_cannot_veto_two_folgas_but_the_sixth_still_can(self):
        data = data_with_estimate()
        validate_model_input(data)
        response = solve(data)
        self.assertIn(response["status"], ("OPTIMAL", "FEASIBLE"), response)
        self.assertEqual(sum(row["kind"] == "OFF" and row["date"] in DECEMBER_ADVISORY_DATES
                             for row in response["assignments"]), 2)
        data["demands"][0]["date"] = "2026-12-06"
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_same_startup_floor_is_hard_if_confirmed_or_if_flag_is_missing(self):
        data = data_with_estimate(estimated=False)
        validate_model_input(data)
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        data["demands"][0]["estimated"] = True
        data["_coverageComparison"].pop("advisoryEstimateDates")
        self.assertEqual(solve(data)["status"], "INFEASIBLE")

    def test_eligible_startup_work_improves_the_advisory_objective(self):
        data = data_with_estimate(minimum=1)
        validate_model_input(data)
        model = cp_model.CpModel()
        work = model.new_bool_var("work")
        choices = {("p0", "2026-12-02"): {"day": work}}
        shifts = {shift["id"]: shift for shift in data["shifts"]}
        args = model, data, data["employees"], choices, shifts, time.monotonic()
        self.assertEqual(_coverage(*args, "ESTIMATED"), [])
        advisory_terms = _coverage(*args, "ADVISORY")
        self.assertEqual(len(advisory_terms), 1)
        for fixed in (0, 1):
            with self.subTest(fixed=fixed):
                trial = model.clone()
                trial.add(trial.get_bool_var_from_proto_index(work.index) == fixed)
                trial.minimize(sum(advisory_terms))
                solver = cp_model.CpSolver()
                self.assertEqual(solver.solve(trial), cp_model.OPTIMAL)
                self.assertEqual(solver.objective_value, 60 * (1 - fixed))

    def test_identical_deficit_algebra_does_not_mix_period_weights(self):
        data = data_with_estimate()
        start = data["demands"][0]
        data["demands"].append({**start, "id": "later", "date": "2026-12-06"})
        data["_coverageComparison"]["sectors"] = [{
            "sector": "Reposição", "horizon": 120, "month": 120,
            "sundays": 120, "monthSundays": 120, "closing": 0, "peak": 2,
        }]
        data["_coverageComparison"]["bands"] = [
            {"scope": scope, "sector": "Reposição", "role": role,
             "start": 480, "end": 540, "maximum": 2, "peak": 2}
            for scope in ("HORIZON", "MONTH", "SUNDAYS", "MONTH_SUNDAYS")
            for role in (None, "Repositor")]
        data["_coverageComparison"]["dailyBands"] = [
            {"date": "2026-12-06", "sector": "Reposição", "role": role,
             "start": 480, "end": 540, "maximum": 2}
            for role in (None, "Repositor")]
        validate_model_input(data)
        model = cp_model.CpModel()
        shifts = {shift["id"]: shift for shift in data["shifts"]}
        args = model, data, data["employees"], {}, shifts, time.monotonic()
        self.assertEqual(_coverage(*args, "ESTIMATED"), [120])
        advisory_terms = _coverage(*args, "ADVISORY")
        self.assertEqual(len(advisory_terms), 1)
        model.minimize(sum(advisory_terms))
        solver = cp_model.CpSolver()
        self.assertEqual(solver.solve(model), cp_model.OPTIMAL)
        self.assertEqual(solver.objective_value, 120)

    def test_optional_build_exhaustion_returns_the_already_viable_roster(self):
        data = data_with_estimate()
        original = _coverage
        scopes = []

        def build(*args, **kwargs):
            scopes.append(args[6])
            if args[6] == "ADVISORY":
                return False
            return original(*args, **kwargs)

        with patch("solver._coverage", side_effect=build):
            result = solve(data)
        self.assertEqual(scopes, ["HARD", "ESTIMATED", "ADVISORY"])
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["assignments"]), 31)
        self.assertEqual(result["optimization"]["stopReason"], "TIME_BUDGET")

    def test_flag_rejects_malformed_dates_and_noncutover_horizons(self):
        for bad in ("2026-12-01", [], ["2026-12-01"] * 5, ["2026-12-01"] * 4 + [[]],
                    sorted(DECEMBER_ADVISORY_DATES)[:-1] + ["2026-12-06"]):
            data = data_with_estimate()
            data["_coverageComparison"]["advisoryEstimateDates"] = bad
            with self.subTest(bad=bad), self.assertRaises(ModelInputError) as ctx:
                validate_model_input(data)
            self.assertEqual(ctx.exception.fields[0]["path"], "_coverageComparison.advisoryEstimateDates")
        data = data_with_estimate()
        data.update(startDate="2026-12-06", endDate="2026-12-12")
        with self.assertRaises(ModelInputError) as ctx:
            validate_model_input(data)
        self.assertEqual(ctx.exception.fields[0]["reason"], "INVALID_SCOPE")
        data = data_with_estimate()
        for mode in (None, "DAYS_AND_HOURS", "REST_ONLY", "HOURS_ONLY"):
            item = copy.deepcopy(data)
            if mode is None:
                item.pop("generationMode")
            else:
                item["generationMode"] = mode
            validate_model_input(item)
