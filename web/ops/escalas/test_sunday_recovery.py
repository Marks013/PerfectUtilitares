"""Operational Sunday recovery: real small models, never production payloads."""
import copy
import time
import unittest
from datetime import date
from unittest.mock import patch

from ortools.sat.python import cp_model

import solver
from hints import balanced_rest_hints
from optimization import ImprovementContext, Snapshot, improve
from test_solver import fixture, make_untimed


class SundayRecoveryTests(unittest.TestCase):
    def test_coverage_can_leave_equal_zero_sunday_seed_with_a_partial_recovery(self):
        data = fixture(40, people=2)
        data['restRulesVersion'] = 2
        days = solver.days_between(data['startDate'], data['endDate'])
        for person in data['employees']:
            for day in days:
                rest = date.fromisoformat(day).weekday() in (2, 6)
                data['assignments'].append({'employeeId': person['id'], 'date': day,
                                            'kind': 'OFF' if rest else 'WORK',
                                            **({} if rest else {'shiftId': 'day'})})
        data['demands'] = [{'date': days[-1], 'sector': 'Reposição', 'start': 480,
                            'end': 720, 'minimum': 1, 'estimated': True}]
        observed = []

        def recover(model, objectives, values, deadline, names, **kwargs):
            sunday = [model.get_int_var_from_proto_index(i) for i in range(len(model.proto.variables))
                      if model.proto.variables[i].name in {f'w:p0:{days[-1]}', f'w:p1:{days[-1]}'}]
            self.assertEqual(len(sunday), 2)
            self.assertEqual(sum(Snapshot(values).value(v) for v in sunday), 0)
            # This fixture permits only partial recovery, so equality-at-zero
            # cannot be escaped by simultaneously putting the whole group on duty.
            model.add(sum(sunday) <= 1)
            if 'REST_SPACING' in names:
                self.assertLess(names.index('SUNDAY_COVERAGE'), names.index('REST_SPACING'))
            result = improve(model, objectives, values, deadline, names, **kwargs)
            observed.append(sum(Snapshot(result[0]).value(v) for v in sunday))
            return result

        with patch('solver.improve', side_effect=recover):
            result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(observed, [1])
        self.assertEqual(sum(a['kind'] == 'WORK' for a in result['assignments'] if a['date'] == days[-1]), 1)

    def test_migration_hints_prefer_saved_compatible_clocks(self):
        data = fixture(40)
        days = solver.days_between(data['startDate'], data['endDate'])
        saved = data['shifts'][0]
        alternative = copy.deepcopy(saved)
        alternative['id'] = 'a-first'
        for segment in alternative['segments']:
            segment['start'] += 60
            segment['end'] += 60
        metrics = {item['id']: solver.shift_metrics(item) for item in (saved, alternative)}
        baseline = {('p0', day): {'kind': 'OFF'} if date.fromisoformat(day).weekday() in (1, 5)
                    else {'kind': 'WORK', 'shiftId': 'day'} for day in days}
        choices = {('p0', day): {'a-first': 1, 'day': 1} for day in days}
        proposed = balanced_rest_hints(data['employees'], days, {'p0': days}, baseline,
                                      choices, metrics, {**data['policy'], '_restRulesVersion': 2},
                                      solver.instant, solver.sunday_limit, preserve_work_people={'p0'})
        self.assertIn('p0', proposed)
        self.assertEqual(proposed['p0'][days[-1]]['kind'], 'WORK')
        for day, entry in proposed['p0'].items():
            if baseline['p0', day]['kind'] == 'WORK' and entry['kind'] == 'WORK':
                self.assertEqual(entry['shiftId'], 'day')
        self.assertFalse(any(entry['kind'] == 'OFF' and date.fromisoformat(day).weekday() == 5
                             for day, entry in proposed['p0'].items()))

    def test_v1_to_v2_keeps_useful_sunday_presence_and_untimed_people_without_clocks(self):
        data = fixture(40, people=4, weeks=6, start_date='2026-10-26')
        data.update(restRulesVersion=2, visibleMonth='2026-11')
        make_untimed(data['employees'][-1])
        data['employees'][-1]['role'] = 'ENC. SETOR'
        days = solver.days_between(data['startDate'], data['endDate'])
        for index, person in enumerate(data['employees']):
            person.update(history=[], historyKnown=False, maxConsecutiveSundays=1, sundayRestRule='PROTECTIVE')
            for offset, day in enumerate(days):
                rest_days = (1, 5) if (index + offset // 7) % 2 == 0 else (0, 6)
                rest = date.fromisoformat(day).weekday() in rest_days
                kind = 'OFF' if rest else 'DUTY' if index == 3 else 'WORK'
                data['assignments'].append({'employeeId': person['id'], 'date': day, 'kind': kind,
                                            **({'shiftId': 'day'} if kind == 'WORK' else {})})
        sundays = [day for day in days if date.fromisoformat(day).weekday() == 6]
        data['demands'] = [{'date': day, 'sector': 'Reposição', 'start': 480, 'end': 720,
                            'minimum': 1, 'estimated': True} for day in sundays]
        before = copy.deepcopy(data)
        result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(data, before)
        self.assertEqual(len(result['assignments']), 4 * 42)
        self.assertFalse(any(a['kind'] == 'OFF' and date.fromisoformat(a['date']).weekday() == 5
                             for a in result['assignments']))
        for day in sundays:
            self.assertTrue(any(a['date'] == day and a['kind'] == 'WORK' for a in result['assignments']), day)
        for entry in result['assignments']:
            if entry['employeeId'] == data['employees'][-1]['id']:
                self.assertNotEqual(entry['kind'], 'WORK')
                self.assertNotIn('shiftId', entry)

    def test_variable_enc_recovers_from_collective_sunday_monday_rests(self):
        data = fixture(40, people=4, weeks=6, start_date='2026-10-26')
        data.update(restRulesVersion=2, visibleMonth='2026-11')
        days = solver.days_between(data['startDate'], data['endDate'])
        absence = set(days[14:21])
        for person in data['employees']:
            make_untimed(person)
            person.update(role='ENC. SETOR', offMode='VARIABLE', fixedOffDays=[],
                          history=[], historyKnown=False, maxConsecutiveSundays=1,
                          sundayRestRule='PROTECTIVE')
        for person in data['employees']:
            for day in days:
                absent = person['id'] == 'p3' and day in absence
                data['assignments'].append({'employeeId': person['id'], 'date': day,
                    'kind': 'ABSENCE' if absent else 'OFF' if date.fromisoformat(day).weekday() in (0, 6) else 'DUTY',
                    **({'locked': True} if absent else {})})
        before = copy.deepcopy(data)
        self.assertEqual(data['demands'], [])
        # An explicit alternative proves this is avoidable under the same rules.
        # It is validated as an exact fixed candidate, without refinement.
        witness = copy.deepcopy(data)
        for entry in witness['assignments']:
            if entry['kind'] == 'ABSENCE':
                continue
            person_index = int(entry['employeeId'][1:])
            week = days.index(entry['date']) // 7
            rests = (0, 6) if (person_index + week) % 2 == 0 else (1, 3)
            entry['kind'] = 'OFF' if date.fromisoformat(entry['date']).weekday() in rests else 'DUTY'
        with patch('solver.improve', side_effect=lambda model, objectives, values, deadline, names, **kwargs: (values, False, [])):
            checked = solver.solve(witness)
        self.assertIn(checked['status'], ('FEASIBLE', 'OPTIMAL'))
        expected = {(a['employeeId'], a['date']): a['kind'] for a in witness['assignments']}
        self.assertEqual({(a['employeeId'], a['date']): a['kind'] for a in checked['assignments']}, expected)

        observed = {}
        original_improve = solver.improve

        def recover(model, objectives, values, deadline, names, **kwargs):
            rotation_index = names.index('UNTIMED_ROTATION')
            fairness_index = names.index('SUNDAY_BALANCE')
            self.assertLess(rotation_index, fairness_index)
            self.assertLess(rotation_index, names.index('REST_SPACING'))
            self.assertEqual(Snapshot(values).value(objectives[fairness_index]), 0)
            observed['initialRotation'] = Snapshot(values).value(objectives[rotation_index])
            result = original_improve(model, objectives, values, deadline, names, **kwargs)
            observed['finalRotation'] = Snapshot(result[0]).value(objectives[rotation_index])
            observed['finalFairness'] = Snapshot(result[0]).value(objectives[fairness_index])
            return result

        with patch('solver.improve', side_effect=recover):
            result = solver.solve(data)
        self.assertLess(observed['finalRotation'], observed['initialRotation'])
        # Positive unequal rates are necessary with five/six opportunities.
        # Fairness must not restore the degenerate all-zero reference.
        self.assertGreater(observed['finalFairness'], 0)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(data, before)
        records = {(a['employeeId'], a['date']): a for a in result['assignments']}
        self.assertEqual(len(records), 4 * 42)
        rotation = [p for p in result['optimization']['phases'] if p['objective'] == 'UNTIMED_ROTATION']
        self.assertTrue(rotation, 'Actual production refinement must reach untimed rotation')
        self.assertGreaterEqual(rotation[0]['budgetSeconds'], .1)
        for entry in result['assignments']:
            self.assertNotEqual(entry['kind'], 'WORK')
            self.assertNotIn('shiftId', entry)
            if entry['kind'] == 'ABSENCE':
                self.assertEqual(entry['employeeId'], 'p3')
                self.assertIn(entry['date'], absence)
            elif date.fromisoformat(entry['date']).weekday() == 5:
                self.assertEqual(entry['kind'], 'DUTY')
        for original in before['assignments']:
            if original['kind'] == 'ABSENCE':
                self.assertEqual(records[original['employeeId'], original['date']], original)
        for person in data['employees']:
            pid = person['id']
            pairs = {tuple(date.fromisoformat(day).weekday() for day in days[offset:offset + 7]
                           if records[pid, day]['kind'] == 'OFF')
                     for offset in range(0, 42, 7)
                     if not any(records[pid, day]['kind'] == 'ABSENCE' for day in days[offset:offset + 7])}
            self.assertGreater(len(pairs), 1, pid)
            self.assertTrue(any(records[pid, day]['kind'] == 'DUTY' for day in days
                                if date.fromisoformat(day).weekday() == 6), pid)
        for day in days:
            available = [records[p['id'], day] for p in data['employees']
                         if records[p['id'], day]['kind'] != 'ABSENCE']
            self.assertTrue(any(a['kind'] == 'DUTY' for a in available), day)

    def test_unknown_retains_best_feasible_values_and_sector_guards(self):
        model = cp_model.CpModel()
        a, b = model.new_bool_var('sector-a-gap'), model.new_bool_var('sector-b-gap')
        model.add(a + b >= 1)
        initial = {a.index: 1, b.index: 1}
        accepted = {}

        class Observe:
            calls = 0

            def checkpoint(self):
                pass

            def solve(self, engine, current):
                self.calls += 1
                if self.calls > 1:
                    return cp_model.UNKNOWN
                status = engine.solve(current)
                if status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
                    accepted.update({v.index: engine.value(v) for v in (a, b)})
                return status

        actual, _, phases = improve(model, [a + b, a + b], initial, time.monotonic() + 3,
                                    ['COVERAGE', 'SUNDAY_BALANCE'],
                                    context=ImprovementContext(control=Observe(),
                                                              protected_groups={'COVERAGE': [a, b]}))
        self.assertEqual(sum(accepted.values()), 1)
        self.assertEqual(actual, accepted)
        self.assertEqual(phases[-1]['status'], 'UNKNOWN')
        self.assertTrue(all(actual[index] <= value for index, value in initial.items()))

    def test_disabled_holidays_absences_and_locks_survive_without_staffing(self):
        data = fixture(40, people=2)
        data['employees'][1]['planningEnabled'] = False
        records = [{'employeeId': 'p1', 'date': day, 'kind': kind,
                    **({'shiftId': 'day'} if kind == 'WORK' else {}),
                    **({'locked': True} if locked else {})}
                   for day, kind, locked in [('2026-11-02', 'HOLIDAY', False),
                                             ('2026-11-03', 'HOLIDAY', True),
                                             ('2026-11-04', 'ABSENCE', False),
                                             ('2026-11-05', 'WORK', False),
                                             ('2026-11-06', 'WORK', True)]]
        data['assignments'] = records
        before = copy.deepcopy(data)
        self.assertEqual(solver.retained_disabled_records(data), [r for r in records if r['kind'] != 'WORK' or r.get('locked')])
        result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual([a for a in result['assignments'] if a['employeeId'] == 'p1'],
                         solver.retained_disabled_records(data))
        self.assertEqual(data, before)
        data['generationMode'] = 'HOURS_ONLY'
        self.assertEqual(solver.retained_disabled_records(data), records)


if __name__ == '__main__':
    unittest.main()
