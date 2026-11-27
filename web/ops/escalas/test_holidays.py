"""Holiday behavioral contracts; closed-holiday shortage checked through the real native result rather than a CP model object."""
from contract_fixtures import fixture
import solver
import copy
import unittest

def holiday_data(day="2026-12-25", start="2026-12-21", closed=True):
    data = fixture(42, start_date=start)
    data["simulation"] = True
    data["generationMode"] = "DAYS_AND_HOURS"
    data["policy"]["holidayDates"] = [day]
    data["policy"]["authorizedHolidayDates"] = [day]
    data["policy"]["closedDates"] = [day] if closed else []
    data["policy"]["paidHolidayDates"] = [day] if closed else []
    return data

class HolidayTests(unittest.TestCase):
    def models(self):
        return (solver, solver)

    def test_open_weekday_holiday_still_forbids_an_ordinary_rest(self):
        for module in self.models():
            with self.subTest(model=module.__name__):
                data = holiday_data("2026-11-20", "2026-11-16", closed=False)
                data["assignments"] = [{"employeeId": "p0", "date": "2026-11-20", "kind": "OFF", "locked": True}]
                self.assertEqual(module.solve(data)["status"], "INFEASIBLE")

    def test_locked_work_or_ordinary_rest_on_closed_holiday_reports_conflict(self):
        for module in self.models():
            for kind in ("WORK", "OFF"):
                with self.subTest(model=module.__name__, kind=kind):
                    data = holiday_data()
                    item = {"employeeId": "p0", "date": "2026-12-25", "kind": kind, "locked": True}
                    if kind == "WORK":
                        item["shiftId"] = "day"
                    data["assignments"] = [item]
                    self.assertEqual(module.solve(data)["status"], "INFEASIBLE")

    def test_weekday_closure_does_not_join_separated_regular_rests(self):
        for module in self.models():
            with self.subTest(model=module.__name__):
                data = holiday_data()
                # Python/calendar contract: Monday=0, Thursday=3, Saturday=5.
                data["employees"][0].update(offPattern="CONSECUTIVE", offMode="FIXED", fixedOffDays=[3, 5])
                self.assertEqual(module.solve(data)["status"], "INFEASIBLE")

    def test_estimated_closed_holiday_has_no_shortage_objective_even_in_a_stale_input(self):
        for module in self.models():
            with self.subTest(model=module.__name__):
                data = holiday_data()
                data['demands'] = [{'date':'2026-12-25', 'sector':'Reposição', 'start':480, 'end':720, 'minimum':2, 'estimated':True}]
                result = module.solve(data)
                self.assertIn(result['status'], ('FEASIBLE','OPTIMAL'), result)
                coverage = [p['incumbentValue'] for p in result['optimization']['phases'] if p['objective'] == 'COVERAGE']
                self.assertTrue(all(value == 0 for value in coverage), coverage)
                holiday = [a for a in result['assignments'] if a['date'] == '2026-12-25']
                self.assertTrue(holiday)
                self.assertTrue(all(a['kind'] == 'HOLIDAY' and 'shiftId' not in a for a in holiday))

    def feasible(self, module, data):
        result = module.solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        return result["assignments"]

    def test_open_sunday_holiday_can_be_a_regular_rest_even_under_cct(self):
            for module in self.models():
                with self.subTest(model=module.__name__):
                    data = holiday_data("2026-11-15", "2026-11-09", closed=False)
                    data["policy"]["normativeProfile"] = "SINDECOMU_SUPERMARKETS_2026_2027"
                    data["assignments"] = [{"employeeId": "p0", "date": "2026-11-15", "kind": "OFF", "locked": True}]
                    entries = self.feasible(module, data)
                    self.assertEqual(next(a for a in entries if a["date"] == "2026-11-15")["kind"], "OFF")

    def test_christmas_is_a_separate_holiday_with_four_workdays_and_two_rests(self):
            for module in self.models():
                with self.subTest(model=module.__name__):
                    data = holiday_data(); before = copy.deepcopy(data)
                    entries = self.feasible(module, data)
                    self.assertEqual(next(a for a in entries if a["date"] == "2026-12-25")["kind"], "HOLIDAY")
                    self.assertEqual(sum(a["kind"] == "WORK" for a in entries), 4)
                    self.assertEqual(sum(a["kind"] == "OFF" for a in entries), 2)
                    self.assertFalse(any(a["kind"] == "ABSENCE" for a in entries))
                    shifts = {s["id"]: s for s in data["shifts"]}
                    self.assertEqual(sum(sum(part["end"] - part["start"] for part in shifts[a["shiftId"]]["segments"] if part["kind"] in ("WORK", "PAID_BREAK")) for a in entries if a["kind"] == "WORK"), 2016)
                    self.assertEqual(data, before)

    def test_real_absence_on_closed_holiday_is_preserved(self):
            for module in self.models():
                with self.subTest(model=module.__name__):
                    data = holiday_data()
                    absent = {"employeeId": "p0", "date": "2026-12-25", "kind": "ABSENCE", "locked": True}
                    data["assignments"] = [absent]
                    entries = self.feasible(module, data)
                    self.assertEqual(next(a for a in entries if a["date"] == absent["date"]), absent)
                    self.assertLessEqual(sum(a["kind"] == "WORK" for a in entries), 5)

    def test_locked_holiday_is_retained_without_creating_presence(self):
            for module in self.models():
                with self.subTest(model=module.__name__):
                    data = holiday_data()
                    item = {"employeeId": "p0", "date": "2026-12-25", "kind": "HOLIDAY", "locked": True}
                    data["assignments"] = [item]
                    entries = self.feasible(module, data)
                    self.assertEqual(next(a for a in entries if a["date"] == item["date"]), item)

    def test_closed_holiday_cannot_satisfy_positive_mandatory_staffing(self):
            for module in self.models():
                with self.subTest(model=module.__name__):
                    data = holiday_data()
                    data["demands"] = [{"sector": "Reposição", "date": "2026-12-25", "start": 480, "end": 720, "minimum": 1}]
                    self.assertEqual(module.solve(data)["status"], "INFEASIBLE")
                    data["demands"][0].update(estimated=True, minimum=0)
                    entries = self.feasible(module, data)
                    self.assertEqual(next(a for a in entries if a["date"] == "2026-12-25")["kind"], "HOLIDAY")

    def test_untimed_people_also_have_a_holiday_not_a_duty_or_ordinary_rest(self):
            for module in self.models():
                with self.subTest(model=module.__name__):
                    data = holiday_data(); data["employees"][0].update(scheduleMode="UNTIMED", shiftIds=[])
                    entries = self.feasible(module, data)
                    self.assertEqual(next(a for a in entries if a["date"] == "2026-12-25")["kind"], "HOLIDAY")
                    self.assertEqual(sum(a["kind"] == "DUTY" for a in entries), 4)

    def test_fixed_imported_clock_is_preserved_through_the_holiday_week(self):
            for module in self.models():
                with self.subTest(model=module.__name__):
                    data = holiday_data(); later = copy.deepcopy(data["shifts"][0]); later["id"] = "later"
                    for segment in later["segments"]:
                        segment["start"] += 60; segment["end"] += 60
                    data["shifts"].append(later)
                    data["employees"][0].update(shiftIds=["later", "day"], fixedImportedShiftId="day")
                    entries = self.feasible(module, data)
                    self.assertTrue(all(a["shiftId"] == "day" for a in entries if a["kind"] == "WORK"))

    def test_mixed_week_with_a_closed_weekday_never_compensates_to_five_workdays(self):
            data = holiday_data()
            data["mixed42Sectors"] = ["Reposição"]
            data["shifts"][0]["segments"][-1]["end"] = 1020
            data["shifts"].append({"id": "long", "name": "Nove horas", "segments": [
                {"start": 480, "end": 750, "kind": "WORK"}, {"start": 750, "end": 930, "kind": "BREAK"},
                {"start": 930, "end": 1200, "kind": "WORK"}]})
            data["employees"][0]["shiftIds"].append("long")
            entries = self.feasible(solver, data)
            self.assertEqual(sum(a["kind"] == "WORK" for a in entries), 4)
            self.assertLessEqual(sum(a.get("shiftId") == "long" for a in entries), 2)
            self.assertEqual(sum(a["kind"] == "OFF" for a in entries), 2)
