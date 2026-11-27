"""Real CP-SAT tests for operational v3, synthetic data only."""
import copy
import unittest
from datetime import date

from solver import solve
from contract_fixtures import fixture, make_untimed
from model_input import ModelInputError


def scenario(branch='02', weeks=4):
    data = fixture(42, people=2, weeks=weeks, start_date='2026-11-29')
    data.update(branchCode=branch, planningWeekStartsOn='SUNDAY', restRulesVersion=3, generationMode='REST_ONLY')
    data['policy']['maxConsecutiveWorkDays'] = 5
    for person in data['employees']:
        person['history'] = []
    return data


class ExplicitRestSolverTests(unittest.TestCase):
    def test_closed_sunday_and_variable_second_rest_with_timed_and_untimed_people(self):
        data = scenario()
        make_untimed(data['employees'][1])
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
        for person in data['employees']:
            records = [a for a in result['assignments'] if a['employeeId'] == person['id']]
            self.assertTrue(all(a['kind'] == 'OFF' for a in records if date.fromisoformat(a['date']).weekday() == 6))
            patterns = []
            for i in range(0, len(records), 7):
                week = sorted(records, key=lambda a: a['date'])[i:i+7]
                self.assertEqual(sum(a['kind'] == 'OFF' for a in week), 2)
                self.assertEqual(sum(a['kind'] in ('WORK', 'DUTY') for a in week), 5)
                patterns.append(tuple(date.fromisoformat(a['date']).weekday() for a in week if a['kind'] == 'OFF'))
            self.assertGreater(len(set(patterns)), 1)
        self.assertEqual(data, before)

    def test_explicit_two_days_are_preserved_and_disabled_day_is_not_fixed(self):
        data = scenario()
        first, second = data['employees']
        first.update(offMode='FIXED', fixedOffDays=[2, 6], fixedRestSlots=[dict(enabled=True, weekday=2), dict(enabled=True, weekday=6)])
        second.update(offMode='VARIABLE', fixedOffDays=[], fixedRestSlots=[dict(enabled=False, weekday=2), dict(enabled=False, weekday=6)])
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
        self.assertTrue(all(a['kind'] == 'OFF' for a in result['assignments']
                            if a['employeeId'] == first['id'] and date.fromisoformat(a['date']).weekday() in (2, 6)))
        self.assertTrue(any(a['kind'] == 'WORK' for a in result['assignments']
                            if a['employeeId'] == second['id'] and date.fromisoformat(a['date']).weekday() == 2))

    def test_hours_only_cannot_move_sunday_work_or_invent_missing_days(self):
        data = scenario(weeks=1)
        generated = solve(data)
        self.assertIn(generated['status'], ('OPTIMAL', 'FEASIBLE'))
        data['assignments'] = generated['assignments']; data['generationMode'] = 'HOURS_ONLY'
        sunday = next(a for a in data['assignments'] if a['employeeId'] == 'p0' and a['date'] == data['startDate'])
        sunday.update(kind='WORK', shiftId='day')
        before = copy.deepcopy(data)
        self.assertEqual(solve(data)['status'], 'INFEASIBLE')
        self.assertEqual(data, before)

    def test_invalid_projection_and_three_mandatory_rests_are_not_silently_repaired(self):
        data = scenario(weeks=1)
        data['employees'][0].update(fixedRestSlots=[dict(enabled=True, weekday=2), dict(enabled=False, weekday=6)])
        with self.assertRaises(ModelInputError):
            solve(data)
        data['employees'][0].update(offMode='FIXED', fixedOffDays=[1, 3],
                                   fixedRestSlots=[dict(enabled=True, weekday=1), dict(enabled=True, weekday=3)])
        self.assertEqual(solve(data)['status'], 'INFEASIBLE')

    def test_sunday_mandatory_demand_remains_an_explicit_conflict(self):
        data = scenario(weeks=1)
        data['demands'] = [dict(id='real', date=data['startDate'], sector='Reposição', start=480, end=720, minimum=1)]
        self.assertEqual(solve(data)['status'], 'INFEASIBLE')

    def test_ordinary_closed_sunday_never_replaces_absence_or_paid_holiday(self):
        data = scenario(weeks=2)
        data['assignments'] = [dict(employeeId='p0', date=data['startDate'], kind='ABSENCE')]
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
        record = next(a for a in result['assignments'] if a['employeeId'] == 'p0' and a['date'] == data['startDate'])
        self.assertEqual(record['kind'], 'ABSENCE')
        self.assertFalse(any(a['kind'] == 'HOLIDAY' for a in result['assignments']))


if __name__ == '__main__':
    unittest.main()
