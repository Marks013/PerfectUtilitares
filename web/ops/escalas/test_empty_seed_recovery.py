"""A synchronized seed can be feasible without serving every estimated demand."""
import copy
import unittest
from datetime import date, timedelta

from solver import _feasibility_hints, days_between, shift_metrics, solve
from test_solver import fixture


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


def assert_original_hints(test, parts, collector, source):
    _, _, off, work, choices, _, _, _, _, _ = parts
    for key, entry in source.items():
        test.assertEqual(collector.values[off[key]], int(entry['kind'] == 'OFF'))
        test.assertEqual(collector.values[work[key]], int(entry['kind'] == 'WORK'))
        for sid, variable in choices[key].items():
            test.assertEqual(collector.values[variable], int(entry.get('shiftId') == sid))


def recovery_fixture(mode, optional_seed=False, locked_target=False):
    data = fixture(40, people=3, start_date='2026-12-06')
    data.update(generationMode=mode, planningWeekStartsOn='SUNDAY', restRulesVersion=2,
                visibleMonth='2026-12', simulation=True)
    dates = days_between(data['startDate'], data['endDate'])
    target = '2026-12-11'
    for person in data['employees']:
        for day in dates:
            off = day in (data['startDate'], target)
            entry = {'employeeId': person['id'], 'date': day, 'kind': 'OFF' if off else 'WORK'}
            if not off:
                entry['shiftId'] = 'day'
            if locked_target and day == target:
                entry['locked'] = True
            data['assignments'].append(entry)
    for day in dates:
        if day == data['startDate']:
            continue
        demand = {'sector': 'Reposição', 'date': day, 'start': 480, 'end': 720}
        data['demands'].append({**demand, 'minimum': 1 if day == target else 2,
                                'estimated': day == target})
    if optional_seed:
        data['_initialAssignments'] = copy.deepcopy(data['assignments'])
    return data, target


class EmptySeedRecoveryTests(unittest.TestCase):
    def test_complete_seed_is_reused_before_estimated_coverage_optimization(self):
        for mode in ('REST_ONLY', 'DAYS_AND_HOURS'):
            with self.subTest(mode=mode):
                parts = scenario(mode)
                before = copy.deepcopy(parts)
                reused, collector = run_hints(parts)
                self.assertTrue(reused)
                assert_original_hints(self, parts, collector, parts[6])
                self.assertEqual(parts, before)

    def test_final_solution_recovers_empty_sector_without_sacrificing_mandatory_coverage(self):
        for mode, optional_seed, locked in (('REST_ONLY', False, False),
                                            ('DAYS_AND_HOURS', False, False),
                                            ('REST_ONLY', True, False),
                                            ('REST_ONLY', True, True)):
            with self.subTest(mode=mode, optional_seed=optional_seed, locked=locked):
                data, target = recovery_fixture(mode, optional_seed, locked)
                before = copy.deepcopy(data)
                self.assertFalse(any(a['date'] == target and a['kind'] == 'WORK'
                                     for a in data['assignments']))
                result = solve(data)
                self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
                entries = {(a['employeeId'], a['date']): a for a in result['assignments']}
                self.assertEqual(len(entries), 21)
                for person in data['employees']:
                    duties = [a for (pid, _), a in entries.items() if pid == person['id']]
                    self.assertEqual(len(duties), 7)
                    self.assertEqual(sum(a.get('shiftId') == 'day' and a['kind'] == 'WORK'
                                         for a in duties), 5)
                    self.assertEqual(sum(a['kind'] == 'OFF' for a in duties), 2)
                for demand in data['demands']:
                    present = sum(day == demand['date'] and a['kind'] == 'WORK'
                                  for (_, day), a in entries.items())
                    if demand['estimated'] and locked:
                        self.assertEqual(present, 0)
                    else:
                        self.assertGreaterEqual(present, demand['minimum'])
                for entry in data['assignments']:
                    if entry.get('locked'):
                        self.assertEqual(entries[entry['employeeId'], entry['date']], entry)
                self.assertEqual(data, before)

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
        parts = list(scenario())
        parts[-1] = [demand for demand in parts[-1] if demand['date'] == '2026-12-03']
        before = copy.deepcopy(parts)
        reused, collector = run_hints(parts)
        self.assertTrue(reused)
        assert_original_hints(self, parts, collector, parts[6])
        self.assertEqual(parts, before)

    def test_preferred_initial_assignments_are_hints_not_the_saved_roster(self):
        parts = scenario()
        before = copy.deepcopy(parts)
        initial = copy.deepcopy(parts[6])
        initial['p00', '2026-12-02'].update(kind='OFF')
        del initial['p00', '2026-12-02']['shiftId']
        initial['p00', '2026-12-04'].update(kind='WORK', shiftId='T')
        reused, collector = run_hints(parts, initial_assignments=list(initial.values()))
        self.assertTrue(reused)
        assert_original_hints(self, parts, collector, initial)
        self.assertEqual(parts, before)

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
