"""Focused regressions for the shipped Sunday scheduling policy."""
import ast
from pathlib import Path
import time
import unittest
from unittest.mock import patch
from datetime import date, timedelta

from ortools.sat.python import cp_model
from optimization import ImprovementContext, Snapshot, improve, _movable_people, _coverage_people
from solver import _feasibility_hints, solve
from test_solver import fixture
from weekend_balance import available_weekends, weekend_objectives


def production_goal_names():
    # Read the actual construction order; do not maintain a smaller test-only list.
    tree = ast.parse(Path(__file__).with_name('solver.py').read_text(encoding='utf-8'))
    goals = next(node.value for node in ast.walk(tree)
                 if isinstance(node, ast.Assign) and isinstance(node.value, ast.List)
                 and any(isinstance(target, ast.Name) and target.id == 'goals'
                         for target in node.targets))
    return [entry.elts[0].value for entry in goals.elts]


class ProductionSundayTests(unittest.TestCase):
    def test_original_domain_bound_cache_is_reused_without_reading_fixed_clone_domains(self):
        from optimization import _objective_floor
        model = cp_model.CpModel()
        variable = model.new_int_var(-3, 8, 'value')
        cache = {}
        terms = ((variable.index,), (-2,), 5)
        self.assertEqual(_objective_floor(model, terms, cache), -11)
        self.assertEqual(cache, {variable.index: (-3, 8)})
        clone = model.clone()
        clone.proto.variables[variable.index].domain.clear()
        clone.proto.variables[variable.index].domain.extend([0, 0])
        self.assertEqual(_objective_floor(clone, terms), 5)
        self.assertEqual(_objective_floor(model, terms, cache), -11)
        self.assertEqual(tuple(model.proto.variables[variable.index].domain), (-3, 8))

    def test_direct_decision_fixing_preserves_every_other_sector_and_cancel_checkpoints(self):
        model = cp_model.CpModel()
        days = [(date(2026, 11, 2) + timedelta(days=i)).isoformat() for i in range(42)]
        work = {(pid, day): model.new_bool_var(f'w:{pid}:{day}') for pid in ('p', 'q', 'r', 's', 't', 'u') for day in days}
        changed = {pid: model.new_bool_var('changed:' + pid) for pid in ('p', 'q')}
        padding = [model.new_int_var(0, 0, f'padding:{i}') for i in range(3000)]
        values = {variable.index: 0 for variable in [*work.values(), *changed.values(), *padding]}
        values[work['p', days[0]].index] = 1
        values[changed['p'].index] = 1
        decisions = {variable.index: key for key, variable in work.items()}
        testcase = self
        class Inspect:
            checkpoints = 0
            def checkpoint(self):
                self.checkpoints += 1
            def solve(self, engine, current):
                for index, (pid, _day) in decisions.items():
                    if pid != 'p':
                        testcase.assertEqual(tuple(current.proto.variables[index].domain), (values[index], values[index]))
                return engine.solve(current)
        control = Inspect()
        actual, _, phases = improve(model, [0, work['p', days[0]], -work['q', days[0]]], values,
            time.monotonic() + 2, ['COVERAGE', 'STABILITY', 'PREFERENCES'], context=ImprovementContext(control=control,
            decision_variables=decisions, coverage_groups={'first': ['p'], 'other': ['q', 'r', 's', 't', 'u']}))
        self.assertGreaterEqual(control.checkpoints, 3)
        self.assertEqual(actual[work['p', days[0]].index], 0)
        self.assertEqual(actual[work['q', days[0]].index], 0)
        self.assertEqual(tuple(model.proto.variables[work['q', days[0]].index].domain), (0, 1))
        self.assertEqual(phases[-1]['searchScope'], 'SELECTED_PEOPLE')
        self.assertEqual(phases[-1]['movablePeople'], 1)

    def test_joint_polish_can_exchange_distant_weeks_in_its_bounded_sector(self):
        model = cp_model.CpModel()
        days = [(date(2026, 11, 2) + timedelta(days=i)).isoformat() for i in range(21)]
        rests = {(pid, day): model.new_bool_var(f'o:{pid}:{day}') for pid in ('p', 'q') for day in days}
        first, second = rests['p', days[6]], rests['p', days[13]]
        model.add(first == second)
        for variable in rests.values():
            if variable.index not in (first.index, second.index):
                model.add(variable == 0)
        preference = model.new_bool_var('preference')
        model.add(preference + first == 1)
        coverage = model.new_int_var(0, 0, 'coverage')
        padding = [model.new_int_var(0, 0, f'padding:{i}') for i in range(3000)]
        values = {variable.index: int(variable.index in (first.index, second.index))
                  for variable in [*rests.values(), preference, coverage, *padding]}
        actual, proven, phases = improve(model, [coverage, first + second, -preference], values,
            time.monotonic() + 2, ['COVERAGE', 'STABILITY', 'PREFERENCES'],
            context=ImprovementContext(protected_groups={'COVERAGE': [coverage]}, coverage_groups={'sector': ['p', 'q']}))
        self.assertEqual((actual[first.index], actual[second.index], actual[preference.index]), (0, 0, 1))
        self.assertEqual(actual[coverage.index], 0)
        self.assertFalse(proven)
        self.assertEqual(phases[-1]['objective'], 'PREFERENCES')
        self.assertEqual(phases[1]['searchScope'], 'SELECTED_PEOPLE')
        self.assertEqual(phases[1]['movablePeople'], 2)

    def test_lower_priority_never_spends_the_higher_priority_incumbent(self):
        model = cp_model.CpModel()
        stability, preference = model.new_bool_var('stability'), model.new_bool_var('preference')
        model.add(stability == preference)
        values = {stability.index: 0, preference.index: 0}
        actual, proven, phases = improve(model, [stability, -preference], values,
            time.monotonic() + 1, ['STABILITY', 'PREFERENCES'])
        self.assertEqual(actual, values)
        self.assertTrue(proven)
        self.assertEqual([phase['objective'] for phase in phases], ['STABILITY', 'PREFERENCES'])
        self.assertTrue(all(phase['incumbentValue'] <= phase['initialValue'] for phase in phases))

    def test_unknown_phases_return_the_exact_incumbent_and_separate_metrics(self):
        model = cp_model.CpModel()
        stability, preference = model.new_bool_var('stability'), model.new_bool_var('preference')
        values = {stability.index: 1, preference.index: 0}
        class Unknown:
            def checkpoint(self):
                pass
            def solve(self, _engine, _model):
                return cp_model.UNKNOWN
        actual, proven, phases = improve(model, [stability, -preference], values,
            time.monotonic() + 1, ['STABILITY', 'PREFERENCES'], context=ImprovementContext(control=Unknown()))
        self.assertEqual(actual, values)
        self.assertFalse(proven)
        self.assertEqual(phases[0]['status'], 'UNKNOWN')
        self.assertEqual([(phase['objective'], phase['initialValue'], phase['incumbentValue'])
                          for phase in phases], [('STABILITY', 1, 1), ('PREFERENCES', 0, 0)])

    def test_joint_integer_scaling_accepts_large_metrics_and_negative_preferences(self):
        model = cp_model.CpModel()
        metric, preference = model.new_int_var(0, 10**9, 'metric'), model.new_bool_var('preference')
        values = {metric.index: 10**9, preference.index: 0}
        actual, proven, phases = improve(model, [metric, -preference], values,
            time.monotonic() + 1, ['REST_DISTRIBUTION', 'PREFERENCES'])
        self.assertEqual(model.validate(), '')
        self.assertEqual((actual[metric.index], actual[preference.index]), (0, 1))
        self.assertTrue(proven)
        self.assertEqual(phases[-1]['incumbentValue'], -1)

    def test_joint_neighborhood_is_bounded_to_one_changed_sector(self):
        from optimization import _polish_people
        model = cp_model.CpModel()
        variables = [model.new_bool_var(f'changed:p{i:02}') for i in range(40)]
        values = {variable.index: int(i >= 20) for i, variable in enumerate(variables)}
        selected = _polish_people(variables, values, [[f'p{i:02}' for i in range(20)], [f'p{i:02}' for i in range(20, 40)]])
        self.assertEqual(len(selected), 18)
        self.assertTrue(selected.issubset({f'p{i:02}' for i in range(20, 40)}))

    def test_a_too_short_phase_is_unattempted_not_reported_as_optimal(self):
        from unittest.mock import patch
        model = cp_model.CpModel()
        goal = model.new_bool_var('goal')
        values = {goal.index: 1}
        with patch('optimization._phase_budget', return_value=.05), patch.object(cp_model.CpSolver, 'solve') as search:
            actual, proven, phases = improve(model, [goal], values, time.monotonic() + 1, ['STABILITY'])
        search.assert_not_called()
        self.assertEqual(actual, values)
        self.assertFalse(proven)
        self.assertEqual(phases, [])

    def test_bulk_hints_preserve_exact_indexes_and_values_after_replacement(self):
        from optimization import _replace_hints
        model = cp_model.CpModel()
        first, second = model.new_bool_var('first'), model.new_int_var(-3, 4, 'second')
        model.add_hint(first, 0)
        _replace_hints(model, {second.index: -2, first.index: 1})
        actual = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
        self.assertEqual(actual, {first.index: 1, second.index: -2})
        self.assertEqual(len(model.proto.solution_hint.vars), 2)

    def test_production_untimed_rotation_precedes_sunday_fairness_and_spacing_guards(self):
        names = production_goal_names()
        self.assertLess(names.index('COVERAGE'), names.index('UNTIMED_ROTATION'))
        self.assertLess(names.index('SUNDAY_COVERAGE'), names.index('UNTIMED_ROTATION'))
        self.assertLess(names.index('CLOSING_COVERAGE'), names.index('UNTIMED_ROTATION'))
        self.assertLess(names.index('UNTIMED_ROTATION'), names.index('SUNDAY_BALANCE'))
        self.assertLess(names.index('UNTIMED_ROTATION'), names.index('REST_SPACING'))

    def test_full_production_budget_funds_leadership_and_untimed_with_both_rest_phases(self):
        from optimization import _phase_budget, MIN_PHASE_BUDGET, MIN_SEARCH_SECONDS
        names = production_goal_names()
        for required in ('COVERAGE', 'SUNDAY_COVERAGE', 'REST_SPACING', 'LEADERSHIP', 'UNTIMED_ROTATION'):
            self.assertIn(required, names)
        remaining, allocations = 10.0, {}
        for index, name in enumerate(names):
            budget = _phase_budget(remaining, names, index)
            allocations[name] = budget
            if name in ('PEOPLE_CHANGED', 'STABILITY', 'PREFERENCES', 'TIE_BREAK'):
                self.assertEqual(budget, 0)  # Operational grants were fully consumed.
                continue
            self.assertGreaterEqual(budget + 1e-9, MIN_PHASE_BUDGET, name)
            # Full allocation consumption, including up to one search-floor
            # worth of preparation, must leave a usable CP allowance.
            self.assertGreaterEqual(budget - MIN_SEARCH_SECONDS + 1e-9, MIN_SEARCH_SECONDS, name)
            remaining -= budget
        self.assertAlmostEqual(allocations['COVERAGE'], 5.5)
        self.assertGreater(allocations['SUNDAY_COVERAGE'], allocations['STABILITY'])
        self.assertGreater(allocations['UNTIMED_ROTATION'], allocations['PREFERENCES'])
        self.assertLess(allocations['SUNDAY_COVERAGE'] + allocations['REST_SPACING'], 4.5)
        self.assertAlmostEqual(sum(allocations.values()), 10.0)
        self.assertAlmostEqual(remaining, 0)

    def test_short_production_budget_admits_a_prefix_and_never_subfloor_searches(self):
        from optimization import _phase_budget, MIN_PHASE_BUDGET
        names = production_goal_names()
        for total in (2.0, MIN_PHASE_BUDGET, MIN_PHASE_BUDGET - .01):
            remaining, attempted = total, []
            for index, name in enumerate(names):
                budget = _phase_budget(remaining, names, index)
                self.assertLessEqual(budget, remaining + 1e-9)
                if budget:
                    self.assertGreaterEqual(budget + 1e-9, MIN_PHASE_BUDGET, name)
                    attempted.append(name)
                remaining -= budget  # No optimistic early return from a phase.
            self.assertEqual(attempted, names[:len(attempted)])
            self.assertGreaterEqual(remaining, -1e-9)
            if total == 2.0:
                self.assertIn('LEADERSHIP', attempted)
                self.assertIn('UNTIMED_ROTATION', attempted)
                self.assertNotIn('TIE_BREAK', attempted)
            elif total < MIN_PHASE_BUDGET:
                self.assertEqual(attempted, [])

    def test_actual_improve_consumes_phase_budgets_without_claiming_unknown_as_optimized(self):
        names = production_goal_names()
        for total, expected_count in ((10.0, len(names) - 4), (2.0, 10), (.19, 0)):
            model = cp_model.CpModel()
            gap = model.new_bool_var('gap')
            initial = {gap.index: 1}

            class ConsumeAllowance:
                now = 0.0

                def checkpoint(self):
                    pass

                def solve(self, engine, current):
                    # Consume the entire actual grant; never invoke CP here.
                    self.now += engine.parameters.max_time_in_seconds
                    return cp_model.UNKNOWN

            control = ConsumeAllowance()
            with patch('optimization.time.monotonic', side_effect=lambda: control.now):
                actual, proven, phases = improve(model, [gap] * len(names), initial,
                    total + .1, names, context=ImprovementContext(control=control))
            self.assertFalse(proven)
            self.assertEqual(actual, initial)
            self.assertEqual([p['objective'] for p in phases], names[:expected_count])
            self.assertTrue(all(p['searchScope'] == 'GLOBAL' for p in phases))
            self.assertTrue(all(p['status'] == 'UNKNOWN' and p['budgetSeconds'] >= .1 for p in phases))
            self.assertLessEqual(control.now, total + 1e-9)
            if total >= 2:
                self.assertIn('LEADERSHIP', [p['objective'] for p in phases])
                self.assertIn('UNTIMED_ROTATION', [p['objective'] for p in phases])

    def test_secondary_goals_improve_without_spending_coverage_or_sunday_guards(self):
        model = cp_model.CpModel()
        coverage = model.new_int_var(0, 0, 'coverage')
        sunday = model.new_int_var(0, 0, 'sunday')
        fairness = model.new_bool_var('fairness')
        stability = model.new_bool_var('stability')
        preference = model.new_bool_var('preference')
        values = {coverage.index: 0, sunday.index: 0, fairness.index: 1, stability.index: 1, preference.index: 0}
        actual, proven, phases = improve(model, [coverage, fairness, stability, -preference], values,
            time.monotonic() + 1, ['COVERAGE', 'SUNDAY_BALANCE', 'STABILITY', 'PREFERENCES'],
            context=ImprovementContext(protected_groups={'COVERAGE': [coverage, sunday]}))
        self.assertEqual([actual[v.index] for v in (coverage, sunday, fairness, stability, preference)], [0, 0, 0, 0, 1])
        self.assertFalse(proven)
        self.assertEqual([phase['objective'] for phase in phases],
                         ['COVERAGE', 'SUNDAY_BALANCE', 'STABILITY', 'PREFERENCES'])
        self.assertEqual(phases[2]['incumbentValue'], 0)
        self.assertEqual(phases[3]['incumbentValue'], -1)
        self.assertEqual(phases[0]['budgetSeconds'], 0)
        self.assertTrue(all(phase['status'] == 'OPTIMAL' for phase in phases))

    def test_a_border_gain_cannot_pay_for_a_visible_month_sector_or_sunday_loss(self):
        from solver import _coverage
        for protect_visible in (False, True):
            with self.subTest(protect_visible=protect_visible):
                data = fixture(40, weeks=6, start_date='2026-10-26')
                data['visibleMonth'] = '2026-11'
                data['employees'][0]['history'] = []
                data['demands'] = [
                    {'id': 'border', 'date': '2026-12-06', 'sector': 'Reposição', 'start': 480, 'end': 720, 'minimum': 1, 'estimated': True},
                    {'id': 'visible', 'date': '2026-11-01', 'sector': 'Reposição', 'start': 480, 'end': 600, 'minimum': 1, 'estimated': True},
                ]
                model = cp_model.CpModel()
                border, visible = model.new_bool_var('border'), model.new_bool_var('visible')
                model.add(border + visible == 1)
                choices = {('p0', '2026-12-06'): {'day': border}, ('p0', '2026-11-01'): {'day': visible}}
                values = {border.index: 0, visible.index: 1}
                sectors, sundays, monthly_sectors, monthly_sundays = {}, {}, {}, {}
                goals = _coverage(model, data, data['employees'], choices, {shift['id']: shift for shift in data['shifts']},
                                  time.monotonic(), 'ESTIMATED', values, sundays, sectors, monthly_sundays, monthly_sectors)
                self.assertEqual(Snapshot(values).value(sum(goals)), 240)
                self.assertEqual(Snapshot(values).value(sum(monthly_sectors['Reposição'])), 0)
                self.assertEqual(Snapshot(values).value(sum(monthly_sundays['Reposição'])), 0)
                guards = [sum(terms) for terms in sectors.values()] + [sum(terms) for terms in sundays.values()]
                if protect_visible:
                    guards += [sum(terms) for terms in monthly_sectors.values()] + [sum(terms) for terms in monthly_sundays.values()]
                result, _, _ = improve(model, [sum(goals)], values, time.monotonic() + 1, ['COVERAGE'], context=ImprovementContext(protected_groups={'COVERAGE': guards}))
                self.assertEqual(result[visible.index], int(protect_visible))
                self.assertEqual(Snapshot(result).value(sum(goals)), 240 if protect_visible else 120)

    def test_no_visible_month_does_not_invent_monthly_guard_scope(self):
        from solver import _coverage
        data = fixture(40)
        data['demands'] = [{'id': 'd', 'date': data['startDate'], 'sector': 'Reposição', 'start': 480, 'end': 720, 'minimum': 1, 'estimated': True}]
        model = cp_model.CpModel()
        choice = model.new_bool_var('work')
        monthly_sundays, monthly_sectors = {}, {}
        _coverage(model, data, data['employees'], {('p0', data['startDate']): {'day': choice}}, {'day': data['shifts'][0]},
                  time.monotonic(), visible_sunday_terms=monthly_sundays, visible_sector_terms=monthly_sectors)
        self.assertEqual((monthly_sundays, monthly_sectors), ({}, {}))

    def test_an_incomplete_sector_does_not_discard_an_exact_sector_candidate(self):
        from unittest.mock import patch
        data = fixture(40, people=2)
        data['employees'][1]['sector'] = 'Caixa'
        dates = [(date.fromisoformat(data['startDate']) + timedelta(days=i)).isoformat() for i in range(7)]
        model = cp_model.CpModel()
        active = {person['id']: dates for person in data['employees']}
        off = {(person['id'], day): model.new_bool_var(f'off-{person["id"]}-{day}') for person in data['employees'] for day in dates}
        work = {key: model.new_bool_var('work-' + str(key)) for key in off}
        choices = {key: {'day': model.new_bool_var('day-' + str(key))} for key in off}
        baseline = {('p0', day): {'employeeId': 'p0', 'date': day, 'kind': 'WORK', 'shiftId': 'day'} for day in dates}
        baseline['p1', dates[0]] = {'employeeId': 'p1', 'date': dates[0], 'kind': 'OFF'}
        replacement = {'p1': {day: {'kind': 'OFF'} for day in dates}}
        with patch('solver.balanced_rest_hints', return_value=replacement) as balanced:
            reused = _feasibility_hints(model, data['employees'], dates, off, work, choices, active, baseline, {}, data['policy'])
        self.assertTrue(reused)
        self.assertEqual([person['id'] for person in balanced.call_args.args[0]], ['p1'])
        hinted = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
        for day in dates:
            self.assertEqual(hinted[work['p0', day].index], 1)
            self.assertEqual(hinted[choices['p0', day]['day'].index], 1)
            self.assertEqual(hinted[off['p0', day].index], 0)
            self.assertEqual(hinted[work['p1', day].index], 0)
            self.assertEqual(hinted[off['p1', day].index], 1)

    def test_sector_guards_start_from_the_exact_validated_saved_roster(self):
        from unittest.mock import patch
        from optimization import _expression_terms
        data = fixture(40, people=2)
        data['employees'][1]['sector'] = 'Caixa'
        days = [(date.fromisoformat(data['startDate']) + timedelta(days=i)).isoformat() for i in range(7)]
        data['assignments'] = [{'employeeId': person['id'], 'date': day, 'kind': 'WORK' if i < 5 else 'OFF',
                                **({'shiftId': 'day'} if i < 5 else {})}
                               for person in data['employees'] for i, day in enumerate(days)]
        data['demands'] = [{'id': f'{person["id"]}-{day}', 'date': day, 'sector': person['sector'],
                            'start': 480, 'end': 720, 'minimum': 1, 'estimated': True}
                           for person in data['employees'] for day in days]
        def inspect_guards(model, objectives, values, deadline, names, **kwargs):
            snapshot = Snapshot(values)
            self.assertEqual({sector: snapshot.value(sum(terms)) for sector, terms in kwargs['context'].sunday_coverage.items()},
                             {'Reposição': 240, 'Caixa': 240})
            context = kwargs['context']
            guards = {_expression_terms(term) for term in context.protected_groups[names[0]]}
            sector_terms = {sector: sum(terms) for sector, terms in context.sector_coverage.items()}
            self.assertEqual({sector: snapshot.value(term) for sector, term in sector_terms.items()},
                             {'Reposição': 480, 'Caixa': 480})
            for term in sector_terms.values():
                self.assertIn(_expression_terms(term), guards)
            return values, False, []
        with patch('solver.improve', side_effect=inspect_guards) as optimize:
            result = solve(data)
        self.assertEqual(optimize.call_count, 1)
        self.assertEqual(result['assignments'], data['assignments'])

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

    def test_only_complete_exact_saved_rosters_are_baseline_candidates(self):
        from unittest.mock import patch
        data = fixture(40)
        person = data['employees'][0]
        dates = [(date.fromisoformat(data['startDate']) + timedelta(days=i)).isoformat() for i in range(7)]
        active = {person['id']: dates}
        records = [{'employeeId': person['id'], 'date': day, 'kind': 'WORK', 'shiftId': 'day'} for day in dates]
        for case in ('complete', 'incomplete', 'unknown-shift', 'wrong-duty'):
            with self.subTest(case=case):
                model = cp_model.CpModel()
                off = {(person['id'], day): model.new_bool_var('off-' + day) for day in dates}
                work = {(person['id'], day): model.new_bool_var('work-' + day) for day in dates}
                choices = {key: {'day': model.new_bool_var('day-' + key[1])} for key in off}
                entries = [dict(record) for record in records]
                if case == 'incomplete':
                    entries.pop()
                elif case == 'unknown-shift':
                    entries[0]['shiftId'] = 'retired'
                elif case == 'wrong-duty':
                    entries[0]['kind'] = 'DUTY'
                baseline = {(entry['employeeId'], entry['date']): entry for entry in entries}
                with patch('solver.balanced_rest_hints', return_value={}) as balanced:
                    exact = _feasibility_hints(model, [person], dates, off, work, choices, active, baseline, {'day': (480,)}, {**fixture()['policy'], '_simulation': False})
                self.assertEqual(exact, case == 'complete')
                self.assertEqual(balanced.call_count, int(case != 'complete'))
                if exact:
                    hinted = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
                    for key in work:
                        self.assertEqual(hinted[work[key].index], 1)
                        self.assertEqual(hinted[off[key].index], 0)
                        self.assertEqual(hinted[choices[key]['day'].index], 1)

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

    def test_a_proven_floor_does_not_consume_search_for_negative_preferences(self):
        from unittest.mock import patch
        model = cp_model.CpModel()
        balanced = model.new_int_var(0, 0, 'already-balanced')
        preference = model.new_bool_var('preference')
        values = {balanced.index: 0, preference.index: 0}
        with patch('optimization.cp_model.CpSolver', wraps=cp_model.CpSolver) as search:
            actual, proven, phases = improve(
                model, [balanced, -preference], values, time.monotonic() + 1,
                ['SUNDAY_BALANCE', 'PREFERENCES'])
        self.assertEqual(search.call_count, 1)
        self.assertEqual(actual[preference.index], 1)
        self.assertTrue(proven)
        self.assertEqual(phases[0]['budgetSeconds'], 0)
        self.assertEqual(phases[0]['bestBound'], 0)
        self.assertEqual(phases[1]['incumbentValue'], -1)

    def test_large_sectors_are_not_silently_excluded_from_monthly_search(self):
        members = [f'p{i:02}' for i in range(40)]
        self.assertEqual(_coverage_people({'Caixa': members}, {'Caixa': [10]}, {}),
                         set(members))
        model = cp_model.CpModel()
        rates = [model.new_int_var(0, 10000, f'weekend-rate:6:{pid}') for pid in members]
        values = {variable.index: 0 if i % 2 else 10000
                  for i, variable in enumerate(rates)}
        self.assertEqual(_movable_people(rates, values, [members]), set(members))

    def test_snapshot_evaluates_a_linear_total_without_a_search(self):
        model = cp_model.CpModel()
        x = model.new_int_var(0, 4, 'x')
        y = model.new_int_var(0, 4, 'y')
        snapshot = Snapshot({x.index: 3, y.index: 1})
        self.assertEqual(snapshot.value(3 * x - 2 * y + 7), 14)
        self.assertEqual(snapshot.value(x + y), 4)
        self.assertEqual(snapshot.value(5), 5)

    def test_only_available_sundays_count_as_rotation_opportunities(self):
        data = fixture(weeks=6)
        person, policy = data['employees'][0], data['policy']
        days = ['2026-11-08', '2026-11-15', '2026-11-22',
                '2026-11-29', '2026-12-06', '2026-12-13']
        policy['closedDates'] = ['2026-11-29']
        policy['holidayDates'] = ['2026-12-06']
        baseline = {
            ('p0', days[0]): {'kind': 'ABSENCE'},
            ('p0', days[1]): {'kind': 'OFF', 'locked': True},
            ('p0', days[2]): {'kind': 'OFF'},
        }
        self.assertEqual(available_weekends(person, days, baseline, policy),
                         [days[2], days[5]])
        policy['_simulation'] = True
        self.assertEqual(available_weekends(person, days, baseline, policy),
                         [days[2], days[4], days[5]])
        person['fixedOffDays'] = [6]
        self.assertEqual(available_weekends(person, days, baseline, policy), [])

    def test_saturday_cannot_purchase_a_worse_sunday_distribution(self):
        model = cp_model.CpModel()
        trade = model.new_bool_var('trade')
        sunday = model.new_int_var(0, 1, 'sunday-total')
        saturday = model.new_int_var(0, 1, 'saturday-total')
        model.add(sunday == trade)
        model.add(saturday + trade == 1)
        values = {trade.index: 1, sunday.index: 1, saturday.index: 0}
        totals = {6: {'a': (sunday, 2), 'b': (0, 2)},
                  5: {'a': (saturday, 1), 'b': (0, 1)}}
        sundays, saturdays = weekend_objectives(
            model, {'same': ['a', 'b']}, totals, Snapshot(values), values)
        # Exhaustive two-state oracle: the combined objective chooses trade=1
        # (5000 + 0) over trade=0 (0 + 10000), worsening the Sunday rate.
        model.minimize(sum(sundays) + sum(saturdays))
        combined = cp_model.CpSolver()
        self.assertEqual(combined.solve(model), cp_model.OPTIMAL)
        self.assertEqual(combined.value(trade), 1)
        actual, _, phases = improve(
            model, [sum(sundays), sum(saturdays)], values,
            time.monotonic() + 2, ['SUNDAY_BALANCE', 'SATURDAY_BALANCE'],
            context=ImprovementContext(protected_groups={'SUNDAY_BALANCE': sundays}))
        self.assertEqual(actual[trade.index], 0)
        self.assertEqual([actual[v.index] for v in sundays + saturdays],
                         [0, 10000])
        self.assertEqual([p['objective'] for p in phases],
                         ['SUNDAY_BALANCE', 'SATURDAY_BALANCE'])

    def test_cross_week_exchange_retains_the_joint_model(self):
        model = cp_model.CpModel()
        days = [(date(2026, 11, 2) + timedelta(days=n)).isoformat()
                for n in range(21)]
        rests = {(pid, day): model.new_bool_var(f'o:{pid}:{day}')
                 for pid in ('p', 'q') for day in days}
        first, second = rests['p', '2026-11-08'], rests['p', '2026-11-15']
        model.add(first == second)
        for variable in rests.values():
            if variable.index not in (first.index, second.index):
                model.add(variable == 0)
        p_rate = model.new_int_var(0, 10000, 'weekend-rate:6:p')
        q_rate = model.new_int_var(0, 0, 'weekend-rate:6:q')
        model.add(p_rate == 5000 * (first + second))
        coverage = model.new_int_var(0, 0, 'coverage')
        padding = [model.new_int_var(0, 0, f'padding:{i}') for i in range(3000)]
        variables = [*rests.values(), p_rate, q_rate, coverage, *padding]
        values = {v.index: int(v.index in (first.index, second.index))
                  for v in variables}
        values[p_rate.index] = 10000
        actual, proven, phases = improve(
            model, [coverage, p_rate], values, time.monotonic() + 3,
            ['COVERAGE', 'SUNDAY_BALANCE'], context=ImprovementContext(employee_groups=[['p', 'q']]))
        self.assertEqual(actual[first.index], 0)
        self.assertEqual(actual[second.index], 0)
        self.assertEqual(actual[coverage.index], 0)
        self.assertFalse(proven)
        self.assertEqual(phases[-1]['searchScope'], 'SELECTED_PEOPLE')

    def test_neighborhood_does_not_drop_tied_members_of_a_comparable_group(self):
        model = cp_model.CpModel()
        scores = {'high1': 10000, 'high2': 10000, 'low': 0, 'middle': 5000}
        variables = [model.new_int_var(0, 10000, f'weekend-rate:6:{pid}')
                     for pid in scores]
        values = {v.index: score for v, score in zip(variables, scores.values())}
        selected = _movable_people(variables, values, [list(scores)], limit=4)
        self.assertEqual(set(selected), set(scores))

    def test_shipped_solver_attempts_sunday_before_saturday(self):
        data = fixture(people=3)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertEqual(len(result['assignments']), 21)
        names = [phase['objective'] for phase in result['optimization']['phases']]
        self.assertIn('SUNDAY_BALANCE', names)
        self.assertIn('SATURDAY_BALANCE', names)
        self.assertLess(names.index('SUNDAY_BALANCE'), names.index('SATURDAY_BALANCE'))

    def test_later_preferences_cannot_transfer_sunday_debt_between_groups(self):
        model = cp_model.CpModel()
        a = model.new_int_var(0, 2, 'group-a')
        b = model.new_int_var(0, 2, 'group-b')
        preference = model.new_bool_var('preference')
        model.add_allowed_assignments([a, b, preference], [(2, 0, 1), (0, 2, 0)])
        observed = []

        class ObserveSearch:
            def checkpoint(self):
                pass

            def solve(self, engine, current):
                status = engine.solve(current)
                if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                    observed.append((engine.value(a), engine.value(b)))
                return status

        actual, _, phases = improve(
            model, [a + b, preference],
            {a.index: 2, b.index: 0, preference.index: 1},
            time.monotonic() + 2, ['SUNDAY_BALANCE', 'PREFERENCES'],
            context=ImprovementContext(protected_groups={'SUNDAY_BALANCE': [a, b]}, control=ObserveSearch()))
        self.assertEqual(len(phases), 2)
        self.assertTrue(observed)
        self.assertEqual((actual[a.index], actual[b.index]), observed[0])
        # The alternate allocation has the same scalar Sunday sum. Only the
        # per-group guard prevents moving all of that debt to the other group.
        protected_zero = a if observed[0][0] == 0 else b
        challenge = model.clone()
        challenge.add(challenge.get_int_var_from_proto_index(protected_zero.index) >= 1)
        engine = cp_model.CpSolver()
        self.assertEqual(engine.solve(challenge), cp_model.INFEASIBLE)

    def test_expired_hint_budget_returns_without_a_partial_person(self):
        from hints import balanced_rest_hints
        from solver import instant, sunday_limit
        data = fixture()
        result = balanced_rest_hints(data['employees'], ['2026-11-02'], {}, {}, {}, {},
                                     data['policy'], instant, sunday_limit, deadline=time.monotonic() - 1)
        self.assertEqual(result, {})

    def test_no_current_sundays_does_not_create_a_historical_rotation_debt(self):
        from unittest.mock import patch
        data = fixture(people=3, weeks=2)
        data['employees'][0]['fixedOffDays'] = [6]
        observed = []
        def inspect(*args, **kwargs):
            observed.append(args[2][6]['p0'][1])
            return weekend_objectives(*args, **kwargs)
        with patch('solver.weekend_objectives', inspect):
            result = solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(observed, [0])

    def test_explicit_decision_metadata_supports_colons_in_identifiers(self):
        model = cp_model.CpModel()
        days = [(date(2026, 11, 2) + timedelta(days=n)).isoformat() for n in range(21)]
        rests = [model.new_bool_var('o:p:leader:' + day) for day in days]
        target = model.new_bool_var('s:p:leader:2026-11-08:turno:manha')
        other = model.new_int_var(0, 0, 'weekend-rate:6:q')
        rate = model.new_int_var(0, 10000, 'weekend-rate:6:p:leader')
        model.add(rate == 10000 * target)
        model.add(target == rests[6])
        for index, variable in enumerate(rests):
            if index != 6:
                model.add(variable == 0)
        coverage = model.new_int_var(0, 0, 'coverage')
        padding = [model.new_int_var(0, 0, f'padding:{i}') for i in range(3000)]
        values = {v.index: int(v.index in (target.index, rests[6].index))
                  for v in [*rests, target, other, rate, coverage, *padding]}
        values[rate.index] = 10000
        decisions = {v.index: ('p:leader', day) for v, day in zip(rests, days)}
        decisions[target.index] = ('p:leader', days[6])
        actual, _, phases = improve(model, [coverage, rate], values, time.monotonic() + 2,
                                     ['COVERAGE', 'SUNDAY_BALANCE'],
                                     context=ImprovementContext(employee_groups=[['p:leader', 'q']], decision_variables=decisions))
        self.assertEqual(actual[target.index], 0)
        self.assertEqual(phases[-1]['searchScope'], 'SELECTED_PEOPLE')


class SavedDraftSundayTests(unittest.TestCase):
    def test_complete_feasible_draft_keeps_its_sunday_balance_during_coverage(self):
        data = fixture(people=2, weeks=2)
        # p1 rests on the first Monday. Keep two historical rests, but avoid
        # an illegal Saturday/Sunday/Monday OFF run across the saved boundary.
        for entry in data['employees'][1]['history']:
            if entry['date'] == '2026-10-30':
                entry['kind'] = 'OFF'
                entry.pop('shiftId', None)
            elif entry['date'] == '2026-10-31':
                entry['kind'] = 'WORK'
                entry['shiftId'] = 'day'
        days = [(date.fromisoformat(data['startDate']) + timedelta(days=n)).isoformat()
                for n in range(14)]
        for person_index, person in enumerate(data['employees']):
            for day_index, day in enumerate(days):
                # A genuinely usable saved sector: one colleague covers each
                # Sunday, with equal Sunday totals and no collective empty day.
                first_pattern = (person_index + day_index // 7) % 2 == 0
                rest_days = (1, 5) if first_pattern else (0, 6)
                entry = {'employeeId': person['id'], 'date': day,
                         'kind': 'OFF' if date.fromisoformat(day).weekday() in rest_days else 'WORK'}
                if entry['kind'] == 'WORK':
                    entry['shiftId'] = 'day'
                data['assignments'].append(entry)
        sundays = [day for day in days if date.fromisoformat(day).weekday() == 6]
        data['demands'] = [
            {'sector': 'Reposição', 'date': day, 'start': 480, 'end': 720,
             'minimum': 1, 'estimated': True} for day in sundays]
        observed = []

        class ObserveSearch:
            def checkpoint(self):
                pass

            def solve(self, engine, current):
                status = engine.solve(current)
                if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                    observed.append({variable.name: engine.value(variable)
                                     for index in range(len(current.proto.variables))
                                     for variable in [current.get_int_var_from_proto_index(index)]
                                     if variable.name.startswith('w:')})
                return status

        result = solve(data, control=ObserveSearch())
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertGreaterEqual(len(observed), 2)
        for entry in data['assignments']:
            name = f"w:{entry['employeeId']}:{entry['date']}"
            self.assertEqual(observed[0][name], int(entry['kind'] == 'WORK'))
        self.assertEqual(result['optimization']['phases'][0]['objective'], 'COVERAGE')
        # The saved draft starts with equal Sunday rates. Coverage may improve
        # presence, but not by transferring Sunday work to only one colleague.
        coverage_totals = [sum(observed[1][f"w:{p['id']}:{day}"] for day in sundays)
                           for p in data['employees']]
        self.assertEqual(max(coverage_totals) - min(coverage_totals), 0)
        final_totals = [sum(entry['kind'] == 'WORK' and entry['date'] in sundays
                            for entry in result['assignments'] if entry['employeeId'] == person['id'])
                        for person in data['employees']]
        self.assertEqual(max(final_totals) - min(final_totals), 0)

    def test_invalid_complete_draft_falls_back_to_a_real_feasible_proposal(self):
        data = fixture()
        data['assignments'] = [
            {'employeeId': 'p0',
             'date': (date.fromisoformat(data['startDate']) + timedelta(days=n)).isoformat(),
             'kind': 'WORK', 'shiftId': 'day'} for n in range(7)]
        observed = []

        class ObserveSearch:
            def checkpoint(self):
                pass

            def solve(self, engine, current):
                status = engine.solve(current)
                observed.append((status, engine.parameters.fix_variables_to_their_hinted_value))
                return status

        result = solve(data, control=ObserveSearch())
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertGreaterEqual(len(observed), 2)
        self.assertEqual(observed[0], (cp_model.INFEASIBLE, True))
        self.assertIn(observed[1][0], (cp_model.FEASIBLE, cp_model.OPTIMAL))
        # An invalid saved draft now retries the complete balanced seed fixed,
        # rather than discarding its distribution in an unrestricted search.
        self.assertTrue(observed[1][1])
        self.assertEqual(len(result['assignments']), 7)
        self.assertEqual(sum(a['kind'] == 'WORK' for a in result['assignments']), 5)
        self.assertEqual(sum(a['kind'] == 'OFF' for a in result['assignments']), 2)
        self.assertTrue(all(a['kind'] == 'WORK' for a in data['assignments']))


class SundayCoverageGuardTests(unittest.TestCase):
    def test_total_coverage_cannot_purchase_more_sunday_shortage(self):
        model = cp_model.CpModel()
        trade = model.new_bool_var('trade')
        weekday = model.new_int_var(0, 10, 'weekday-shortage')
        model.add(weekday == 10 * (1 - trade))
        sunday = 5 * trade
        values = {trade.index: 0, weekday.index: 10}
        actual, _, _ = improve(model, [weekday + sunday], values, time.monotonic() + 2,
                                ['COVERAGE'], context=ImprovementContext(protected_groups={'COVERAGE': [sunday]}))
        self.assertEqual(actual[trade.index], 0)
        self.assertEqual(actual[weekday.index], 10)

    def test_clock_adaptation_hints_do_not_lock_saved_rest_days(self):
        from unittest.mock import patch
        data = fixture(40)
        days = [(date.fromisoformat(data['startDate']) + timedelta(days=i)).isoformat() for i in range(7)]
        saved_rests = {days[3], days[6]}
        baseline = {('p0', day): {'kind': 'OFF'} for day in saved_rests}
        model = cp_model.CpModel()
        off = {('p0', day): model.new_bool_var('off-' + day) for day in days}
        work = {key: model.new_bool_var('work-' + key[1]) for key in off}
        choices = {key: {'day': model.new_bool_var('shift-' + key[1])} for key in off}
        args = (model, data['employees'], days, off, work, choices, {'p0': days},
                baseline, {'day': (480, 480, 1020)}, {**data['policy'], '_simulation': False})
        self.assertTrue(_feasibility_hints(*args))
        hinted = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
        self.assertEqual({day for (_, day), variable in off.items() if hinted[variable.index]}, saved_rests)
        self.assertEqual(len(model.proto.constraints), 0)
        self.assertTrue(all(tuple(variable.domain) == (0, 1) for variable in model.proto.variables))
        model.clear_hints()
        with patch('solver.balanced_rest_hints', return_value={}) as balanced:
            self.assertFalse(_feasibility_hints(*args, prefer_baseline=False))
        self.assertEqual(balanced.call_count, 1)
        self.assertFalse(balanced.call_args.kwargs.get('preserve_rest_pattern', False))

    def test_adapting_clocks_reuses_the_existing_rest_pattern_as_a_hint(self):
        data = fixture(people=1, weeks=2)
        previous = solve(data)
        self.assertIn(previous['status'], ('FEASIBLE', 'OPTIMAL'))
        # Preparation removes incompatible unlocked WORK clocks, but keeps OFF.
        data['assignments'] = [a for a in previous['assignments'] if a['kind'] == 'OFF']
        expected = {a['date'] for a in data['assignments']}
        observed = []

        class InspectSeed:
            def checkpoint(self):
                pass

            def solve(self, engine, model):
                status = engine.solve(model)
                if not observed and status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
                    observed.append({variable.name[len('o:p0:'):] for index in range(len(model.proto.variables))
                                     for variable in [model.get_int_var_from_proto_index(index)]
                                     if variable.name.startswith('o:p0:') and engine.value(variable)})
                return status

        result = solve(data, control=InspectSeed())
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(observed[0], expected)
        self.assertEqual(len(result['assignments']), 14)


class SundayPresenceTests(unittest.TestCase):
    def test_staffed_sunday_sector_cannot_be_emptied_for_another_goal(self):
        from weekend_balance import preserve_sunday_presence
        model = cp_model.CpModel()
        a, b = model.new_bool_var('a'), model.new_bool_var('b')
        day = '2026-11-08'
        preserve_sunday_presence(model, [{'id': 'a', 'sector': 'Caixa'}, {'id': 'b', 'sector': 'Caixa'}],
                                 [day], {('a', day): a, ('b', day): b}, {a.index: 1, b.index: 0})
        model.minimize(a + b)
        engine = cp_model.CpSolver()
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(a) + engine.value(b), 1)

    def test_an_empty_reference_does_not_invent_an_operational_minimum(self):
        from weekend_balance import preserve_sunday_presence
        model = cp_model.CpModel()
        person = model.new_bool_var('person')
        day = '2026-11-08'
        preserve_sunday_presence(model, [{'id': 'a', 'sector': 'Caixa'}],
                                 [day], {('a', day): person}, {person.index: 0})
        model.minimize(person)
        engine = cp_model.CpSolver()
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(person), 0)


class SectorCoverageTests(unittest.TestCase):
    def test_sunday_shortage_is_protected_separately_for_each_sector(self):
        from solver import _coverage
        data = fixture(people=2)
        data['employees'][0]['sector'] = 'Caixa'
        data['employees'][1]['sector'] = 'Acougue'
        day = '2026-11-08'
        data['demands'] = [{'sector': sector, 'date': day, 'start': 480, 'end': 540,
                            'minimum': 1, 'estimated': True} for sector in ('Caixa', 'Acougue')]
        model = cp_model.CpModel()
        a, b = model.new_bool_var('a'), model.new_bool_var('b')
        values = {a.index: 1, b.index: 0}
        terms = {}
        _coverage(model, data, data['employees'], {('p0', day): {'day': a}, ('p1', day): {'day': b}},
                  {'day': data['shifts'][0]}, time.monotonic(), 'ESTIMATED', values, terms)
        self.assertEqual(set(terms), {'Caixa', 'Acougue'})
        self.assertEqual(Snapshot(values).value(sum(terms['Caixa'])), 0)
        self.assertEqual(Snapshot(values).value(sum(terms['Acougue'])), 60)


class SundayCoveragePriorityTests(unittest.TestCase):
    def test_sector_guards_preserve_weekly_coverage_not_only_sunday(self):
        model = cp_model.CpModel()
        trade = model.new_bool_var('trade')
        first = 3 * trade
        second = 10 * (1 - trade)
        actual, _, _ = improve(model, [first + second], {trade.index: 0},
                                time.monotonic() + 1, ['COVERAGE'],
                                context=ImprovementContext(protected_groups={'COVERAGE': [first, second]}))
        # The global objective alone would exchange ten missing minutes in one
        # sector for three in another, worsening a previously covered sector.
        self.assertEqual(actual[trade.index], 0)

    def test_weekly_and_sunday_sector_totals_have_distinct_durations(self):
        from solver import _coverage
        data = fixture(people=1)
        sector = data['employees'][0]['sector']
        days = ['2026-11-02', '2026-11-08']
        data['demands'] = [{'sector': sector, 'date': day, 'start': 480, 'end': 540,
                            'minimum': 1, 'estimated': True} for day in days]
        model = cp_model.CpModel()
        present = [model.new_bool_var(day) for day in days]
        values = {v.index: 0 for v in present}
        sundays, sectors = {}, {}
        terms = _coverage(model, data, data['employees'],
                          {('p0', day): {'day': v} for day, v in zip(days, present)},
                          {'day': data['shifts'][0]}, time.monotonic(), 'ESTIMATED',
                          values, sundays, sectors)
        snapshot = Snapshot(values)
        self.assertEqual(snapshot.value(sum(terms)), 120)
        self.assertEqual(snapshot.value(sum(sectors[sector])), 120)
        self.assertEqual(snapshot.value(sum(sundays[sector])), 60)

    def test_coverage_neighborhood_keeps_the_whole_largest_real_sector(self):
        from optimization import _coverage_people
        groups = {'large': [f'p{i}' for i in range(34)], 'small': ['x', 'y', 'z']}
        model = cp_model.CpModel()
        large = model.new_int_var(0, 100, 'large-gap')
        small = model.new_int_var(0, 100, 'small-gap')
        selected = _coverage_people(groups, {'large': [large], 'small': [small]},
                                     {large.index: 100, small.index: 20})
        self.assertEqual(selected, set(groups['large']))

    def test_sunday_coverage_can_exchange_rests_across_the_whole_month(self):
        model = cp_model.CpModel()
        days = [(date(2026, 11, 2) + timedelta(days=n)).isoformat() for n in range(28)]
        rests = [model.new_bool_var(f'o:p:{day}') for day in days]
        first, last = rests[6], rests[27]
        model.add(first == last)
        for variable in rests:
            if variable.index not in (first.index, last.index):
                model.add(variable == 0)
        # Keep the existing total unchanged: moving the gap from Sunday to a
        # weekday is beneficial only to the explicit Sunday objective.
        total = model.new_int_var(0, 0, 'total-delta')
        padding = [model.new_int_var(0, 0, f'padding:{i}') for i in range(3000)]
        values = {v.index: int(v.index in (first.index, last.index))
                  for v in [*rests, total, *padding]}
        actual, proven, phases = improve(
            model, [total, first], values, time.monotonic() + 2,
            ['COVERAGE', 'SUNDAY_COVERAGE'], context=ImprovementContext(coverage_groups={'Caixa': ['p']},
            sunday_coverage={'Caixa': [first]}))
        self.assertEqual(actual[first.index], 0)
        self.assertEqual(actual[last.index], 0)
        self.assertFalse(proven)
        self.assertEqual(phases[-1]['searchScope'], 'SELECTED_PEOPLE')


if __name__ == '__main__':
    unittest.main()
