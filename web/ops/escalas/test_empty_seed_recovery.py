"""Regression: a complete but synchronized seed must not bypass rest balancing."""
import copy
import unittest
from datetime import date, timedelta

from hints import _compatible
from solver import _feasibility_hints, instant, shift_metrics, sunday_limit


class HintCollector:
    """Only collect decision hints; this is not a CP-SAT feasibility assertion."""

    def __init__(self):
        self.values = {}

    def add_hint(self, variable, value):
        self.values[variable] = value


def scenario(mode='REST_ONLY', one_person=False):
    first = date(2026, 11, 29)
    dates = [(first + timedelta(days=index)).isoformat() for index in range(35)]
    rests = {'2026-11-29', '2026-12-04', '2026-12-06', '2026-12-10',
             '2026-12-14', '2026-12-16', '2026-12-20', '2026-12-23',
             '2026-12-27', '2026-12-31'}
    people = [dict(id=f'p{index:02}', sector='SYNTHETIC', role='Synthetic role',
                   weeklyHours=42, scheduleMode='TIMED', shiftIds=['T'],
                   activeFrom='2020-01-01', fixedOffDays=[], preferredOffDays=[],
                   offMode='VARIABLE', offPattern='ANY', history=[],
                   sundayRestRule='COMMERCE', maxConsecutiveSundays=2)
              for index in range(1 if one_person else 12)]
    shift = {'segments': [{'kind': 'WORK', 'start': 420, 'end': 660},
                         {'kind': 'BREAK', 'start': 660, 'end': 780},
                         {'kind': 'WORK', 'start': 780, 'end': 1044}]}
    metrics = {'T': shift_metrics(shift)}
    active = {person['id']: dates[:] for person in people}
    baseline = {}
    for person in people:
        for day in dates:
            kind = 'OFF' if day in rests else 'HOLIDAY' if day == '2026-12-25' else 'WORK'
            baseline[person['id'], day] = {'employeeId': person['id'], 'date': day, 'kind': kind}
            if kind == 'WORK':
                baseline[person['id'], day]['shiftId'] = 'T'
    off = {key: ('off', *key) for key in baseline}
    work = {key: ('work', *key) for key in baseline}
    choices = {key: {'T': ('shift', *key, 'T')} for key in baseline}
    policy = dict(closedDates=['2026-12-25'], holidayDates=['2026-12-25'],
                  paidHolidayDates=['2026-12-25'], authorizedHolidayDates=[],
                  holidayRestAllowed=False, maxConsecutiveWorkDays=5,
                  minInterShiftMinutes=660, minWeeklyRestMinutes=2100,
                  _simulation=True, _restRulesVersion=2,
                  _generationMode=mode, _visibleMonth='2026-12',
                  _planningWeekStartsOn='SUNDAY')
    demands = [dict(sector='SYNTHETIC', date=day, start=420, end=660,
                    minimum=6, estimated=True) for day in dates if day != '2026-12-25']
    return people, dates, off, work, choices, active, baseline, metrics, policy, demands


def run_hints(parts, **kwargs):
    people, dates, off, work, choices, active, baseline, metrics, policy, demands = parts
    model = HintCollector()
    reused = _feasibility_hints(model, people, dates, off, work, choices, active,
                               baseline, metrics, policy, estimated_demands=demands, **kwargs)
    return reused, model


def entries_from_hints(parts, model, pid):
    _, dates, off, work, choices, _, baseline, _, _, _ = parts
    entries = {}
    for day in dates:
        key = pid, day
        if baseline[key]['kind'] in ('ABSENCE', 'HOLIDAY'):
            kind = baseline[key]['kind']
        elif model.values[work[key]]:
            kind = 'WORK'
        else:
            kind = 'OFF'
        entry = {'kind': kind}
        if kind == 'WORK':
            entry['shiftId'] = next(sid for sid, variable in choices[key].items()
                                   if model.values[variable])
        entries[day] = entry
    return entries


class EmptySeedRecoveryTests(unittest.TestCase):
    def test_complete_empty_sector_is_rebalanced_in_day_changing_modes(self):
        for mode in ('REST_ONLY', 'DAYS_AND_HOURS'):
            with self.subTest(mode=mode):
                parts = scenario(mode)
                before = copy.deepcopy(parts)
                reused, collector = run_hints(parts)
                people, dates, _, _, _, _, _, metrics, policy, _ = parts
                entries = [entries_from_hints(parts, collector, person['id']) for person in people]
                self.assertFalse(reused)
                self.assertEqual(parts, before)
                self.assertGreater(len({tuple(day for day, item in calendar.items()
                                              if item['kind'] == 'OFF') for calendar in entries}), 1)
                for day in dates:
                    if day not in policy['closedDates']:
                        self.assertTrue(any(calendar[day]['kind'] == 'WORK' for calendar in entries), day)
                for person, calendar in zip(people, entries):
                    self.assertTrue(_compatible(person, calendar, {}, metrics, policy,
                                                instant, sunday_limit, True, baseline=parts[6]))
                    for index in range(0, len(dates), 7):
                        kinds = [calendar[day]['kind'] for day in dates[index:index + 7]]
                        self.assertEqual(kinds.count('OFF'), 2)
                        self.assertEqual(kinds.count('WORK'), 5 - kinds.count('HOLIDAY'))

    def test_hours_only_never_redistributes_even_an_empty_sector(self):
        parts = scenario('HOURS_ONLY')
        before = copy.deepcopy(parts)
        reused, collector = run_hints(parts)
        self.assertTrue(reused)
        for key, old in parts[6].items():
            self.assertEqual(collector.values[parts[2][key]], int(old['kind'] == 'OFF'))
            self.assertEqual(collector.values[parts[3][key]], int(old['kind'] == 'WORK'))
        self.assertEqual(parts, before)

    def test_no_positive_estimate_does_not_invent_a_staffing_minimum(self):
        for demands in ([], [{'sector': 'SYNTHETIC', 'date': '2026-12-04',
                             'minimum': 0, 'estimated': True}],
                        [{'sector': 'SYNTHETIC', 'date': '2026-12-04',
                          'minimum': 6, 'estimated': False}]):
            with self.subTest(demands=demands):
                parts = list(scenario())
                parts[-1] = demands
                reused, collector = run_hints(parts)
                self.assertTrue(reused)
                for key, old in parts[6].items():
                    self.assertEqual(collector.values[parts[2][key]], int(old['kind'] == 'OFF'))

    def test_complete_staffed_sector_remains_exactly_unchanged(self):
        parts = scenario()
        _, collector = run_hints(parts)
        for person in parts[0]:
            calendar = entries_from_hints(parts, collector, person['id'])
            for day, entry in calendar.items():
                parts[6][person['id'], day] = {'employeeId': person['id'], 'date': day, **entry}
        before = copy.deepcopy(parts)
        reused, second = run_hints(parts)
        self.assertTrue(reused)
        for key, old in parts[6].items():
            self.assertEqual(second.values[parts[2][key]], int(old['kind'] == 'OFF'))
            self.assertEqual(second.values[parts[3][key]], int(old['kind'] == 'WORK'))
        self.assertEqual(parts, before)

    def test_optional_initial_assignments_do_not_hide_an_empty_sector(self):
        parts = scenario()
        initial = list(copy.deepcopy(parts[6]).values())
        reused, collector = run_hints(parts, initial_assignments=initial)
        self.assertFalse(reused)
        self.assertTrue(any(collector.values[parts[3][person['id'], '2026-12-04']]
                            for person in parts[0]))

    def test_absence_holiday_and_individual_locks_are_not_rewritten(self):
        parts = scenario()
        baseline = parts[6]
        baseline['p00', '2026-12-04']['locked'] = True
        baseline['p00', '2026-12-03']['locked'] = True
        baseline['p01', '2026-12-08'] = {'employeeId': 'p01', 'date': '2026-12-08',
                                        'kind': 'ABSENCE'}
        before = copy.deepcopy(parts)
        _, collector = run_hints(parts)
        self.assertEqual(collector.values[parts[2]['p00', '2026-12-04']], 1)
        self.assertEqual(collector.values[parts[3]['p00', '2026-12-03']], 1)
        self.assertEqual(collector.values[parts[4]['p00', '2026-12-03']['T']], 1)
        self.assertEqual(collector.values[parts[2]['p01', '2026-12-08']], 0)
        self.assertEqual(collector.values[parts[3]['p01', '2026-12-08']], 0)
        for person in parts[0]:
            key = person['id'], '2026-12-25'
            self.assertEqual(collector.values[parts[2][key]], 0)
            self.assertEqual(collector.values[parts[3][key]], 0)
        self.assertEqual(parts, before)

    def test_fully_locked_empty_sector_is_not_silently_unlocked(self):
        parts = scenario()
        for old in parts[6].values():
            old['locked'] = True
        before = copy.deepcopy(parts)
        _, collector = run_hints(parts)
        for key, old in parts[6].items():
            # It may offer no valid hint, but never a changed locked rest.
            alleged = collector.values.get(parts[2][key])
            if alleged is not None:
                self.assertEqual(alleged, int(old['kind'] == 'OFF'))
        self.assertEqual(parts, before)

    def test_single_person_keeps_the_existing_seed_contract(self):
        parts = scenario(one_person=True)
        reused, _ = run_hints(parts)
        self.assertTrue(reused)


if __name__ == '__main__':
    unittest.main()
