"""A preferred seed is a hint, never the saved baseline or rule authority."""
import copy
import unittest
from unittest.mock import patch

from optimization import Snapshot
from solver import days_between, solve
from test_solver import fixture


class InitialAssignmentTests(unittest.TestCase):
    def data(self):
        data = fixture(40)
        days = days_between(data['startDate'], data['endDate'])
        data['assignments'] = [dict(employeeId='p0', date=day, kind='WORK', shiftId='day')
                               if i < 5 else dict(employeeId='p0', date=day, kind='OFF')
                               for i, day in enumerate(days)]
        data['_initialAssignments'] = copy.deepcopy(data['assignments'])
        data['_initialAssignments'][3] = dict(employeeId='p0', date=days[3], kind='OFF')
        data['_initialAssignments'][5] = dict(employeeId='p0', date=days[5], kind='WORK', shiftId='day')
        return data

    def keep_seed(self, model, objectives, values, deadline, names, **kwargs):
        return values, False, []

    def test_preferred_two_day_exchange_still_counts_against_original_saved_roster(self):
        data = self.data()
        original = copy.deepcopy(data['assignments'])
        seen = {}
        def inspect(model, objectives, values, deadline, names, **kwargs):
            seen.update({name: Snapshot(values).value(goal) for name, goal in zip(names, objectives)})
            return values, False, []
        with patch('solver.improve', side_effect=inspect):
            result = solve(data)
        self.assertEqual(result['status'], 'FEASIBLE')
        self.assertEqual(result['assignments'], data['_initialAssignments'])
        self.assertEqual(data['assignments'], original)
        self.assertEqual(seen['PEOPLE_CHANGED'], 1)
        self.assertEqual(seen['STABILITY'], 2)

    def test_fixed_weekday_violation_falls_back_to_original_not_infeasibility(self):
        data = self.data()
        data['employees'][0]['fixedOffDays'] = [5]
        with patch('solver.improve', side_effect=self.keep_seed):
            result = solve(data)
        self.assertEqual(result['status'], 'FEASIBLE')
        self.assertEqual(result['assignments'], data['assignments'])

    def test_incomplete_duplicate_unknown_and_over_limit_hints_are_ignored(self):
        for case in ('incomplete', 'duplicate', 'unknown', 'over-limit', 'wrong-shape'):
            with self.subTest(case=case):
                data = self.data()
                if case == 'incomplete':
                    data['_initialAssignments'].pop()
                elif case == 'duplicate':
                    data['_initialAssignments'].append(data['_initialAssignments'][0])
                elif case == 'unknown':
                    data['_initialAssignments'][0]['employeeId'] = 'other-tenant'
                elif case == 'over-limit':
                    data['_initialAssignments'] = data['_initialAssignments'] * 1501
                else:
                    data['_initialAssignments'] = {'not': 'a list'}
                with patch('solver.improve', side_effect=self.keep_seed):
                    result = solve(data)
                self.assertEqual(result['status'], 'FEASIBLE')
                self.assertEqual(result['assignments'], data['assignments'])

    def test_hint_cannot_erase_absence_or_create_a_new_one(self):
        for erase in (False, True):
            with self.subTest(erase=erase):
                data = self.data()
                if erase:
                    data['assignments'][2] = dict(employeeId='p0', date='2026-11-04', kind='ABSENCE')
                else:
                    data['_initialAssignments'][2] = dict(employeeId='p0', date='2026-11-04', kind='ABSENCE')
                with patch('solver.improve', side_effect=self.keep_seed):
                    result = solve(data)
                self.assertEqual(result['status'], 'FEASIBLE')
                self.assertEqual(result['assignments'], data['assignments'])

    def test_hint_cannot_change_a_locked_assignment(self):
        data = self.data()
        data['assignments'][3]['locked'] = True
        with patch('solver.improve', side_effect=self.keep_seed):
            result = solve(data)
        self.assertEqual(result['assignments'], data['assignments'])
        self.assertTrue(result['assignments'][3]['locked'])

    def test_unknown_shift_is_ignored_without_replacing_the_current_reference(self):
        for shift in ('retired', ['day']):
            with self.subTest(shift=shift):
                data = self.data()
                data['_initialAssignments'][5]['shiftId'] = shift
                with patch('solver.improve', side_effect=self.keep_seed):
                    result = solve(data)
                self.assertEqual(result['status'], 'FEASIBLE')
                self.assertEqual(result['assignments'], data['assignments'])

    def test_legacy_call_without_private_hint_preserves_original_contract(self):
        data = self.data()
        del data['_initialAssignments']
        with patch('solver.improve', side_effect=self.keep_seed):
            result = solve(data)
        self.assertEqual(result['assignments'], data['assignments'])


if __name__ == '__main__':
    unittest.main()
