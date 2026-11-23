"""Private saved-grade floors are feasibility constraints, not shortage objectives."""
import copy
import time
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model

from coverage_comparison import CoverageComparison
from coverage_service_protection import SERVICE_CONFLICT, add_service_protection
from model_input import ModelInputError, validate_model_input
from solver import MAX_SECONDS, _coverage, days_between, solve
from test_december_cutover import fixture as december_fixture
from test_solver import fixture, make_untimed


def protection(day="2026-11-08", start=480, end=720, minimum=1, role="Repositor"):
    record = {"date": day, "sector": "Reposição", "start": start, "end": end, "minimum": minimum}
    if role is not None:
        record["role"] = role
    return record


def service_band(sector="Reposição", role="Repositor", start=480, end=720, scope="HORIZON", minimum=1):
    return {"sector": sector, "role": role, "start": start, "end": end, "scope": scope, "minimum": minimum}


class CoverageProtectionTests(unittest.TestCase):
    def test_first_feasible_model_preserves_donor_and_can_staff_sunday(self):
        data = fixture(42, people=2)
        data["_coverageProtection"] = [protection("2026-11-04"), protection()]
        before = copy.deepcopy(data)
        validate_model_input(data)

        class InitialModel:
            def __init__(self):
                self.checked = False

            def checkpoint(self):
                pass

            def solve(self, engine, model):
                status = engine.solve(model)
                if (not self.checked and engine.parameters.stop_after_first_solution
                        and status in (cp_model.FEASIBLE, cp_model.OPTIMAL)):
                    self.checked = True
                    for day in ("2026-11-04", "2026-11-08"):
                        worked = sum(engine.value(model.get_bool_var_from_proto_index(index))
                                     for index, var in enumerate(model.proto.variables)
                                     if var.name.startswith("s:") and var.name.endswith(f":{day}:day"))
                        if worked < 1:
                            raise AssertionError("A private floor was absent from the first feasible model")
                return status

        control = InitialModel()
        result = solve(data, control)
        self.assertTrue(control.checked)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"))
        for day in ("2026-11-04", "2026-11-08"):
            self.assertTrue(any(entry["kind"] == "WORK" and entry["date"] == day
                                for entry in result["assignments"]))
        self.assertEqual(data, before)

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

    def test_fixed_previous_clock_and_variable_current_clock_can_cover_one_band(self):
        data = fixture(people=2)
        data["shifts"].extend([
            {"id": "overnight", "segments": [{"kind": "WORK", "start": 1320, "end": 1510}]},
            {"id": "opening", "segments": [{"kind": "WORK", "start": 30, "end": 90}]}])
        data["employees"][0]["history"][-1].update(kind="WORK", shiftId="overnight")
        data["_coverageProtection"] = [protection("2026-11-02", 50, 70, 2)]
        validate_model_input(data)
        model = cp_model.CpModel()
        present = model.new_bool_var("current-opening")
        choices = {("p1", "2026-11-02"): {"opening": present}}
        shifts = {shift["id"]: shift for shift in data["shifts"]}
        self.assertEqual(_coverage(model, data, data["employees"], choices, shifts, time.monotonic(), "PROTECTED"), [])
        engine = cp_model.CpSolver()
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertTrue(engine.boolean_value(present))

        # The same historical clock never satisfies a civil absence in the target week.
        data["assignments"] = [{"employeeId": "p0", "date": "2026-11-02", "kind": "ABSENCE"}]
        self.assertIsInstance(_coverage(cp_model.CpModel(), data, data["employees"], {}, shifts,
                                        time.monotonic(), "PROTECTED"), str)

    def test_private_band_construction_stops_at_the_existing_deadline(self):
        data = fixture()
        data["_coverageProtection"] = [protection()]
        model = cp_model.CpModel()
        clock = model.new_bool_var("sunday-clock")
        choices = {("p0", "2026-11-08"): {"day": clock}}
        shifts = {shift["id"]: shift for shift in data["shifts"]}
        # Indexing and opening the band fit the budget; constraining it no longer does.
        with patch("solver.time.monotonic", side_effect=[0, 0, MAX_SECONDS + 1]):
            self.assertIs(_coverage(model, data, data["employees"], choices, shifts, 0, "PROTECTED"), False)
        self.assertEqual(len(model.proto.constraints), 0)

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

    def test_monthly_sunday_counts_exclude_the_outer_sunday(self):
        data = fixture(weeks=5, start_date="2026-11-30")
        data["visibleMonth"] = "2026-12"
        dates = days_between(data["startDate"], data["endDate"])
        for scope in ("SUNDAYS", "MONTH_SUNDAYS"):
            with self.subTest(scope=scope):
                data["_coverageServiceProtection"] = {"days": [], "bands": [service_band(scope=scope, minimum=2)]}
                model = cp_model.CpModel()
                inside, outside = model.new_bool_var("inside"), model.new_bool_var("outside")
                choices = {("p0", "2026-12-06"): {"day": inside},
                           ("p0", "2027-01-03"): {"day": outside}}
                shifts = {shift["id"]: shift for shift in data["shifts"]}
                validate_model_input(data)
                result = add_service_protection(model, data, data["employees"], dates, choices, shifts,
                                                time.monotonic() + 1)
                if scope == "SUNDAYS":
                    self.assertIs(result, True)
                else:
                    self.assertIn(SERVICE_CONFLICT, result)
                    self.assertIn("MONTH_SUNDAYS, 08:00–12:00: até 1 pessoas-dia disponíveis para preservar 2", result)

    def test_spill_and_same_day_work_count_as_one_civil_person_day(self):
        data = fixture(people=2)
        data["shifts"].extend([
            {"id": "overnight", "segments": [{"kind": "WORK", "start": 1320, "end": 1510}]},
            {"id": "opening", "segments": [{"kind": "WORK", "start": 30, "end": 90}]}])
        data["_coverageServiceProtection"] = {"days": [], "bands": [
            service_band(scope="SUNDAYS", start=50, end=70, minimum=2)]}
        model = cp_model.CpModel()
        spill, same_day, other = (model.new_bool_var(label) for label in ("spill", "same-day", "other"))
        choices = {("p0", "2026-11-07"): {"overnight": spill},
                   ("p0", "2026-11-08"): {"opening": same_day},
                   ("p1", "2026-11-08"): {"opening": other}}
        shifts = {shift["id"]: shift for shift in data["shifts"]}
        dates = days_between(data["startDate"], data["endDate"])
        validate_model_input(data)
        self.assertIs(add_service_protection(model, data, data["employees"], dates, choices, shifts,
                                             time.monotonic() + 1), True)
        model.add(spill == 1)
        model.add(same_day == 1)
        model.add(other == 0)
        self.assertEqual(cp_model.CpSolver().solve(model), cp_model.INFEASIBLE)

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

    def test_historical_timezone_transition_fails_closed_before_adding_terms(self):
        data = fixture(start_date="2018-10-29")
        dates = days_between(data["startDate"], data["endDate"])
        data["_coverageServiceProtection"] = {"days": [{"date": "2018-11-04", "sector": "Reposição"}], "bands": []}
        model = cp_model.CpModel()
        result = add_service_protection(model, data, data["employees"], dates, {}, {}, time.monotonic() + 1)
        self.assertIn("fuso horário", result)
        self.assertEqual(len(model.proto.constraints), 0)

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

    def compile(self, selected, expected):
        validate_model_input(self.data)
        model = cp_model.CpModel()
        choices = {}
        for pid, day, sid in selected:
            variable = model.new_bool_var("known-clock")
            model.add(variable == 1)
            choices.setdefault((pid, day), {})[sid] = variable
        shifts = {shift["id"]: shift for shift in self.data["shifts"]}
        result = _coverage(model, self.data, self.data["employees"], choices, shifts, time.monotonic(), "ESTIMATED")
        if isinstance(result, str):
            self.assertFalse(expected, result)
        else:
            self.assertIsNot(result, False)
            status = cp_model.CpSolver().solve(model)
            self.assertEqual(status, cp_model.OPTIMAL if expected else cp_model.INFEASIBLE)
        return result

    def test_equal_sunday_deficit_can_move_between_dates(self):
        # The saved shortage was [2, 1]; this staffing swaps it to [1, 2].
        self.compile([("p0", "2026-11-08", "day")], True)

    def test_december_protects_day_role_and_band_without_freezing_surplus(self):
        self.data = december_fixture()
        other = {**self.data["employees"][0], "id": "p1", "shiftIds": ["late"], "fixedImportedShiftId": "late"}
        self.data["employees"].append(other)
        base = self.data["shifts"][0]
        self.data["shifts"] += [
            {"id": sid, "segments": [{**s, "start": s["start"] + offset, "end": s["end"] + offset}
                                     for s in base["segments"]]}
            for sid, offset in (("late", 30), ("earlier", -10))
        ]
        morning, afternoon = "2026-12-02", "2026-12-04"
        bands = [(480, 510), (1044, 1074)]
        self.data["demands"] = [
            {"id": f"{day}-{lo}", **protection(day, lo, hi), "estimated": True}
            for day in (morning, afternoon) for lo, hi in bands
        ]
        saved = {
            "sectors": [self.sector_cap(60, peak=1, sundays=0)],
            "bands": [self.band_cap(scope, role, 1, 1, lo, hi)
                      for scope in ("HORIZON", "MONTH") for role in ("Repositor", None) for lo, hi in bands],
        }
        self.data["_coverageComparison"] = saved
        crossed = [("p0", afternoon, "day"), ("p1", morning, "late")]
        self.data["employees"][0]["fixedImportedShiftId"] = "day"
        self.compile(crossed, True)
        saved["dailyBands"] = [
            {"date": date, "sector": "Reposição", "role": role, "start": lo, "end": hi, "maximum": 1}
            for date, (lo, hi) in ((morning, bands[1]), (afternoon, bands[0])) for role in ("Repositor", None)
        ]
        self.compile(crossed, False)
        self.data["employees"][0].update(shiftIds=["earlier"], fixedImportedShiftId="earlier")
        self.compile([("p0", morning, "earlier"), ("p1", afternoon, "late")], True)

        saved["dailyBands"][0]["date"] = "2027-01-01"
        with self.assertRaises(ModelInputError) as invalid:
            validate_model_input(self.data)
        self.assertEqual(invalid.exception.fields[0], {
            "path": "_coverageComparison.dailyBands[0].date", "reason": "OUTSIDE_HORIZON",
        })

    def test_sunday_scope_and_sector_volume_do_not_increase(self):
        self.compile([], False)
        self.data["_coverageComparison"]["sectors"][0]["horizon"] = 179
        self.compile([("p0", "2026-11-08", "day")], False)
        self.data["_coverageComparison"]["sectors"][0]["horizon"] = 180
        self.data["_coverageComparison"]["sectors"][0]["sundays"] = 179
        self.compile([("p0", "2026-11-08", "day")], False)

    def test_same_total_cannot_worsen_simultaneous_peak(self):
        saved = self.data["_coverageComparison"]
        saved["bands"] = [{**cap, "maximum": 2, "peak": 1} for cap in saved["bands"]]
        saved["sectors"] = [self.sector_cap(120)]
        self.compile([("p0", "2026-11-08", "day"), ("p1", "2026-11-15", "day")], True)
        self.compile([("p0", "2026-11-08", "day"), ("p1", "2026-11-08", "day")], False)

    def test_frozen_bands_split_at_candidate_clock_cuts_and_missing_role_caps_are_zero(self):
        day = "2026-11-08"
        self.data["shifts"] += [
            {"id": "early", "segments": [{"kind": "WORK", "start": 480, "end": 510}]},
            {"id": "late", "segments": [{"kind": "WORK", "start": 510, "end": 540}]}]
        self.data["demands"] = [{"id": "test", **protection(day, 480, 540), "estimated": True}]
        saved = self.data["_coverageComparison"]
        saved["sectors"] = [self.sector_cap(30)]
        saved["bands"] = [self.band_cap(scope, role, 1, 1, end=510)
                          for scope in ("HORIZON", "MONTH", "SUNDAYS", "MONTH_SUNDAYS") for role in (None, "Repositor")]
        self.compile([("p0", day, "late")], True)
        self.compile([("p0", day, "early")], False)
        saved["bands"] = [row for row in saved["bands"] if row["role"] is None]
        self.compile([("p0", day, "late")], False)

    def test_closing_uses_entire_horizon_and_closed_estimated_deficit_stays_in_totals(self):
        self.data = fixture(weeks=5, start_date="2026-11-30")
        day = "2026-11-30"  # Technical day outside the visible month.
        self.data.update(visibleMonth="2026-12", storeClosingMinutes=600)
        self.data["policy"].update(closedDates=[day], holidayDates=[day], paidHolidayDates=[day])
        self.data["demands"] = [{"id": "closed", **protection(day, 540, 600, role=None), "estimated": True}]
        saved = {"sectors": [self.sector_cap(60, closing=0, visible=0, sundays=0)],
                 "bands": [self.band_cap("HORIZON", None, 1, 1, 540, 600)]}
        self.data["_coverageComparison"] = saved
        self.compile([], False)
        saved["sectors"][0]["closing"] = 60
        self.compile([], True)

    def test_comparison_is_enforced_in_first_feasibility_call_that_returns_a_roster(self):
        self.data = fixture(people=1)
        target = "2026-11-08"
        self.data["demands"] = [{"id": "sunday", **protection(target), "estimated": True}]
        # Missing sector or band caps represent zero shortage.
        self.data["_coverageComparison"] = {"sectors": [], "bands": []}
        observed = []

        class Probe:
            def checkpoint(self):
                pass

            def solve(self, engine, model):
                result = engine.solve(model)
                if not observed and engine.parameters.stop_after_first_solution and result in (cp_model.FEASIBLE, cp_model.OPTIMAL):
                    selected = model.get_bool_var_from_proto_index(next(
                        index for index, var in enumerate(model.proto.variables) if var.name == f"s:p0:{target}:day"))
                    observed.append(engine.boolean_value(selected))
                return result

        validate_model_input(self.data)
        result = solve(self.data, Probe())
        self.assertEqual(observed, [True])
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)

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

    def test_constant_band_conflict_reports_the_exact_role_scope_and_limit(self):
        group = ("MONTH_SUNDAYS", 495, 525)
        for maximum, peak, detail in (
            (9, 1, "Pico de pessoas: pelo menos 2 com os horários permitidos, limite 1"),
            (3, 2, "Soma das carências: pelo menos 4 com os horários permitidos, limite 3"),
        ):
            with self.subTest(maximum=maximum, peak=peak):
                comparison = CoverageComparison({
                    "sectors": [],
                    "bands": [self.band_cap("MONTH_SUNDAYS", "Repositor", maximum, peak)],
                })
                comparison.track_band("Reposição", "Repositor", 2, {group: 2})
                outcome = comparison.constrain(cp_model.CpModel(), (), lambda: False)
                self.assertIn("Reposição / Repositor, domingos do mês, 08h15–08h45", outcome)
                self.assertIn(detail, outcome)

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
