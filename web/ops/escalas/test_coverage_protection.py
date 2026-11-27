"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
from contract_fixtures import make_untimed
from model_input import ModelInputError
from model_input import validate_model_input
from solver import solve
import copy
import unittest

def protection(day="2026-11-08", start=480, end=720, minimum=1, role="Repositor"):
    record = {"date": day, "sector": "Reposição", "start": start, "end": end, "minimum": minimum}
    if role is not None:
        record["role"] = role
    return record

def service_band(sector="Reposição", role="Repositor", start=480, end=720, scope="HORIZON", minimum=1):
    return {"sector": sector, "role": role, "start": start, "end": end, "scope": scope, "minimum": minimum}

class CoverageProtectionTests(unittest.TestCase):
    def test_cannot_fund_sunday_with_a_protected_weekday(self):
        data = fixture()
        data["_coverageProtection"] = [
            protection(f"2026-11-0{day}") for day in (2, 3, 4, 5, 6, 8)]
        self.assert_coverage_conflict(data)

    def test_cannot_count_absence_or_untimed_duty_toward_floor(self):
        data = fixture(people=2)
        make_untimed(data["employees"][1])
        data["assignments"] = [
            {"date": "2026-11-08", "employeeId": "p0", "kind": "ABSENCE", "locked": True},
            {"date": "2026-11-08", "employeeId": "p1", "kind": "DUTY", "locked": True}]
        data["_coverageProtection"] = [protection()]
        self.assert_coverage_conflict(data)

    def test_partially_overlapping_interval_does_not_count_break(self):
        for kind in ("BREAK", "PAID_BREAK"):
            with self.subTest(kind=kind):
                data = fixture()
                data["shifts"][0]["segments"][1]["kind"] = kind
                data["shifts"][0]["segments"][2]["end"] -= 60 if kind == "PAID_BREAK" else 0
                data["_coverageProtection"] = [protection(start=719, end=721)]
                self.assert_coverage_conflict(data)

    def test_less_strict_private_floor_never_decreases_confirmed_floor(self):
        data = fixture()
        data["demands"] = [{"id": "confirmed", **protection(minimum=2)}]
        data["_coverageProtection"] = [protection()]
        self.assert_coverage_conflict(data)

    def test_payload_rejects_out_of_scope_floors(self):
        data = fixture()
        cases = [
            ([protection()] * 12001, "_coverageProtection"),
            ([protection(day="2026-11-09")], "_coverageProtection[0].date"),
            ([{**protection(), "sector": ""}], "_coverageProtection[0].sector"),
            ([protection(role="Outra função")], "_coverageProtection[0].role"),
            ([protection(start=-1)], "_coverageProtection[0].start"),
            ([protection(start=720, end=720)], "_coverageProtection[0]"),
            ([protection(end=1441)], "_coverageProtection[0].end"),
            ([protection(minimum=0)], "_coverageProtection[0].minimum"),
            ([protection(minimum=251)], "_coverageProtection[0].minimum"),
            ([{**protection(), "estimated": True}], "_coverageProtection[0]"),
        ]
        for floors, path in cases:
            with self.subTest(path=path):
                data["_coverageProtection"] = floors
                with self.assertRaises(ModelInputError) as raised:
                    validate_model_input(data)
                self.assertEqual(raised.exception.fields[0]["path"], path)

    def assert_coverage_conflict(self, data):
        before = copy.deepcopy(data)
        validate_model_input(data)
        result = solve(data)
        self.assertEqual(result["status"], "INFEASIBLE", result)
        self.assertEqual(result["assignments"], [])
        self.assertIn("COVERAGE", [entry["family"] for entry in result["solverDiagnostics"]])
        self.assertEqual(data, before)

class CoverageServiceProtectionTests(unittest.TestCase):
    def test_one_timed_worker_is_enough_to_preserve_a_day_with_no_demand(self):
        data = fixture(people=2)
        day = "2026-11-08"
        data["assignments"] = [{"employeeId": "p1", "date": day, "kind": "OFF", "locked": True}]
        data["_coverageServiceProtection"] = {"days": [{"date": day, "sector": "Reposição"}] * 2, "bands": []}
        before = copy.deepcopy(data)
        validate_model_input(data)
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        self.assertEqual([entry["employeeId"] for entry in result["assignments"]
                          if entry["date"] == day and entry["kind"] == "WORK"], ["p0"])
        self.assertEqual(data, before)

    def test_a_demand_feasible_roster_cannot_drop_a_staffed_day(self):
        data = fixture()
        day = "2026-11-08"
        data["assignments"] = [{"employeeId": "p0", "date": day, "kind": "OFF", "locked": True}]
        self.assertIn(solve(data)["status"], ("FEASIBLE", "OPTIMAL"))
        data["_coverageServiceProtection"] = {"days": [{"date": day, "sector": "Reposição"}], "bands": []}
        self.assert_service_conflict(data)

    def test_another_role_can_meet_demand_but_not_replace_protected_sunday_presence(self):
        data = fixture(people=2)
        data["employees"][1]["role"] = "Outro cargo"
        data["assignments"] = [
            {"employeeId": "p0", "date": f"2026-11-0{day}", "kind": "WORK", "shiftId": "day", "locked": True}
            for day in range(2, 7)]
        data["demands"] = [{"id": "general", **protection(role=None)}]
        baseline = solve(data)
        self.assertIn(baseline["status"], ("FEASIBLE", "OPTIMAL"), baseline)
        self.assertTrue(any(entry["employeeId"] == "p1" and entry["date"] == "2026-11-08" and entry["kind"] == "WORK"
                            for entry in baseline["assignments"]))
        data["_coverageServiceProtection"] = {"days": [], "bands": [service_band(scope="SUNDAYS")]}
        self.assert_service_conflict(data)

    def test_role_band_preserves_both_dates_and_checks_every_minute(self):
        data = fixture(people=2)
        data["_coverageServiceProtection"] = {"days": [], "bands": [service_band(minimum=10, start=719, end=720)]}
        validate_model_input(data)
        self.assertIn(solve(data)["status"], ("FEASIBLE", "OPTIMAL"))
        data["_coverageServiceProtection"]["bands"][0]["end"] = 721
        self.assert_service_conflict(data)

    def test_locked_paid_break_absence_and_untimed_duty_do_not_count(self):
        data = fixture(people=3)
        data["shifts"][0]["segments"][1]["kind"] = "PAID_BREAK"
        data["shifts"][0]["segments"][2]["end"] -= 60
        make_untimed(data["employees"][1])
        day = "2026-11-08"
        data["assignments"] = [
            {"date": day, "employeeId": "p0", "kind": "WORK", "shiftId": "day", "locked": True},
            {"date": day, "employeeId": "p1", "kind": "DUTY", "locked": True},
            {"date": day, "employeeId": "p2", "kind": "ABSENCE", "locked": True}]
        data["_coverageServiceProtection"] = {"days": [], "bands": [service_band(scope="SUNDAYS", start=719, end=721)]}
        self.assert_service_conflict(data)

    def test_validates_bounds_and_allows_exact_blank_registered_keys(self):
        data = fixture()
        data["employees"][0].update(sector="", role="")
        day = {"date": data["startDate"], "sector": ""}
        band = service_band(sector="", role="")
        data["_coverageServiceProtection"] = {"days": [day], "bands": [band]}
        validate_model_input(data)
        for days, bands, path in (
                ([day] * 10501, [], ".days"),
                ([], [band] * 12001, ".bands"),
                ([{**day, "date": "2026-11-09"}], [], ".days[0].date"),
                ([], [{**band, "role": "Inventado"}], ".bands[0].role"),
                ([], [{**band, "minimum": 0}], ".bands[0].minimum"),
                ([], [{**band, "minimum": 10501}], ".bands[0].minimum"),
                ([], [{**band, "scope": "WEEK"}], ".bands[0].scope")):
            with self.subTest(path=path):
                data["_coverageServiceProtection"] = {"days": days, "bands": bands}
                with self.assertRaises(ModelInputError) as raised:
                    validate_model_input(data)
                self.assertEqual(raised.exception.fields[0]["path"], "_coverageServiceProtection" + path)

    def assert_service_conflict(self, data):
        before = copy.deepcopy(data)
        validate_model_input(data)
        result = solve(data)
        self.assertEqual(result["status"], "INFEASIBLE", result)
        self.assertEqual(result["assignments"], [])
        self.assertIn("COVERAGE", [entry["family"] for entry in result["solverDiagnostics"]])
        self.assertEqual(data, before)

class CoverageComparisonTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture(people=2, weeks=2)
        self.data["demands"] = [
            {"id": day, **protection(day, 480, 540, 2), "estimated": True}
            for day in ("2026-11-08", "2026-11-15")]
        self.data["_coverageComparison"] = {
            "sectors": [self.sector_cap(180)],
            "bands": [self.band_cap(scope, role, 3, 2)
                      for scope in ("HORIZON", "MONTH", "SUNDAYS", "MONTH_SUNDAYS")
                      for role in (None, "Repositor")],
        }

    @staticmethod
    def sector_cap(minutes, peak=2, closing=0, visible=None, sundays=None):
        visible = minutes if visible is None else visible
        sundays = minutes if sundays is None else sundays
        return {"sector": "Reposição", "horizon": minutes, "month": visible,
                "sundays": sundays, "monthSundays": min(visible, sundays), "closing": closing, "peak": peak}

    @staticmethod
    def band_cap(scope, role, maximum, peak, start=480, end=540):
        return {"scope": scope, "sector": "Reposição", "role": role, "start": start,
                "end": end, "maximum": maximum, "peak": peak}

    def test_existing_daily_and_explicit_mandatory_guards_survive_any_comparison_caps(self):
        self.data["assignments"] = [{"employeeId": "p0", "date": "2026-11-15", "kind": "OFF", "locked": True},
                                    {"employeeId": "p1", "date": "2026-11-15", "kind": "OFF", "locked": True}]
        for guard in ("_coverageProtection", "explicit"):
            with self.subTest(guard=guard):
                data = copy.deepcopy(self.data)
                if guard == "explicit":
                    data["demands"].append({"id": "required", **protection("2026-11-15")})
                else:
                    data[guard] = [protection("2026-11-15")]
                validate_model_input(data)
                result = solve(data)
                self.assertEqual(result["status"], "INFEASIBLE", result)
                self.assertEqual(result["assignments"], [])
                self.assertIn("COVERAGE", [entry["family"] for entry in result["solverDiagnostics"]])

    def test_no_margin_exposes_the_comparison_family_without_changing_api_family(self):
        self.data["assignments"] = [{"employeeId": "p0", "date": day, "kind": "OFF", "locked": True}
                                   for day in ("2026-11-08", "2026-11-15")]
        self.data["_coverageComparison"] = {"sectors": [], "bands": []}
        validate_model_input(self.data)
        result = solve(self.data)
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertTrue(any(item["family"] == "COVERAGE" and "limite de desfalque" in item["message"]
                            for item in result["solverDiagnostics"]), result)

    def test_boundary_rejects_invalid_cap_and_scope(self):
        saved = self.data["_coverageComparison"]
        saved["bands"][0]["maximum"] = -1
        with self.assertRaises(ModelInputError) as bad_cap:
            validate_model_input(self.data)
        self.assertEqual(bad_cap.exception.fields[0]["path"], "_coverageComparison.bands[0].maximum")
        saved["bands"][0]["maximum"] = 1
        saved["bands"][0]["scope"] = "SURPLUS"
        with self.assertRaises(ModelInputError) as bad_scope:
            validate_model_input(self.data)
        self.assertEqual(bad_scope.exception.fields[0]["path"], "_coverageComparison.bands[0].scope")
