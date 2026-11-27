"""CP-SAT keeps whole-week accounting while rotating inside the visible month."""
import copy
import unittest
from datetime import date

from solver import solve
from contract_fixtures import fixture, make_untimed


class VisibleRestSolverTests(unittest.TestCase):
    def test_six_week_january_has_variation_within_its_four_complete_visible_weeks(self):
        data = fixture(40, people=2, weeks=6, start_date='2026-12-27')
        data.update(branchCode='02', planningWeekStartsOn='SUNDAY', restRulesVersion=3,
                    generationMode='REST_ONLY', visibleMonth='2027-01')
        data['policy']['maxConsecutiveWorkDays'] = 5
        for person in data['employees']:
            person['history'] = []
        make_untimed(data['employees'][1])
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
        for person in data['employees']:
            records = sorted((item for item in result['assignments']
                              if item['employeeId'] == person['id']), key=lambda item: item['date'])
            self.assertEqual(len(records), 42)
            patterns = []
            for start in range(0, 42, 7):
                week = records[start:start + 7]
                self.assertEqual(sum(item['kind'] == 'OFF' for item in week), 2)
                self.assertEqual(sum(item['kind'] in ('WORK', 'DUTY') for item in week), 5)
                self.assertEqual(week[0]['kind'], 'OFF')
                if all(item['date'].startswith('2027-01-') for item in week):
                    patterns.append(tuple(date.fromisoformat(item['date']).weekday()
                                          for item in week if item['kind'] == 'OFF'))
            self.assertEqual(len(patterns), 4)
            self.assertGreater(len(set(patterns)), 1)
        self.assertEqual(data, before)


if __name__ == '__main__':
    unittest.main()
