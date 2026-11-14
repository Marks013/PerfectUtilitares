"""Role/clock comparability, protected coverage and useful rest search budgets."""
import time
from datetime import date
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ortools.sat.python import cp_model
from optimization import (ImprovementContext, Snapshot, _spacing_people,
                          _refinement_phase_budget, improve)
from solver import (_clock_profiles, _weekend_group_key, _spacing_priority,
                    _coverage, days_between)
from test_solver import fixture
import optimization
from weekend_balance import weekend_objectives, sunday_distribution


class SundayRoleRefinementTests(unittest.TestCase):
    def test_same_sector_does_not_equate_fiscal_and_zelador(self):
        data = fixture(people=2)
        first, second = data['employees']
        first['sector'] = second['sector'] = 'ADMINISTRATIVO'
        first['role'], second['role'] = 'FISCAL DE PREVENÇÃO/PERDAS', 'ZELADOR'
        days = days_between(data['startDate'], data['endDate'])
        profiles = {p['id']: (((480, 720), (780, 1044)),) for p in data['employees']}
        self.assertNotEqual(_weekend_group_key(first, days, profiles),
                            _weekend_group_key(second, days, profiles))
        second['role'] = first['role']
        self.assertEqual(_weekend_group_key(first, days, profiles),
                         _weekend_group_key(second, days, profiles))

    def test_same_function_compares_actual_work_intervals_not_shift_labels(self):
        data = fixture(people=2)
        first, second = data['employees']
        days = days_between(data['startDate'], data['endDate'])
        shifts = {'early': {'segments': [{'start': 480, 'end': 720, 'kind': 'WORK'}]},
                  'late': {'segments': [{'start': 720, 'end': 960, 'kind': 'WORK'}]},
                  'renamed': {'segments': [{'start': 480, 'end': 720, 'kind': 'WORK'}]}}
        choices = {(first['id'], days[0]): {'early': 1}, (second['id'], days[0]): {'late': 1}}
        profiles = _clock_profiles(choices, shifts)
        self.assertNotEqual(_weekend_group_key(first, days, profiles),
                            _weekend_group_key(second, days, profiles))
        choices[second['id'], days[0]] = {'renamed': 1}
        profiles = _clock_profiles(choices, shifts)
        self.assertEqual(_weekend_group_key(first, days, profiles),
                         _weekend_group_key(second, days, profiles))
        self.assertEqual(first['offMode'], 'VARIABLE')
        self.assertEqual(first['fixedOffDays'], [])

    def coverage_case(self, separate_roles, separate_times=False):
        data = fixture(people=2, start_date='2026-12-07')
        day = '2026-12-13'
        first, second = data['employees']
        first['sector'] = second['sector'] = 'ADMINISTRATIVO'
        first['history'] = second['history'] = []
        first['role'] = 'FISCAL DE PREVENÇÃO/PERDAS'
        second['role'] = 'ZELADOR' if separate_roles else first['role']
        shifts = {str(i): {'segments': [{'start': 480 + i * 240 if separate_times else 480,
            'end': 720 + i * 240 if separate_times else 720, 'kind': 'WORK'}]} for i in range(2)}
        data['visibleMonth'], data['storeClosingMinutes'] = '2026-12', 720
        data['demands'] = [{'date': day, 'sector': p['sector'], 'role': p['role'],
            'start': shifts[str(i)]['segments'][0]['start'],
            'end': shifts[str(i)]['segments'][0]['end'], 'minimum': 1, 'estimated': True}
            for i, p in enumerate(data['employees'])]
        model = cp_model.CpModel()
        a, b = model.new_bool_var('fiscal'), model.new_bool_var('other')
        model.add(a + b == 1)
        values = {a.index: 1, b.index: 0}
        choices = {(first['id'], day): {'0': a}, (second['id'], day): {'1': b}}
        guards = {}
        coverage = _coverage(model, data, data['employees'], choices, shifts,
            time.monotonic(), 'ESTIMATED', values, closing_terms={}, role_terms=guards)
        # Combined person-minute deficit ties in the two alternatives.
        model.add(sum(coverage) <= Snapshot(values).value(sum(coverage)))
        for terms in guards.values():
            model.add(sum(terms) <= Snapshot(values).value(sum(terms)))
        model.minimize(a)  # Optional rest aesthetics would prefer the invalid exchange.
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(a), 1)
        self.assertEqual(engine.value(b), 0)
        self.assertEqual(engine.value(sum(coverage)), Snapshot(values).value(sum(coverage)))
        return guards

    def test_role_deficit_cannot_be_transferred_between_fiscal_and_zelador(self):
        guards = self.coverage_case(separate_roles=True)
        self.assertIn(('ADMINISTRATIVO', 'FISCAL DE PREVENÇÃO/PERDAS', 'SUNDAY'), guards)
        self.assertIn(('ADMINISTRATIVO', 'FISCAL DE PREVENÇÃO/PERDAS', 'CLOSING'), guards)

    def test_same_function_does_not_trade_a_morning_gap_for_an_afternoon_gap(self):
        guards = self.coverage_case(separate_roles=False, separate_times=True)
        self.assertIn(('ADMINISTRATIVO', 'FISCAL DE PREVENÇÃO/PERDAS', 'SUNDAY', (480, 720)), guards)
        self.assertIn(('ADMINISTRATIVO', 'FISCAL DE PREVENÇÃO/PERDAS', 'SUNDAY', (720, 960)), guards)

    def test_temporal_role_guards_allow_interleaving_between_sundays(self):
        data = fixture(people=2)
        for p in data['employees']:
            p['history'] = []
        days = ['2026-12-06', '2026-12-13']
        data['demands'] = [{'date': day, 'sector': 'Reposição', 'role': 'Repositor',
                            'start': 480, 'end': 720, 'minimum': 1, 'estimated': True} for day in days]
        model = cp_model.CpModel()
        work = {(p['id'], day): model.new_bool_var('w:' + p['id'] + ':' + day)
                for p in data['employees'] for day in days}
        values = {v.index: int(day == days[0]) for (_, day), v in work.items()}
        for p in data['employees']:
            model.add(sum(work[p['id'], day] for day in days) == 1)
        guards = {}
        coverage = _coverage(model, data, data['employees'],
            {key: {'day': v} for key, v in work.items()}, {'day': data['shifts'][0]},
            time.monotonic(), 'ESTIMATED', values, role_terms=guards)
        for terms in guards.values():
            model.add(sum(terms) <= Snapshot(values).value(sum(terms)))
        model.minimize(sum(coverage))
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(sum(coverage)), 0)
        self.assertEqual([sum(engine.value(work[p['id'], day]) for p in data['employees']) for day in days], [1, 1])

    def common_partition_case(self, boundary_source):
        data = fixture(people=2, weeks=2, start_date='2026-11-30')
        data['visibleMonth'], data['storeClosingMinutes'] = '2026-12', 720
        days = ['2026-12-06', '2026-12-13']
        for person in data['employees']:
            person['history'] = []
        model = cp_model.CpModel()
        work = {(p['id'], day): model.new_bool_var('full:' + p['id'] + ':' + day)
                for p in data['employees'] for day in days}
        choices = {key: {'full': variable} for key, variable in work.items()}
        values = {variable.index: int(day == days[0]) for (_, day), variable in work.items()}
        shifts = {'full': {'segments': [{'start': 480, 'end': 720, 'kind': 'WORK'}]}}
        if boundary_source == 'unselected-clock':
            shifts['partial'] = {'segments': [{'start': 480, 'end': 600, 'kind': 'WORK'}]}
            for person in data['employees']:
                variable = model.new_bool_var('unselected:' + person['id'])
                model.add(variable == 0)
                values[variable.index] = 0
                choices[person['id'], days[1]]['partial'] = variable
        data['demands'] = []
        for day in days:
            intervals = [(480, 600), (600, 720)] if (
                boundary_source == 'reference' and day == days[1]) else [(480, 720)]
            for start, end in intervals:
                data['demands'].append({'date': day, 'sector': 'Reposição', 'role': 'Repositor',
                    'start': start, 'end': end, 'minimum': 3, 'estimated': True})
        for person in data['employees']:
            model.add(sum(work[person['id'], day] for day in days) == 1)
        guards, closing = {}, {}
        coverage = _coverage(model, data, data['employees'], choices, shifts,
            time.monotonic(), 'ESTIMATED', values, closing_terms=closing, role_terms=guards)
        snapshot = Snapshot(values)
        self.assertEqual(snapshot.value(sum(coverage)), 960)
        self.assertEqual(snapshot.value(sum(closing['Reposição'])), 240)
        slots = {key[3] for key in guards if len(key) == 4 and key[2] == 'SUNDAY'}
        self.assertEqual(slots, {(480, 600), (600, 720)})
        # Splitting coefficients creates no minute variables or extra gap model.
        self.assertLessEqual(len(model.proto.variables), 12 if boundary_source == 'unselected-clock' else 8)
        for terms in guards.values():
            model.add(sum(terms) <= snapshot.value(sum(terms)))
        model.add(sum(coverage) <= 960)
        model.add(sum(closing['Reposição']) <= 240)
        balance = model.new_int_var(0, 2, 'date-balance')
        model.add_abs_equality(balance,
            sum(work[p['id'], days[0]] for p in data['employees'])
            - sum(work[p['id'], days[1]] for p in data['employees']))
        model.minimize(balance)
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(balance), 0)
        self.assertEqual([sum(engine.value(work[p['id'], day]) for p in data['employees'])
                          for day in days], [1, 1])
        self.assertEqual(engine.value(sum(coverage)), 960)
        self.assertEqual(engine.value(sum(closing['Reposição'])), 240)
        for terms in guards.values():
            self.assertLessEqual(engine.value(sum(terms)), snapshot.value(sum(terms)))

    def test_common_partition_allows_960_person_minutes_with_unselected_clock_boundary(self):
        self.common_partition_case('unselected-clock')

    def test_common_partition_allows_960_person_minutes_with_reference_boundary(self):
        self.common_partition_case('reference')

    def test_correctable_excess_gets_the_same_priority_in_neighborhood_and_objective(self):
        groups = {'many': ['a', 'b', 'c', 'd'], 'excess': ['e']}
        quality = {'people': {pid: [1, 1] for pid in groups['many']}, 'excess': {pid: 0 for pid in groups['many']}}
        quality['people']['e'], quality['excess']['e'] = [1, 1, 1], 1
        priority = _spacing_priority(quality)
        with patch('optimization.MOVABLE_PEOPLE_LIMIT', 4):
            self.assertEqual(_spacing_people(groups, quality['people'], {}), set(groups['many']))
            self.assertEqual(_spacing_people(groups, priority, {}), {'e'})

    def test_a_pair_required_by_better_coverage_remains_allowed(self):
        model = cp_model.CpModel()
        pair = model.new_bool_var('optional-pair')
        gap = model.new_int_var(0, 1, 'coverage-gap')
        model.add(gap + pair == 1)
        values = {pair.index: 0, gap.index: 1}
        result, _, _ = improve(model, [gap, pair], values, time.monotonic() + 2,
                               ['COVERAGE', 'REST_SPACING'])
        self.assertEqual(result[gap.index], 0)
        self.assertEqual(result[pair.index], 1)

    def test_short_budget_funds_a_real_sunday_attempt_without_extending_deadline(self):
        model = cp_model.CpModel()
        names = ['COVERAGE', 'SUNDAY_COVERAGE', 'CLOSING_COVERAGE', 'UNTIMED_ROTATION',
                 'SUNDAY_BALANCE', 'REST_SPACING', 'STABILITY']
        goals = [model.new_int_var(0, 1, name) for name in names]
        values = {v.index: 1 for v in goals}
        clock = [100.0]
        class Engine:
            def __init__(self): self.parameters = SimpleNamespace()
            def solve(self, _):
                clock[0] += self.parameters.max_time_in_seconds
                return cp_model.UNKNOWN
            def status_name(self, _): return 'UNKNOWN'
        with patch('optimization.time.monotonic', side_effect=lambda: clock[0]), \
                patch('optimization.cp_model.CpSolver', Engine):
            result, proven, phases = improve(model, goals, values, 103.0, names,
                context=ImprovementContext(refinement_reserve_seconds=0.8))
        sunday = next(p for p in phases if p['objective'] == 'SUNDAY_BALANCE')
        self.assertGreaterEqual(sunday['budgetSeconds'], 0.79)
        self.assertLessEqual(clock[0], 103.0)
        self.assertEqual(result, values)
        self.assertFalse(proven)
        self.assertEqual(sunday['status'], 'UNKNOWN')
        self.assertLessEqual(_refinement_phase_budget(0.3, names, 4, 0.8), 0.3)


class SundayNeighborhoodContinuityTests(unittest.TestCase):
    def test_complete_previous_block_replaces_packing_without_union_or_stale_priority(self):
        model, values, groups = cp_model.CpModel(), {}, []
        target = set()
        for size, score, prefix in ((13, 7692, 'a'), (11, 5454, 'b')):
            members = [f'{prefix}{i:02}' for i in range(size)]
            target.update(members)
            index = len(groups)
            groups.append(members)
            for pid in members:
                variable = model.new_int_var(0, 10000, f'weekend-rate:6:{pid}')
                values[variable.index] = 2000
            variable = model.new_int_var(0, 10000, f'weekend-date-spread:6:{index}')
            values[variable.index] = score
        for i in range(12):
            groups.append([f'c{i:02}'])
            target.add(f'c{i:02}')
        for i in range(7):
            members = [f'z{i}{j}' for j in range(5)]
            index = len(groups)
            groups.append(members)
            for pid in members:
                variable = model.new_int_var(0, 10000, f'weekend-rate:6:{pid}')
                values[variable.index] = 2000
            variable = model.new_int_var(0, 10000, f'weekend-date-spread:6:{index}')
            values[variable.index] = 10000
        variables = [model.get_int_var_from_proto_index(i) for i in range(len(values))]
        fallback = optimization._movable_people(variables, values, groups)
        self.assertEqual(len(fallback), 35)
        self.assertTrue(target.isdisjoint(fallback))
        self.assertEqual(optimization._movable_people(variables, values, groups,
                                                     preferred=target), target)
        for invalid in (None, set(), target - {'a00'}, target | {'z00'},
                        (target - {'a00'}) | {'unknown'}, {'c00'}):
            with self.subTest(invalid=invalid):
                self.assertEqual(optimization._movable_people(variables, values, groups,
                                                             preferred=invalid), fallback)
        current = dict(values)
        for variable in variables:
            if variable.name.startswith('weekend-date-spread:6:') and int(variable.name.rsplit(':', 1)[1]) < 2:
                current[variable.index] = 0
        self.assertEqual(optimization._movable_people(variables, current, groups,
                                                     preferred=target), fallback)

    def calendar_case(self):
        data = fixture(people=40, hours=42, weeks=2, start_date='2026-11-30')
        days = days_between(data['startDate'], data['endDate'])
        sundays = [days[6], days[13]]
        target = ['a0', 'a1', 'b0', 'b1', 'c0']
        pids = target + [f'z{i:02}' for i in range(35)]
        groups = {'a': target[:2], 'b': target[2:4], 'c': target[4:]}
        groups.update({f'z{i}': pids[5 + i * 5:10 + i * 5] for i in range(7)})
        sectors = {'operational': target}
        sectors.update({f'blocked-{i}': groups[f'z{i}'] for i in range(7)})
        for person, pid in zip(data['employees'], pids):
            person.update(id=pid, sector='operational' if pid in target else f'blocked-{(int(pid[1:]) // 5)}',
                          role='Repositor', history=[], weeklyHours=42, scheduleMode='TIMED',
                          shiftIds=[pid[0] if pid in target else 'a'],
                          fixedImportedShiftId=pid[0] if pid in target else 'a',
                          maxConsecutiveSundays=1, sundayRestRule='PROTECTIVE')
        shifts = {name: {'segments': [{'kind': 'WORK', 'start': 480 + offset, 'end': 720 + offset},
                    {'kind': 'BREAK', 'start': 720 + offset, 'end': 780 + offset},
                    {'kind': 'WORK', 'start': 780 + offset, 'end': 1044 + offset}]}
                  for name, offset in (('a', 0), ('b', 60), ('c', 30))}
        data['shifts'] = [dict(id=sid, name=sid, **shift) for sid, shift in shifts.items()]
        data['policy'].update(maxConsecutiveWorkDays=5, dailyLimitMinutes=528)
        data['visibleMonth'], data['storeClosingMinutes'] = '2026-12', 1104
        data['demands'] = [{'date': day, 'sector': 'operational', 'role': 'Repositor',
                           'start': start, 'end': end, 'minimum': 3, 'estimated': True}
                          for day in sundays for start, end in ((540, 720), (1044, 1104))]
        data['demands'].append({'date': sundays[0], 'sector': 'operational',
            'role': 'Repositor', 'start': 540, 'end': 720, 'minimum': 4, 'estimated': False})
        model, values, work, off, decisions = cp_model.CpModel(), {}, {}, {}, {}
        for pid in pids:
            for i, day in enumerate(days):
                work[pid, day] = model.new_bool_var(f'w:{pid}:{day}')
                off[pid, day] = model.new_bool_var(f'o:{pid}:{day}')
                resting = i in (0, 2, 8, 13)
                for variable, value in ((work[pid, day], int(not resting)),
                                        (off[pid, day], int(resting))):
                    values[variable.index] = value
                    decisions[variable.index] = pid, day
                model.add(work[pid, day] + off[pid, day] == 1)
                if i % 7 == 5:
                    model.add(off[pid, day] == 0)
            for week in (days[:7], days[7:]):
                model.add(sum(work[pid, day] for day in week) == 5)
                model.add(sum(504 * work[pid, day] for day in week) == 2520)
            for i in range(len(days) - 5):
                model.add(sum(work[pid, day] for day in days[i:i + 6]) <= 5)
            for i in range(len(days) - 2):
                model.add(sum(off[pid, day] for day in days[i:i + 3]) <= 2)
            model.add(sum(work[pid, day] for day in sundays) <= 1)
            if pid not in target:
                # A locked WORK Sunday is still an opportunity in the rates;
                # the consecutive-Sunday rule makes these cohorts immovable.
                model.add(work[pid, sundays[0]] == 1)
        choices = {(pid, day): {pid[0] if pid in target else 'a': variable}
                   for (pid, day), variable in work.items()}
        _coverage(model, data, data['employees'], choices, shifts, time.monotonic(), 'HARD')
        sunday, sector, visible_sunday, visible_sector, closing, roles = {}, {}, {}, {}, {}, {}
        gaps = _coverage(model, data, data['employees'], choices, shifts, time.monotonic(),
            'ESTIMATED', values, sunday, sector, visible_sunday, visible_sector, closing,
            role_terms=roles)
        totals = {weekday: {pid: (sum(work[pid, day] for day in days
                           if date.fromisoformat(day).weekday() == weekday), 2)
                           for pid in pids} for weekday in (5, 6)}
        sunday_goals, _ = weekend_objectives(model, groups, totals, Snapshot(values), values)
        date_spreads, presence, _ = sunday_distribution(model, groups, data['employees'],
            days, work, {}, {'closedDates': [], 'holidayDates': [], 'authorizedHolidayDates': []}, values)
        sunday_goals.extend(date_spreads)
        guarded = [sum(v) for mapping in (sunday, sector, visible_sunday, visible_sector, closing, roles)
                   for v in mapping.values()]
        context = ImprovementContext(decision_variables=decisions, employee_groups=list(groups.values()),
            coverage_groups=sectors, sunday_coverage=sunday, refinement_reserve_seconds=0.8,
            protected_groups={'COVERAGE': guarded, 'SUNDAY_BALANCE': sunday_goals + presence})
        first = {key: values[variable.index] for key, variable in work.items()}
        # A known legal coverage repair transfers the singleton's Sunday plus
        # one ordinary weekday in each week, preserving its fixed geometry.
        for i, value in ((0, 1), (6, 0), (10, 0), (13, 1)):
            first['c0', days[i]] = value
        return SimpleNamespace(model=model, values=values, work=work, off=off, context=context,
            coverage=sum(gaps), balance=sum(sunday_goals), guarded=guarded + sunday_goals + presence,
            target=set(target), pids=pids, days=days, sundays=sundays, first=first)

    def run_calendar(self, case, mode='gain', repeated=False):
        test = self
        clock = [100.0]
        class Control:
            calls = 0
            first_values = None
            first_guards = None
            def checkpoint(self): pass
            def solve(self, engine, model):
                self.calls += 1
                if mode in ('unknown', 'rejected'):
                    return cp_model.UNKNOWN if mode == 'unknown' else cp_model.INFEASIBLE
                # Certify a known, complete intermediate roster with real CP.
                # The following phase uses the original, unmodified neighborhood.
                if self.calls <= (2 if repeated else 1):
                    pinned = model.clone()
                    calendar = case.first if mode != 'no_gain' else {
                        key: case.values[v.index] for key, v in case.work.items()}
                    for key, variable in case.work.items():
                        pinned.add(pinned.get_int_var_from_proto_index(variable.index) == calendar[key])
                    status = engine.solve(pinned)
                    test.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))
                    self.first_values = {i: engine.value(case.model.get_int_var_from_proto_index(i))
                                         for i in range(len(case.values))}
                    self.first_guards = [Snapshot(self.first_values).value(v) for v in case.guarded]
                    if mode == 'deadline': clock[0] = 102.0
                    return status
                return engine.solve(model)
        control = Control()
        case.context.control = control
        goals, names = [0, case.coverage], ['COVERAGE', 'SUNDAY_COVERAGE']
        if repeated:
            goals.append(case.coverage)
            names.append('SUNDAY_COVERAGE')
        goals.append(case.balance)
        names.append('SUNDAY_BALANCE')
        with patch('optimization.LARGE_MODEL_VARIABLES', 0):
            if mode == 'deadline':
                with patch('optimization.time.monotonic', side_effect=lambda: clock[0]):
                    result = improve(case.model, goals, case.values, 102.0, names, context=case.context)
            else:
                result = improve(case.model, goals, case.values, time.monotonic() + (4 if repeated else 2),
                                 names, context=case.context)
        return result, control

    def test_accepted_coverage_gain_unblocks_a_complete_coupled_exchange(self):
        case = self.calendar_case()
        (result, _, phases), control = self.run_calendar(case)
        coverage = next(p for p in phases if p['objective'] == 'SUNDAY_COVERAGE')
        balance = next(p for p in phases if p['objective'] == 'SUNDAY_BALANCE')
        self.assertEqual(coverage['initialValue'] - coverage['incumbentValue'], 180)
        self.assertEqual(balance['initialValue'], 90000)
        self.assertEqual(balance['incumbentValue'], 80000)
        self.assertEqual(balance['movablePeople'], 5)
        self.assertEqual(control.calls, 2)
        self.assertEqual([p['objective'] for p in phases if p['budgetSeconds'] > 0],
                         ['SUNDAY_COVERAGE', 'SUNDAY_BALANCE'])
        self.assertEqual([sum(result[case.work[pid, day].index] for pid in case.target)
                          for day in case.sundays], [4, 1])
        self.assertEqual([result[case.work['c0', day].index] for day in case.sundays], [1, 0])
        self.assertTrue(any(result[v.index] != control.first_values[v.index]
                            for (pid, day), v in case.work.items()
                            if pid in case.target and day not in case.sundays))
        for expression, limit in zip(case.guarded, control.first_guards):
            self.assertLessEqual(Snapshot(result).value(expression), limit)
        for pid in case.pids:
            for start in (0, 7):
                self.assertEqual(sum(result[case.work[pid, day].index]
                                     for day in case.days[start:start + 7]), 5)
        # Structural exclusion, independent of timing: old packing pins all five
        # operational people. A better target spread then cannot be represented.
        variables = [case.model.get_int_var_from_proto_index(i) for i in range(len(result))]
        fallback = optimization._movable_people(variables, control.first_values,
                                                 case.context.employee_groups)
        self.assertEqual(len(fallback), 35)
        self.assertTrue(fallback.isdisjoint(case.target))

    def test_no_gain_unknown_and_deadline_preserve_fallback_or_incumbent(self):
        for mode, calls, expected in (('no_gain', 2, 90000), ('unknown', 2, 90000),
                                      ('rejected', 1, 90000), ('deadline', 1, 90000)):
            with self.subTest(mode=mode):
                case = self.calendar_case()
                (result, _, phases), control = self.run_calendar(case, mode)
                self.assertEqual(Snapshot(result).value(case.balance), expected)
                self.assertEqual(control.calls, calls)
                if mode in ('unknown', 'rejected'):
                    self.assertEqual(result, case.values)
                elif mode == 'deadline':
                    self.assertEqual(result, control.first_values)
                    self.assertFalse(any(p['objective'] == 'SUNDAY_BALANCE' for p in phases))
                else:
                    self.assertEqual(next(p for p in phases if p['objective'] == 'SUNDAY_BALANCE')['movablePeople'], 35)

    def test_later_attempt_without_gain_does_not_replace_a_successful_block(self):
        case = self.calendar_case()
        other = case.context.coverage_groups['blocked-0']
        with patch('optimization._coverage_people', side_effect=[case.target, set(other)]):
            (result, _, phases), control = self.run_calendar(case, repeated=True)
        self.assertEqual(control.calls, 3)
        self.assertEqual(Snapshot(result).value(case.balance), 80000)
        attempts = [p for p in phases if p['objective'] == 'SUNDAY_COVERAGE']
        self.assertLess(attempts[0]['incumbentValue'], attempts[0]['initialValue'])
        self.assertEqual(attempts[1]['incumbentValue'], attempts[1]['initialValue'])


if __name__ == '__main__':
    unittest.main()
