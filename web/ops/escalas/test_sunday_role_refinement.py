"""Role/clock comparability, protected coverage and useful rest search budgets."""
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ortools.sat.python import cp_model
from optimization import (ImprovementContext, Snapshot, _spacing_people,
                          _refinement_phase_budget, improve)
from solver import (_clock_profiles, _weekend_group_key, _spacing_priority,
                    _coverage, days_between)
from test_solver import fixture


class SundayRoleRefinementTests(unittest.TestCase):
    def test_same_sector_does_not_equate_fiscal_and_zelador(self):
        data = fixture(people=2)
        first, second = data['employees']
        first['sector'] = second['sector'] = 'ADMINISTRATIVO'
        first['role'], second['role'] = 'FISCAL DE PREVENÇÃO/PERDAS', 'ZELADOR'
        days = days_between(data['startDate'], data['endDate'])
        profiles = {p['id']: (((480, 720), (780, 1044)),) for p in data['employees']}
        self.assertNotEqual(_weekend_group_key(first, days, profiles),
                            _weekend_group_key(second, days, profiles))
        second['role'] = first['role']
        self.assertEqual(_weekend_group_key(first, days, profiles),
                         _weekend_group_key(second, days, profiles))

    def test_same_function_compares_actual_work_intervals_not_shift_labels(self):
        data = fixture(people=2)
        first, second = data['employees']
        days = days_between(data['startDate'], data['endDate'])
        shifts = {'early': {'segments': [{'start': 480, 'end': 720, 'kind': 'WORK'}]},
                  'late': {'segments': [{'start': 720, 'end': 960, 'kind': 'WORK'}]},
                  'renamed': {'segments': [{'start': 480, 'end': 720, 'kind': 'WORK'}]}}
        choices = {(first['id'], days[0]): {'early': 1}, (second['id'], days[0]): {'late': 1}}
        profiles = _clock_profiles(choices, shifts)
        self.assertNotEqual(_weekend_group_key(first, days, profiles),
                            _weekend_group_key(second, days, profiles))
        choices[second['id'], days[0]] = {'renamed': 1}
        profiles = _clock_profiles(choices, shifts)
        self.assertEqual(_weekend_group_key(first, days, profiles),
                         _weekend_group_key(second, days, profiles))
        self.assertEqual(first['offMode'], 'VARIABLE')
        self.assertEqual(first['fixedOffDays'], [])

    def coverage_case(self, separate_roles, separate_times=False):
        data = fixture(people=2, start_date='2026-12-07')
        day = '2026-12-13'
        first, second = data['employees']
        first['sector'] = second['sector'] = 'ADMINISTRATIVO'
        first['history'] = second['history'] = []
        first['role'] = 'FISCAL DE PREVENÇÃO/PERDAS'
        second['role'] = 'ZELADOR' if separate_roles else first['role']
        shifts = {str(i): {'segments': [{'start': 480 + i * 240 if separate_times else 480,
            'end': 720 + i * 240 if separate_times else 720, 'kind': 'WORK'}]} for i in range(2)}
        data['visibleMonth'], data['storeClosingMinutes'] = '2026-12', 720
        data['demands'] = [{'date': day, 'sector': p['sector'], 'role': p['role'],
            'start': shifts[str(i)]['segments'][0]['start'],
            'end': shifts[str(i)]['segments'][0]['end'], 'minimum': 1, 'estimated': True}
            for i, p in enumerate(data['employees'])]
        model = cp_model.CpModel()
        a, b = model.new_bool_var('fiscal'), model.new_bool_var('other')
        model.add(a + b == 1)
        values = {a.index: 1, b.index: 0}
        choices = {(first['id'], day): {'0': a}, (second['id'], day): {'1': b}}
        guards = {}
        coverage = _coverage(model, data, data['employees'], choices, shifts,
            time.monotonic(), 'ESTIMATED', values, closing_terms={}, role_terms=guards)
        # Combined person-minute deficit ties in the two alternatives.
        model.add(sum(coverage) <= Snapshot(values).value(sum(coverage)))
        for terms in guards.values():
            model.add(sum(terms) <= Snapshot(values).value(sum(terms)))
        model.minimize(a)  # Optional rest aesthetics would prefer the invalid exchange.
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(a), 1)
        self.assertEqual(engine.value(b), 0)
        self.assertEqual(engine.value(sum(coverage)), Snapshot(values).value(sum(coverage)))
        return guards

    def test_role_deficit_cannot_be_transferred_between_fiscal_and_zelador(self):
        guards = self.coverage_case(separate_roles=True)
        self.assertIn(('ADMINISTRATIVO', 'FISCAL DE PREVENÇÃO/PERDAS', 'SUNDAY'), guards)
        self.assertIn(('ADMINISTRATIVO', 'FISCAL DE PREVENÇÃO/PERDAS', 'CLOSING'), guards)

    def test_same_function_does_not_trade_a_morning_gap_for_an_afternoon_gap(self):
        guards = self.coverage_case(separate_roles=False, separate_times=True)
        self.assertIn(('ADMINISTRATIVO', 'FISCAL DE PREVENÇÃO/PERDAS', 'SUNDAY', (480, 720)), guards)
        self.assertIn(('ADMINISTRATIVO', 'FISCAL DE PREVENÇÃO/PERDAS', 'SUNDAY', (720, 960)), guards)

    def test_temporal_role_guards_allow_interleaving_between_sundays(self):
        data = fixture(people=2)
        for p in data['employees']:
            p['history'] = []
        days = ['2026-12-06', '2026-12-13']
        data['demands'] = [{'date': day, 'sector': 'Reposição', 'role': 'Repositor',
                            'start': 480, 'end': 720, 'minimum': 1, 'estimated': True} for day in days]
        model = cp_model.CpModel()
        work = {(p['id'], day): model.new_bool_var('w:' + p['id'] + ':' + day)
                for p in data['employees'] for day in days}
        values = {v.index: int(day == days[0]) for (_, day), v in work.items()}
        for p in data['employees']:
            model.add(sum(work[p['id'], day] for day in days) == 1)
        guards = {}
        coverage = _coverage(model, data, data['employees'],
            {key: {'day': v} for key, v in work.items()}, {'day': data['shifts'][0]},
            time.monotonic(), 'ESTIMATED', values, role_terms=guards)
        for terms in guards.values():
            model.add(sum(terms) <= Snapshot(values).value(sum(terms)))
        model.minimize(sum(coverage))
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(sum(coverage)), 0)
        self.assertEqual([sum(engine.value(work[p['id'], day]) for p in data['employees']) for day in days], [1, 1])

    def common_partition_case(self, boundary_source):
        data = fixture(people=2, weeks=2, start_date='2026-11-30')
        data['visibleMonth'], data['storeClosingMinutes'] = '2026-12', 720
        days = ['2026-12-06', '2026-12-13']
        for person in data['employees']:
            person['history'] = []
        model = cp_model.CpModel()
        work = {(p['id'], day): model.new_bool_var('full:' + p['id'] + ':' + day)
                for p in data['employees'] for day in days}
        choices = {key: {'full': variable} for key, variable in work.items()}
        values = {variable.index: int(day == days[0]) for (_, day), variable in work.items()}
        shifts = {'full': {'segments': [{'start': 480, 'end': 720, 'kind': 'WORK'}]}}
        if boundary_source == 'unselected-clock':
            shifts['partial'] = {'segments': [{'start': 480, 'end': 600, 'kind': 'WORK'}]}
            for person in data['employees']:
                variable = model.new_bool_var('unselected:' + person['id'])
                model.add(variable == 0)
                values[variable.index] = 0
                choices[person['id'], days[1]]['partial'] = variable
        data['demands'] = []
        for day in days:
            intervals = [(480, 600), (600, 720)] if (
                boundary_source == 'reference' and day == days[1]) else [(480, 720)]
            for start, end in intervals:
                data['demands'].append({'date': day, 'sector': 'Reposição', 'role': 'Repositor',
                    'start': start, 'end': end, 'minimum': 3, 'estimated': True})
        for person in data['employees']:
            model.add(sum(work[person['id'], day] for day in days) == 1)
        guards, closing = {}, {}
        coverage = _coverage(model, data, data['employees'], choices, shifts,
            time.monotonic(), 'ESTIMATED', values, closing_terms=closing, role_terms=guards)
        snapshot = Snapshot(values)
        self.assertEqual(snapshot.value(sum(coverage)), 960)
        self.assertEqual(snapshot.value(sum(closing['Reposição'])), 240)
        slots = {key[3] for key in guards if len(key) == 4 and key[2] == 'SUNDAY'}
        self.assertEqual(slots, {(480, 600), (600, 720)})
        # Splitting coefficients creates no minute variables or extra gap model.
        self.assertLessEqual(len(model.proto.variables), 12 if boundary_source == 'unselected-clock' else 8)
        for terms in guards.values():
            model.add(sum(terms) <= snapshot.value(sum(terms)))
        model.add(sum(coverage) <= 960)
        model.add(sum(closing['Reposição']) <= 240)
        balance = model.new_int_var(0, 2, 'date-balance')
        model.add_abs_equality(balance,
            sum(work[p['id'], days[0]] for p in data['employees'])
            - sum(work[p['id'], days[1]] for p in data['employees']))
        model.minimize(balance)
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(balance), 0)
        self.assertEqual([sum(engine.value(work[p['id'], day]) for p in data['employees'])
                          for day in days], [1, 1])
        self.assertEqual(engine.value(sum(coverage)), 960)
        self.assertEqual(engine.value(sum(closing['Reposição'])), 240)
        for terms in guards.values():
            self.assertLessEqual(engine.value(sum(terms)), snapshot.value(sum(terms)))

    def test_common_partition_allows_960_person_minutes_with_unselected_clock_boundary(self):
        self.common_partition_case('unselected-clock')

    def test_common_partition_allows_960_person_minutes_with_reference_boundary(self):
        self.common_partition_case('reference')

    def test_correctable_excess_gets_the_same_priority_in_neighborhood_and_objective(self):
        groups = {'many': ['a', 'b', 'c', 'd'], 'excess': ['e']}
        quality = {'people': {pid: [1, 1] for pid in groups['many']}, 'excess': {pid: 0 for pid in groups['many']}}
        quality['people']['e'], quality['excess']['e'] = [1, 1, 1], 1
        priority = _spacing_priority(quality)
        with patch('optimization.MOVABLE_PEOPLE_LIMIT', 4):
            self.assertEqual(_spacing_people(groups, quality['people'], {}), set(groups['many']))
            self.assertEqual(_spacing_people(groups, priority, {}), {'e'})

    def test_a_pair_required_by_better_coverage_remains_allowed(self):
        model = cp_model.CpModel()
        pair = model.new_bool_var('optional-pair')
        gap = model.new_int_var(0, 1, 'coverage-gap')
        model.add(gap + pair == 1)
        values = {pair.index: 0, gap.index: 1}
        result, _, _ = improve(model, [gap, pair], values, time.monotonic() + 2,
                               ['COVERAGE', 'REST_SPACING'])
        self.assertEqual(result[gap.index], 0)
        self.assertEqual(result[pair.index], 1)

    def test_short_budget_funds_a_real_sunday_attempt_without_extending_deadline(self):
        model = cp_model.CpModel()
        names = ['COVERAGE', 'SUNDAY_COVERAGE', 'CLOSING_COVERAGE', 'UNTIMED_ROTATION',
                 'SUNDAY_BALANCE', 'REST_SPACING', 'STABILITY']
        goals = [model.new_int_var(0, 1, name) for name in names]
        values = {v.index: 1 for v in goals}
        clock = [100.0]
        class Engine:
            def __init__(self): self.parameters = SimpleNamespace()
            def solve(self, _):
                clock[0] += self.parameters.max_time_in_seconds
                return cp_model.UNKNOWN
            def status_name(self, _): return 'UNKNOWN'
        with patch('optimization.time.monotonic', side_effect=lambda: clock[0]), \
                patch('optimization.cp_model.CpSolver', Engine):
            result, proven, phases = improve(model, goals, values, 103.0, names,
                context=ImprovementContext(refinement_reserve_seconds=0.8))
        sunday = next(p for p in phases if p['objective'] == 'SUNDAY_BALANCE')
        self.assertGreaterEqual(sunday['budgetSeconds'], 0.79)
        self.assertLessEqual(clock[0], 103.0)
        self.assertEqual(result, values)
        self.assertFalse(proven)
        self.assertEqual(sunday['status'], 'UNKNOWN')
        self.assertLessEqual(_refinement_phase_budget(0.3, names, 4, 0.8), 0.3)


if __name__ == '__main__':
    unittest.main()
