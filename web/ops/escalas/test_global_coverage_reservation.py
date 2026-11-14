"""Coverage scheduling preserves a usable global consumer inside its cutoff."""
import time
import unittest
from unittest.mock import patch
from ortools.sat.python import cp_model
import optimization
from optimization import ImprovementContext, improve


class GlobalCoverageReservationTests(unittest.TestCase):
    def test_four_local_repairs_cannot_consume_global_preparation_and_search(self):
        model = cp_model.CpModel()
        decisions = {model.new_bool_var('calendar').index: ('p' + str(i), day)
                     for i in range(4) for day in ('2026-12-21', '2026-12-27')}
        values = {index: 1 for index in decisions}
        objective = sum(model.get_int_var_from_proto_index(i) for i in decisions)
        clock, calls, built = [100.0], [], []
        class Observe:
            def checkpoint(self):
                pass
            def solve(self, engine, current):
                global_scope = all(tuple(current.proto.variables[i].domain) == (0, 1) for i in decisions)
                calls.append((global_scope, clock[0], engine.parameters.max_time_in_seconds))
                clock[0] += engine.parameters.max_time_in_seconds + .005
                # A scheduling counterexample, deliberately making no quality claim.
                return cp_model.UNKNOWN
        def builder(current, deadline, control):
            built.append((clock[0], deadline))
            clock[0] += min(.59, deadline - clock[0] - .001)
            return dict(current)
        context = ImprovementContext(control=Observe(), decision_variables=decisions,
            initial_repair_groups=[{'p' + str(i)} for i in range(4)],
            coverage_hint_builder=builder, refinement_reserve_seconds=.8)
        with patch('optimization.time.monotonic', side_effect=lambda: clock[0]):
            result, _, phases = improve(model, [objective, objective, objective], values,
                112, ['COVERAGE', 'SUNDAY_COVERAGE', 'SUNDAY_BALANCE'], context=context)
        coverage = [p for p in phases if p['objective'] == 'COVERAGE']
        global_phases = [p for p in coverage if p['searchScope'] == 'GLOBAL']
        self.assertEqual(len(global_phases), 1)
        self.assertEqual(len(built), 1)
        self.assertEqual(len(coverage), 5)
        self.assertGreaterEqual(global_phases[0]['budgetSeconds'], .8)
        self.assertLessEqual(len(calls), 7)
        self.assertEqual(result, values)
        self.assertTrue(all(start + budget <= 111.9 + 1e-8 for _, start, budget in calls))
        for name in ('SUNDAY_COVERAGE', 'SUNDAY_BALANCE'):
            self.assertGreaterEqual(next(p['budgetSeconds'] for p in phases if p['objective'] == name), .8)
        print('RESERVATION_SCHEDULE', dict(coverage=[(p['searchScope'], p['budgetSeconds'],
            p.get('preparationSeconds', 0)) for p in coverage], calls=len(calls), builderCalls=len(built)))


    def test_global_skip_reports_real_preparation_without_claiming_search(self):
        for mode, horizon, expected in (
                ('admission', .25, 'INSUFFICIENT_ALLOCATION'),
                ('preparation', 1.0, 'PREPARATION_EXHAUSTED'),
                ('deadline', .05, 'DEADLINE')):
            with self.subTest(mode=mode):
                model = cp_model.CpModel()
                decision = model.new_bool_var('calendar')
                values, clock = {decision.index: 1}, [100.0]
                def builder(current, deadline, control):
                    self.assertEqual(mode, 'preparation')
                    clock[0] += 1.0
                    return None
                context = ImprovementContext(decision_variables={decision.index: ('p', '2026-12-21')},
                                             coverage_hint_builder=builder)
                with patch('optimization.time.monotonic', side_effect=lambda: clock[0]), \
                        patch.object(cp_model.CpSolver, 'solve', side_effect=AssertionError('No CP allowed')):
                    result, _, phases = improve(model, [decision], values, 100 + horizon,
                                               ['COVERAGE'], context=context)
                self.assertEqual(result, values)
                self.assertEqual(len(phases), 1)
                phase = phases[0]
                self.assertEqual(phase['searchSkippedReason'], expected)
                self.assertEqual(phase['status'], 'UNKNOWN')
                self.assertEqual((phase['budgetSeconds'], phase['wallTimeSeconds']), (0, 0))
                self.assertEqual(phase['preparationSeconds'], 1 if mode == 'preparation' else 0)
                self.assertEqual(phase['decisionHintStatus'], 'DEADLINE' if mode == 'preparation' else 'NO_TIME')
                self.assertNotIn('bestBound', phase)
                print('NO_SEARCH', mode, phase)

    def test_small_production_cp_runs_four_repairs_and_one_global_with_guards(self):
        import copy
        import solver
        from test_solver import fixture
        from test_sunday_composed_hint import scenario
        template = scenario()
        data = fixture(42, people=8, weeks=3, start_date='2026-11-30')
        data.update(restRulesVersion=2, visibleMonth='2026-12', generationMode='REST_ONLY')
        data['shifts'] = copy.deepcopy(template['shifts'])
        dates = solver.days_between(data['startDate'], data['endDate'])
        pattern = 'WWWWOWO' * 2 + 'WWWOOWW'
        for i, person in enumerate(data['employees']):
            person.update(sector='Sector' + str(i // 2), maxConsecutiveSundays=1,
                          shiftIds=['day', 'alternate'])
            for day, kind in zip(dates, pattern):
                entry = dict(employeeId=person['id'], date=day, kind='WORK' if kind == 'W' else 'OFF')
                if kind == 'W':
                    entry['shiftId'] = 'day'
                if i == 0 and day == dates[0]:
                    entry['locked'] = True
                data['assignments'].append(entry)
        for sector in range(4):
            for demand in template['demands']:
                if demand['sector'] == 'Local':
                    row = {**demand, 'sector': 'Sector' + str(sector), 'role': 'Repositor'}
                    row.pop('roles', None)
                    data['demands'].append(row)
        original = copy.deepcopy(data)
        calls, captured = [], []
        real_improve = solver.improve
        def observe(model, objectives, values, deadline, names, *, context):
            before = dict(values)
            result = real_improve(model, objectives, values, deadline, names, context=context)
            final, _, phases = result
            for guard in context.protected_groups['COVERAGE']:
                self.assertLessEqual(optimization.Snapshot(final).value(guard),
                                     optimization.Snapshot(before).value(guard))
            self.assertLessEqual(optimization.Snapshot(final).value(objectives[0]),
                                 optimization.Snapshot(before).value(objectives[0]))
            captured.append(phases)
            return result
        class Observe:
            def checkpoint(self):
                pass
            def solve(self, engine, model):
                calls.append((time.monotonic(), engine.parameters.max_time_in_seconds,
                              engine.parameters.num_workers))
                return engine.solve(model)
        started = time.monotonic()
        with patch('solver._rest_repair_groups', return_value=[{'p0'}, {'p2'}, {'p4'}, {'p6'}]), \
                patch('solver.improve', side_effect=observe), \
                patch('solver._coverage', wraps=solver._coverage) as coverage_builder:
            result = solver.solve(data, Observe())
        self.assertTrue(any(call.kwargs.get('role_terms') for call in coverage_builder.call_args_list))
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        phases = captured[0]
        coverage = [p for p in phases if p['objective'] == 'COVERAGE']
        self.assertEqual(len(coverage), 5)
        self.assertEqual([p['searchScope'] for p in coverage], ['SELECTED_PEOPLE'] * 4 + ['GLOBAL'])
        self.assertTrue(all(p['budgetSeconds'] > 0 for p in coverage))
        self.assertEqual(coverage[-1]['decisionHintStatus'], 'COMPLETE_DECISIONS')
        self.assertTrue(all('searchSkippedReason' not in p for p in coverage))
        self.assertTrue(all(workers == 1 and call_time + budget <= started + 12.001
                            for call_time, budget, workers in calls))
        self.assertEqual(data, original)
        for entry in result['assignments']:
            if entry['kind'] == 'WORK':
                self.assertEqual(entry['shiftId'], 'day')
        locked = next(e for e in result['assignments'] if e['employeeId'] == 'p0' and e['date'] == dates[0])
        self.assertTrue(locked['locked'])
        self.assertEqual(locked['kind'], 'WORK')
        print('REAL_CP_RESERVATION', dict(coverage=[(p['searchScope'], p['initialValue'],
            p['incumbentValue'], p['budgetSeconds'], p.get('preparationSeconds')) for p in coverage],
            cpCalls=len(calls), hintStatus=coverage[-1]['decisionHintStatus'],
            elapsed=round(time.monotonic() - started, 3), coverageGuardsPreserved=True))


if __name__ == '__main__':
    unittest.main()
