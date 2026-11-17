"""Real peak/dispersion models and bounded production integration regressions."""
import copy
import json
import sys
import time
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model

import optimization
import solver
from optimization import ImprovementContext, Snapshot, improve
from sunday_peak import MAX_SAFE_INTEGER, _bounds, build_sunday_peaks
from test_solver import fixture, make_untimed


DAYS = ['2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']
POLICY = {'closedDates': [], 'holidayDates': [], 'authorizedHolidayDates': [], '_simulation': True}
TRANSPORT_CASES = None


def capture_transport_cases():
    """Return actual solver responses for F08's Python/JSON/client roundtrip.

    The regression below populates this cache during the consolidated unittest
    invocation. Calling this function afterward emits the SAME real results,
    without repeating solves. Inputs are synthetic fixtures; outputs, including
    assignments and optimization metadata, are returned untouched by solve().
    """
    global TRANSPORT_CASES
    if TRANSPORT_CASES is not None:
        return TRANSPORT_CASES
    responses = {}
    for label, minimum in (('safe', 25), ('fallback', 250)):
        data = fixture(42, people=1, weeks=4, start_date='2026-11-30')
        data.update(restRulesVersion=2, visibleMonth='2026-12')
        person = data['employees'][0]
        make_untimed(person)
        person.update(history=[], historyKnown=False, maxConsecutiveSundays=1,
                      sundayRestRule='PROTECTIVE')
        # No timed worker belongs to these demand sectors. _coverage constructs
        # its ordinary estimated gap variables; DUTY never supplies an hour.
        data['demands'] = [dict(sector='Unstaffed A', date=day, start=0, end=1000,
            minimum=minimum, roles={}, estimated=True) for day in DAYS]
        data['demands'] += [dict(sector='Unstaffed B', date=day, start=0, end=1,
            minimum=1, roles={}, estimated=True) for day in DAYS[:2]]
        responses[label] = solver.solve(data)
    TRANSPORT_CASES = responses
    return responses


class SundayPeakTests(unittest.TestCase):
    def search(self, model, objective):
        model.minimize(objective)
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 2
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        return engine

    def test_tied_peaks_release_every_sunday_without_freezing_daily_deficits(self):
        model = cp_model.CpModel()
        gaps = [model.new_int_var(0, 6, 'gap:' + day) for day in DAYS]
        model.add(sum(gaps) == 18)
        values = {variable.index: initial for variable, initial in zip(gaps, (6, 6, 0, 6))}
        daily = {('A', day): [100 * variable] for day, variable in zip(DAYS, gaps)}
        plan = build_sunday_peaks(model, daily, POLICY, values, visible_month='2026-12')
        engine = self.search(model, plan.objective)
        result = [engine.value(variable) for variable in gaps]
        self.assertEqual(sorted(result), [4, 4, 5, 5])
        self.assertEqual(engine.value(sum(plan.peaks['A'])), 500)
        self.assertEqual(sum(result), 18)
        self.assertGreater(result[2], 0)  # This date was not frozen at its zero seed.
        self.assertTrue(plan.ready)
        self.assertIn('A', plan.neighborhoods)

    def test_constant_dominant_sunday_keeps_the_other_sundays_in_the_tie_break(self):
        model = cp_model.CpModel()
        first = model.new_int_var(0, 5, 'first')
        second = model.new_int_var(0, 5, 'second')
        model.add(first + second == 5)
        values = {first.index: 5, second.index: 0}
        plan = build_sunday_peaks(model, {
            ('A', DAYS[0]): [600], ('A', DAYS[1]): [100 * first],
            ('A', DAYS[2]): [100 * second]}, POLICY, values)
        engine = self.search(model, plan.objective)
        self.assertEqual(engine.value(sum(plan.peaks['A'])), 600)
        self.assertEqual(sorted((engine.value(first), engine.value(second))), [2, 3])
        self.assertIn('A', plan.neighborhoods)

    def test_improving_aggregate_peak_cannot_spend_another_sectors_peak(self):
        model = cp_model.CpModel()
        trade = model.new_bool_var('trade')
        values = {trade.index: 0}
        plan = build_sunday_peaks(model, {
            ('A', DAYS[0]): [600 - 300 * trade], ('A', DAYS[1]): [0],
            ('B', DAYS[0]): [100 + 200 * trade], ('B', DAYS[1]): [0]}, POLICY, values)
        # This unit model starts at SUNDAY_PEAK. Install the current caps here,
        # as improve does on phase entry, rather than during model construction.
        for terms in plan.peaks.values():
            model.add(sum(terms) <= Snapshot(values).value(sum(terms)))
        engine = self.search(model, plan.objective)
        self.assertEqual(engine.value(trade), 0)
        self.assertEqual(engine.value(sum(plan.peaks['A'])), 600)
        self.assertEqual(engine.value(sum(plan.peaks['B'])), 100)

    def test_accepted_peak_gain_survives_a_later_stability_objective(self):
        model = cp_model.CpModel()
        gap = model.new_int_var(0, 6, 'gap')
        values = {gap.index: 6}
        plan = build_sunday_peaks(model, {
            ('A', DAYS[0]): [100 * gap], ('A', DAYS[1]): [0]}, POLICY, values)
        result, _, phases = improve(model, [plan.objective, -gap], values,
            time.monotonic() + 4, ['SUNDAY_PEAK', 'STABILITY'], context=ImprovementContext(
                protected_groups={'SUNDAY_PEAK': [sum(plan.peaks['A'])]}))
        self.assertEqual(result[gap.index], 0)
        self.assertEqual(Snapshot(result).value(plan.objective), 0)
        self.assertTrue(all(p['incumbentValue'] == 0 for p in phases))

    def test_peak_refinement_cannot_spend_a_protected_sector_month_total(self):
        model = cp_model.CpModel()
        trade = model.new_bool_var('trade')
        values = {trade.index: 0}
        plan = build_sunday_peaks(model, {
            ('A', DAYS[0]): [600 - 300 * trade], ('A', DAYS[1]): [0]}, POLICY, values)
        month_total = 600 - 300 * trade + 1000 * trade
        result, _, _ = improve(model, [plan.objective], values, time.monotonic() + 2,
            ['SUNDAY_PEAK'], context=ImprovementContext(
                protected_groups={'SUNDAY_PEAK': [month_total, sum(plan.peaks['A'])]}))
        self.assertEqual(result[trade.index], 0)
        self.assertEqual(Snapshot(result).value(month_total), 600)

    def test_earlier_total_gain_can_raise_seed_peak_then_phase_entry_uses_current_peak(self):
        model = cp_model.CpModel()
        option = model.new_int_var(0, 2, 'option')
        first = model.new_int_var(0, 150, 'first')
        second = model.new_int_var(0, 100, 'second')
        # Seed: total200/peak100. Accepted earlier total improvement:150/150.
        # Peak refinement can then redistribute that accepted total to75/75.
        model.add_allowed_assignments([option, first, second],
                                      [(0, 100, 100), (1, 150, 0), (2, 75, 75)])
        values = {option.index: 0, first.index: 100, second.index: 100}
        plan = build_sunday_peaks(model, {
            ('A', DAYS[0]): [first], ('A', DAYS[1]): [second]}, POLICY, values)
        total = first + second
        names = ['COVERAGE', 'SUNDAY_COVERAGE', 'SUNDAY_PEAK', 'STABILITY']
        observed = []
        class Observe:
            def checkpoint(self):
                pass
            def solve(inner, engine, current):
                position = len(observed)
                candidate = current
                if position < 2:
                    # Select an explicit witness among the two equal total150
                    # optima. Every status and variable still comes from CP-SAT.
                    candidate = current.clone()
                    candidate.add(option == 1)
                if position >= 2:
                    hint = dict(zip(current.proto.solution_hint.vars, current.proto.solution_hint.values))
                    self.assertEqual(Snapshot(hint).value(sum(plan.peaks['A'])),
                                     150 if position == 2 else 75)
                status = engine.solve(candidate)
                self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
                observed.append((engine.value(total), engine.value(sum(plan.peaks['A']))))
                return status
        result, _, phases = improve(model, [total, total, plan.objective, -first], values,
            time.monotonic() + 4, names, context=ImprovementContext(control=Observe(),
                protected_groups={'SUNDAY_PEAK': [sum(plan.peaks['A'])]}))
        self.assertEqual([p['objective'] for p in phases], names)
        self.assertEqual(observed[:2], [(150, 150), (150, 150)])
        self.assertEqual(observed[2:], [(150, 75), (150, 75)])
        self.assertEqual(result[option.index], 2)
        self.assertEqual(Snapshot(result).value(total), 150)

    def test_calendar_filters_and_constant_only_sectors_do_not_take_neighborhoods(self):
        model = cp_model.CpModel()
        variable = model.new_int_var(0, 3, 'gap')
        values = {variable.index: 1}
        policy = {**POLICY, 'closedDates': [DAYS[0]], '_simulation': False,
                  'holidayDates': [DAYS[1]]}
        plan = build_sunday_peaks(model, {
            ('excluded', DAYS[0]): [variable], ('excluded', DAYS[1]): [variable],
            ('excluded', '2026-11-29'): [variable], ('excluded', '2026-12-14'): [variable],
            ('constant', DAYS[2]): [100], ('constant', DAYS[3]): [100],
            ('single', DAYS[2]): [variable]}, policy, values, visible_month='2026-12')
        self.assertEqual(set(plan.peaks), {'constant'})
        self.assertEqual(plan.neighborhoods, {})
        self.assertEqual(Snapshot(values).value(plan.objective), 0)

    def test_bounds_include_negative_coefficients_and_exact_common_units(self):
        model = cp_model.CpModel()
        variable = model.new_int_var(-3, 8, 'variable')
        self.assertEqual(_bounds(model, 50 - 2 * variable, {}), (34, 56))
        self.assertEqual(_bounds(model, 7, {}), (7, 7))
        positive = model.new_int_var(0, 250, 'positive')
        self.assertEqual(_bounds(model, 7 + 3 * positive, {}), (7, 757))

    def test_exact_js_unsafe_counterexample_falls_back_instead_of_rounding(self):
        model = cp_model.CpModel()
        x, y = model.new_int_var(0, 250, 'x'), model.new_bool_var('y')
        values = {x.index: 250, y.index: 1}
        daily = {('A', day): [1000 * x] for day in DAYS}
        daily.update({('B', day): [y] for day in DAYS[:2]})
        plan = build_sunday_peaks(model, daily, POLICY, values)
        score = 250001 * (250000000002 + 1) + 250000000002
        self.assertEqual(score, 62500500000750005)
        self.assertGreater(score, MAX_SAFE_INTEGER)
        self.assertLess(score, (1 << 62) - 1)
        self.assertFalse(plan.ready)
        self.assertEqual(plan.objective, 0)
        self.assertEqual(len(values), len(model.proto.variables))
        self.assertEqual(model.validate(), '')

    def test_js_safe_counterpart_retains_the_exact_composed_score(self):
        model = cp_model.CpModel()
        x, y = model.new_int_var(0, 25, 'x'), model.new_bool_var('y')
        values = {x.index: 25, y.index: 1}
        daily = {('A', day): [1000 * x] for day in DAYS}
        daily.update({('B', day): [y] for day in DAYS[:2]})
        plan = build_sunday_peaks(model, daily, POLICY, values)
        self.assertTrue(plan.ready)
        score = Snapshot(values).value(plan.objective)
        self.assertEqual(score, 62505000075005)
        self.assertLessEqual(score, MAX_SAFE_INTEGER)
        self.assertEqual(json.loads(json.dumps(score)), score)

    def test_actual_solver_transport_safe_and_fallback_responses_are_captured_untouched(self):
        responses = capture_transport_cases()
        self.assertIs(capture_transport_cases(), responses)
        self.assertEqual(json.loads(json.dumps(responses, allow_nan=False)), responses)
        for response in responses.values():
            self.assertIn(response['status'], ('FEASIBLE', 'OPTIMAL'))
            self.assertTrue(response['assignments'])
            for phase in response['optimization']['phases']:
                for field in ('initialValue', 'incumbentValue'):
                    self.assertLessEqual(abs(phase[field]), MAX_SAFE_INTEGER)
        safe = responses['safe']['optimization']
        peak = next(p for p in safe['phases'] if p['objective'] == 'SUNDAY_PEAK')
        self.assertEqual(peak['initialValue'], 62505000075005)
        self.assertNotIn('SUNDAY_PEAK', safe['unattemptedObjectives'])
        fallback = responses['fallback']['optimization']
        self.assertFalse(any(p['objective'] == 'SUNDAY_PEAK' for p in fallback['phases']))
        self.assertEqual(fallback['unattemptedObjectives'].count('SUNDAY_PEAK'), 1)

    def test_exceptional_integer_range_omits_refinement_without_seed_caps_or_overflow(self):
        model = cp_model.CpModel()
        variable = model.new_int_var(0, 2_000_001, 'large-gap')
        values = {variable.index: 2_000_000}
        plan = build_sunday_peaks(model, {
            ('A', DAYS[0]): [variable], ('A', DAYS[1]): [1]}, POLICY, values)
        self.assertFalse(plan.ready)
        self.assertEqual(plan.objective, 0)
        self.assertIn('A', plan.peaks)
        self.assertEqual(model.validate(), '')
        self.assertEqual(len(values), len(model.proto.variables))

    def test_actual_hourly_deficits_include_meals_and_roles_but_not_untimed_duty(self):
        data = fixture(42, people=2, weeks=2, start_date='2026-11-30')
        data['employees'][1]['scheduleMode'] = 'UNTIMED'
        data['employees'][1]['shiftIds'] = []
        data['demands'] = [dict(date=day, sector='Reposição', start=480, end=1044,
            minimum=1, roles={'Repositor': 1}, estimated=True) for day in DAYS[:2]]
        model = cp_model.CpModel()
        timed = [model.new_bool_var('timed:' + day) for day in DAYS[:2]]
        duty = model.new_bool_var('untimed-duty')
        model.add(duty == 1)
        values = {timed[0].index: 0, timed[1].index: 1, duty.index: 1}
        choices = {('p0', day): {'day': variable} for day, variable in zip(DAYS, timed)}
        choices.update({('p1', day): {} for day in DAYS[:2]})
        daily = {}
        solver._coverage(model, data, data['employees'], choices,
            {'day': data['shifts'][0]}, time.monotonic(), 'ESTIMATED', values, daily_terms=daily)
        self.assertEqual(Snapshot(values).value(sum(daily['Reposição', DAYS[0]])), 564)
        self.assertEqual(Snapshot(values).value(sum(daily['Reposição', DAYS[1]])), 60)
        plan = build_sunday_peaks(model, daily, POLICY, values)
        engine = self.search(model, plan.objective)
        self.assertEqual(engine.value(duty), 1)
        self.assertEqual(engine.value(sum(plan.peaks['Reposição'])), 60)

    def test_net_coverage_reserve_is_shared_and_fairness_reserve_is_retained(self):
        names = ['COVERAGE', 'SUNDAY_COVERAGE', 'SUNDAY_PEAK', 'SUNDAY_BALANCE']
        self.assertEqual(optimization._refinement_reserve('SUNDAY_COVERAGE', names, .8), .4)
        self.assertEqual(optimization._refinement_reserve('SUNDAY_PEAK', names, .8), .4)
        self.assertEqual(optimization._refinement_reserve('SUNDAY_BALANCE', names, .8), .8)
        self.assertAlmostEqual(optimization._future_refinement_reserve(names, 1, .8, 0), 1.6)
        self.assertAlmostEqual(optimization._future_refinement_reserve(names, 1, .8, .2), 2.2)

    def test_setup_hint_and_unknown_preserve_deadline_incumbent_and_all_sector_weeks(self):
        names = ['COVERAGE', 'SUNDAY_COVERAGE', 'SUNDAY_PEAK', 'SUNDAY_BALANCE']
        model = cp_model.CpModel()
        work = {(pid, day): model.new_bool_var(f'w:{pid}:{day}')
                for pid in ('p', 'q', 'outside') for day in DAYS}
        gap = model.new_bool_var('gap')
        values = {v.index: 0 for v in work.values()}
        values[gap.index] = 1
        hints = []
        observed = []
        class Consume:
            now = 0.0
            def checkpoint(self):
                pass
            def solve(inner, engine, current):
                if len(observed) == 2:
                    for (pid, _day), variable in work.items():
                        self.assertEqual(tuple(current.proto.variables[variable.index].domain),
                                         (0, 0) if pid == 'outside' else (0, 1))
                observed.append(engine.parameters.max_time_in_seconds)
                inner.now += observed[-1]
                return cp_model.UNKNOWN
        control = Consume()
        actual_clone = model.clone
        def charged_clone():
            control.now += .25
            return actual_clone()
        def build(current, deadline, _control):
            hints.append(deadline)
            control.now += .06
            return {v.index: current[v.index] for v in work.values()}
        with patch('optimization.time.monotonic', side_effect=lambda: control.now), \
                patch.object(model, 'clone', side_effect=charged_clone):
            result, proven, phases = improve(model, [gap] * len(names), values, 10.1, names,
                context=ImprovementContext(control=control,
                    decision_variables={v.index: key for key, v in work.items()},
                    coverage_groups={'A': ['p', 'q'], 'B': ['outside']}, sunday_peaks={'A': [gap]},
                    coverage_hint_builder=build, refinement_reserve_seconds=.8))
        self.assertEqual([p['objective'] for p in phases], names)
        self.assertEqual(result, values)
        self.assertFalse(proven)
        self.assertEqual(len(hints), 1)
        self.assertLessEqual(control.now, 10.1)
        self.assertTrue(all(p['status'] == 'UNKNOWN' for p in phases))
        self.assertTrue(all(p['workers'] == 1 for p in phases))
        peak = phases[2]
        self.assertEqual(peak['searchScope'], 'SELECTED_PEOPLE')
        self.assertEqual(peak['movablePeople'], 2)
        self.assertGreaterEqual(peak['preparationSeconds'], .25)
        self.assertGreaterEqual(peak['budgetSeconds'], .4 - 1e-9)
        self.assertGreaterEqual(phases[1]['budgetSeconds'], .4 - 1e-9)
        self.assertGreaterEqual(phases[3]['budgetSeconds'], .8 - 1e-9)
        self.assertTrue(all(tuple(model.proto.variables[v.index].domain) == (0, 1) for v in work.values()))

    def test_real_solver_wires_peak_after_totals_with_existing_guards_and_fixed_clocks(self):
        from test_sunday_composed_hint import scenario
        data = scenario()
        before = copy.deepcopy(data)
        actual_improve = solver.improve
        captured = []
        def observe(model, goals, values, deadline, names, *, context):
            self.assertLess(names.index('SUNDAY_COVERAGE'), names.index('SUNDAY_PEAK'))
            self.assertLess(names.index('SUNDAY_PEAK'), names.index('SUNDAY_BALANCE'))
            self.assertTrue(context.sunday_peaks)
            peak_guards = [g for g in context.protected_groups['SUNDAY_PEAK']
                           if any(v.name.startswith('sunday-peak:') for v in cp_model.FlatIntExpr(g).vars)]
            self.assertEqual(len(peak_guards), 2)
            self.assertFalse(any(v.name.startswith('sunday-peak:')
                for g in context.protected_groups['COVERAGE'] for v in cp_model.FlatIntExpr(g).vars))
            captured.append(True)
            return actual_improve(model, goals, values, deadline, names, context=context)
        with patch('solver.improve', side_effect=observe):
            result = solver.solve(data)
        self.assertEqual(captured, [True])
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(data, before)
        self.assertEqual(result['optimization']['budgetSeconds'], 12)
        for entry in result['assignments']:
            if entry['kind'] == 'WORK':
                self.assertEqual(entry['shiftId'], 'day')
        peak = next(p for p in result['optimization']['phases'] if p['objective'] == 'SUNDAY_PEAK')
        self.assertLessEqual(peak['incumbentValue'], peak['initialValue'])


if __name__ == '__main__':
    if sys.argv[1:] == ['--capture-transport']:
        print(json.dumps(capture_transport_cases(), allow_nan=False))
    else:
        unittest.main()
