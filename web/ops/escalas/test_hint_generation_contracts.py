"""Seed contract regressions; scheduled for the consolidated runtime run."""
import copy
import unittest
from datetime import date
from unittest.mock import patch
from ortools.sat.python import cp_model
from hints import balanced_rest_hints, saturday_rest_forbidden
from solver import _feasibility_hints, _seed_hint_state, days_between, instant, shift_metrics, sunday_limit
from test_solver import fixture
from test_generation_contracts import complete_baseline


def context(data):
    dates = days_between(data['startDate'], data['endDate'])
    active = {p['id']: dates for p in data['employees']}
    baseline = {(a['employeeId'], a['date']): a for a in data['assignments']}
    model, off, work, choices = cp_model.CpModel(), {}, {}, {}
    for p in data['employees']:
        for day in dates:
            key = p['id'], day
            off[key] = model.new_bool_var('o:' + day)
            work[key] = model.new_bool_var('w:' + day)
            choices[key] = {'day': model.new_bool_var('s:' + day)}
    metrics = {s['id']: shift_metrics(s) for s in data['shifts']}
    policy = {**data['policy'], '_simulation': True,
              '_restRulesVersion': data.get('restRulesVersion', 1),
              '_visibleMonth': data.get('visibleMonth'), '_generationMode': data.get('generationMode')}
    return model, data['employees'], dates, off, work, choices, active, baseline, metrics, policy


class HintGenerationContractsTests(unittest.TestCase):
    def test_v2_saved_saturday_off_is_not_fixed_as_comparable_seed(self):
        data = fixture(40, weeks=6, start_date='2026-10-26')
        complete_baseline(data)
        data.update(restRulesVersion=2, visibleMonth='2026-11')
        args = context(data)
        self.assertFalse(_feasibility_hints(*args))
        model, _, _, off, work, choices, *_ = args
        self.assertEqual(_seed_hint_state(model, off, work, choices), 'COMPLETE')
        values = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
        for key in off:
            if date.fromisoformat(key[1]).weekday() == 5:
                self.assertEqual(values[off[key].index], 0)
                self.assertEqual(values[work[key].index], 1)

    def test_v2_balanced_seed_preserves_saturday_absence_and_holiday(self):
        for kind in ('ABSENCE', 'HOLIDAY'):
            with self.subTest(kind=kind):
                data = fixture(40)
                data['restRulesVersion'] = 2
                data['assignments'] = [{'employeeId': 'p0', 'date': '2026-11-07', 'kind': kind}]
                before = copy.deepcopy(data)
                _, people, dates, _, _, choices, active, baseline, metrics, policy = context(data)
                result = balanced_rest_hints(people, dates, active, baseline, choices, metrics, policy, instant, sunday_limit)
                self.assertEqual(result['p0']['2026-11-07']['kind'], kind)
                self.assertEqual(data, before)

    def test_hours_only_ignores_day_changing_initial_and_balanced_seeds(self):
        data = fixture(40)
        complete_baseline(data)
        data['generationMode'] = 'HOURS_ONLY'
        initial = copy.deepcopy(data['assignments'])
        initial[3] = {'employeeId': 'p0', 'date': '2026-11-05', 'kind': 'OFF'}
        initial[5] = {'employeeId': 'p0', 'date': '2026-11-07', 'kind': 'WORK', 'shiftId': 'day'}
        args = context(data)
        with patch('solver.balanced_rest_hints', side_effect=AssertionError('must not redistribute days')):
            self.assertTrue(_feasibility_hints(*args, initial_assignments=initial))
        model, _, _, off, work, choices, *_ = args
        values = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
        for item in data['assignments']:
            key = item['employeeId'], item['date']
            self.assertEqual(values[off[key].index], int(item['kind'] == 'OFF'))
            self.assertEqual(values[work[key].index], int(item['kind'] == 'WORK'))
        model.clear_hints()
        self.assertFalse(_feasibility_hints(*args, prefer_baseline=False))
        self.assertEqual(_seed_hint_state(model, off, work, choices), 'NONE')

    def test_existing_holiday_is_hintable_without_calendar_reclassification(self):
        data = fixture(40)
        complete_baseline(data)
        data['generationMode'] = 'HOURS_ONLY'
        data['assignments'][2] = {'employeeId': 'p0', 'date': '2026-11-04', 'kind': 'HOLIDAY'}
        args = context(data)
        self.assertTrue(_feasibility_hints(*args))
        model, _, _, off, work, *_ = args
        values = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
        self.assertEqual(values[off['p0', '2026-11-04'].index], 0)
        self.assertEqual(values[work['p0', '2026-11-04'].index], 0)

    def test_v2_padding_hints_are_restricted_and_v1_saved_hints_unchanged(self):
        policy = {'_restRulesVersion': 2, '_visibleMonth': '2026-11'}
        for day in ('2026-10-31', '2026-12-05'):
            for old in (None, {'kind': 'WORK'}, {'kind': 'OFF'}, {'kind': 'OFF', 'locked': True}):
                self.assertTrue(saturday_rest_forbidden(policy, day, old))
        data = fixture(40)
        complete_baseline(data)
        before = copy.deepcopy(data)
        args = context(data)
        self.assertTrue(_feasibility_hints(*args))
        model, _, _, off, *_ = args
        values = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
        self.assertEqual({day for (_, day), var in off.items() if values[var.index]},
                         {a['date'] for a in data['assignments'] if a['kind'] == 'OFF'})
        self.assertEqual(data, before)
        self.assertTrue(any(a['kind'] == 'OFF' and date.fromisoformat(a['date']).weekday() == 5 for a in data['assignments']))


if __name__ == '__main__':
    unittest.main()
