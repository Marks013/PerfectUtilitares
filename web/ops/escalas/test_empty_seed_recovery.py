"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import days_between
from contract_fixtures import fixture
from solver import solve
import copy
import unittest

def recovery_fixture(mode, optional_seed=False, locked_target=False):
    data = fixture(40, people=3, start_date='2026-12-06')
    data.update(generationMode=mode, planningWeekStartsOn='SUNDAY', restRulesVersion=2,
                visibleMonth='2026-12', simulation=True)
    dates = days_between(data['startDate'], data['endDate'])
    target = '2026-12-11'
    for person in data['employees']:
        for day in dates:
            off = day in (data['startDate'], target)
            entry = {'employeeId': person['id'], 'date': day, 'kind': 'OFF' if off else 'WORK'}
            if not off:
                entry['shiftId'] = 'day'
            if locked_target and day == target:
                entry['locked'] = True
            data['assignments'].append(entry)
    for day in dates:
        if day == data['startDate']:
            continue
        demand = {'sector': 'Reposição', 'date': day, 'start': 480, 'end': 720}
        data['demands'].append({**demand, 'minimum': 1 if day == target else 2,
                                'estimated': day == target})
    if optional_seed:
        data['_initialAssignments'] = copy.deepcopy(data['assignments'])
    return data, target

class EmptySeedRecoveryTests(unittest.TestCase):
    def test_final_solution_recovers_empty_sector_without_sacrificing_mandatory_coverage(self):
        for mode, optional_seed, locked in (('REST_ONLY', False, False),
                                            ('DAYS_AND_HOURS', False, False),
                                            ('REST_ONLY', True, False),
                                            ('REST_ONLY', True, True)):
            with self.subTest(mode=mode, optional_seed=optional_seed, locked=locked):
                data, target = recovery_fixture(mode, optional_seed, locked)
                before = copy.deepcopy(data)
                self.assertFalse(any(a['date'] == target and a['kind'] == 'WORK'
                                     for a in data['assignments']))
                result = solve(data)
                self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
                entries = {(a['employeeId'], a['date']): a for a in result['assignments']}
                self.assertEqual(len(entries), 21)
                for person in data['employees']:
                    duties = [a for (pid, _), a in entries.items() if pid == person['id']]
                    self.assertEqual(len(duties), 7)
                    self.assertEqual(sum(a.get('shiftId') == 'day' and a['kind'] == 'WORK'
                                         for a in duties), 5)
                    self.assertEqual(sum(a['kind'] == 'OFF' for a in duties), 2)
                for demand in data['demands']:
                    present = sum(day == demand['date'] and a['kind'] == 'WORK'
                                  for (_, day), a in entries.items())
                    if demand['estimated'] and locked:
                        self.assertEqual(present, 0)
                    else:
                        self.assertGreaterEqual(present, demand['minimum'])
                for entry in data['assignments']:
                    if entry.get('locked'):
                        self.assertEqual(entries[entry['employeeId'], entry['date']], entry)
                self.assertEqual(data, before)
