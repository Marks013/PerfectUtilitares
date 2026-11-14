"""Objective admission and truthful fallback metadata; focused regressions."""
import copy
import unittest
from datetime import date
from unittest.mock import patch

from ortools.sat.python import cp_model
import solver
from optimization import ImprovementContext, improve
from test_solver import fixture


class ObjectiveNameContracts(unittest.TestCase):
    def test_mismatched_names_fail_before_accessing_or_mutating_the_model(self):
        class UntouchedModel:
            def __getattr__(self, name):
                raise AssertionError('model accessed before cardinality validation')
        for names in ([], ['COVERAGE'], ['COVERAGE', 'REST_SPACING', 'STABILITY']):
            with self.subTest(names=names):
                with self.assertRaisesRegex(ValueError, '^objective/name count mismatch$'):
                    improve(UntouchedModel(), [0, 0], {}, 104.0, names)

    def test_matching_and_default_names_keep_every_constant_objective(self):
        for names, expected in ((None, ['OBJECTIVE_1', 'OBJECTIVE_2']),
                                (['COVERAGE', 'REST_SPACING'], ['COVERAGE', 'REST_SPACING'])):
            with self.subTest(names=names):
                model = cp_model.CpModel()
                with patch('optimization.time.monotonic', return_value=100.0), \
                        patch('optimization.cp_model.CpSolver') as engine:
                    values, _, phases = improve(model, [0, 0], {}, 104.0, names)
                self.assertEqual(values, {})
                self.assertEqual([phase['objective'] for phase in phases], expected)
                engine.assert_not_called()

    def test_internal_repeated_coverage_repairs_do_not_violate_input_cardinality(self):
        model = cp_model.CpModel()
        variable = model.new_bool_var('o:p:2026-12-06')
        context = ImprovementContext(
            decision_variables={variable.index: ('p', '2026-12-06')},
            initial_repair_groups=[{'p'}])
        with patch('optimization.time.monotonic', return_value=100.0), \
                patch('optimization.cp_model.CpSolver') as engine:
            values, _, phases = improve(model, [variable], {variable.index: 0},
                                        104.0, ['COVERAGE'], context=context)
        self.assertEqual(values[variable.index], 0)
        self.assertEqual([phase['objective'] for phase in phases], ['COVERAGE'])
        engine.assert_not_called()


class EarlyRefinementContracts(unittest.TestCase):
    def test_interrupted_estimates_keep_the_verified_seed_and_honest_metadata(self):
        for interrupted, reason in ((False, 'TIME_BUDGET'),
                                    ('estimated construction interrupted', 'BOUNDED_REFINEMENT')):
            with self.subTest(reason=reason):
                data = fixture(people=1, weeks=1)
                data['restRulesVersion'] = 2
                person = data['employees'][0]
                data['assignments'] = []
                for day in solver.days_between(data['startDate'], data['endDate']):
                    resting = date.fromisoformat(day).weekday() in (2, 6)
                    entry = {'employeeId': person['id'], 'date': day,
                             'kind': 'OFF' if resting else 'WORK'}
                    if not resting:
                        entry['shiftId'] = 'day'
                    data['assignments'].append(entry)
                data['demands'] = [{'date': '2026-11-03', 'sector': person['sector'],
                    'role': person['role'], 'start': 480, 'end': 720,
                    'minimum': 1, 'estimated': True}]
                original_coverage = solver._coverage
                original_read = solver._read_assignments
                verified_seeds = []

                def interrupt_estimates(model, document, people, choices, shifts, started,
                                        scope='ALL', *args, **kwargs):
                    if scope == 'ESTIMATED':
                        return interrupted
                    return original_coverage(model, document, people, choices, shifts,
                                             started, scope, *args, **kwargs)

                def capture_seed(*args, **kwargs):
                    roster = original_read(*args, **kwargs)
                    verified_seeds.append(copy.deepcopy(roster))
                    return roster

                with patch('solver._coverage', side_effect=interrupt_estimates), \
                        patch('solver._read_assignments', side_effect=capture_seed), \
                        patch('solver.improve') as refinement:
                    result = solver.solve(data)
                self.assertEqual(result['status'], 'FEASIBLE')
                self.assertEqual(len(verified_seeds), 1)
                self.assertTrue(verified_seeds[0])
                self.assertEqual(result['assignments'], verified_seeds[0])
                refinement.assert_not_called()
                metadata = result['optimization']
                self.assertEqual(metadata['phases'], [])
                self.assertEqual(metadata['unattemptedObjectives'], ['COVERAGE'])
                self.assertEqual(metadata['stopReason'], reason)
                self.assertEqual(metadata['budgetSeconds'], 12)
                self.assertEqual(set(metadata), {'budgetSeconds', 'phases',
                    'unattemptedObjectives', 'constructionSeconds', 'feasibilitySeconds',
                    'refinementSeconds', 'stopReason'})
                for key in ('constructionSeconds', 'feasibilitySeconds', 'refinementSeconds'):
                    self.assertGreaterEqual(metadata[key], 0)
                    self.assertLessEqual(metadata[key], result['wallTimeSeconds'])


if __name__ == '__main__':
    unittest.main()
