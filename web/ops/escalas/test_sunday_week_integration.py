"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
from model_input import validate_model_input
from planning_calendar import planning_weeks
import copy
import unittest

def locked_roster(data, rests, long_days=()):
    """A concrete calendar is the oracle; no optimizer-selected pattern is assumed."""
    holidays = set(data['policy'].get('paidHolidayDates', []))
    data['assignments'] = []
    for person in data['employees']:
        for week in planning_weeks(data):
            for day in week['dates']:
                kind = 'HOLIDAY' if day in holidays else 'OFF' if day in rests else 'WORK'
                if kind == 'WORK' and person.get('scheduleMode') == 'UNTIMED':
                    kind = 'DUTY'
                entry = {'employeeId': person['id'], 'date': day, 'kind': kind, 'locked': True}
                if kind == 'WORK':
                    entry['shiftId'] = 'long' if day in long_days else 'day'
                data['assignments'].append(entry)

class SundayWeekBoundaryTests(unittest.TestCase):
    def test_legacy_and_explicit_monday_inputs_remain_unchanged(self):
        for calendar in ({}, {'planningWeekStartsOn': 'MONDAY'}):
            data = fixture(40)
            data.update(calendar)
            before = copy.deepcopy(data)
            validate_model_input(data)
            self.assertEqual(data, before)
            self.assertEqual(planning_weeks(data)[0]['dates'][-1], '2026-11-08')
