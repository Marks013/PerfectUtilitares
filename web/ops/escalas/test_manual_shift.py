"""Dated local-shift choices enter the model before hours and coverage calculation."""
import copy
import unittest
from datetime import date
from unittest.mock import patch

import solver
from model_input import ModelInputError, validate_model_input
from test_solver import fixture, make_untimed


def manual_fixture(people=1):
    data = fixture(40, people=people)
    data['restRulesVersion'] = 2
    early = copy.deepcopy(data['shifts'][0])
    early['id'] = 'local-early'
    for segment in early['segments']:
        segment['start'] -= 60
        segment['end'] -= 60
    data['shifts'].append(early)
    for person in data['employees']:
        person.update(shiftIds=['day'], fixedImportedShiftId='day')
        for day in solver.days_between(data['startDate'], data['endDate']):
            rest = date.fromisoformat(day).weekday() in (2, 6)
            data['assignments'].append({'employeeId': person['id'], 'date': day,
                'kind': 'OFF' if rest else 'WORK', **({} if rest else {'shiftId': 'day'})})
    return data


class ManualShiftTests(unittest.TestCase):
    def test_partial_selection_overrides_import_and_is_used_by_hours_coverage_and_hints(self):
        data = manual_fixture()
        selected = {'2026-11-03': 'local-early', '2026-11-05': 'local-early'}
        data['employees'][0]['manualShiftByDate'] = selected
        # A formerly valid preferred seed still carries the imported clocks.
        data['_initialAssignments'] = copy.deepcopy(data['assignments'])
        data['demands'] = [{'date': day, 'sector': 'Reposição', 'start': 420, 'end': 480,
                            'minimum': 1} for day in selected]
        validate_model_input(data)
        before = copy.deepcopy(data)
        raw_results, hinted = [], set()
        original_read, original_hints = solver._read_assignments, solver._feasibility_hints

        def read(*args, **kwargs):
            records = original_read(*args, **kwargs)
            raw_results.append(copy.deepcopy(records))
            return records

        def hints(model, *args, **kwargs):
            reused = original_hints(model, *args, **kwargs)
            for index, value in zip(model.proto.solution_hint.vars, model.proto.solution_hint.values):
                for day, sid in selected.items():
                    if model.proto.variables[index].name == f's:p0:{day}:{sid}' and value == 1:
                        hinted.add(day)
            return reused

        with patch('solver._read_assignments', side_effect=read), patch('solver._feasibility_hints', side_effect=hints):
            result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        self.assertEqual(data, before)
        self.assertEqual(hinted, set(selected))
        shifts = {s['id']: s for s in data['shifts']}
        worked = [a for a in result['assignments'] if a['kind'] == 'WORK']
        self.assertEqual(sum(solver.shift_metrics(shifts[a['shiftId']])[0] for a in worked), 40 * 60)
        for day, sid in selected.items():
            assignment = next(a for a in worked if a['date'] == day)
            self.assertEqual(assignment['shiftId'], sid)
            self.assertFalse(assignment.get('locked', False))
            self.assertTrue(any(s['kind'] == 'WORK' and s['start'] <= 420 and s['end'] >= 480
                                for s in shifts[sid]['segments']))
            self.assertTrue(raw_results)
            self.assertTrue(all(any(a['date'] == day and a['kind'] == 'WORK' and a['shiftId'] == sid
                                   for a in records) for records in raw_results))
        self.assertTrue(all(a['shiftId'] == 'day' for a in worked if a['date'] not in selected))

    def test_hours_only_preserves_off_absence_holiday_locks_closure_and_excluded_people(self):
        data = manual_fixture(people=2)
        data['generationMode'] = 'HOURS_ONLY'
        data['employees'][1]['planningEnabled'] = False
        data['policy']['closedDates'] = ['2026-11-08']
        data['employees'][0]['manualShiftByDate'] = {
            '2026-11-02': 'day', '2026-11-03': 'local-early', '2026-11-04': 'local-early',
            '2026-11-05': 'local-early', '2026-11-08': 'local-early'}
        data['employees'][1]['manualShiftByDate'] = {'2026-11-03': 'local-early'}
        for item in data['assignments']:
            if item['employeeId'] != 'p0':
                continue
            if item['date'] in ('2026-11-04', '2026-11-05'):
                item['kind'] = 'ABSENCE' if item['date'] == '2026-11-04' else 'HOLIDAY'
                item.pop('shiftId', None)
            if item['date'] in ('2026-11-02', '2026-11-04', '2026-11-08'):
                item['locked'] = True
        before = copy.deepcopy(data)
        result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        self.assertEqual(data, before)
        actual = {(a['employeeId'], a['date']): a for a in result['assignments']}
        for old in data['assignments']:
            new = actual[old['employeeId'], old['date']]
            if old['employeeId'] == 'p0' and old['date'] == '2026-11-03':
                self.assertEqual(new, {**old, 'shiftId': 'local-early'})
            else:
                self.assertEqual(new, old)

    def test_different_paid_duration_cannot_be_hidden_by_postprocessing_or_another_shift(self):
        data = manual_fixture()
        data['generationMode'] = 'HOURS_ONLY'
        data['shifts'][1]['segments'][-1]['end'] -= 120  # Six paid hours instead of eight.
        data['employees'][0]['manualShiftByDate'] = {'2026-11-03': 'local-early'}
        validate_model_input(data)
        result = solver.solve(data)
        self.assertEqual(result['status'], 'INFEASIBLE', result)  # 4*8 + 6 cannot satisfy 40h.
        self.assertEqual(result['assignments'], [])

    def test_absent_field_preserves_imported_reference(self):
        data = manual_fixture()
        data['generationMode'] = 'HOURS_ONLY'
        result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        self.assertEqual(result['assignments'], data['assignments'])

    def test_invalid_shape_dates_references_and_employment_fail_before_cp(self):
        variants = [(None, 'EXPECTED_OBJECT'), ([], 'EXPECTED_OBJECT'),
                    ({'private-invalid-date': 'local-early'}, 'INVALID_DATE'),
                    ({'2026-11-09': 'local-early'}, 'OUTSIDE_HORIZON'),
                    ({'2026-11-03': 'private-unknown'}, 'UNKNOWN_REFERENCE'),
                    ({'2026-11-03': '1500'}, 'UNKNOWN_REFERENCE'),
                    ({'2026-11-03': []}, 'INVALID_IDENTIFIER')]
        for selection, reason in variants:
            data = manual_fixture()
            data['employees'][0]['manualShiftByDate'] = selection
            for invoke in (validate_model_input, solver.solve):
                with patch('solver._solve', side_effect=AssertionError('must reject before CP')):
                    with self.assertRaises(ModelInputError) as caught:
                        invoke(data)
                self.assertEqual(caught.exception.fields[0]['reason'], reason)
                self.assertIn('manualShiftByDate', caught.exception.fields[0]['path'])
                self.assertNotIn('private', str(caught.exception.fields))
        data = manual_fixture()
        person = data['employees'][0]
        person.update(shiftIds=['day'], manualShiftByDate={'2026-11-03': 'local-early'})
        validate_model_input(data)  # The dated map authorizes a local target outside the normal base.
        self.assertEqual(person['shiftIds'], ['day'])
        person['activeFrom'] = '2026-11-04'
        with self.assertRaises(ModelInputError) as caught:
            validate_model_input(data)
        self.assertEqual(caught.exception.fields[0]['reason'], 'OUTSIDE_EMPLOYMENT')

    def test_locked_work_conflict_is_rejected_without_unlocking_or_replacing(self):
        data = manual_fixture()
        data['employees'][0]['manualShiftByDate'] = {'2026-11-03': 'local-early'}
        next(a for a in data['assignments'] if a['date'] == '2026-11-03')['locked'] = True
        before = copy.deepcopy(data)
        for invoke in (validate_model_input, solver.solve):
            with self.assertRaises(ModelInputError) as caught:
                invoke(data)
            self.assertEqual(caught.exception.fields[0]['reason'], 'MANUAL_SHIFT_LOCK_CONFLICT')
        self.assertEqual(data, before)

    def test_untimed_and_missing_profiles_never_receive_manual_clocks(self):
        for mode in ('UNTIMED', 'MISSING'):
            data = manual_fixture()
            make_untimed(data['employees'][0])
            data['employees'][0].update(scheduleMode=mode, manualShiftByDate={'2026-11-03': 'local-early'})
            with self.assertRaises(ModelInputError) as caught:
                solver.solve(data)
            self.assertEqual(caught.exception.fields[0]['reason'], 'MANUAL_SHIFT_REQUIRES_TIMED_EMPLOYEE')

    def test_manual_outside_normal_base_never_leaks_without_fixed_import_even_under_demand(self):
        data = manual_fixture()
        data['generationMode'] = 'HOURS_ONLY'
        person = data['employees'][0]
        person.pop('fixedImportedShiftId')
        person['manualShiftByDate'] = {'2026-11-03': 'local-early'}
        data['demands'] = [
            {'date': '2026-11-03', 'sector': 'Reposição', 'start': 420, 'end': 480, 'minimum': 1},
            {'date': '2026-11-05', 'sector': 'Reposição', 'start': 420, 'end': 480,
             'minimum': 1, 'estimated': True}]
        validate_model_input(data)
        before = copy.deepcopy(data)
        result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        self.assertEqual(data, before)
        self.assertEqual(person['shiftIds'], ['day'])
        self.assertNotIn('fixedImportedShiftId', person)
        records = {a['date']: a for a in result['assignments']}
        self.assertEqual(records['2026-11-03']['shiftId'], 'local-early')
        self.assertEqual(records['2026-11-05']['shiftId'], 'day')
        self.assertTrue(all(a['shiftId'] == 'day' for a in result['assignments']
                            if a['kind'] == 'WORK' and a['date'] != '2026-11-03'))
        # Making the tempting out-of-period target mandatory must expose the
        # conflict, never widen the manual interval or normal choices.
        data['demands'][1].pop('estimated')
        impossible = solver.solve(data)
        self.assertEqual(impossible['status'], 'INFEASIBLE', impossible)
        self.assertEqual(impossible['assignments'], [])

    def test_explicit_existing_lock_is_only_a_day_exception_outside_the_normal_base(self):
        data = manual_fixture()
        data['generationMode'] = 'HOURS_ONLY'
        person = data['employees'][0]
        person.pop('fixedImportedShiftId')
        person['manualShiftByDate'] = {'2026-11-03': 'local-early'}
        locked = next(a for a in data['assignments'] if a['date'] == '2026-11-05')
        locked.update(shiftId='local-early', locked=True)
        before = copy.deepcopy(data)
        result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        self.assertEqual(data, before)
        records = {a['date']: a for a in result['assignments']}
        self.assertEqual(records['2026-11-05'], locked)
        self.assertEqual(records['2026-11-03']['shiftId'], 'local-early')
        self.assertTrue(all(a['shiftId'] == 'day' for a in result['assignments']
                            if a['kind'] == 'WORK' and a['date'] not in ('2026-11-03', '2026-11-05')))

    def test_inadmissible_target_does_not_invalidate_absence_holiday_or_preserved_off(self):
        for kind, locked in (('ABSENCE', True), ('HOLIDAY', True), ('OFF', True), ('OFF', False)):
            data = manual_fixture()
            data['generationMode'] = 'HOURS_ONLY'
            data['policy']['dailyLimitMinutes'] = 480
            data['shifts'][1]['segments'][-1]['end'] += 60  # Structurally valid, operationally nine hours.
            data['employees'][0]['manualShiftByDate'] = {'2026-11-04': 'local-early'}
            selected = next(a for a in data['assignments'] if a['date'] == '2026-11-04')
            selected['kind'] = kind
            if locked:
                selected['locked'] = True
            if kind == 'HOLIDAY':
                # Four workdays plus a paid weekday holiday and two regular OFFs.
                extra_rest = next(a for a in data['assignments'] if a['date'] == '2026-11-05')
                extra_rest['kind'] = 'OFF'
                extra_rest.pop('shiftId')
            validate_model_input(data)
            before = copy.deepcopy(data)
            result = solver.solve(data)
            self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
            self.assertEqual(result['assignments'], data['assignments'])
            self.assertEqual(data, before)
            # A missing local reference is still a structural error on non-work.
            data['employees'][0]['manualShiftByDate']['2026-11-04'] = 'missing-local'
            with self.assertRaises(ModelInputError) as caught:
                validate_model_input(data)
            self.assertEqual(caught.exception.fields[0]['reason'], 'UNKNOWN_REFERENCE')

    def test_inadmissible_manual_target_allows_off_in_day_generation_but_not_substitution(self):
        data = manual_fixture()
        data['policy']['dailyLimitMinutes'] = 480
        data['shifts'][1]['segments'][-1]['end'] += 60
        data['employees'][0]['manualShiftByDate'] = {'2026-11-04': 'local-early'}
        validate_model_input(data)
        before = copy.deepcopy(data)
        result = solver.solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        self.assertEqual(next(a for a in result['assignments'] if a['date'] == '2026-11-04')['kind'], 'OFF')
        self.assertEqual(data, before)
        data['demands'] = [{'date': '2026-11-04', 'sector': 'Reposição',
                            'start': 480, 'end': 540, 'minimum': 1}]
        result = solver.solve(data)
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertEqual(result['assignments'], [])
        self.assertTrue(result.get('solverDiagnostics'), result)

    def test_inadmissible_manual_target_conflicts_with_preserved_or_locked_work(self):
        for locked in (False, True):
            data = manual_fixture()
            data['generationMode'] = 'HOURS_ONLY'
            data['policy']['dailyLimitMinutes'] = 480
            data['shifts'][1]['segments'][-1]['end'] += 60
            data['employees'][0]['manualShiftByDate'] = {'2026-11-03': 'local-early'}
            if locked:
                selected = next(a for a in data['assignments'] if a['date'] == '2026-11-03')
                selected.update(shiftId='local-early', locked=True)
            validate_model_input(data)
            before = copy.deepcopy(data)
            result = solver.solve(data)
            self.assertEqual(result['status'], 'INFEASIBLE', result)
            self.assertEqual(result['assignments'], [])
            self.assertEqual(data, before)


if __name__ == '__main__':
    unittest.main()
