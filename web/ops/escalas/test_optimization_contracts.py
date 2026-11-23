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


class RejectionStageContracts(unittest.TestCase):
    def test_input_and_coverage_checks_reject_before_search(self):
        incomplete = fixture()
        incomplete['generationMode'] = 'HOURS_ONLY'
        no_clock = fixture()
        person = no_clock['employees'][0]
        no_clock['demands'] = [{'date': '2026-11-03', 'sector': person['sector'],
                               'role': person['role'], 'start': 720, 'end': 780, 'minimum': 1}]

        for data, stage, family in ((incomplete, 'INPUT_CHECK', 'BLOCKS'),
                                    (no_clock, 'COVERAGE_CHECK', 'COVERAGE')):
            with self.subTest(stage=stage), patch('solver.cp_model.CpSolver') as engine:
                result = solver.solve(data)
                self.assertEqual(result['status'], 'INFEASIBLE')
                self.assertEqual(result['rejectionStage'], stage)
                self.assertEqual(result['assignments'], [])
                self.assertEqual(result['solverDiagnostics'][0]['family'], family)
                engine.assert_not_called()

    def test_rejected_fixed_seed_yields_to_unrestricted_search(self):
        data = fixture()
        search_modes = []

        class Control:
            def checkpoint(self):
                pass

            def solve(self, engine, model):
                fixed = engine.parameters.fix_variables_to_their_hinted_value
                search_modes.append(fixed)
                return cp_model.INFEASIBLE if fixed else engine.solve(model)

        with patch('solver._seed_hint_state', return_value='COMPLETE'):
            result = solver.solve(data, Control())
        self.assertEqual(search_modes[0], True)
        self.assertIn(False, search_modes)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertNotIn('rejectionStage', result)

    def test_unrestricted_search_proves_incompatible_coverage(self):
        data = fixture()
        person = data['employees'][0]
        data['demands'] = [{'date': '2026-11-03', 'sector': person['sector'],
                            'role': person['role'], 'start': 480, 'end': 720, 'minimum': 2}]
        result = solver.solve(data)
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertEqual(result['rejectionStage'], 'SEARCH')
        self.assertEqual(result['assignments'], [])


class EarlyRefinementContracts(unittest.TestCase):
    def test_skipped_search_is_unattempted_unless_a_real_phase_or_member_accounts_for_it(self):
        data = fixture(people=2)
        data['assignments'] = [{'employeeId': 'p0', 'date': '2026-11-08', 'kind': 'OFF'}]
        data['demands'] = [{'date': '2026-11-08', 'sector': 'Reposição',
                            'start': 480, 'end': 720, 'minimum': 1, 'estimated': True}]
        skipped = {'objective': 'COVERAGE', 'status': 'UNKNOWN', 'searchScope': 'GLOBAL',
                   'searchSkippedReason': 'PREPARATION_EXHAUSTED'}
        polish = {'objective': 'POLISH', 'status': 'FEASIBLE',
                  'members': [{'objective': 'SUNDAY_COVERAGE'},
                              {'objective': 'STABILITY', 'searchSkippedReason': 'DEADLINE'}]}
        local = {'objective': 'COVERAGE', 'status': 'UNKNOWN', 'searchScope': 'SELECTED_PEOPLE'}

        for phases, coverage_unattempted in (([skipped, polish], True), ([local, skipped, polish], False)):
            with self.subTest(coverage_unattempted=coverage_unattempted):
                def refine(_model, _objectives, values, _deadline, names, **_kwargs):
                    self.assertTrue({'COVERAGE', 'SUNDAY_COVERAGE', 'STABILITY'}.issubset(names))
                    return values, False, phases

                with patch('solver.improve', side_effect=refine):
                    result = solver.solve(data)
                self.assertEqual(result['status'], 'FEASIBLE')
                self.assertEqual(result['optimization']['phases'], phases)
                unattempted = result['optimization']['unattemptedObjectives']
                self.assertEqual('COVERAGE' in unattempted, coverage_unattempted)
                self.assertNotIn('SUNDAY_COVERAGE', unattempted)
                self.assertIn('STABILITY', unattempted)

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
