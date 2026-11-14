"""Pure recipient-side protected-calendar regressions; no CP or scale run."""
import copy
import time
import unittest
from datetime import date, timedelta
from unittest.mock import patch
from ortools.sat.python import cp_model
import hints
from solver import instant, sunday_limit
from test_solver import fixture


def context(with_absence=False):
    data = fixture(42, people=6, weeks=3, start_date='2026-12-07')
    dates = [(date(2026, 12, 7) + timedelta(days=i)).isoformat() for i in range(21)]
    holiday = '2026-12-25'
    data['policy'].update(closedDates=[holiday], holidayDates=[holiday], paidHolidayDates=[holiday])
    policy = {**data['policy'], '_restRulesVersion': 2, '_visibleMonth': '2026-12',
              '_generationMode': None, '_simulation': False}
    active, baseline, choices, metrics = {}, {}, {}, {}
    for i, person in enumerate(data['employees']):
        pid, sid = person['id'], 'recipient-clock-' + str(i)
        person.update(shiftIds=[sid], maxConsecutiveSundays=1)
        metrics[sid] = (504, 480 + 10 * i, 1044 + 10 * i)
        for entry in person['history']:
            if entry['kind'] == 'WORK':
                entry['shiftId'] = sid
        active[pid] = dates
        for day in dates:
            weekday = date.fromisoformat(day).weekday()
            kind = ('HOLIDAY' if day == holiday else 'ABSENCE'
                    if with_absence and day == '2026-12-16' else 'OFF'
                    if weekday == 6 or weekday == 4 or day == '2026-12-21' else 'WORK')
            entry = dict(employeeId=pid, date=day, kind=kind)
            if kind == 'WORK':
                entry['shiftId'] = sid
            if day == dates[0]:
                entry['locked'] = True
            baseline[pid, day] = entry
            choices[pid, day] = {sid: 1} if kind not in ('HOLIDAY', 'ABSENCE') else {}
    return data['employees'], dates, active, baseline, choices, metrics, policy


class ProtectedCalendarPortfolioTests(unittest.TestCase):
    def test_shared_protected_slots_reuse_and_revalidate_recipient_calendars(self):
        for with_absence in (False, True):
            with self.subTest(with_absence=with_absence):
                people, dates, active, baseline, choices, metrics, policy = context(with_absence)
                original = copy.deepcopy((people, active, baseline, choices, metrics, policy))
                stats, reused, checked = {}, [], []
                actual_reuse, actual_check = hints._rematerialize_calendar, hints._compatible
                def reuse(*args, **kwargs):
                    result = actual_reuse(*args, **kwargs)
                    if result is not None:
                        reused.append((args[0]['id'], result))
                    return result
                def check(*args, **kwargs):
                    if args[7] is True and any(e['kind'] == 'HOLIDAY' for e in args[1].values()):
                        checked.append((args[0]['id'], args[1]))
                    return actual_check(*args, **kwargs)
                with patch.object(cp_model.CpSolver, '__init__', side_effect=AssertionError('No CP')), \
                        patch.object(cp_model.CpModel, '__init__', side_effect=AssertionError('No model')), \
                        patch('hints._rematerialize_calendar', side_effect=reuse), \
                        patch('hints._compatible', side_effect=check):
                    result = hints.balanced_rest_hints(people, dates, active, baseline, choices,
                        metrics, policy, instant, sunday_limit, deadline=time.monotonic() + 5,
                        calendar_portfolio=True, portfolio_stats=stats)
                self.assertEqual(set(result), set(active))
                self.assertGreater(stats.get('portfolioPeople', 0), 0,
                                   'Protected calendars must actually use the reuse path')
                self.assertTrue(reused)
                self.assertLessEqual(stats['masksMax'], 4)
                self.assertTrue(all(any(pid == p and entries == e for p, e in checked)
                                    for pid, entries in reused))
                for person in people:
                    pid, sid = person['id'], person['shiftIds'][0]
                    self.assertEqual(set(result[pid]), set(dates))
                    self.assertEqual(result[pid]['2026-12-25']['kind'], 'HOLIDAY')
                    week = [result[pid][day]['kind'] for day in dates[14:21]]
                    self.assertEqual((week.count('WORK'), week.count('OFF'), week.count('HOLIDAY')), (4, 2, 1))
                    if with_absence:
                        self.assertEqual(result[pid]['2026-12-16']['kind'], 'ABSENCE')
                    for day, entry in result[pid].items():
                        if entry['kind'] == 'WORK':
                            self.assertEqual(entry['shiftId'], sid)
                        if date.fromisoformat(day).weekday() == 5:
                            self.assertNotEqual(entry['kind'], 'OFF')
                signatures = {tuple(day for day, e in entries.items()
                                    if date.fromisoformat(day).weekday() == 6 and e['kind'] == 'WORK')
                              for entries in result.values()}
                self.assertGreater(len(signatures), 1)
                self.assertEqual((people, active, baseline, choices, metrics, policy), original)
                print('PURE_PROTECTED_REUSE', dict(withAbsence=with_absence, people=len(result),
                    reused=len(reused), fullProtectedChecks=len(checked), sundaySignatures=len(signatures),
                    counters=stats, cpCalls=0))

    def test_signature_lock_choice_and_boundaries_refuse_without_relabelling(self):
        people, dates, active, baseline, choices, metrics, policy = context()
        donor, recipient = people[0], people[1]
        generated = hints.balanced_rest_hints([donor], dates, active, baseline, choices,
            metrics, policy, instant, sunday_limit, deadline=time.monotonic() + 5)
        entries = generated[donor['id']]
        mask = tuple(None if e['kind'] in ('HOLIDAY', 'ABSENCE') else e['kind'] == 'OFF'
                     for e in (entries[day] for day in dates))
        slots = (('2026-12-25', 'HOLIDAY'),)
        selected = {day: recipient['shiftIds'][0] for day in dates}
        def materialize(p=recipient, b=baseline, c=choices, pol=policy, m=mask, signature=slots):
            prior = {e['date']: e for e in p.get('planningHistory', []) + p['history']
                     + p.get('planningFuture', [])}
            return hints._rematerialize_calendar(p, dates, active[p['id']], m, b, c, metrics,
                pol, selected, prior, instant, sunday_limit, protected_slots=signature,
                deadline=time.monotonic() + 5)
        with patch.object(cp_model.CpSolver, '__init__', side_effect=AssertionError('No CP')), \
                patch.object(cp_model.CpModel, '__init__', side_effect=AssertionError('No model')):
            result = materialize()
            self.assertIsNotNone(result)
            self.assertTrue(all(e.get('shiftId') == recipient['shiftIds'][0]
                                for e in result.values() if e['kind'] == 'WORK'))
            self.assertIsNone(materialize(signature=()))
            self.assertIsNone(materialize(signature=(('2026-12-24', 'HOLIDAY'),)))
            b = copy.deepcopy(baseline)
            b[recipient['id'], '2026-12-25']['kind'] = 'ABSENCE'
            self.assertIsNone(materialize(b=b))
            altered = list(mask)
            altered[dates.index('2026-12-25')] = False
            self.assertIsNone(materialize(m=tuple(altered)))
            work_day = next(day for day in dates if entries[day]['kind'] == 'WORK'
                            and date.fromisoformat(day).weekday() != 5)
            off_day = next(day for day in dates if entries[day]['kind'] == 'OFF')
            for kind, day in (('WORK', off_day), ('OFF', work_day)):
                b = copy.deepcopy(baseline)
                b[recipient['id'], day] = dict(employeeId=recipient['id'], date=day, kind=kind, locked=True)
                if kind == 'WORK':
                    b[recipient['id'], day]['shiftId'] = recipient['shiftIds'][0]
                self.assertIsNone(materialize(b=b))
            c = copy.deepcopy(choices)
            c[recipient['id'], work_day] = {}
            self.assertIsNone(materialize(c=c))
            p = copy.deepcopy(recipient)
            p['fixedOffDays'] = [date.fromisoformat(work_day).weekday()]
            self.assertIsNone(materialize(p=p))
            self.assertEqual(entries[dates[0]]['kind'], 'WORK')
            p = copy.deepcopy(recipient)
            start = date.fromisoformat(dates[0])
            p['history'] = [dict(employeeId=p['id'], date=(start-timedelta(days=i)).isoformat(),
                kind='WORK', shiftId=p['shiftIds'][0]) for i in range(1, 6)]
            self.assertIsNone(materialize(p=p))
            self.assertEqual(entries[dates[-1]]['kind'], 'WORK')
            p = copy.deepcopy(recipient)
            end = date.fromisoformat(dates[-1])
            p['planningFuture'] = [dict(employeeId=p['id'], date=(end+timedelta(days=i)).isoformat(),
                kind='WORK', shiftId=p['shiftIds'][0]) for i in range(1, 6)]
            self.assertIsNone(materialize(p=p))
        print('PURE_PROTECTED_FIDELITY', dict(recipientClockPreserved=True,
            missingDifferentSignatureRejected=True, noImplicitProtectedWork=True, cpCalls=0))


    def _protected_map_fixture(self):
        from test_hint_generation_contracts import context as decision_context
        data = fixture(40, people=134, weeks=5, start_date='2026-11-30')
        data.update(restRulesVersion=2, visibleMonth='2026-12')
        holidays = ['2026-12-25', '2027-01-01']
        data['policy'].update(closedDates=holidays, holidayDates=holidays,
                              paidHolidayDates=holidays, validUntil='2027-12-31')
        dates = [(date(2026, 11, 30) + timedelta(days=i)).isoformat() for i in range(35)]
        offset = 0
        for sector, size in enumerate((36, 20, 18, 16, 14, 12, 10, 8)):
            for i in range(offset, offset + size):
                data['employees'][i].update(sector='Sector' + str(sector), maxConsecutiveSundays=1,
                    role='ENC.' if i % 12 == 0 else 'CAIXA' if sector == 0 else 'OPERADOR')
            offset += size
        for person in data['employees']:
            for day in dates:
                parsed = date.fromisoformat(day)
                monday = (parsed - timedelta(days=parsed.weekday())).isoformat()
                holiday_week = monday in ('2026-12-21', '2026-12-28')
                off = parsed.weekday() in ((0, 6) if holiday_week else (4, 6))
                entry = dict(employeeId=person['id'], date=day,
                             kind='HOLIDAY' if day in holidays else 'OFF' if off else 'WORK')
                if entry['kind'] == 'WORK':
                    entry['shiftId'] = 'day'
                data['assignments'].append(entry)
        model, people, dates, off, work, choices, active, baseline, metrics, policy = decision_context(data)
        policy.update(_simulation=False, _visibleMonth='2026-12')
        values = {}
        for key, options in choices.items():
            old = baseline[key]
            values[off[key].index] = int(old['kind'] == 'OFF')
            values[work[key].index] = int(old['kind'] == 'WORK')
            for sid, variable in options.items():
                values[variable.index] = int(old['kind'] == 'WORK' and old.get('shiftId') == sid)
        return model, [people, dates, active, baseline, off, work, choices, metrics, policy, values]

    def test_pending_functional_134_protected_map_consumed_completely(self):
        """GATED: execute only after separate functional/scale authorization."""
        import solver
        from optimization import _replace_hints
        model, args = self._protected_map_fixture()
        people, dates, active, baseline, off, work, choices, metrics, policy, values = args
        expected = set(values)
        original = copy.deepcopy((baseline, values))
        original_choices = {key: {sid: v.index for sid, v in opts.items()} for key, opts in choices.items()}
        stats, completed = {}, {}
        actual = hints.balanced_rest_hints
        def observe(*a, **kw):
            result = actual(*a, **kw, portfolio_stats=stats)
            completed.update(result)
            return result
        started = time.monotonic()
        with patch('solver.balanced_rest_hints', side_effect=observe), \
                patch.object(cp_model.CpSolver, '__init__', side_effect=AssertionError('No large CP')):
            result = solver._composed_decision_hints(*args, started + 30)
        returned = time.monotonic()
        self.assertIsNotNone(result)
        self.assertEqual(set(result), expected)
        self.assertTrue(all(type(v) is int and v in (0, 1) for v in result.values()))
        decoded = {p['id']: {} for p in people}
        for key, options in choices.items():
            old = baseline[key]
            selected = [sid for sid, v in options.items() if result[v.index]]
            if old['kind'] in ('HOLIDAY', 'ABSENCE'):
                self.assertEqual((result[off[key].index], result[work[key].index], selected), (0, 0, []))
                entry = {'kind': old['kind']}
            else:
                self.assertEqual(result[off[key].index] + result[work[key].index], 1)
                self.assertEqual(len(selected), result[work[key].index])
                entry = {'kind': 'OFF' if result[off[key].index] else 'WORK'}
                if selected:
                    self.assertEqual(selected, ['day'])
                    entry['shiftId'] = 'day'
            decoded[key[0]][key[1]] = entry
        self.assertEqual(decoded, completed)
        self.assertEqual(sum(map(len, decoded.values())), 4690)
        external = {p['id'] for p in people[36:]}
        self.assertEqual(len(external), 98)
        signatures = {tuple(day for day, e in decoded[pid].items()
                            if date.fromisoformat(day).weekday() == 6 and e['kind'] == 'WORK') for pid in external}
        changed = {pid for pid in external if any(e['kind'] != baseline[pid, day]['kind']
                    for day, e in decoded[pid].items())}
        self.assertGreater(len(signatures), 1)
        self.assertTrue(changed)
        self.assertGreater(stats.get('portfolioPeople', 0), 0)
        self.assertLessEqual(stats['masksMax'], 4)
        self.assertEqual((baseline, values), original)
        self.assertEqual({key: {sid: v.index for sid, v in opts.items()} for key, opts in choices.items()}, original_choices)
        _replace_hints(model, result)  # Real consumer operation, without a CP search.
        consumed = time.monotonic()
        self.assertEqual(dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values)), result)
        print('GATED_PROTECTED_FUNCTIONAL_MAP', dict(people=134, personDates=4690, external=98,
            externalChanged=len(changed), externalSundaySignatures=len(signatures), counters=stats,
            returnedSeconds=round(returned-started, 6), consumerReadySeconds=round(consumed-started, 6),
            testDeadlineSeconds=30, cpCalls=0))

    def test_pending_observe_134_protected_deadline_through_consumer(self):
        """GATED observational measurement; None is explicitly insufficient."""
        import solver
        from optimization import _replace_hints
        model, args = self._protected_map_fixture()
        expected, stats, completed = set(args[9]), {}, {}
        actual = hints.balanced_rest_hints
        def observe(*a, **kw):
            result = actual(*a, **kw, portfolio_stats=stats)
            completed.update(result)
            return result
        started = time.monotonic()
        deadline = started + .6
        with patch('solver.balanced_rest_hints', side_effect=observe), \
                patch.object(cp_model.CpSolver, '__init__', side_effect=AssertionError('No large CP')):
            result = solver._composed_decision_hints(*args, deadline)
        returned = time.monotonic()
        complete = (isinstance(result, dict) and set(result) == expected
                    and all(type(v) is int and v in (0, 1) for v in result.values()))
        ready = None
        if complete and returned < deadline:
            _replace_hints(model, result)
            self.assertEqual(dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values)), result)
            ready = time.monotonic()
        outcome = ('COMPLETE_DELIVERED_IN_TIME' if ready is not None and ready < deadline
                   else 'COMPLETE_LATE_AT_CONSUMER' if ready is not None
                   else 'COMPLETE_RETURNED_LATE' if complete
                   else 'NO_COMPLETE_MAP_AFTER_DEADLINE' if returned >= deadline
                   else 'NO_COMPLETE_MAP_BEFORE_DEADLINE')
        print('GATED_PROTECTED_DEADLINE_MAP', dict(status=outcome, generatorPeople=len(completed),
            finalMapComplete=complete, offeredInTime=134 if ready is not None and ready < deadline else 0,
            returnedSeconds=round(returned-started, 6),
            consumerReadySeconds=round(ready-started, 6) if ready is not None else None,
            deadlineSeconds=.6, counters=stats, cpCalls=0))

    def test_pending_small_cp_delivers_protected_hint_to_global_search(self):
        """GATED: actual production model/CP; never part of the pure command."""
        import solver
        people, dates, active, baseline, choices, metrics, policy = context()
        data = fixture(42, people=6, weeks=3, start_date=dates[0])
        reference = data['shifts'][0]
        data.update(employees=copy.deepcopy(people), assignments=copy.deepcopy(list(baseline.values())),
                    policy={k: v for k, v in policy.items() if not k.startswith('_')},
                    restRulesVersion=2, visibleMonth='2026-12', generationMode='REST_ONLY', shifts=[])
        for i, person in enumerate(people):
            shift = copy.deepcopy(reference)
            shift['id'] = person['shiftIds'][0]
            for segment in shift['segments']:
                segment['start'] += 10 * i
                segment['end'] += 10 * i
            data['shifts'].append(shift)
        for day in dates:
            if day == '2026-12-25':
                continue
            for start, end in ((540, 720), (840, 1000)):
                data['demands'].append(dict(sector=people[0]['sector'], role='Repositor', date=day,
                    start=start, end=end, minimum=1, estimated=True))
        built, deliveries, captures = [], [], []
        actual_builder, actual_improve = solver._composed_decision_hints, solver.improve
        def build(*a, **kw):
            started = time.monotonic()
            result = actual_builder(*a, **kw)
            built.append(dict(start=started, deadline=a[10], returned=time.monotonic(), values=result))
            return result
        def improve(model, goals, values, deadline, names, *, context):
            original = dict(values)
            result = actual_improve(model, goals, values, deadline, names, context=context)
            from optimization import Snapshot
            for guard in context.protected_groups['COVERAGE']:
                self.assertLessEqual(Snapshot(result[0]).value(guard), Snapshot(original).value(guard))
            captures.append(result[2])
            return result
        class Observe:
            def checkpoint(self):
                pass
            def solve(self, engine, model):
                hinted = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
                if built and built[-1]['values'] is not None and hinted == built[-1]['values']:
                    deliveries.append(time.monotonic())
                return engine.solve(model)
        with patch('solver._rest_repair_groups', return_value=[]), \
                patch('solver._composed_decision_hints', side_effect=build), \
                patch('solver.improve', side_effect=improve):
            result = solver.solve(data, Observe())
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(len(built), 1)
        self.assertTrue(deliveries)
        self.assertLessEqual(deliveries[0], built[0]['deadline'])
        phase = next(p for p in captures[0] if p['objective'] == 'COVERAGE' and p['searchScope'] == 'GLOBAL')
        self.assertGreater(phase['budgetSeconds'], 0)
        self.assertEqual(phase['decisionHintStatus'], 'COMPLETE_DECISIONS')
        for entry in result['assignments']:
            if entry['date'] == '2026-12-25':
                self.assertEqual(entry['kind'], 'HOLIDAY')
            if entry['kind'] == 'WORK':
                self.assertEqual(entry['shiftId'], next(p['shiftIds'][0] for p in people if p['id'] == entry['employeeId']))
        print('GATED_SMALL_PROTECTED_CP', dict(status=result['status'], hintStatus=phase['decisionHintStatus'],
            builderSeconds=round(built[0]['returned']-built[0]['start'], 6),
            consumerSeconds=round(deliveries[0]-built[0]['start'], 6),
            coverage=(phase['initialValue'], phase['incumbentValue'])))


if __name__ == '__main__':
    unittest.main()
