"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
from datetime import date
from datetime import timedelta
from solver import solve
import time
import unittest

class ProductionSundayTests(unittest.TestCase):
    def test_changed_weekly_hours_do_not_lock_an_obsolete_saved_shift(self):
        import copy
        data = fixture(40)
        old = copy.deepcopy(data['shifts'][0])
        old['id'] = 'old-42h'
        old['segments'][-1]['end'] += 24
        data['shifts'].append(old)
        data['employees'][0]['shiftIds'].append(old['id'])
        data['assignments'] = [{'employeeId': 'p0', 'date': (date.fromisoformat(data['startDate']) + timedelta(days=i)).isoformat(),
                                'kind': 'WORK' if i < 5 else 'OFF', **({'shiftId': old['id']} if i < 5 else {})} for i in range(7)]
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        working = [entry for entry in result['assignments'] if entry['kind'] == 'WORK']
        self.assertEqual(len(working), 5)
        self.assertTrue(all(entry['shiftId'] == 'day' for entry in working))

    def test_invalid_saved_roster_does_not_become_a_hard_constraint(self):
        data = fixture(40)
        data['assignments'] = [{'employeeId': 'p0', 'date': (date.fromisoformat(data['startDate']) + timedelta(days=i)).isoformat(),
                                'kind': 'WORK', 'shiftId': 'day'} for i in range(7)]
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertEqual(sum(entry['kind'] == 'WORK' for entry in result['assignments']), 5)

    def test_disabled_people_keep_only_their_existing_protected_records(self):
        data = fixture(people=2)
        data['employees'][1]['planningEnabled'] = False
        absence = {'employeeId': 'p1', 'date': '2026-11-02', 'kind': 'ABSENCE'}
        locked = {'employeeId': 'p1', 'date': '2026-11-03', 'kind': 'WORK',
                  'shiftId': 'day', 'locked': True}
        data['assignments'] = [absence, locked,
                               {'employeeId': 'p1', 'date': '2026-11-04', 'kind': 'OFF'}]
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertEqual([a for a in result['assignments'] if a['employeeId'] == 'p1'],
                         [absence, locked])
        self.assertEqual(len(result['assignments']), 9)

    def test_retained_disabled_work_does_not_satisfy_staffing_demand(self):
        data = fixture(people=2)
        data['employees'][1].update(planningEnabled=False, sector='Caixa')
        locked = {'employeeId': 'p1', 'date': '2026-11-03', 'kind': 'WORK',
                  'shiftId': 'day', 'locked': True}
        data['assignments'] = [locked]
        data['demands'] = [{'id': 'required', 'date': '2026-11-03', 'sector': 'Caixa',
                            'start': 480, 'end': 720, 'minimum': 1}]
        result = solve(data)
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertEqual(result['assignments'], [])
        self.assertEqual(data['assignments'], [locked])

    def test_shipped_solver_attempts_sunday_before_saturday(self):
        data = fixture(people=3)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertEqual(len(result['assignments']), 21)
        names = [phase['objective'] for phase in result['optimization']['phases']]
        self.assertIn('SUNDAY_BALANCE', names)
        self.assertIn('SATURDAY_BALANCE', names)
        self.assertLess(names.index('SUNDAY_BALANCE'), names.index('SATURDAY_BALANCE'))

    def test_expired_hint_budget_returns_without_a_partial_person(self):
        from hints import balanced_rest_hints
        from solver import instant, sunday_limit
        data = fixture()
        result = balanced_rest_hints(data['employees'], ['2026-11-02'], {}, {}, {}, {},
                                     data['policy'], instant, sunday_limit, deadline=time.monotonic() - 1)
        self.assertEqual(result, {})
