"""Bounded seed generation: synthetic calendars, never staffing approval."""
import copy
import unittest
from datetime import date, timedelta
from unittest.mock import patch

import hints
from solver import instant, sunday_limit


def context(people=12):
    first = date(2026, 11, 29)
    days = [(first + timedelta(days=i)).isoformat() for i in range(35)]
    employees = [dict(id=f'synthetic-{i:03}', sector='Synthetic', role='Synthetic role',
        weeklyHours=42, shiftIds=['day'], activeFrom='2020-01-01', offMode='VARIABLE',
        fixedOffDays=[], offPattern='ANY', maxConsecutiveSundays=2,
        sundayRestRule='COMMERCE', preferredOffDays=[], history=[]) for i in range(people)]
    policy = dict(closedDates=['2026-12-25'], holidayDates=['2026-12-25'],
        paidHolidayDates=['2026-12-25'], authorizedHolidayDates=[],
        holidayRestAllowed=False, maxConsecutiveWorkDays=5,
        minInterShiftMinutes=660, minWeeklyRestMinutes=2100, _simulation=True,
        _restRulesVersion=2, _visibleMonth='2026-12', _planningWeekStartsOn='SUNDAY',
        _generationMode='REST_ONLY')
    active = {p['id']: days[:] for p in employees}
    baseline = {(p['id'], '2026-12-25'): {'kind': 'HOLIDAY'} for p in employees}
    choices = {(p['id'], day): {'day': 1} for p in employees for day in days}
    return employees, days, active, baseline, choices, {'day': (504, 420, 1044)}, policy


def generate(parts, **kwargs):
    return hints.balanced_rest_hints(*parts, instant, sunday_limit, **kwargs)


class HintRobustnessTests(unittest.TestCase):
    def test_empty_inputs_do_not_inspect_people_or_policy(self):
        self.assertEqual(generate(([], [], {}, {}, {}, {}, {})), {})
        self.assertEqual(generate(([{}], [], {}, {}, {}, {}, {})), {})

    def test_expired_budget_does_not_start_preparation(self):
        parts = context()
        original = copy.deepcopy(parts)
        with patch('hints.time.monotonic', return_value=10), \
                patch('hints.paid_holiday_dates', side_effect=AssertionError('expired preparation')):
            self.assertEqual(generate(parts, deadline=10), {})
        self.assertEqual(parts, original)

    def test_cancellation_precedes_group_preparation(self):
        class Cancelled(Exception):
            pass
        class Control:
            def checkpoint(self):
                raise Cancelled()
        with patch('hints.paid_holiday_dates', side_effect=AssertionError('cancelled preparation')):
            with self.assertRaises(Cancelled):
                generate(context(), control=Control())

    def test_no_active_days_does_not_return_an_empty_person_calendar(self):
        parts = context(1)
        parts[2][parts[0][0]['id']] = []
        for portfolio in (False, True):
            with self.subTest(portfolio=portfolio):
                self.assertEqual(generate(parts, calendar_portfolio=portfolio), {})

    def test_empty_compatibility_candidate_is_declined(self):
        parts = context(1)
        self.assertFalse(hints._compatible(parts[0][0], {}, {}, parts[5], parts[6],
                                         instant, sunday_limit, True))

    def test_partial_employment_requires_final_consecutive_rest_check(self):
        parts = context(1)
        person = parts[0][0]
        person.update(offMode='FIXED', fixedOffDays=[6], offPattern='CONSECUTIVE',
                      activeUntil=parts[1][0])
        parts[2][person['id']] = [parts[1][0]]
        for portfolio in (False, True):
            with self.subTest(portfolio=portfolio):
                self.assertEqual(generate(parts, calendar_portfolio=portfolio), {})
        # Real preceding history can complete the pair; unknown future cannot.
        person['history'] = [{'date': '2026-11-28', 'kind': 'OFF'}]
        for portfolio in (False, True):
            self.assertEqual(generate(parts, calendar_portfolio=portfolio),
                             {person['id']: {parts[1][0]: {'kind': 'OFF'}}})

    def test_reused_portfolio_has_weekday_diversity_and_validates_recipients(self):
        parts = context()
        original = copy.deepcopy(parts)
        stats, checked = {}, []
        actual = hints._compatible
        def check(person, proposed, prior, metrics, policy, clock, limit, final, **kwargs):
            result = actual(person, proposed, prior, metrics, policy, clock, limit, final, **kwargs)
            if final and result:
                checked.append((person['id'], copy.deepcopy(proposed)))
            return result
        with patch('hints._compatible', side_effect=check):
            result = generate(parts, calendar_portfolio=True, portfolio_stats=stats)
        self.assertEqual(set(result), set(parts[2]))
        self.assertGreater(stats.get('portfolioPeople', 0), 0)
        self.assertLessEqual(stats['masksMax'], 4)
        self.assertLess(stats['beamPeople'], len(parts[0]))
        for pid, entries in result.items():
            self.assertIn((pid, entries), checked)
            self.assertEqual(set(entries), set(parts[1]))
            for index in range(0, 35, 7):
                kinds = [entries[day]['kind'] for day in parts[1][index:index+7]]
                self.assertEqual(kinds.count('OFF'), 2)
                self.assertEqual(kinds.count('WORK'), 5-kinds.count('HOLIDAY'))
        for day in parts[1]:
            if day not in parts[6]['closedDates']:
                self.assertTrue(any(entries[day]['kind'] == 'WORK' for entries in result.values()), day)
        self.assertEqual(parts, original)

    def test_deterministic_and_no_recipient_aliasing(self):
        parts = context()
        first = generate(parts, calendar_portfolio=True)
        reversed_parts = list(parts)
        reversed_parts[0] = list(reversed(parts[0]))
        self.assertEqual(generate(reversed_parts, calendar_portfolio=True), first)
        pid = parts[0][0]['id']
        second = copy.deepcopy(first)
        first[pid][parts[1][0]]['kind'] = 'TEST_ONLY'
        self.assertEqual(generate(parts, calendar_portfolio=True), second)
        self.assertFalse(any(entry['kind'] == 'TEST_ONLY' for key, days in first.items()
                             if key != pid for entry in days.values()))

    def test_expired_final_validation_does_not_emit_late_calendar(self):
        parts, clock = context(1), [0.0]
        actual = hints._compatible
        def check(*args, **kwargs):
            result = actual(*args, **kwargs)
            if args[7]:
                clock[0] = 2.0
            return result
        with patch('hints.time.monotonic', side_effect=lambda: clock[0]), \
                patch('hints._compatible', side_effect=check):
            self.assertEqual(generate(parts, deadline=1.0), {})

    def test_hours_only_remains_unchanged(self):
        parts = context()
        parts[6]['_generationMode'] = 'HOURS_ONLY'
        original = copy.deepcopy(parts)
        with patch('hints.paid_holiday_dates', side_effect=AssertionError('hours-only repair')):
            self.assertEqual(generate(parts), {})
        self.assertEqual(parts, original)

    def test_locks_absence_and_recipient_clocks_survive_reuse(self):
        parts = context()
        people, days, _, baseline, choices, metrics, _ = parts
        for i, person in enumerate(people):
            sid = 'clock-' + str(i)
            person['shiftIds'] = [sid]
            metrics[sid] = (504, 420 + i, 1044 + i)
            for day in days:
                choices[person['id'], day] = {sid: 1}
            baseline[person['id'], days[2]] = {'kind': 'WORK', 'shiftId': sid, 'locked': True}
        baseline[people[0]['id'], days[10]] = {'kind': 'ABSENCE'}
        original = copy.deepcopy(parts)
        result = generate(parts, calendar_portfolio=True)
        self.assertEqual(set(result), set(parts[2]))
        for person in people:
            entries, sid = result[person['id']], person['shiftIds'][0]
            self.assertEqual(entries[days[2]], {'kind': 'WORK', 'shiftId': sid})
            self.assertEqual(entries['2026-12-25']['kind'], 'HOLIDAY')
            self.assertTrue(all(e.get('shiftId') == sid for e in entries.values() if e['kind'] == 'WORK'))
        self.assertEqual(result[people[0]['id']][days[10]]['kind'], 'ABSENCE')
        self.assertEqual(parts, original)


class SeedRobustnessIntegrationTests(unittest.TestCase):
    """Actual CP-SAT with normal project imports; no fake feasibility result."""
    def test_sunday_start_recovers_synchronized_seed_with_protected_dates(self):
        import solver
        from test_solver import fixture, make_untimed
        data = fixture(42, people=12, weeks=5, start_date='2026-11-29')
        data.update(planningWeekStartsOn='SUNDAY', restRulesVersion=2,
                    visibleMonth='2026-12', simulation=True, generationMode='REST_ONLY')
        data['policy'].update(validUntil='2027-12-31', closedDates=['2026-12-25'],
            holidayDates=['2026-12-25'], paidHolidayDates=['2026-12-25'])
        days = solver.days_between(data['startDate'], data['endDate'])
        rests = {days[i] for i in (0, 5, 7, 11, 15, 17, 21, 24, 28, 32)}
        for person in data['employees']:
            person.update(history=[], historyKnown=False)
        make_untimed(data['employees'][-1])
        for person in data['employees']:
            for day in days:
                kind = ('HOLIDAY' if day == '2026-12-25' else 'OFF' if day in rests else
                        'DUTY' if person is data['employees'][-1] else 'WORK')
                entry = dict(employeeId=person['id'], date=day, kind=kind)
                if kind == 'WORK':
                    entry['shiftId'] = 'day'
                if person['id'] == 'p0' and day == '2026-12-01':
                    entry['locked'] = True
                if person['id'] == 'p1' and day == '2026-12-08':
                    entry = dict(employeeId='p1', date=day, kind='ABSENCE')
                data['assignments'].append(entry)
        data['demands'] = [dict(sector='Reposição', date=day, start=480, end=720,
            minimum=6, estimated=True) for day in days if day != '2026-12-25']
        original = copy.deepcopy(data)
        result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        self.assertEqual(data, original)
        indexed = {(entry['employeeId'], entry['date']): entry for entry in result['assignments']}
        self.assertEqual(len(indexed), 12 * 35)
        self.assertTrue(indexed['p0', '2026-12-01']['locked'])
        self.assertEqual(indexed['p0', '2026-12-01']['kind'], 'WORK')
        self.assertEqual(indexed['p1', '2026-12-08']['kind'], 'ABSENCE')
        for day in days:
            if day != '2026-12-25':
                self.assertTrue(any(indexed[p['id'], day]['kind'] == 'WORK'
                                    for p in data['employees']), day)
            else:
                self.assertTrue(all(indexed[p['id'], day]['kind'] == 'HOLIDAY'
                                    for p in data['employees']))
        for person in data['employees']:
            entries = [indexed[person['id'], day] for day in days]
            for offset in range(0, 35, 7):
                kinds = [entry['kind'] for entry in entries[offset:offset+7]]
                if 'ABSENCE' not in kinds:
                    self.assertEqual(kinds.count('OFF'), 2)
                    self.assertEqual(kinds.count('WORK')+kinds.count('DUTY'), 5-kinds.count('HOLIDAY'))
            run = 0
            for day, entry in zip(days, entries):
                run = run + 1 if entry['kind'] in ('WORK', 'DUTY') else 0
                self.assertLessEqual(run, 5)
                if date.fromisoformat(day).weekday() == 5:
                    self.assertNotEqual(entry['kind'], 'OFF')
                if person is data['employees'][-1]:
                    self.assertNotEqual(entry['kind'], 'WORK')
                    self.assertNotIn('shiftId', entry)


if __name__ == '__main__':
    unittest.main()
