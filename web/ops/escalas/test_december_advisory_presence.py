"""Keep advisory civil dates out of the frozen service-presence scopes."""
import time
import unittest

from ortools.sat.python import cp_model

from coverage_service_protection import SERVICE_CONFLICT, add_service_protection
from model_input import DECEMBER_ADVISORY_DATES, validate_model_input
from solver import days_between
from test_december_cutover import fixture


class DecemberAdvisoryPresenceTests(unittest.TestCase):
    @staticmethod
    def data(scope="HORIZON", start=480, end=540):
        data = fixture()
        data["_coverageComparison"] = {
            "sectors": [], "bands": [], "dailyBands": [],
            "advisoryEstimateDates": sorted(DECEMBER_ADVISORY_DATES),
        }
        data["_coverageServiceProtection"] = {
            "days": [], "bands": [{
                "sector": "Reposição", "role": "Repositor", "scope": scope,
                "start": start, "end": end, "minimum": 1,
            }],
        }
        return data

    @staticmethod
    def compile(data, work):
        validate_model_input(data)
        model = cp_model.CpModel()
        choices = {}
        for day, sid, selected in work:
            variable = model.new_bool_var(f"work:{day}")
            model.add(variable == selected)
            choices["p0", day] = {sid: variable}
        dates = days_between(data["startDate"], data["endDate"])
        shifts = {shift["id"]: shift for shift in data["shifts"]}
        outcome = add_service_protection(model, data, data["employees"], dates, choices, shifts, time.monotonic() + 1)
        return model, outcome

    def test_early_work_cannot_satisfy_a_later_presence_floor(self):
        for scope in ("HORIZON", "MONTH"):
            with self.subTest(scope=scope):
                data = self.data(scope)
                early = ("2026-12-02", "day")
                later = ("2026-12-06", "day")
                model, outcome = self.compile(data, [(*early, 1)])
                self.assertIsInstance(outcome, str)
                self.assertIn(SERVICE_CONFLICT, outcome)
                for early_selected, later_selected, expected in (
                        (1, 0, cp_model.INFEASIBLE), (0, 1, cp_model.OPTIMAL)):
                    model, outcome = self.compile(data, [
                        (*early, early_selected), (*later, later_selected)])
                    self.assertIs(outcome, True)
                    self.assertEqual(cp_model.CpSolver().solve(model), expected)
                # The legacy (unmarked) payload still measures the entire horizon.
                del data["_coverageComparison"]["advisoryEstimateDates"]
                model, outcome = self.compile(data, [(*early, 1)])
                self.assertIs(outcome, True)
                self.assertEqual(cp_model.CpSolver().solve(model), cp_model.OPTIMAL)

    def test_an_exact_protected_day_cannot_be_replaced_by_an_advisory_day(self):
        data = self.data()
        data["_coverageServiceProtection"]["days"] = [{"date": "2026-12-07", "sector": "Reposição"}]
        model, outcome = self.compile(data, [("2026-12-02", "day", 1), ("2026-12-06", "day", 1)])
        self.assertIsInstance(outcome, str)
        self.assertIn("2026-12-07", outcome)
        self.assertIn(SERVICE_CONFLICT, outcome)

    def test_overnight_work_anchored_on_the_fifth_counts_on_the_sixth(self):
        data = self.data(start=30, end=60)
        data["_coverageServiceProtection"]["days"] = [{"date": "2026-12-06", "sector": "Reposição"}]
        data["shifts"].append({
            "id": "night", "segments": [{"kind": "WORK", "start": 1320, "end": 1500}],
        })
        data["employees"][0]["shiftIds"].append("night")
        model, outcome = self.compile(data, [("2026-12-05", "night", 1)])
        self.assertIs(outcome, True)
        self.assertEqual(cp_model.CpSolver().solve(model), cp_model.OPTIMAL)
