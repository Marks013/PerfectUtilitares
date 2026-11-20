"""Pure contract checks. These do not claim CP-SAT feasibility."""
import copy
import unittest
from datetime import date, timedelta

from rest_configuration import (effective_rest_input, fixed_rest_projection,
                                repeated_variable_pattern, variable_rest_groups)


def fixture():
    dates = [(date(2026, 11, 29) + timedelta(days=i)).isoformat() for i in range(28)]
    person = dict(id='synthetic', offMode='VARIABLE', fixedOffDays=[], offPattern='ANY',
                  activeFrom='2020-01-01')
    policy = dict(closedDates=[], holidayDates=[], paidHolidayDates=[],
                  _restRulesVersion=3, _planningWeekStartsOn='SUNDAY')
    return dates, person, policy


class RestConfigurationTests(unittest.TestCase):
    def test_legacy_projection_is_preserved(self):
        self.assertEqual(fixed_rest_projection(dict(offMode='MIXED', fixedOffDays=[2])), ('MIXED', [2]))

    def test_slots_enable_independently_without_losing_disabled_days(self):
        slots = [dict(enabled=False, weekday=2), dict(enabled=True, weekday=6)]
        person = dict(offMode='MIXED', fixedOffDays=[6], fixedRestSlots=slots)
        before = copy.deepcopy(person)
        self.assertEqual(fixed_rest_projection(person), ('MIXED', [6]))
        self.assertEqual(person, before)
        person.update(offMode='FIXED', fixedOffDays=[2, 6])
        slots[0]['enabled'] = True
        self.assertEqual(fixed_rest_projection(person), ('FIXED', [2, 6]))

    def test_rejects_duplicate_enabled_days_and_projection_mismatch(self):
        invalid = [
            dict(offMode='FIXED', fixedOffDays=[2, 6], fixedRestSlots=[dict(enabled=True, weekday=2)] * 2),
            dict(offMode='FIXED', fixedOffDays=[2, 6], fixedRestSlots=[dict(enabled=False, weekday=2), dict(enabled=True, weekday=6)]),
            dict(offMode='MIXED', fixedOffDays=[2], fixedRestSlots=[dict(enabled=True, weekday=None), dict(enabled=False, weekday=6)]),
            dict(offMode='VARIABLE', fixedOffDays=[], fixedRestSlots=[]),
            dict(offMode='VARIABLE', fixedOffDays=[], fixedRestSlots=[dict(enabled=0, weekday=2), dict(enabled=False, weekday=None)]),
        ]
        for person in invalid:
            with self.subTest(person=person), self.assertRaises(ValueError):
                fixed_rest_projection(person)

    def test_branch02_closure_is_not_a_personal_fixed_day_or_a_holiday(self):
        dates, person, _ = fixture()
        for code in ('02', '2', '002', ' 02 '):
            data = dict(branchCode=code, startDate=dates[0], endDate=dates[-1], restRulesVersion=3,
                        employees=[person], policy=dict(closedDates=['2026-12-25'], holidayDates=['2026-12-25']),
                        demands=[dict(date='2026-12-06', estimated=True), dict(date='2026-12-06', minimum=1)])
            before = copy.deepcopy(data)
            prepared = effective_rest_input(data)
            self.assertIn('2026-12-06', prepared['policy']['closedDates'])
            self.assertIn('2026-12-27', prepared['policy']['closedDates'])  # overnight boundary
            self.assertEqual(prepared['policy']['holidayDates'], ['2026-12-25'])
            self.assertEqual(prepared['employees'], [person])
            self.assertEqual(len(prepared['demands']), 1)
            self.assertEqual(effective_rest_input(prepared), prepared)
            self.assertEqual(data, before)

    def test_other_branches_and_legacy_are_not_reinterpreted(self):
        dates, person, _ = fixture()
        for code, version in [('06', 3), ('02', 2), ('A02', 3)]:
            data = dict(branchCode=code, restRulesVersion=version, startDate=dates[0], endDate=dates[-1],
                        employees=[person], policy=dict(closedDates=[]), demands=[])
            self.assertEqual(effective_rest_input(data), data)

    def test_automatic_repetition_is_rejected_but_explicit_pair_is_allowed(self):
        dates, person, policy = fixture()
        records = {day: dict(kind='OFF' if date.fromisoformat(day).weekday() in (2, 6) else 'WORK') for day in dates}
        self.assertTrue(repeated_variable_pattern(person, dates, records, {}, policy))
        person.update(offMode='FIXED', fixedOffDays=[2, 6])
        self.assertFalse(repeated_variable_pattern(person, dates, records, {}, policy))

    def test_closed_sunday_allows_second_rest_to_rotate(self):
        dates, person, policy = fixture()
        policy['closedDates'] = [day for day in dates if date.fromisoformat(day).weekday() == 6]
        records = {day: dict(kind='OFF' if date.fromisoformat(day).weekday() in (2, 6) else 'WORK') for day in dates}
        self.assertTrue(repeated_variable_pattern(person, dates, records, {}, policy))
        records['2026-12-09'] = dict(kind='WORK')
        records['2026-12-10'] = dict(kind='OFF')
        self.assertFalse(repeated_variable_pattern(person, dates, records, {}, policy))

    def test_absences_holidays_locks_and_partial_weeks_are_not_rotation_opportunities(self):
        dates, person, policy = fixture()
        baseline = {(person['id'], dates[1]): dict(kind='ABSENCE'),
                    (person['id'], dates[8]): dict(kind='WORK', locked=True),
                    (person['id'], dates[15]): dict(kind='HOLIDAY')}
        self.assertEqual(variable_rest_groups(person, dates, baseline, policy), [])
        person['activeUntil'] = dates[9]
        self.assertEqual(variable_rest_groups(person, dates, {}, policy), [])

    def test_hours_only_consecutive_and_forced_two_rests_are_not_rewritten(self):
        dates, person, policy = fixture()
        policy['_generationMode'] = 'HOURS_ONLY'
        self.assertEqual(variable_rest_groups(person, dates, {}, policy), [])
        policy.pop('_generationMode')
        person['offPattern'] = 'CONSECUTIVE'
        self.assertEqual(variable_rest_groups(person, dates, {}, policy), [])
        person['offPattern'] = 'ANY'
        policy['closedDates'] = [day for day in dates if date.fromisoformat(day).weekday() in (2, 6)]
        self.assertEqual(variable_rest_groups(person, dates, {}, policy), [])


if __name__ == '__main__':
    unittest.main()
