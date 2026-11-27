"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
import solver
import time
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
                data["demands"] = [{"date": "2026-12-25", "sector": "Reposição", "start": 480, "end": 720, "minimum": 2, "estimated": True}]
                result = module._coverage(module.cp_model.CpModel(), data, [], {}, {}, time.monotonic())
                self.assertEqual(result, [])
