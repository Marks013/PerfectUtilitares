"""Daily deficit and Saturday fairness must not migrate to another day or group."""
import copy
import time
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model
from optimization import ImprovementContext, Snapshot, improve, _movable_people
from solver import _coverage, _coverage_reference_slices, solve
from test_solver import fixture


class DailyCoverageTests(unittest.TestCase):
    def reference(self, minimum=1, start=480, end=540, role=None, estimated=True):
        return {'date': '2026-11-02', 'sector': 'Caixa', 'start': start,
                'end': end, 'minimum': minimum, 'estimated': estimated,
                **({'role': role} if role else {})}

    def reference_objective(self, demands, people=()):
        model, values, choices, employees = cp_model.CpModel(), {}, {}, []
        for i, (role, present) in enumerate(people):
            pid = f'p{i}'
            variable = model.new_bool_var(pid)
            values[variable.index] = present
            choices[pid, '2026-11-02'] = {'day': variable}
            employees.append({'id': pid, 'sector': 'Caixa', 'role': role, 'history': []})
        data = {'startDate': '2026-11-02', 'endDate': '2026-11-08',
                'policy': fixture()['policy'], 'demands': demands, 'storeClosingMinutes': 540}
        daily, closing, sectors = {}, {}, {}
        terms = _coverage(model, data, employees, choices,
                          {'day': {'segments': [{'start': 480, 'end': 600, 'kind': 'WORK'}]}},
                          time.monotonic(), 'ESTIMATED', values, sector_terms=sectors,
                          closing_terms=closing, daily_terms=daily)
        snapshot = Snapshot(values)
        return snapshot.value(sum(terms)), {key: snapshot.value(sum(items)) for key, items in daily.items()}, \
            {key: snapshot.value(sum(items)) for key, items in closing.items()}

    def test_duplicate_one_hour_estimate_penalizes_one_hour(self):
        row = self.reference()
        before = copy.deepcopy(row)
        result = self.reference_objective([row, copy.deepcopy(row)])
        self.assertEqual(result, (60, {('Caixa', '2026-11-02'): 60}, {'Caixa': 60}))
        self.assertEqual(row, before)

    def test_partial_overlaps_use_highest_floor_only_in_overlap(self):
        rows = [self.reference(2, 480, 540), self.reference(3, 510, 570)]
        result = self.reference_objective(rows)
        self.assertEqual(result[0], 240)  # 30*2 + 30*3 + 30*3.
        self.assertEqual(result[1]['Caixa', '2026-11-02'], 240)
        self.assertEqual(result[2]['Caixa'], 150)

    def test_role_maxima_sum_without_adding_general_reference_again(self):
        rows = [self.reference(2, role='Caixa'), self.reference(1, role='Caixa'),
                self.reference(1, role='Fiscal'), self.reference(3)]
        self.assertEqual(self.reference_objective(rows)[0], 180)
        self.assertEqual(self.reference_objective(rows, [('Caixa', 1), ('Fiscal', 1)])[0], 60)
        self.assertEqual(self.reference_objective(rows, [('Caixa', 1), ('Caixa', 1)])[0], 60)
        self.assertEqual(self.reference_objective(rows, [('Caixa', 1), ('Caixa', 1), ('Fiscal', 1)])[0], 0)

    def test_total_surplus_does_not_cancel_missing_distinct_function(self):
        rows = [self.reference(1, role='Caixa'), self.reference(1, role='Fiscal'), self.reference(2)]
        self.assertEqual(self.reference_objective(rows, [('Caixa', 1), ('Caixa', 1), ('Caixa', 1)])[0], 60)

    def test_confirmed_and_estimated_targets_stay_separate_and_immutable(self):
        rows = [self.reference(1, estimated=False), self.reference(3, role='Caixa', estimated=False),
                self.reference(2, role='Caixa', estimated=False), self.reference(1, role='Fiscal', estimated=False),
                self.reference(8, role='Caixa')]
        before = copy.deepcopy(rows)
        slices = list(_coverage_reference_slices(rows))
        hard = next(row for row in slices if not row['estimated'])
        soft = next(row for row in slices if row['estimated'])
        self.assertEqual((hard['minimum'], hard['roles']), (4, {'Caixa': 3, 'Fiscal': 1}))
        self.assertEqual((soft['minimum'], soft['roles']), (8, {'Caixa': 8}))
        self.assertEqual(rows, before)

    def test_hard_role_floor_remains_a_constraint_even_with_general_surplus(self):
        model = cp_model.CpModel()
        present = model.new_bool_var('wrong-role')
        data = {'startDate': '2026-11-02', 'endDate': '2026-11-08', 'policy': fixture()['policy'],
                'demands': [self.reference(1, role='Fiscal', estimated=False)] * 2}
        result = _coverage(model, data, [{'id': 'p', 'sector': 'Caixa', 'role': 'Caixa', 'history': []}],
                           {('p', '2026-11-02'): {'day': present}},
                           {'day': {'segments': [{'start': 480, 'end': 540, 'kind': 'WORK'}]}},
                           time.monotonic(), 'HARD')
        self.assertEqual(result, [])
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 1
        self.assertEqual(engine.solve(model), cp_model.INFEASIBLE)

    def coverage_model(self):
        model = cp_model.CpModel()
        monday = model.new_bool_var('monday')
        tuesday = model.new_bool_var('tuesday')
        model.add(monday + tuesday == 1)
        values = {monday.index: 1, tuesday.index: 0}
        days = ['2026-11-02', '2026-11-03']
        data = {'startDate': days[0], 'endDate': '2026-11-08', 'policy': fixture()['policy'],
                'demands': [{'date': day, 'sector': 'Caixa', 'start': 480, 'end': 540,
                             'minimum': 1, 'estimated': True} for day in days]}
        daily, sectors = {}, {}
        coverage = _coverage(model, data, [{'id': 'p', 'sector': 'Caixa', 'role': 'Caixa', 'history': []}],
            {('p', days[0]): {'day': monday}, ('p', days[1]): {'day': tuesday}},
            {'day': {'segments': [{'start': 480, 'end': 540, 'kind': 'WORK'}]}},
            time.monotonic(), 'ESTIMATED', values, sector_terms=sectors, daily_terms=daily)
        return model, values, monday, tuesday, coverage, sectors, daily

    def test_same_total_does_not_authorize_moving_deficit_to_a_previously_staffed_day(self):
        model, values, monday, tuesday, coverage, sectors, daily = self.coverage_model()
        protected = [sum(terms) for group in (sectors, daily) for terms in group.values()]
        actual, _, _ = improve(model, [sum(coverage), monday], values, time.monotonic() + 1,
            ['COVERAGE', 'PREFERENCES'],
            context=ImprovementContext(protected_groups={'COVERAGE': protected}))
        self.assertEqual([actual[monday.index], actual[tuesday.index]], [1, 0])
        self.assertEqual([Snapshot(actual).value(sum(daily['Caixa', day]))
                          for day in ('2026-11-02', '2026-11-03')], [0, 60])

    def test_daily_guards_allow_a_real_improvement_without_a_sacrificed_day(self):
        model, values, monday, tuesday, coverage, sectors, daily = self.coverage_model()
        # Permit both days to be staffed: the independent oracle is (1, 1), no deficit.
        model.proto.constraints[0].linear.domain.clear()
        model.proto.constraints[0].linear.domain.extend([1, 2])
        protected = [sum(terms) for group in (sectors, daily) for terms in group.values()]
        actual, _, _ = improve(model, [sum(coverage)], values, time.monotonic() + 1, ['COVERAGE'],
            context=ImprovementContext(protected_groups={'COVERAGE': protected}))
        self.assertEqual([actual[monday.index], actual[tuesday.index]], [1, 1])
        self.assertEqual(Snapshot(actual).value(sum(coverage)), 0)

    def test_shared_shortage_keeps_each_dates_minutes_and_adds_no_variable(self):
        model = cp_model.CpModel()
        data = {'startDate': '2026-11-02', 'endDate': '2026-11-08', 'policy': fixture()['policy'],
                'demands': [{'date': day, 'sector': 'Caixa', 'start': 480, 'end': end,
                             'minimum': 2, 'estimated': True}
                            for day, end in [('2026-11-02', 540), ('2026-11-03', 600)]]}
        values, daily = {}, {}
        coverage = _coverage(model, data, [], {}, {}, time.monotonic(), 'ESTIMATED', values,
                             daily_terms=daily)
        self.assertEqual(len(model.proto.variables), 1)
        self.assertEqual(Snapshot(values).value(sum(coverage)), 360)
        self.assertEqual([Snapshot(values).value(sum(terms)) for terms in daily.values()], [120, 240])

    def test_production_protects_saturday_and_daily_groups_from_the_first_phase(self):
        data = fixture(40, people=3)
        data['demands'] = [{'date': data['startDate'], 'sector': 'Reposição', 'start': 480,
                            'end': 540, 'minimum': 2, 'estimated': True}]
        captured = []
        native = improve
        def inspect(model, objectives, values, deadline, names=None, *, context=None):
            captured.extend(context.protected_groups['COVERAGE'])
            return native(model, objectives, values, deadline, names, context=context)
        with patch('solver.improve', inspect):
            result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        names = {variable.name for expression in captured
                 for variable in cp_model.FlatIntExpr(expression).vars}
        self.assertTrue(any(name.startswith('weekend-spread:5:') for name in names))
        # A weekly fixture registers the same shortage under horizon and civil-date scopes.
        gaps = [expression for expression in captured
                if any(v.name.startswith('coverage-gap:') for v in cp_model.FlatIntExpr(expression).vars)]
        self.assertGreaterEqual(len(gaps), 2)

    def test_saturday_neighborhood_uses_saturday_rates_not_sunday_rates(self):
        model = cp_model.CpModel()
        variables, values = [], {}
        for weekday, scores in [(6, [0, 10000, 5000, 5000]), (5, [5000, 5000, 0, 10000])]:
            for pid, score in zip('abcd', scores):
                variable = model.new_int_var(0, 10000, f'weekend-rate:{weekday}:{pid}')
                variables.append(variable)
                values[variable.index] = score
        self.assertEqual(_movable_people(variables, values, [['a', 'b'], ['c', 'd']],
                                         limit=2, weekday=5), {'c', 'd'})
        self.assertEqual(_movable_people(variables, values, [['a', 'b'], ['c', 'd']], limit=2), {'a', 'b'})


if __name__ == '__main__':
    unittest.main()
