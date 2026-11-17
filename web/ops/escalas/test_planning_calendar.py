"""Calendar arithmetic only; no solver dependency or production state."""
from datetime import date, timedelta
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
        cases = [('2026-12', '2026-11-29', '2027-01-02', 5),
                 ('2027-01', '2026-12-27', '2027-02-06', 6),
                 ('2026-02', '2026-02-01', '2026-02-28', 4)]
        for month, first, last, count in cases:
            with self.subTest(month=month):
                period = planning_month_period(month, SUNDAY)
                self.assertEqual(period, {'startDate': first, 'endDate': last})
                self.assertEqual(len(planning_weeks({**period, **SUNDAY})), count)

    def test_each_sunday_belongs_only_to_the_week_it_starts(self):
        weeks = planning_weeks({**planning_month_period('2026-12', SUNDAY), **SUNDAY})
        self.assertEqual([w['startDate'] for w in weeks if '2026-12-13' in w['dates']], ['2026-12-13'])
        self.assertNotIn('2026-12-13', weeks[1]['dates'])

    def test_misaligned_or_unbounded_horizons_are_rejected(self):
        for first, last in [('2026-12-07', '2026-12-13'), ('2026-12-06', '2026-12-11'),
                            ('2026-12-06', '2027-01-23'), ('2026-12-13', '2026-12-06')]:
            with self.subTest(first=first, last=last), self.assertRaises(ValueError):
                planning_weeks({'startDate': first, 'endDate': last, **SUNDAY})

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
                    self.assertIn(len(days), (28, 35, 42))
                    self.assertEqual(len(days), len(set(days)))
                    self.assertLessEqual(period['startDate'], value + '-01')
                    self.assertGreaterEqual(period['endDate'][:7], value)
                    for week in weeks:
                        self.assertEqual(date.fromisoformat(week['startDate']).weekday(), weekday)
                        for offset, day in enumerate(week['dates']):
                            self.assertEqual(day, (date.fromisoformat(week['startDate']) + timedelta(days=offset)).isoformat())
                            self.assertEqual(planning_week_start(day, calendar), week['startDate'])
                    checked += 1
        self.assertEqual(checked, 2396)


if __name__ == '__main__':
    unittest.main()
