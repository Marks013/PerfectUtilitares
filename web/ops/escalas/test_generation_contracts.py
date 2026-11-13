"""Generation preservation regressions for the consolidated production runtime run."""
import copy
import unittest
from datetime import date
from unittest.mock import patch

from model_input import ModelInputError, validate_model_input
from solver import _saturday_off_forbidden, days_between, retained_disabled_records, solve
from test_solver import fixture, make_untimed


def complete_baseline(data):
    for person in data['employees']:
        for day in days_between(data['startDate'], data['endDate']):
            kind = 'OFF' if date.fromisoformat(day).weekday() in (5, 6) else 'WORK'
            if kind == 'WORK' and person.get('scheduleMode') == 'UNTIMED':
                kind = 'DUTY'
            item = {'employeeId': person['id'], 'date': day, 'kind': kind}
            if kind == 'WORK':
                item['shiftId'] = 'day'
            data['assignments'].append(item)


class GenerationContractsTests(unittest.TestCase):
    def assert_feasible(self, result):
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)

    def test_v2_generates_no_saturday_off_and_keeps_history(self):
        data = fixture(40, weeks=6, start_date='2026-10-26')
        data.update(restRulesVersion=2, visibleMonth='2026-11')
        complete_baseline(data)  # Unlocked OFFs in both padding weeks must be regenerated.
        data['employees'][0]['planningFuture'] = [
            {'employeeId': 'p0', 'date': '2026-12-12', 'kind': 'OFF'}]
        before = copy.deepcopy(data)
        result = solve(data)
        self.assert_feasible(result)
        self.assertFalse(any(a['kind'] == 'OFF' and date.fromisoformat(a['date']).weekday() == 5
                             for a in result['assignments']))
        self.assertEqual(data, before)

    def test_saturday_absence_and_existing_holiday_keep_their_kind(self):
        for kind in ('ABSENCE', 'HOLIDAY'):
            with self.subTest(kind=kind):
                data = fixture(40)
                data['restRulesVersion'] = 2
                data['assignments'] = [{'employeeId': 'p0', 'date': '2026-11-07', 'kind': kind, 'locked': True}]
                result = solve(data)
                self.assert_feasible(result)
                item = next(a for a in result['assignments'] if a['date'] == '2026-11-07')
                self.assertEqual(item['kind'], kind)
                self.assertTrue(item['locked'])

    def test_fixed_and_locked_saturday_conflict_before_cp(self):
        for fixed, day in ((True, '2026-11-07'), (False, '2026-11-07'),
                           (False, '2026-10-31'), (False, '2026-12-05')):
            data = fixture(40, weeks=6, start_date='2026-10-26')
            data.update(restRulesVersion=3, visibleMonth='2026-11')
            if fixed:
                data['employees'][0]['fixedOffDays'] = [5]
            else:
                # Published overlapping days arrive as locked assignments too.
                data['assignments'] = [{'employeeId': 'p0', 'date': day, 'kind': 'OFF', 'locked': True}]
            before = copy.deepcopy(data)
            with patch('solver._solve', side_effect=AssertionError('must reject before CP')):
                result = solve(data)
            self.assertEqual(result['status'], 'INFEASIBLE')
            self.assertEqual(result['assignments'], [])
            self.assertIn('sábado', result['solverDiagnostics'][0]['message'])
            self.assertEqual(data, before)

    def test_v2_padding_drafts_never_waive_the_rule_while_v1_is_unchanged(self):
        data = fixture(40)
        data['visibleMonth'] = '2026-11'
        for version in (1, 2):
            data['restRulesVersion'] = version
            for day in ('2026-10-31', '2026-11-07', '2026-12-05'):
                for old in (None, {'kind': 'WORK'}, {'kind': 'OFF'}, {'kind': 'OFF', 'locked': True}):
                    self.assertEqual(_saturday_off_forbidden(data, day, old), version >= 2)

    def test_hours_only_missing_or_duplicate_baseline_rejected_before_cp(self):
        for variant in ('empty', 'missing', 'duplicate'):
            data = fixture(40)
            data['generationMode'] = 'HOURS_ONLY'
            if variant != 'empty':
                complete_baseline(data)
                if variant == 'missing':
                    data['assignments'].pop()
                else:
                    data['assignments'].append(dict(data['assignments'][0]))
            with patch('solver._solve', side_effect=AssertionError('must reject before CP')):
                result = solve(data)
            self.assertEqual(result['status'], 'INFEASIBLE')
            self.assertTrue(result['solverDiagnostics'])

    def test_hours_only_preserves_all_kinds_dates_metadata_and_disabled_records(self):
        data = fixture(40, people=2)
        make_untimed(data['employees'][1])
        data['generationMode'] = 'HOURS_ONLY'
        complete_baseline(data)
        for item in data['assignments']:
            if item['date'] in ('2026-11-04', '2026-11-05'):
                item['kind'] = 'ABSENCE' if item['date'] == '2026-11-04' else 'HOLIDAY'
                item.pop('shiftId', None)
            item['note'] = 'synthetic-preserved'
        disabled = copy.deepcopy(data['employees'][0])
        disabled.update(id='disabled', planningEnabled=False)
        data['employees'].append(disabled)
        for day, kind in zip(days_between('2026-11-02', '2026-11-06'),
                             ('WORK', 'DUTY', 'OFF', 'ABSENCE', 'HOLIDAY')):
            item = {'employeeId': 'disabled', 'date': day, 'kind': kind,
                    'note': 'synthetic-disabled-preserved'}
            if kind == 'WORK':
                item['shiftId'] = 'day'
            data['assignments'].append(item)
        before = copy.deepcopy(data)
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(result['assignments'], data['assignments'])
        self.assertEqual(data, before)

    def test_disabled_retention_is_complete_only_in_hours_mode(self):
        data = fixture(40, people=2)
        data['employees'][1]['planningEnabled'] = False
        originals = []
        for day, kind in zip(days_between('2026-11-02', '2026-11-07'),
                             ('WORK', 'DUTY', 'OFF', 'ABSENCE', 'HOLIDAY', 'OFF')):
            item = {'employeeId': 'p1', 'date': day, 'kind': kind}
            if kind == 'WORK':
                item['shiftId'] = 'day'
            if day == '2026-11-07':
                item['locked'] = True
            originals.append(item)
        data['assignments'] = copy.deepcopy(originals)
        data['assignments'].append({'employeeId': 'p0', 'date': '2026-11-02', 'kind': 'OFF'})
        for mode in ('HOURS_ONLY', 'REST_ONLY', 'DAYS_AND_HOURS', None):
            with self.subTest(mode=mode):
                data['generationMode'] = mode
                retained = retained_disabled_records(data)
                # Excluded people never lose paid holidays, leave or explicit locks.
                expected = originals if mode == 'HOURS_ONLY' else [a for a in originals
                    if a.get('locked') or a['kind'] in ('ABSENCE', 'HOLIDAY')]
                self.assertEqual(retained, expected)
                self.assertEqual(len(retained), len({(a['employeeId'], a['date']) for a in retained}))
                self.assertTrue(all(a is not original for a in retained for original in data['assignments']))

    def test_preserved_disabled_work_does_not_supply_coverage(self):
        data = fixture(40, people=2)
        data['generationMode'] = 'HOURS_ONLY'
        complete_baseline(data)
        data['employees'][1]['planningEnabled'] = False
        data['demands'] = [{'date': '2026-11-02', 'sector': 'Reposição',
                            'start': 480, 'end': 540, 'minimum': 2}]
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertEqual(data, before)

    def test_hours_only_changes_only_permitted_unlocked_work_shift(self):
        data = fixture(40)
        data['generationMode'] = 'HOURS_ONLY'
        complete_baseline(data)
        alternate = copy.deepcopy(data['shifts'][0])
        alternate['id'] = 'late'
        for segment in alternate['segments']:
            segment['start'] += 60
            segment['end'] += 60
        data['shifts'].append(alternate)
        data['employees'][0]['shiftIds'].append('late')
        data['assignments'][1]['locked'] = True
        data['demands'] = [{'date': '2026-11-02', 'sector': 'Reposição', 'start': 1020, 'end': 1080, 'minimum': 1}]
        result = solve(data)
        self.assert_feasible(result)
        self.assertEqual(result['assignments'][0]['shiftId'], 'late')
        self.assertEqual(result['assignments'][1], data['assignments'][1])
        self.assertEqual([(a['date'], a['kind']) for a in result['assignments']],
                         [(a['date'], a['kind']) for a in data['assignments']])

    def test_hours_only_v2_saturday_off_conflicts_without_changing_baseline(self):
        data = fixture(40)
        data.update(generationMode='HOURS_ONLY', restRulesVersion=2)
        complete_baseline(data)
        before = copy.deepcopy(data)
        with patch('solver._solve', side_effect=AssertionError('must reject before CP')):
            result = solve(data)
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertEqual(data, before)

    def test_invalid_rest_version_is_rejected_at_service_boundary(self):
        for value in (True, 0, '2', 2.5):
            data = fixture(40)
            data['restRulesVersion'] = value
            with self.assertRaises(ModelInputError):
                validate_model_input(data)


if __name__ == '__main__':
    unittest.main()
