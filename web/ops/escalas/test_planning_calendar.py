"""Calendar arithmetic only; no solver dependency or production state."""
from datetime import date, timedelta
import copy
import unittest

from planning_calendar import (planning_month_period, planning_week_end,
                               planning_week_start, planning_week_starts_on,
                               planning_weeks)

SUNDAY = {'planningWeekStartsOn': 'SUNDAY'}


class PlanningCalendarTests(unittest.TestCase):
    def test_missing_metadata_is_legacy_not_sunday(self):
        self.assertEqual(planning_week_starts_on({}), 'MONDAY')
        self.assertEqual(planning_week_start('2026-12-13'), '2026-12-07')
        self.assertEqual(planning_week_start('2026-12-13', SUNDAY), '2026-12-13')
        self.assertEqual(planning_week_end('2026-12-13', SUNDAY), '2026-12-19')

    def test_unknown_conventions_and_invalid_dates_are_rejected(self):
        for value in (None, '', 0, 'SATURDAY', 'sunday'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                planning_week_starts_on({'planningWeekStartsOn': value})
        for value in ('2026-02-29', '2026-13-01', '2026-1-01', '2026-01-01T00:00:00Z'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                planning_week_start(value, SUNDAY)

    def test_months_are_expanded_not_shifted(self):
        cases = [('2026-11', '2026-11-01', '2026-12-05', 5),
                 ('2027-01', '2026-12-27', '2027-02-06', 6),
                 ('2026-02', '2026-02-01', '2026-02-28', 4)]
        for month, first, last, count in cases:
            with self.subTest(month=month):
                period = planning_month_period(month, SUNDAY)
                self.assertEqual(period, {'startDate': first, 'endDate': last})
                self.assertEqual(len(planning_weeks({**period, **SUNDAY})), count)

    def test_december_2026_sunday_cutover_is_an_exact_civil_month(self):
        period = planning_month_period('2026-12', SUNDAY)
        self.assertEqual(period, {'startDate': '2026-12-01', 'endDate': '2026-12-31'})
        weeks = planning_weeks({**period, **SUNDAY})
        self.assertEqual([len(week['dates']) for week in weeks], [5, 7, 7, 7, 5])
        self.assertEqual(planning_month_period('2026-12'),
                         {'startDate': '2026-11-30', 'endDate': '2027-01-03'})

    def test_each_sunday_belongs_only_to_the_week_it_starts(self):
        weeks = planning_weeks({**planning_month_period('2026-12', SUNDAY), **SUNDAY})
        self.assertEqual([w['startDate'] for w in weeks if '2026-12-13' in w['dates']], ['2026-12-13'])
        self.assertNotIn('2026-12-13', weeks[1]['dates'])

    def test_misaligned_or_unbounded_horizons_are_rejected(self):
        for first, last in [('2026-12-07', '2026-12-13'), ('2026-12-06', '2026-12-11'),
                            ('2026-12-06', '2027-01-23'), ('2026-12-13', '2026-12-06')]:
            with self.subTest(first=first, last=last), self.assertRaises(ValueError):
                planning_weeks({'startDate': first, 'endDate': last, **SUNDAY})

    def test_nonobject_metadata_never_defaults_to_monday(self):
        for value in (None, False, 0, '', 'SUNDAY', [], ['SUNDAY']):
            with self.subTest(value=value), self.assertRaises(ValueError):
                planning_week_starts_on(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                planning_week_start('2026-12-13', value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                planning_week_end('2026-12-13', value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                planning_month_period('2026-12', value)

    def test_missing_period_fields_and_wrong_period_types_have_domain_errors(self):
        for value in (None, False, [], {}, SUNDAY, {'startDate': '2026-12-06'},
                      {'endDate': '2026-12-12'}, {'startDate': 20261206, 'endDate': '2026-12-12'}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                planning_weeks(value)

    def test_direct_horizons_have_the_same_bounds_as_monthly_horizons(self):
        for first, last in [('1999-12-26', '2000-01-01'), ('2099-12-27', '2100-01-02')]:
            with self.subTest(first=first), self.assertRaises(ValueError):
                planning_weeks({'startDate': first, 'endDate': last, **SUNDAY})
        for convention, first, last in [('SUNDAY', '2000-01-02', '2000-01-08'),
                                         ('MONDAY', '2099-12-21', '2099-12-27')]:
            data = {'startDate': first, 'endDate': last, 'planningWeekStartsOn': convention}
            self.assertEqual(len(planning_weeks(data)), 1)

    def test_civil_week_bounds_do_not_reparse_outside_intermediate_dates(self):
        # Civil utilities support history from 1900; planning horizons remain 2000..2099.
        self.assertEqual(planning_week_start('1900-01-01', SUNDAY), '1899-12-31')
        self.assertEqual(planning_week_end('1900-01-01', SUNDAY), '1900-01-06')
        self.assertEqual(planning_week_start('2099-12-31', SUNDAY), '2099-12-27')
        self.assertEqual(planning_week_end('2099-12-31', SUNDAY), '2100-01-02')

    def test_calendar_outputs_do_not_alias_inputs_or_other_calls(self):
        data = {**planning_month_period('2026-12', SUNDAY), **SUNDAY, 'employees': []}
        before = copy.deepcopy(data)
        first = planning_weeks(data)
        first[0]['dates'][0] = 'changed'
        second = planning_weeks(data)
        self.assertEqual(data, before)
        self.assertEqual(second[0]['dates'][0], data['startDate'])
        self.assertEqual(first[1], second[1])
        self.assertEqual(planning_month_period('2027-01', data),
                         {'startDate': '2026-12-27', 'endDate': '2027-02-06'})

    def test_leap_days_and_all_six_horizon_lengths(self):
        for convention in ('MONDAY', 'SUNDAY'):
            calendar = {'planningWeekStartsOn': convention}
            first = planning_week_start('2028-02-29', calendar)
            for weeks in range(1, 7):
                last = (date.fromisoformat(first) + timedelta(days=7 * weeks - 1)).isoformat()
                result = planning_weeks({'startDate': first, 'endDate': last, **calendar})
                days = [day for week in result for day in week['dates']]
                self.assertEqual(len(result), weeks)
                self.assertEqual(days.count('2028-02-29'), 1)
        for value in ('2000-00', '2000-13', '1999-12', '2100-01', '2026-2',
                      '2026-12\n', None, 202612):
            with self.subTest(value=value), self.assertRaises(ValueError):
                planning_month_period(value, SUNDAY)

    def test_century_partition_has_no_missing_or_duplicate_days(self):
        checked = 0
        for year in range(2000, 2100):
            for month in range(1, 13):
                for convention, weekday in [('MONDAY', 0), ('SUNDAY', 6)]:
                    calendar = {'planningWeekStartsOn': convention}
                    value = f'{year:04d}-{month:02d}'
                    try:
                        period = planning_month_period(value, calendar)
                    except ValueError:
                        self.assertIn(value, ('2000-01', '2099-12'))
                        continue
                    weeks = planning_weeks({**period, **calendar})
                    days = [day for week in weeks for day in week['dates']]
                    if value == '2026-12' and convention == 'SUNDAY':
                        self.assertEqual(len(days), 31)
                    else:
                        self.assertIn(len(days), (28, 35, 42))
                    self.assertEqual(len(days), len(set(days)))
                    self.assertLessEqual(period['startDate'], value + '-01')
                    self.assertGreaterEqual(period['endDate'][:7], value)
                    for week in weeks:
                        civil_start = planning_week_start(week['startDate'], calendar)
                        self.assertEqual(week['startDate'], max(civil_start, period['startDate']))
                        self.assertEqual(date.fromisoformat(civil_start).weekday(), weekday)
                        for offset, day in enumerate(week['dates']):
                            self.assertEqual(day, (date.fromisoformat(week['startDate']) + timedelta(days=offset)).isoformat())
                            self.assertEqual(planning_week_start(day, calendar), civil_start)
                    checked += 1
        self.assertEqual(checked, 2396)


if __name__ == '__main__':
    unittest.main()
