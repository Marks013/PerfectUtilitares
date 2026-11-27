"""Original public contracts retained during engine migration; assertions unchanged."""
from model_input import DECEMBER_ADVISORY_DATES
from model_input import ModelInputError
from model_input import validate_model_input
from solver import solve
from test_december_cutover import fixture
import copy
import unittest

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
