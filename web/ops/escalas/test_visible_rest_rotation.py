"""Monthly rotation must not be satisfied solely by technical padding dates."""
import unittest
from datetime import date, timedelta

from rest_configuration import repeated_variable_pattern, variable_rest_groups


def padding_scenario():
    dates = [(date(2026, 12, 27) + timedelta(days=i)).isoformat() for i in range(42)]
    person = dict(id='synthetic', offMode='VARIABLE', fixedOffDays=[], offPattern='ANY',
                  activeFrom='2020-01-01')
    policy = dict(closedDates=[day for day in dates if date.fromisoformat(day).weekday() == 6],
                  holidayDates=[], paidHolidayDates=[], _restRulesVersion=3,
                  _planningWeekStartsOn='SUNDAY', _visibleMonth='2027-01')
    records = {day: dict(kind='OFF' if date.fromisoformat(day).weekday() in (2, 6) else 'WORK')
               for day in dates}
    records['2027-02-03'], records['2027-02-04'] = dict(kind='WORK'), dict(kind='OFF')
    return dates, person, policy, records


class VisibleRestRotationTests(unittest.TestCase):
    def test_padding_variation_does_not_authorize_a_fixed_visible_month(self):
        dates, person, policy, records = padding_scenario()
        self.assertTrue(repeated_variable_pattern(person, dates, records, {}, policy))
        groups = variable_rest_groups(person, dates, {}, policy)
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0][1]), 4)
        self.assertEqual(groups[0][1][0][0], '2027-01-03')
        self.assertEqual(groups[0][1][-1][-1], '2027-01-30')

    def test_real_monthly_variation_is_accepted(self):
        dates, person, policy, records = padding_scenario()
        records['2027-01-13'], records['2027-01-14'] = dict(kind='WORK'), dict(kind='OFF')
        self.assertFalse(repeated_variable_pattern(person, dates, records, {}, policy))

    def test_padding_is_not_used_when_only_one_unprotected_visible_week_remains(self):
        dates, person, policy, records = padding_scenario()
        baseline = {(person['id'], day): dict(kind='OFF', locked=True)
                    for day in ('2027-01-03', '2027-01-10', '2027-01-17')}
        self.assertEqual(variable_rest_groups(person, dates, baseline, policy), [])
        self.assertFalse(repeated_variable_pattern(person, dates, records, baseline, policy))

    def test_nonmonthly_horizon_keeps_complete_week_comparison(self):
        dates, person, policy, records = padding_scenario()
        policy.pop('_visibleMonth')
        self.assertFalse(repeated_variable_pattern(person, dates, records, {}, policy))
        person.update(offMode='FIXED', fixedOffDays=[2, 6])
        policy['_visibleMonth'] = '2027-01'
        self.assertFalse(repeated_variable_pattern(person, dates, records, {}, policy))


if __name__ == '__main__':
    unittest.main()
