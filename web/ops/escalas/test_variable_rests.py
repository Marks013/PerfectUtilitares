"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
from contract_fixtures import make_untimed
from datetime import date
from datetime import timedelta
from solver import solve
import copy
import unittest

class RestSpacingTests(unittest.TestCase):
    def test_saved_variable_triple_is_repaired_without_removing_locks(self):
        data = fixture(40, weeks=2)
        data['employees'][0]['history'] = []
        offs = {'2026-11-04', '2026-11-08', '2026-11-09', '2026-11-10'}
        data['assignments'] = []
        for index in range(14):
            day = (date.fromisoformat(data['startDate']) + timedelta(days=index)).isoformat()
            assignment = {'employeeId': 'p0', 'date': day, 'kind': 'OFF' if day in offs else 'WORK'}
            if assignment['kind'] == 'WORK':
                assignment['shiftId'] = 'day'
            if day == '2026-11-08':
                assignment['locked'] = True
            data['assignments'].append(assignment)
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        sequence = 0
        for assignment in result['assignments']:
            sequence = sequence + 1 if assignment['kind'] == 'OFF' else 0
            self.assertLessEqual(sequence, 2)
        locked = next(entry for entry in result['assignments'] if entry['date'] == '2026-11-08')
        self.assertEqual(locked, next(entry for entry in before['assignments'] if entry['date'] == '2026-11-08'))
        phases = [entry['objective'] for entry in result['optimization']['phases']]
        self.assertIn('REST_SPACING', phases)
        self.assertEqual(data, before)

class UntimedRotationTests(unittest.TestCase):
    def test_untimed_rotation_runs_before_cosmetic_goals_and_varies_weekday_rests(self):
        data = fixture(40, weeks=4)
        person = data["employees"][0]
        make_untimed(person)
        person["history"] = []
        data["assignments"] = [{"employeeId": "p0", "date": (date.fromisoformat(data["startDate"]) + timedelta(days=index)).isoformat(),
                                "kind": "OFF" if index % 7 in (0, 6) else "DUTY"} for index in range(28)]
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        phases = [entry["objective"] for entry in result["optimization"]["phases"]]
        self.assertIn("UNTIMED_ROTATION", phases)
        if "SATURDAY_BALANCE" in phases:
            self.assertLess(phases.index("UNTIMED_ROTATION"), phases.index("SATURDAY_BALANCE"))
        off_weekdays = [date.fromisoformat(entry["date"]).weekday() for entry in result["assignments"] if entry["kind"] == "OFF"]
        self.assertGreater(len(set(off_weekdays)), 2)
        self.assertTrue(all(entry["kind"] in ("OFF", "DUTY") for entry in result["assignments"]))
        self.assertEqual(data, before)
