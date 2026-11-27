"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
from datetime import date
from datetime import timedelta
from solver import solve
import copy
import unittest

class ModelRuleTests(unittest.TestCase):
    def test_legacy_six_day_cap_cannot_allow_six_across_weeks(self):
        data = fixture(42, weeks=2)
        data["policy"]["maxConsecutiveWorkDays"] = 6
        # Thursday through the following Tuesday: each calendar week could still have five days.
        data["assignments"] = [{"employeeId": "p0", "date": (date(2026, 11, 5) + timedelta(days=offset)).isoformat(),
                                "kind": "WORK", "shiftId": "day", "locked": True} for offset in range(6)]
        before = copy.deepcopy(data)
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        self.assertEqual(data, before)

    def test_known_previous_month_five_days_force_a_rest_on_first_day(self):
        data = fixture(42, start_date="2026-11-02")
        person = data["employees"][0]
        person["history"] = [{"employeeId": "p0", "date": (date(2026, 10, 28) + timedelta(days=offset)).isoformat(),
                               "kind": "WORK", "shiftId": "day"} for offset in range(5)]
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(result["assignments"][0]["kind"], "OFF")

    def test_short_pause_opt_in_produces_real_complete_assignments(self):
        data = fixture(42)
        data["simulation"] = True
        data["employees"][0]["simulationDailyMinutes"] = 300
        data["shifts"][0]["segments"] = [{"start": 480, "end": 780, "kind": "WORK"}]
        self.assertEqual(solve(data)["status"], "INFEASIBLE")
        data["policy"]["allowShortMealSimulation"] = True
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(sum(entry["kind"] == "WORK" for entry in result["assignments"]), 5)
        self.assertEqual(sum(entry["kind"] == "OFF" for entry in result["assignments"]), 2)
        data["assignments"] = [{"employeeId": "p0", "date": data["startDate"], "kind": "ABSENCE"}]
        result = solve(data)
        self.assertEqual(result["assignments"][0]["kind"], "ABSENCE")

    def test_overnight_work_must_not_occupy_an_absence_civil_date(self):
        data = fixture()
        data['simulation'] = True
        data['shifts'].append({'id': 'night', 'name': 'Night', 'segments': [
            {'start': 1200, 'end': 1440, 'kind': 'WORK'},
            {'start': 1440, 'end': 1500, 'kind': 'BREAK'},
            {'start': 1500, 'end': 1764, 'kind': 'WORK'}]})
        data['employees'][0]['shiftIds'].append('night')
        data['assignments'] = [
            {'employeeId': 'p0', 'date': '2026-11-02', 'kind': 'WORK', 'shiftId': 'night', 'locked': True},
            {'employeeId': 'p0', 'date': '2026-11-03', 'kind': 'ABSENCE'}]
        before = copy.deepcopy(data)
        self.assertEqual(solve(data)['status'], 'INFEASIBLE')
        self.assertEqual(data, before)
        data['assignments'] = [data['assignments'][1]]
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertEqual(next(a for a in result['assignments'] if a['date'] == '2026-11-03')['kind'], 'ABSENCE')
        for entry in result['assignments']:
            if entry['kind'] == 'WORK':
                from solver import occupied_dates
                shift = next(s for s in data['shifts'] if s['id'] == entry['shiftId'])
                self.assertNotIn('2026-11-03', occupied_dates(entry['date'], shift))

    def test_excluded_learner_has_no_allocations_but_keeps_protected_records(self):
        data = fixture(people=2)
        learner = data['employees'][1]
        learner.update(role='AUX. DE SERVIÇOS EM SUPER', planningEnabled=False)
        protected = {'employeeId': learner['id'], 'date': data['startDate'], 'kind': 'ABSENCE'}
        data['assignments'] = [protected]
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertEqual([a for a in result['assignments'] if a['employeeId'] == learner['id']], [protected])

    def test_absent_week_remains_absent_without_fictitious_rest(self):
        data = fixture(42)
        data["assignments"] = [{"employeeId": "p0", "date": (date(2026, 11, 2) + timedelta(days=offset)).isoformat(),
                                "kind": "ABSENCE"} for offset in range(7)]
        result = solve(data)
        self.assertIn(result["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertTrue(all(entry["kind"] == "ABSENCE" for entry in result["assignments"]))
