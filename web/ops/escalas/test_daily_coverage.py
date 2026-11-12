"""Daily deficit and Saturday fairness must not migrate to another day or group."""
import time
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model
from optimization import ImprovementContext, Snapshot, improve, _movable_people
from solver import _coverage, solve
from test_solver import fixture


class DailyCoverageTests(unittest.TestCase):
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
