"""Exercise the December 2026 cutover without production data or outside dates."""
from collections import Counter
import unittest

from model_input import ModelInputError, validate_model_input, validate_planning_horizon
from planning_calendar import is_december_cutover, planning_month_period, planning_weeks
from solver import solve

DECEMBER = {
    'planningWeekStartsOn': 'SUNDAY', 'visibleMonth': '2026-12',
    'startDate': '2026-12-01', 'endDate': '2026-12-31',
}


def fixture(untimed=False):
    return {
        **DECEMBER, 'branchCode': '07', 'restRulesVersion': 3,
        'generationMode': 'DAYS_AND_HOURS', 'defaultWeeklyHours': 42, 'simulation': True,
        'policy': {
            'weeklyLimit': 44, 'dailyLimitMinutes': 504, 'compensationAuthorized': True,
            'minInterShiftMinutes': 660, 'minWeeklyRestMinutes': 2100, 'minMealMinutes': 60,
            'maxConsecutiveWorkDays': 6, 'closedDates': [], 'holidayDates': [],
            'authorizedHolidayDates': [], 'holidayRestAllowed': False,
        },
        'shifts': [{'id': 'day', 'segments': [
            {'start': 480, 'end': 720, 'kind': 'WORK'},
            {'start': 720, 'end': 780, 'kind': 'BREAK'},
            {'start': 780, 'end': 1044, 'kind': 'WORK'},
        ]}],
        'employees': [{
            'id': 'p0', 'sector': 'Reposição', 'role': 'Repositor',
            'weeklyHours': 42, 'shiftIds': [] if untimed else ['day'],
            'scheduleMode': 'UNTIMED' if untimed else 'TIMED',
            'activeFrom': DECEMBER['startDate'], 'offMode': 'VARIABLE',
            'fixedOffDays': [], 'offPattern': 'ANY', 'maxConsecutiveSundays': 2,
            'sundayRestRule': 'COMMERCE', 'preferredOffDays': [], 'historyKnown': False,
            'history': [],
        }],
        'demands': [], 'assignments': [],
    }


class DecemberCutoverTests(unittest.TestCase):
    def get_assignments(self, data):
        validate_model_input(data)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
        days = {entry['date']: entry for entry in result['assignments']}
        self.assertEqual(days.keys(), {d for week in planning_weeks(data) for d in week['dates']})
        return days

    def test_only_exact_sunday_cutover_allows_partial_edges(self):
        self.assertTrue(is_december_cutover(DECEMBER))
        self.assertEqual(planning_month_period('2026-12', DECEMBER),
                         {'startDate': '2026-12-01', 'endDate': '2026-12-31'})
        self.assertEqual([(week['startDate'], week['endDate']) for week in planning_weeks(DECEMBER)],
                         [('2026-12-01', '2026-12-05'), ('2026-12-06', '2026-12-12'),
                          ('2026-12-13', '2026-12-19'), ('2026-12-20', '2026-12-26'),
                          ('2026-12-27', '2026-12-31')])
        validate_planning_horizon(DECEMBER)
        for override in ({'startDate': '2026-12-02'}, {'endDate': '2026-12-30'},
                         {'planningWeekStartsOn': 'MONDAY'}):
            with self.subTest(override=override), self.assertRaises(ModelInputError):
                validate_planning_horizon({**DECEMBER, **override})
        aligned = {**DECEMBER, 'startDate': '2026-12-06', 'endDate': '2026-12-12'}
        self.assertFalse(is_december_cutover(aligned))
        validate_planning_horizon(aligned)

    def test_timed_and_untimed_each_have_two_rests_before_sunday(self):
        for untimed in (False, True):
            with self.subTest(untimed=untimed):
                data = fixture(untimed)
                data['assignments'] = [
                    {'employeeId': 'p0', 'date': '2026-12-06', 'kind': 'OFF', 'locked': True},
                ]
                result = self.get_assignments(data)
                work_kind = 'DUTY' if untimed else 'WORK'
                first, second = planning_weeks(data)[:2]
                for week, work in ((first, 3), (second, 5)):
                    self.assertEqual(Counter(result[d]['kind'] for d in week['dates']),
                                     {work_kind: work, 'OFF': 2})
                self.assertEqual(result['2026-12-05']['kind'], work_kind)
                self.assertTrue(result['2026-12-06']['locked'])
                if not untimed:
                    self.assertEqual({entry.get('shiftId') for entry in result.values()
                                      if entry['kind'] == 'WORK'}, {'day'})

    def test_closed_holiday_does_not_consume_one_of_the_first_rests(self):
        data = fixture()
        holiday = '2026-12-03'
        for field in ('closedDates', 'holidayDates', 'paidHolidayDates'):
            data['policy'][field] = [holiday]
        result = self.get_assignments(data)
        self.assertEqual(Counter(result[d]['kind'] for d in planning_weeks(data)[0]['dates']),
                         {'WORK': 2, 'OFF': 2, 'HOLIDAY': 1})

    def test_mixed_long_days_follow_sunday_weeks_at_both_edges(self):
        data = fixture()
        data['mixed42Sectors'] = ['Reposição']
        data['shifts'][0]['segments'][-1]['end'] = 1020
        data['shifts'].append({'id': 'long', 'segments': [
            {'start': 480, 'end': 750, 'kind': 'WORK'},
            {'start': 750, 'end': 930, 'kind': 'BREAK'},
            {'start': 930, 'end': 1200, 'kind': 'WORK'},
        ]})
        data['employees'][0]['shiftIds'].append('long')
        result = self.get_assignments(data)
        first, *middle, last = planning_weeks(data)
        for week in (first, last):
            self.assertLessEqual(sum(result[d].get('shiftId') == 'long' for d in week['dates']), 2)
        for week in middle:
            self.assertEqual(sum(result[d].get('shiftId') == 'long' for d in week['dates']), 2)

    def test_absence_and_conflicting_work_locks_are_never_removed(self):
        data = fixture()
        absent = '2026-12-03'
        data['assignments'] = [{'employeeId': 'p0', 'date': absent, 'kind': 'ABSENCE'}]
        self.assertEqual(self.get_assignments(data)[absent]['kind'], 'ABSENCE')
        data['assignments'] = [
            {'employeeId': 'p0', 'date': day, 'kind': 'WORK', 'shiftId': 'day', 'locked': True}
            for day in ('2026-12-01', '2026-12-02', '2026-12-04')
        ]
        self.assertEqual(solve(data)['status'], 'INFEASIBLE')
