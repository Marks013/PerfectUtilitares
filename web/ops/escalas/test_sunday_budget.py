"""Net Sunday search time, charged preparation and incumbent preservation."""
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from ortools.sat.python import cp_model
import optimization
from optimization import ImprovementContext, Snapshot, improve
from solver import _coverage
from test_solver import fixture


class SundayBudgetTests(unittest.TestCase):
    def test_preparation_and_repeated_repairs_leave_both_net_sunday_reserves(self):
        model = cp_model.CpModel()
        names = ['COVERAGE', 'SUNDAY_COVERAGE', 'CLOSING_COVERAGE',
                 'UNTIMED_ROTATION', 'SUNDAY_BALANCE', 'REST_SPACING']
        goals = [model.new_int_var(0, 1, name) for name in names]
        decisions = {model.new_bool_var(f'w:p:{day}').index: ('p', day)
                     for day in ('2026-12-06', '2026-12-13', '2026-12-20',
                                 '2026-12-27', '2026-12-01', '2026-12-02',
                                 '2026-12-03', '2026-12-04')}
        values = {i: 1 for i in range(len(model.proto.variables))}
        clock, starts = [100.0], []
        clone = cp_model.CpModel.clone
        floor = optimization._objective_floor

        def charged_clone(instance):
            clock[0] += 0.18
            return clone(instance)

        def charged_floor(*args):
            clock[0] += 0.06
            return floor(*args)

        class Engine:
            def __init__(self): self.parameters = SimpleNamespace()
            def solve(self, _):
                starts.append((clock[0], self.parameters.max_time_in_seconds))
                clock[0] += self.parameters.max_time_in_seconds
                return cp_model.UNKNOWN
            def status_name(self, _): return 'UNKNOWN'

        context = ImprovementContext(decision_variables=decisions,
            initial_repair_groups=[{'p'}] * 4, refinement_reserve_seconds=0.8)
        with patch('optimization.time.monotonic', side_effect=lambda: clock[0]), \
                patch('optimization.cp_model.CpSolver', Engine), \
                patch('optimization.cp_model.CpModel.clone', charged_clone), \
                patch('optimization._objective_floor', side_effect=charged_floor), \
                patch('optimization.LARGE_MODEL_VARIABLES', 0):
            result, proven, phases = improve(model, goals, values, 106.0, names,
                                               context=context)
        for name in ('SUNDAY_COVERAGE', 'SUNDAY_BALANCE'):
            phase = next(p for p in phases if p['objective'] == name)
            self.assertGreaterEqual(phase['budgetSeconds'], 0.8)
            self.assertGreaterEqual(phase['preparationSeconds'], 0.24)
            self.assertEqual(phase['status'], 'UNKNOWN')
            self.assertEqual(phase['initialValue'], phase['incumbentValue'])
            self.assertNotIn('bestBound', phase)
        self.assertTrue(starts)
        self.assertTrue(all(start + budget <= 105.9 + 1e-9 for start, budget in starts))
        self.assertLessEqual(clock[0], 105.9 + 1e-9)
        self.assertEqual(result, values)
        self.assertFalse(proven)

    def test_setup_spike_uses_only_actual_deadline_residual_and_reports_it(self):
        for setup, expected in ((0.4, 0.5), (0.85, None)):
            with self.subTest(setup=setup):
                model = cp_model.CpModel()
                goal = model.new_bool_var('sunday-gap')
                decisions = {model.new_bool_var(f'w:p:2026-12-{day:02d}').index:
                             ('p', f'2026-12-{day:02d}') for day in range(1, 9)}
                values = {i: 1 for i in range(len(model.proto.variables))}
                clock, calls = [100.0], []
                clone = cp_model.CpModel.clone

                def charged_clone(instance):
                    clock[0] += setup
                    return clone(instance)

                class Engine:
                    def __init__(self): self.parameters = SimpleNamespace()
                    def solve(self, _):
                        calls.append((clock[0], self.parameters.max_time_in_seconds))
                        clock[0] += self.parameters.max_time_in_seconds
                        return cp_model.UNKNOWN
                    def status_name(self, _): return 'UNKNOWN'

                with patch('optimization.time.monotonic', side_effect=lambda: clock[0]), \
                        patch('optimization.cp_model.CpSolver', Engine), \
                        patch('optimization.cp_model.CpModel.clone', charged_clone), \
                        patch('optimization.LARGE_MODEL_VARIABLES', 0):
                    result, proven, phases = improve(model, [0, goal], values, 101.0,
                        ['COVERAGE', 'SUNDAY_BALANCE'], context=ImprovementContext(
                            decision_variables=decisions, refinement_reserve_seconds=0.8))
                searched = [p for p in phases if p['objective'] == 'SUNDAY_BALANCE']
                if expected is None:
                    self.assertFalse(calls)
                    self.assertFalse(searched)  # Remains unattempted, never UNKNOWN/OPTIMAL.
                else:
                    self.assertEqual(searched[0]['budgetSeconds'], expected)
                    self.assertEqual(searched[0]['preparationSeconds'], setup)
                    self.assertEqual(searched[0]['status'], 'UNKNOWN')
                    self.assertTrue(all(start + budget <= 100.9 + 1e-9 for start, budget in calls))
                self.assertLessEqual(clock[0], 100.9 + 1e-9)
                self.assertEqual(result, values)
                self.assertFalse(proven)

    def test_synchronized_compatible_sundays_can_improve_with_every_guard(self):
        data = fixture(people=2, weeks=2, start_date='2026-11-30')
        days = ['2026-12-06', '2026-12-13']
        data['visibleMonth'], data['storeClosingMinutes'] = '2026-12', 720
        data['demands'] = [{'date': day, 'sector': 'Reposição', 'role': 'Repositor',
            'start': 480, 'end': 720, 'minimum': 3, 'estimated': True} for day in days]
        model = cp_model.CpModel()
        work = {(p['id'], day): model.new_bool_var(f'w:{p["id"]}:{day}')
                for p in data['employees'] for day in days}
        values = {v.index: int(day == days[0]) for (_, day), v in work.items()}
        for person in data['employees']:
            model.add(sum(work[person['id'], day] for day in days) == 1)
        guards, closing = {}, {}
        gaps = _coverage(model, data, data['employees'],
            {key: {'day': v} for key, v in work.items()},
            {'day': {'segments': [{'start': 480, 'end': 720, 'kind': 'WORK'}]}},
            time.monotonic(), 'ESTIMATED', values, role_terms=guards, closing_terms=closing)
        balance = model.new_int_var(0, 2, 'balance')
        model.add_abs_equality(balance, sum(work[p['id'], days[0]] - work[p['id'], days[1]]
                                           for p in data['employees']))
        values[balance.index] = 2
        protected = [sum(gaps)] + [sum(v) for v in guards.values()] + [sum(v) for v in closing.values()]
        before = [Snapshot(values).value(v) for v in protected]
        result, _, phases = improve(model, [sum(gaps), balance], values,
            time.monotonic() + 2, ['COVERAGE', 'SUNDAY_BALANCE'],
            context=ImprovementContext(protected_groups={'COVERAGE': protected},
                                       refinement_reserve_seconds=0.8))
        self.assertEqual(result[balance.index], 0)
        self.assertTrue(all(Snapshot(result).value(v) <= bound for v, bound in zip(protected, before)))
        self.assertEqual([sum(result[work[p['id'], day].index] for p in data['employees'])
                          for day in days], [1, 1])
