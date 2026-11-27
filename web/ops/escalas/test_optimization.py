"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
import copy
import unittest

class SearchContinuationTests(unittest.TestCase):
    def test_all_nonempty_goals_run_with_a_real_baseline_and_preferences(self):
        import solver as scheduling
        data = fixture(people=3, weeks=1)
        days = scheduling.days_between(data['startDate'], data['endDate'])
        data['assignments'] = [{'employeeId': p['id'], 'date': day,
            'kind': 'WORK' if index < 5 else 'OFF', **({'shiftId': 'day'} if index < 5 else {})}
            for p in data['employees'] for index, day in enumerate(days)]
        for person in data['employees']:
            person['preferredOffDays'] = [4]
        data['demands'] = [{'date': days[0], 'sector': 'Reposição', 'start': 480,
                            'end': 720, 'minimum': 2, 'estimated': True}]
        before = copy.deepcopy(data)
        result = scheduling.solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        phases = result['optimization']['phases']
        from test_sunday_production import production_goal_names
        active = {'COVERAGE', 'SUNDAY_BALANCE', 'REST_SPACING', 'SATURDAY_BALANCE',
                  'REST_DISTRIBUTION', 'REST_ROTATION', 'PEOPLE_CHANGED', 'STABILITY', 'PREFERENCES', 'TIE_BREAK'}
        self.assertEqual([p['objective'] for p in phases], [name for name in production_goal_names() if name in active])
        self.assertTrue(all(p['incumbentValue'] <= p['initialValue'] for p in phases))
        self.assertEqual(data, before)
        self.assertGreaterEqual(sum(a['kind'] == 'WORK' for a in result['assignments'] if a['date'] == days[0]), 2)
        shifts = {s['id']: s for s in data['shifts']}
        for person in data['employees']:
            paid = sum(scheduling.shift_metrics(shifts[a['shiftId']])[0] for a in result['assignments']
                       if a['employeeId'] == person['id'] and a['kind'] == 'WORK')
            self.assertEqual(paid, person['weeklyHours'] * 60)
        self.assertTrue(all(phase['status'] in ('OPTIMAL', 'FEASIBLE') for phase in phases))
        self.assertEqual(len(result['assignments']), 21)
