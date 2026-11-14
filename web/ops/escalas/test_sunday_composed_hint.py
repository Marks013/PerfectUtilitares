"""Global composed hints use the production model, generator and CP-SAT."""
import copy
import time
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from ortools.sat.python import cp_model
import solver
from hints import _compatible, balanced_rest_hints
from optimization import ImprovementContext, Snapshot, improve
from test_solver import fixture
from control import SolveCancelled


def scenario():
    data = fixture(42, people=4, weeks=3, start_date='2026-11-30')
    data.update(restRulesVersion=2, visibleMonth='2026-12', generationMode='REST_ONLY')
    data['policy']['maxConsecutiveWorkDays'] = 5
    alternate = copy.deepcopy(data['shifts'][0])
    alternate['id'] = 'alternate'
    for segment in alternate['segments']:
        segment['start'] += 60
        segment['end'] += 60
    data['shifts'].append(alternate)
    pattern = 'WWWWOWO' * 2 + 'WWWOOWW'
    dates = solver.days_between(data['startDate'], data['endDate'])
    for index, person in enumerate(data['employees']):
        person.update(sector='Local' if index < 2 else 'External', maxConsecutiveSundays=1)
        person['shiftIds'].append('alternate')
        if index == 0:
            person['history'][-1]['kind'] = 'HOLIDAY'
        for day, kind in zip(dates, pattern):
            entry = dict(employeeId=person['id'], date=day,
                         kind='WORK' if kind == 'W' else 'OFF')
            if kind == 'W':
                entry['shiftId'] = 'day'
            if index == 0 and day == dates[0]:
                entry['locked'] = True
            data['assignments'].append(entry)
    # A fixed reference at each actual paid interval, with role and sector guards.
    for sector in ('Local', 'External'):
        for day in dates:
            for start, end in ((480, 720), (780, 1044)):
                data['demands'].append(dict(sector=sector, date=day, start=start,
                    end=end, minimum=1, roles={'Repositor': 1}, estimated=True))
    return data


class ComposedSundayHintTests(unittest.TestCase):
    def test_real_global_model_receives_external_complete_composed_calendar(self):
        data = scenario()
        before = copy.deepcopy(data)
        captures, searches, generation, clock_choices = [], [], [], []
        actual_improve, actual_builder = solver.improve, solver._composed_decision_hints
        def generate(*args, **kwargs):
            clock_choices.append(args[4])
            return balanced_rest_hints(*args, **kwargs)

        def build(*args, **kwargs):
            result = actual_builder(*args, **kwargs)
            generation.append((args, result))
            return result

        def improve(model, goals, values, deadline, names, *, context):
            captures.append((model, list(goals), dict(values), list(names), context, deadline))
            return actual_improve(model, goals, values, deadline, names, context=context)

        class Observe:
            def checkpoint(self):
                pass

            def solve(self, engine, model):
                # Observe real input and delegate every result to the real engine.
                hint = dict(zip(model.proto.solution_hint.vars, model.proto.solution_hint.values))
                domains = [tuple(v.domain) for v in model.proto.variables]
                status = engine.solve(model)
                searches.append((hint, domains, status, engine.parameters.max_time_in_seconds,
                                 engine.parameters.num_workers))
                return status

        started = time.monotonic()
        with patch('solver._rest_repair_groups', return_value=[{'p0', 'p1'}]), \
                patch('solver._composed_decision_hints', side_effect=build), \
                patch('solver.balanced_rest_hints', side_effect=generate), \
                patch('solver.improve', side_effect=improve):
            result = solver.solve(data, Observe())
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(data, before)
        self.assertEqual(len(generation), 1)
        args, proposed = generation[0]
        self.assertIsInstance(proposed, dict)
        employees, dates, active, baseline, off, work, choices, metrics, policy, current, *_ = args
        model, goals, initial, names, context, deadline = captures[0]
        self.assertLess(Snapshot(current).value(goals[names.index('COVERAGE')]),
                        Snapshot(initial).value(goals[names.index('COVERAGE')]))
        self.assertEqual(set(proposed), set(context.decision_variables))
        # Two catalog clocks are admissible; REST_ONLY freezes the first real
        # reference in the production model before any hint is constructed.
        self.assertEqual(len(data['shifts']), 2)
        self.assertTrue(all(set(options) <= {'day'} for options in choices.values()))
        self.assertTrue(all(len(options) <= 1 for options in clock_choices[-1].values()))
        delivered = [(hint, domains) for hint, domains, status, budget, workers in searches
                     if hint == proposed]
        self.assertEqual(len(delivered), 1)
        hint, domains = delivered[0]
        for index, (pid, day) in context.decision_variables.items():
            if pid in ('p2', 'p3'):
                self.assertEqual(domains[index], (0, 1))
                self.assertIn(index, hint)
        self.assertTrue(all(workers == 1 and budget <= 12 for _, _, _, budget, workers in searches))
        self.assertLessEqual(deadline - started, 12.01)
        phases = result['optimization']['phases']
        self.assertEqual(sum(p.get('decisionHintStatus') == 'COMPLETE_DECISIONS' for p in phases), 1)
        self.assertTrue(all(p.get('searchScope') == 'GLOBAL' for p in phases if 'decisionHintStatus' in p))
        # Reject the isolated first/third-week exchange using the real validator.
        pid = 'p0'
        old = {day: baseline[pid, day] for day in dates}
        simple = dict(old)
        for offset in range(7):
            simple[dates[offset]] = old[dates[14 + offset]]
            simple[dates[14 + offset]] = old[dates[offset]]
        prior = {e['date']: e for e in employees[0]['history']}
        streak = maximum = 0
        for day in dates:
            streak = streak + 1 if simple[day]['kind'] == 'WORK' else 0
            maximum = max(maximum, streak)
        self.assertEqual(maximum, 6)
        self.assertFalse(_compatible(employees[0], simple, prior, metrics, policy,
                                    solver.instant, solver.sunday_limit, True, baseline=baseline))
        hinted = {}
        for person in employees:
            pid = person['id']
            entries = {}
            for day in active[pid]:
                key = pid, day
                entry = {'kind': 'OFF' if proposed[off[key].index] else 'WORK'}
                if entry['kind'] == 'WORK':
                    entry['shiftId'] = next(sid for sid, v in choices[key].items() if proposed[v.index])
                entries[day] = entry
            self.assertTrue(_compatible(person, entries, {e['date']: e for e in person['history']},
                metrics, policy, solver.instant, solver.sunday_limit, True, baseline=baseline))
            hinted[pid] = ''.join('W' if entries[d]['kind'] == 'WORK' else 'O' for d in dates)
        final = {(e['employeeId'], e['date']): e for e in result['assignments']}
        self.assertEqual(final['p0', dates[0]], baseline['p0', dates[0]])
        for person in employees:
            pid = person['id']
            for week in range(3):
                entries = [final[pid, day] for day in dates[week * 7:week * 7 + 7]]
                self.assertEqual(sum(e['kind'] == 'WORK' for e in entries), 5)
            for day in dates:
                entry = final[pid, day]
                self.assertFalse(entry['kind'] == 'OFF' and date.fromisoformat(day).weekday() == 5)
                if entry['kind'] == 'WORK':
                    self.assertEqual(entry['shiftId'], 'day')
        # The real coverage objective, accepted by the real production phases.
        coverage = [p for p in phases if p['objective'] == 'COVERAGE']
        self.assertTrue(coverage)
        self.assertLessEqual(coverage[-1]['incumbentValue'], coverage[0]['initialValue'])
        fairness = next(p for p in phases if p['objective'] == 'SUNDAY_BALANCE')
        seed_fairness = Snapshot(initial).value(goals[names.index('SUNDAY_BALANCE')])
        self.assertLess(fairness['incumbentValue'], seed_fairness)
        for person in employees:
            entries = {day: final[person['id'], day] for day in dates}
            self.assertTrue(_compatible(person, entries, {e['date']: e for e in person['history']},
                metrics, policy, solver.instant, solver.sunday_limit, True, baseline=baseline))
        for demand in data['demands']:
            members = [p['id'] for p in employees if p['sector'] == demand['sector']]
            old_presence = sum(baseline[pid, demand['date']]['kind'] == 'WORK' for pid in members)
            new_presence = sum(final[pid, demand['date']]['kind'] == 'WORK' for pid in members)
            self.assertGreaterEqual(new_presence, min(demand['minimum'], old_presence))
        print('PROOF', dict(hinted=hinted, cpCalls=len(searches),
            globalHintCalls=len(delivered), elapsed=round(time.monotonic() - started, 3),
            coverage=[(p['initialValue'], p['incumbentValue']) for p in coverage],
            sundayBalance=(seed_fairness, fairness['incumbentValue']),
            phaseBudgets=[(p['objective'], p['budgetSeconds'], p.get('preparationSeconds', 0),
                           p['wallTimeSeconds']) for p in phases],
            phases=[(p['objective'], p['status'], p['incumbentValue']) for p in phases]))
        args = list(args)
        saved = dict(args[9])
        args[10] = time.monotonic() - 1
        self.assertIsNone(actual_builder(*args))
        args[10] = time.monotonic() + 1
        complete_person = {day: {'kind': 'WORK', 'shiftId': 'day'}
                           if char == 'W' else {'kind': 'OFF'}
                           for day, char in zip(dates, hinted['p0'])}
        with patch('solver.balanced_rest_hints', return_value={'p0': complete_person}):
            self.assertIsNone(actual_builder(*args))
        class Cancel:
            def checkpoint(self):
                raise SolveCancelled()
        args[11] = Cancel()
        with self.assertRaises(SolveCancelled):
            actual_builder(*args)
        self.assertEqual(dict(args[9]), saved)

    def test_optional_callback_fallback_and_budget_do_not_add_searches(self):
        for failure in ('absent', 'partial', 'error', 'late', 'cancel', 'incompatible'):
            with self.subTest(failure=failure):
                model = cp_model.CpModel()
                decision = model.new_bool_var('calendar')
                values, calls = {decision.index: 1}, []
                if failure == 'incompatible':
                    model.add(decision == 1)
                now = [100.0]
                class Observe:
                    def checkpoint(self):
                        pass
                    def solve(self, engine, current):
                        calls.append(dict(zip(current.proto.solution_hint.vars,
                                              current.proto.solution_hint.values)))
                        return engine.solve(current)
                def builder(current, deadline, control):
                    self.assertEqual(dict(current), values)
                    with self.assertRaises(TypeError):
                        current[decision.index] = 0
                    if failure == 'error':
                        raise RuntimeError('construction failed')
                    if failure == 'cancel':
                        raise SolveCancelled()
                    if failure == 'late':
                        now[0] += 20
                    if failure == 'incompatible':
                        return {decision.index: 0}
                    return None
                context = ImprovementContext(control=Observe(),
                    decision_variables={decision.index: ('p', '2026-12-06')},
                    coverage_hint_builder=None if failure == 'absent' else builder)
                with patch('optimization.time.monotonic', side_effect=lambda: now[0]):
                    if failure == 'cancel':
                        with self.assertRaises(SolveCancelled):
                            improve(model, [decision], values, 112, ['COVERAGE'], context=context)
                        self.assertEqual(calls, [])
                        continue
                    actual, _, phases = improve(model, [decision], values, 112,
                                                ['COVERAGE'], context=context)
                self.assertEqual(values, {decision.index: 1})
                if failure == 'late':
                    self.assertEqual(calls, [])
                    self.assertEqual(actual, values)
                else:
                    self.assertEqual(calls, [{decision.index: 0 if failure == 'incompatible' else 1}])
                    self.assertEqual(actual[decision.index], 1 if failure == 'incompatible' else 0)
                    if failure == 'error':
                        self.assertEqual(phases[0]['decisionHintStatus'], 'FAILED')


    def test_general_clock_choices_preserve_unique_reference_or_decline_ambiguity(self):
        def context(data):
            dates = solver.days_between(data['startDate'], data['endDate'])
            people = data['employees']
            active = {p['id']: dates for p in people}
            baseline = {(e['employeeId'], e['date']): e for e in data['assignments']}
            model, off, work, choices, values = cp_model.CpModel(), {}, {}, {}, {}
            for person in people:
                for day in dates:
                    key = person['id'], day
                    off[key] = model.new_bool_var('off')
                    work[key] = model.new_bool_var('work')
                    choices[key] = {sid: model.new_bool_var('clock') for sid in person['shiftIds']}
                    old = baseline[key]
                    values[off[key].index] = int(old['kind'] == 'OFF')
                    values[work[key].index] = int(old['kind'] == 'WORK')
                    for sid, variable in choices[key].items():
                        values[variable.index] = int(old.get('shiftId') == sid and old['kind'] == 'WORK')
            metrics = {s['id']: solver.shift_metrics(s) for s in data['shifts']}
            policy = {**data['policy'], '_restRulesVersion': 2, '_visibleMonth': '2026-12',
                      '_simulation': False, '_generationMode': None}
            return model, [people, dates, active, baseline, off, work, choices, metrics,
                           policy, values, time.monotonic() + .6]

        data = scenario()
        data.pop('generationMode')
        # Both durations remain admissible at the helper boundary, without locks.
        alternate = data['shifts'][1]
        alternate['segments'][-1]['end'] -= 24
        for entry in data['assignments']:
            entry.pop('locked', None)
        model, args = context(data)
        before = model.proto.SerializeToString() if hasattr(model.proto, 'SerializeToString') else str(model.proto)
        values = dict(args[9])
        proposed = solver._composed_decision_hints(*args)
        self.assertIsNotNone(proposed)
        moved = 0
        for key, options in args[6].items():
            self.assertEqual(len(options), 2)
            self.assertEqual(proposed[options['alternate'].index], 0)
            if args[3][key]['kind'] == 'OFF' and proposed[args[5][key].index]:
                moved += 1
                self.assertEqual(proposed[options['day'].index], 1)
        self.assertGreater(moved, 0)
        after = model.proto.SerializeToString() if hasattr(model.proto, 'SerializeToString') else str(model.proto)
        self.assertEqual(after, before)
        self.assertEqual(args[9], values)

        # A viable 42-hour week: two 540-minute and three 480-minute shifts.
        # The unrestricted heuristic prefers 480 over an existing 540-minute day.
        mixed = fixture(42, people=1, weeks=1, start_date='2026-11-30')
        mixed['restRulesVersion'] = 2
        short = mixed['shifts'][0]
        short['segments'][-1]['end'] = 1020
        long = copy.deepcopy(short)
        long['id'] = 'long'
        long['segments'][-1]['end'] = 1080
        mixed['shifts'].append(long)
        mixed['employees'][0]['shiftIds'] = ['day', 'long']
        for index, day in enumerate(solver.days_between(mixed['startDate'], mixed['endDate'])):
            entry = dict(employeeId='p0', date=day, kind='OFF' if index in (4, 6) else 'WORK')
            if entry['kind'] == 'WORK':
                entry['shiftId'] = 'long' if index < 2 else 'day'
            mixed['assignments'].append(entry)
        _, args = context(mixed)
        self.assertEqual(sum(args[7][e['shiftId']][0] for e in mixed['assignments']
                             if e['kind'] == 'WORK'), 2520)
        unrestricted = balanced_rest_hints(args[0], args[1], args[2], args[3], args[6],
            args[7], args[8], solver.instant, solver.sunday_limit, deadline=time.monotonic() + .6)
        changed = [day for day, e in unrestricted['p0'].items() if e['kind'] == 'WORK'
                   and args[3]['p0', day]['kind'] == 'WORK'
                   and e['shiftId'] != args[3]['p0', day]['shiftId']]
        self.assertTrue(changed)
        with patch('solver.balanced_rest_hints', wraps=balanced_rest_hints) as generator:
            self.assertIsNone(solver._composed_decision_hints(*args))
            generator.assert_not_called()
        print('CLOCK_CONTRAPROOF', dict(admissibleDurations=sorted({m[0] for m in args[7].values()}),
            heuristicChangedCurrentWorkDays=len(changed), ambiguousBatch='DECLINED',
            unambiguousOffToWorkDays=moved))

    def test_representative_134_people_35_days_constructor_measurement(self):
        data = fixture(42, people=134, weeks=5, start_date='2026-11-02')
        dates = solver.days_between(data['startDate'], data['endDate'])
        active, baseline, values = {}, {}, {}
        model, off, work, choices = cp_model.CpModel(), {}, {}, {}
        sizes = [36, 20, 18, 16, 14, 12, 10, 8]
        offset = 0
        for sector, size in enumerate(sizes):
            for index in range(offset, offset + size):
                p = data['employees'][index]
                p.update(sector='Sector' + str(sector),
                         role='ENC.' if index % 12 == 0 else 'CAIXA' if sector == 0 else 'OPERADOR',
                         maxConsecutiveSundays=1)
            offset += size
        for person in data['employees']:
            pid = person['id']
            active[pid] = dates
            for day in dates:
                key = pid, day
                kind = 'OFF' if date.fromisoformat(day).weekday() in (4, 6) else 'WORK'
                baseline[key] = dict(employeeId=pid, date=day, kind=kind)
                if kind == 'WORK':
                    baseline[key]['shiftId'] = 'day'
                off[key], work[key] = model.new_bool_var('off'), model.new_bool_var('work')
                choices[key] = {'day': model.new_bool_var('clock')}
                values.update({off[key].index: int(kind == 'OFF'), work[key].index: int(kind == 'WORK'),
                               choices[key]['day'].index: int(kind == 'WORK')})
        metrics = {'day': solver.shift_metrics(data['shifts'][0])}
        policy = {**data['policy'], '_restRulesVersion': 2, '_visibleMonth': '2026-11',
                  '_simulation': False, '_generationMode': None}
        completed, portfolio_stats = {}, {}
        def observe(*args, **kwargs):
            result = balanced_rest_hints(*args, **kwargs, portfolio_stats=portfolio_stats)
            completed.update(result)
            return result
        started = time.monotonic()
        deadline = started + .6
        with patch('solver.balanced_rest_hints', side_effect=observe):
            result = solver._composed_decision_hints(data['employees'], dates, active, baseline,
                off, work, choices, metrics, policy, values, deadline)
        elapsed = time.monotonic() - started
        external = {p['id'] for p in data['employees'][36:]}
        completed_dates = sum(len(entries) for entries in completed.values())
        offered = len(data['employees']) if result is not None else 0
        changed = {pid for pid, entries in completed.items()
                   if any(e['kind'] != baseline[pid, day]['kind']
                          or e.get('shiftId') != baseline[pid, day].get('shiftId')
                          for day, e in entries.items())}
        sunday_signatures = {tuple(day for day, e in entries.items()
                                   if date.fromisoformat(day).weekday() == 6 and e['kind'] == 'WORK')
                             for entries in completed.values()}
        self.assertLessEqual(portfolio_stats.get('masksMax', 0), 4)
        self.assertLessEqual(deadline - started, .600001)
        self.assertLessEqual(completed_dates, 4690)
        if result is not None:
            self.assertEqual(len(completed), 134)
            self.assertEqual(completed_dates, 4690)
            self.assertGreater(len(sunday_signatures), 1)
        print('SCALE_MEASUREMENT', dict(peopleIntended=134, datesPerPerson=35, personDatesIntended=4690,
            peopleCompleted=len(completed), personDatesCompleted=completed_dates,
            externalPeopleCompleted=len(external.intersection(completed)), peopleOffered=offered,
            externalPeopleOffered=len(external) if result is not None else 0,
            peopleChangedOffered=len(changed) if result is not None else 0,
            externalPeopleChangedOffered=len(external.intersection(changed)) if result is not None else 0,
            distinctSundaySignatures=len(sunday_signatures), portfolio=portfolio_stats,
            deadlineSeconds=round(deadline - started, 6), elapsedSeconds=round(elapsed, 6),
            status='COMPLETE_DECISIONS' if result is not None else 'INCOMPLETE_DISCARDED', cpCalls=0))


    def test_portfolio_masks_use_recipient_week_rules_and_full_context(self):
        from hints import _rematerialize_calendar
        data = scenario()
        person = copy.deepcopy(data['employees'][0])
        dates = solver.days_between(data['startDate'], data['endDate'])
        active = {person['id']: dates}
        baseline = {(e['employeeId'], e['date']): copy.deepcopy(e) for e in data['assignments']
                    if e['employeeId'] == person['id']}
        choices = {(person['id'], d): {'day': 1} for d in dates}
        metrics = {s['id']: solver.shift_metrics(s) for s in data['shifts']}
        policy = {**data['policy'], '_restRulesVersion': 2, '_visibleMonth': '2026-12',
                  '_simulation': False}
        selected = {d: 'day' for d in dates}
        generated = balanced_rest_hints([person], dates, active, baseline, choices,
            metrics, policy, solver.instant, solver.sunday_limit, deadline=time.monotonic() + .6)
        mask = tuple(generated[person['id']][d]['kind'] == 'OFF' for d in dates)
        def materialize(p=person, b=baseline, c=choices, a=dates, m=mask):
            prior = {e['date']: e for e in p.get('planningHistory', []) + p['history']
                     + p.get('planningFuture', [])}
            return _rematerialize_calendar(p, dates, a, m, b, c, metrics, policy,
                selected, prior, solver.instant, solver.sunday_limit,
                deadline=time.monotonic() + .6)
        self.assertIsNotNone(materialize())
        off_day = next(d for d, bit in zip(dates, mask) if bit)
        work_day = next(d for d, bit in zip(dates, mask)
                        if not bit and date.fromisoformat(d).weekday() != 5)
        for kind, day in (('WORK', off_day), ('OFF', work_day)):
            b = copy.deepcopy(baseline)
            b[person['id'], day] = dict(employeeId=person['id'], date=day, kind=kind, locked=True)
            if kind == 'WORK':
                b[person['id'], day]['shiftId'] = 'day'
            self.assertIsNone(materialize(b=b), 'locked ' + kind)
        p = copy.deepcopy(person)
        p['fixedOffDays'] = [date.fromisoformat(work_day).weekday()]
        self.assertIsNone(materialize(p=p), 'fixedOffDay')
        for kind in ('ABSENCE', 'HOLIDAY'):
            b = copy.deepcopy(baseline)
            b[person['id'], work_day] = dict(employeeId=person['id'], date=work_day, kind=kind)
            self.assertIsNone(materialize(b=b), kind)
        self.assertIsNone(materialize(a=dates[:-1]), 'partial activity')
        c = copy.deepcopy(choices)
        c[person['id'], work_day] = {}
        self.assertIsNone(materialize(c=c), 'unavailable clock')
        self.assertFalse(mask[0])  # The donor has a real locked WORK on this date.
        p = copy.deepcopy(person)
        start = date.fromisoformat(dates[0])
        p['history'] = [dict(employeeId=p['id'], date=(start - timedelta(days=i)).isoformat(),
                             kind='WORK', shiftId='day') for i in range(1, 6)]
        self.assertIsNone(materialize(p=p), 'history boundary')
        self.assertFalse(mask[-1])
        p = copy.deepcopy(person)
        end = date.fromisoformat(dates[-1])
        p['planningFuture'] = [dict(employeeId=p['id'], date=(end + timedelta(days=i)).isoformat(),
                                   kind='WORK', shiftId='day') for i in range(1, 6)]
        self.assertIsNone(materialize(p=p), 'future boundary')
        m = list(mask)
        m[dates.index(work_day)] = True
        self.assertIsNone(materialize(m=tuple(m)), 'weekly quantity')
        m = list(mask)
        saturday = next(i for i, d in enumerate(dates) if date.fromisoformat(d).weekday() == 5)
        m[saturday] = True
        self.assertIsNone(materialize(m=tuple(m)), 'Saturday')
        print('PORTFOLIO_FIDELITY', dict(validRecipient=True, rejectedContexts=10,
            sharedWeeklyConstruction=True, finalCompatibility=True))


    def test_portfolio_134_people_returns_complete_diverse_external_decisions(self):
        import hints
        data = fixture(42, people=134, weeks=5, start_date='2026-11-02')
        dates = solver.days_between(data['startDate'], data['endDate'])
        active, baseline, values = {}, {}, {}
        model, off, work, choices = cp_model.CpModel(), {}, {}, {}
        offset = 0
        for sector, size in enumerate((36, 20, 18, 16, 14, 12, 10, 8)):
            for index in range(offset, offset + size):
                data['employees'][index].update(sector='Sector' + str(sector),
                    role='ENC.' if index % 12 == 0 else 'CAIXA' if sector == 0 else 'OPERADOR',
                    maxConsecutiveSundays=1)
            offset += size
        for person in data['employees']:
            pid = person['id']
            active[pid] = dates
            for day in dates:
                key = pid, day
                kind = 'OFF' if date.fromisoformat(day).weekday() in (4, 6) else 'WORK'
                baseline[key] = dict(employeeId=pid, date=day, kind=kind)
                if kind == 'WORK':
                    baseline[key]['shiftId'] = 'day'
                off[key], work[key] = model.new_bool_var('off'), model.new_bool_var('work')
                choices[key] = {'day': model.new_bool_var('clock')}
                values.update({off[key].index: int(kind == 'OFF'), work[key].index: int(kind == 'WORK'),
                               choices[key]['day'].index: int(kind == 'WORK')})
        expected = {v.index for v in (*off.values(), *work.values(),
                    *(v for options in choices.values() for v in options.values()))}
        choice_indices = {key: {sid: v.index for sid, v in options.items()}
                          for key, options in choices.items()}
        saved_values, saved_baseline = dict(values), copy.deepcopy(baseline)
        saved_active, saved_model = copy.deepcopy(active), str(model.proto)
        metrics = {'day': solver.shift_metrics(data['shifts'][0])}
        saved_metrics = dict(metrics)
        policy = {**data['policy'], '_restRulesVersion': 2, '_visibleMonth': '2026-11',
                  '_simulation': False, '_generationMode': None}
        completed, stats, rematerialized = {}, {}, {}
        actual_rematerialize = hints._rematerialize_calendar
        def observe_generator(*args, **kwargs):
            result = balanced_rest_hints(*args, **kwargs, portfolio_stats=stats)
            completed.update(result)
            return result
        def observe_rematerialization(*args, **kwargs):
            candidate = actual_rematerialize(*args, **kwargs)
            if candidate is not None:
                rematerialized.setdefault(args[0]['id'], []).append(candidate)
            return candidate
        # This is a functional proof, not a latency assertion. The product still
        # supplies at most 0.6 s; no production constant or call is patched here.
        started = time.monotonic()
        deadline = started + 30
        with patch('solver.balanced_rest_hints', side_effect=observe_generator), \
                patch('hints._rematerialize_calendar', side_effect=observe_rematerialization), \
                patch.object(cp_model.CpSolver, 'solve', side_effect=AssertionError('No large CP in this proof')):
            result = solver._composed_decision_hints(data['employees'], dates, active, baseline,
                off, work, choices, metrics, policy, values, deadline)
        self.assertIsNotNone(result, 'The functional requirement cannot pass with zero offer')
        self.assertIsInstance(result, dict)
        self.assertEqual(set(result), expected)
        self.assertTrue(all(type(value) is int and value in (0, 1) for value in result.values()))
        decoded = {p['id']: {} for p in data['employees']}
        for key, options in choices.items():
            pid, day = key
            is_off, is_work = result[off[key].index], result[work[key].index]
            selected = [sid for sid, v in options.items() if result[v.index]]
            self.assertEqual(is_off + is_work, 1)
            self.assertEqual(len(selected), is_work)
            entry = {'kind': 'OFF' if is_off else 'WORK'}
            if is_work:
                entry['shiftId'] = selected[0]
                self.assertEqual(entry['shiftId'], 'day')
            decoded[pid][day] = entry
        self.assertEqual(set(completed), set(decoded))
        self.assertEqual(sum(len(entries) for entries in decoded.values()), 4690)
        for pid, entries in decoded.items():
            self.assertEqual(set(entries), set(dates))
            self.assertEqual(entries, completed[pid], 'Final decisions must match the actual complete calendar')
        external = {p['id'] for p in data['employees'][36:]}
        self.assertEqual(len(external), 98)
        self.assertTrue(external <= decoded.keys())
        changed_external = {pid for pid in external
                            if any(entry['kind'] != baseline[pid, day]['kind']
                                   or entry.get('shiftId') != baseline[pid, day].get('shiftId')
                                   for day, entry in decoded[pid].items())}
        self.assertTrue(changed_external, 'At least one external calendar must actually participate')
        sundays = [day for day in dates if date.fromisoformat(day).weekday() == 6]
        external_signatures = {tuple(decoded[pid][day]['kind'] == 'WORK' for day in sundays)
                               for pid in external}
        external_presence = {day: sum(decoded[pid][day]['kind'] == 'WORK' for pid in external)
                             for day in sundays}
        self.assertGreater(len(external_signatures), 1)
        self.assertGreater(min(external_presence.values()), 0, 'Break the all-OFF Sunday synchronization')
        self.assertLess(max(external_presence.values()), len(external))
        reused_external = {pid for pid in external.intersection(rematerialized)
                           if any(candidate == decoded[pid] for candidate in rematerialized[pid])}
        self.assertTrue(reused_external, 'An external delivered calendar must use real rematerialization')
        self.assertGreater(stats.get('portfolioPeople', 0), 0)
        self.assertGreater(stats.get('candidatesValid', 0), 0)
        self.assertGreater(stats.get('masksMax', 0), 0)
        self.assertLessEqual(stats['masksMax'], 4)
        self.assertEqual(values, saved_values)
        self.assertEqual(baseline, saved_baseline)
        self.assertEqual(active, saved_active)
        self.assertEqual(metrics, saved_metrics)
        self.assertEqual(str(model.proto), saved_model)
        self.assertEqual({key: {sid: v.index for sid, v in options.items()}
                          for key, options in choices.items()}, choice_indices)
        print('FUNCTIONAL_134_PROOF', dict(peopleDecoded=len(decoded), personDatesDecoded=4690,
            exactDecisionIndices=len(expected), externalDecoded=len(external),
            externalChanged=len(changed_external), externalReusedDelivered=len(reused_external),
            externalSundaySignatures=len(external_signatures),
            externalSundayPresence=[external_presence[day] for day in sundays],
            portfolio=stats, testDeadlineSeconds=30,
            elapsedSeconds=round(time.monotonic() - started, 6), cpCalls=0))


if __name__ == '__main__':
    unittest.main()
