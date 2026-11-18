"""Production boundary and weekly allocation in the selected civil calendar."""
import copy
import unittest
from unittest.mock import patch

from model_input import ModelInputError, validate_model_input
from planning_calendar import planning_month_period, planning_week_start, planning_weeks
from rest_quality import rest_pair_summary, visible_month
from solver import shift_metrics, solve
from test_solver import fixture, make_untimed

SUNDAY = {'planningWeekStartsOn': 'SUNDAY'}


def locked_roster(data, rests, long_days=()):
    """A concrete calendar is the oracle; no optimizer-selected pattern is assumed."""
    holidays = set(data['policy'].get('paidHolidayDates', []))
    data['assignments'] = []
    for person in data['employees']:
        for week in planning_weeks(data):
            for day in week['dates']:
                kind = 'HOLIDAY' if day in holidays else 'OFF' if day in rests else 'WORK'
                if kind == 'WORK' and person.get('scheduleMode') == 'UNTIMED':
                    kind = 'DUTY'
                entry = {'employeeId': person['id'], 'date': day, 'kind': kind, 'locked': True}
                if kind == 'WORK':
                    entry['shiftId'] = 'long' if day in long_days else 'day'
                data['assignments'].append(entry)


class SundayWeekBoundaryTests(unittest.TestCase):
    def test_invalid_metadata_and_wrong_alignment_fail_before_solver_allocation(self):
        for value in (None, False, 0, '', 'SATURDAY', [], {}):
            data = fixture(40)
            data['planningWeekStartsOn'] = value
            for entrypoint in (validate_model_input, solve):
                with self.subTest(value=value, entrypoint=entrypoint.__name__):
                    with patch('solver._solve', side_effect=AssertionError('must reject before CP')):
                        with self.assertRaises(ModelInputError) as error:
                            entrypoint(data)
                    self.assertEqual(error.exception.fields[0]['path'], 'planningWeekStartsOn')
                    self.assertEqual(str(error.exception), 'INVALID_MODEL_INPUT')
        for calendar, start in ((SUNDAY, '2026-11-02'), ({}, '2026-11-01')):
            data = fixture(40, start_date=start)
            data.update(calendar)
            for entrypoint in (validate_model_input, solve):
                with self.subTest(calendar=calendar, entrypoint=entrypoint.__name__):
                    with patch('solver._solve', side_effect=AssertionError('must reject before CP')):
                        with self.assertRaises(ModelInputError) as error:
                            entrypoint(data)
                    self.assertEqual(error.exception.fields[0]['reason'], 'INVALID_HORIZON')

    def test_legacy_and_explicit_monday_inputs_remain_unchanged(self):
        for calendar in ({}, {'planningWeekStartsOn': 'MONDAY'}):
            data = fixture(40)
            data.update(calendar)
            before = copy.deepcopy(data)
            validate_model_input(data)
            self.assertEqual(data, before)
            self.assertEqual(planning_weeks(data)[0]['dates'][-1], '2026-11-08')

    def test_month_inference_uses_selected_calendar_not_monday_padding(self):
        for month in ('2026-12', '2027-01', '2028-02'):
            data = {**planning_month_period(month, SUNDAY), **SUNDAY}
            self.assertEqual(visible_month(data), month)
        self.assertEqual(visible_month(planning_month_period('2026-12')), '2026-12')

    def test_pair_repetitions_follow_the_selected_week_not_the_weekday_number(self):
        data = fixture(40, weeks=2, start_date='2026-11-01')
        data.update(SUNDAY)
        person = data['employees'][0]
        person['history'] = []
        make_untimed(person)
        # Pair endings belong to nonconsecutive Sunday-weeks but consecutive
        # Monday-weeks. This checks reporting, not a valid full roster.
        data['assignments'] = [{'employeeId': 'p0', 'date': day, 'kind': 'OFF'}
                               for day in ('2026-11-06', '2026-11-07', '2026-11-14')]
        person['planningFuture'] = [{'employeeId': 'p0', 'date': '2026-11-15', 'kind': 'OFF'}]
        # End the second pair inside the horizon so it participates in this summary.
        data['endDate'] = '2026-11-15'
        summary = rest_pair_summary(data)
        self.assertEqual(summary['totalPairs'], 2)
        self.assertEqual(summary['weeklyRepetitions'], 0)
        data['planningWeekStartsOn'] = 'MONDAY'
        self.assertEqual(rest_pair_summary(data)['weeklyRepetitions'], 1)


class SundayWeekAllocationTests(unittest.TestCase):
    def assert_preserved(self, data):
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        expected = {(a['employeeId'], a['date']): a for a in data['assignments']}
        actual = {(a['employeeId'], a['date']): a for a in result['assignments']}
        self.assertEqual(actual, expected)
        self.assertEqual(data, before)
        return result

    def test_sunday_is_in_its_new_week_and_cannot_pay_previous_week_rest(self):
        data = fixture(40, weeks=2, start_date='2026-11-01')
        data.update(SUNDAY)
        locked_roster(data, {'2026-11-02', '2026-11-05', '2026-11-08', '2026-11-11'})
        result = self.assert_preserved(data)
        for week in planning_weeks(data):
            entries = [a for a in result['assignments'] if a['date'] in week['dates']]
            self.assertEqual(sum(a['kind'] == 'WORK' for a in entries), 5)
            self.assertEqual(sum(a['kind'] == 'OFF' for a in entries), 2)
        monday_group = [a for a in result['assignments'] if '2026-11-02' <= a['date'] <= '2026-11-08']
        self.assertEqual(sum(a['kind'] == 'OFF' for a in monday_group), 3)
        # Swapping the two Sundays would balance a Monday-week but violate both
        # actual selected weeks (three rests in one and one in the other).
        locked_roster(data, {'2026-11-01', '2026-11-02', '2026-11-05', '2026-11-11'})
        self.assertEqual(solve(data)['status'], 'INFEASIBLE')

    def test_fixed_sunday_can_complete_consecutive_rest_after_last_saturday(self):
        data = fixture(40, start_date='2026-11-01')
        data.update(SUNDAY)
        person = data['employees'][0]
        make_untimed(person)
        person.update(offMode='FIXED', fixedOffDays=[5, 6], offPattern='CONSECUTIVE')
        locked_roster(data, {'2026-11-01', '2026-11-07'})
        result = self.assert_preserved(data)
        self.assertEqual(len(result['assignments']), 7)
        self.assertTrue(all(a['date'] <= '2026-11-07' for a in result['assignments']))
        self.assertFalse(person.get('planningFuture'))

    def test_untimed_people_use_sunday_weeks_without_fictitious_hours(self):
        data = fixture(40, weeks=2, start_date='2026-11-01')
        data.update(SUNDAY)
        make_untimed(data['employees'][0])
        locked_roster(data, {'2026-11-02', '2026-11-05', '2026-11-08', '2026-11-11'})
        result = self.assert_preserved(data)
        self.assertTrue(all('shiftId' not in entry for entry in result['assignments']))
        self.assertEqual(sum(a['kind'] == 'DUTY' for a in result['assignments']), 10)

    def test_transition_week_uses_its_saturday_ceiling(self):
        data = fixture(44, start_date='2026-12-13', shift_hours=42)
        data.update(SUNDAY)
        locked_roster(data, {'2026-12-15', '2026-12-18'})
        result = self.assert_preserved(data)
        self.assertEqual(sum(shift_metrics(data['shifts'][0])[0] for a in result['assignments']
                             if a['kind'] == 'WORK'), 42 * 60)

    def test_closed_holiday_across_year_is_not_a_regular_rest(self):
        data = fixture(42, start_date='2026-12-27')
        data.update(SUNDAY, restRulesVersion=2)
        for field in ('closedDates', 'holidayDates', 'paidHolidayDates'):
            data['policy'][field] = ['2027-01-01']
        locked_roster(data, {'2026-12-28', '2026-12-30'})
        result = self.assert_preserved(data)
        self.assertEqual(sum(a['kind'] == 'OFF' for a in result['assignments']), 2)
        self.assertEqual(sum(a['kind'] == 'WORK' for a in result['assignments']), 4)
        self.assertEqual(next(a for a in result['assignments'] if a['date'] == '2027-01-01')['kind'], 'HOLIDAY')

    def test_mixed_hours_are_distributed_inside_the_same_sunday_week(self):
        data = fixture(42, start_date='2026-11-29', shift_hours=40)
        data.update(SUNDAY, mixed42Sectors=['Reposição'])
        data['shifts'].append({'id': 'long', 'name': 'Longo', 'segments': [
            {'start': 480, 'end': 750, 'kind': 'WORK'},
            {'start': 750, 'end': 930, 'kind': 'BREAK'},
            {'start': 930, 'end': 1200, 'kind': 'WORK'}]})
        data['employees'][0]['shiftIds'] = ['day', 'long']
        locked_roster(data, {'2026-12-01', '2026-12-04'}, {'2026-11-29', '2026-12-02'})
        result = self.assert_preserved(data)
        shifts = {s['id']: s for s in data['shifts']}
        minutes = [shift_metrics(shifts[a['shiftId']])[0] for a in result['assignments'] if a['kind'] == 'WORK']
        self.assertEqual(sorted(minutes), [480, 480, 480, 540, 540])
        self.assertEqual(sum(minutes), 42 * 60)
        self.assertEqual(planning_week_start('2026-11-29', data), '2026-11-29')
