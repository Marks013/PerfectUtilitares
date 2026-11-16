"""Focused Sunday date distribution and bounded preparation regressions."""
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ortools.sat.python import cp_model
import optimization
from optimization import ImprovementContext, Snapshot, _movable_people, improve
from solver import (_composed_decision_hints, _coverage, days_between, instant,
                    shift_metrics, sunday_limit)
from hints import balanced_rest_hints
from test_solver import fixture
from weekend_balance import sunday_distribution, weekend_objectives


class SundayDistributionTests(unittest.TestCase):
    def test_sector_calendar_is_built_before_its_coverage_search(self):
        # Captured shape: most peers work only the third Sunday. Recovery must
        # exchange complete Sunday trajectories, retaining all mandatory rules.
        model = cp_model.CpModel()
        days = ['2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']
        work = {(str(i), day): model.new_bool_var(f'w:{i}:{day}')
                for i in range(12) for day in days}
        outside = model.new_bool_var('w:outside:2026-12-06')
        model.add(outside == 1)
        values = {v.index: int(day == days[2] or (int(pid), day) in (
            (0, days[0]), (1, days[1]), (2, days[3]))) for (pid, day), v in work.items()}
        # The three extra presences cannot also work the adjacent third Sunday.
        for pid in ('1', '2'):
            values[work[pid, days[2]].index] = 0
        values[outside.index] = 1
        for pid in map(str, range(12)):
            for first, second in zip(days, days[1:]):
                model.add(work[pid, first] + work[pid, second] <= 1)
        for pid, day in (('0', days[0]), ('1', days[1]), ('2', days[3])):
            model.add(work[pid, day] == 1)
        deficits = []
        for day in days:
            gap = model.new_int_var(0, 6, 'gap:' + day)
            model.add(gap >= 6 - sum(work[str(i), day] for i in range(12)))
            values[gap.index] = max(0, 6 - sum(values[work[str(i), day].index] for i in range(12)))
            deficits.append(gap)
        decisions = {v.index: key for key, v in work.items()}
        decisions[outside.index] = ('outside', days[0])
        proposal = {v.index: int(days.index(day) % 2 == (
            int(pid) % 2 if pid not in ('2', '3') else 1 - int(pid) % 2))
                    for (pid, day), v in work.items()}
        proposal[outside.index] = 1
        observed = []
        def build(current, deadline, control, people):
            self.assertEqual(people, frozenset(map(str, range(12))))
            self.assertEqual(dict(current), values)
            self.assertGreater(deadline, time.monotonic())
            observed.append('built')
            return proposal
        class InspectControl:
            def checkpoint(self):
                pass
            def solve(inner, engine, search_model):
                self.assertEqual(observed, ['built'])
                hint = dict(zip(search_model.proto.solution_hint.vars,
                                search_model.proto.solution_hint.values))
                self.assertEqual(hint, proposal)
                self.assertEqual(tuple(search_model.proto.variables[outside.index].domain), (1, 1))
                observed.append('searched')
                return engine.solve(search_model)
        result, _, phases = improve(model, [sum(deficits)], values, time.monotonic() + 8,
            ['COVERAGE'], context=ImprovementContext(control=InspectControl(),
                decision_variables=decisions,
                initial_repair_groups=[set(map(str, range(12)))],
                coverage_repair_hint_builder=build))
        self.assertEqual(observed, ['built', 'searched'])
        self.assertEqual(Snapshot(result).value(sum(deficits)), 0)
        self.assertEqual(result[outside.index], 1)
        self.assertEqual(phases[0]['searchScope'], 'SELECTED_PEOPLE')
        self.assertEqual(phases[0]['decisionHintStatus'], 'COMPLETE_DECISIONS')

    def test_scoped_calendar_keeps_nonparticipants_without_reading_their_references(self):
        data = fixture(people=2)
        days = days_between(data['startDate'], data['endDate'])
        model = cp_model.CpModel()
        people = data['employees']
        active = {p['id']: days for p in people}
        off = {(p['id'], day): model.new_bool_var(f'o:{p["id"]}:{day}') for p in people for day in days}
        work = {(p['id'], day): model.new_bool_var(f'w:{p["id"]}:{day}') for p in people for day in days}
        choices = {key: {'day': model.new_bool_var('s:' + ':'.join(key))} for key in work}
        values = {v.index: 0 for v in off.values()}
        values.update({v.index: 1 for v in work.values()})
        values.update({v.index: 1 for options in choices.values() for v in options.values()})
        proposed = {'p0': {day: {'kind': 'OFF'} for day in days}}
        # A nonparticipant's ambiguous clocks must not reject a sector calendar.
        choices['p1', days[0]] = {'other': choices['p1', days[0]]['day']}
        with patch('solver.balanced_rest_hints', return_value=proposed) as builder:
            result = _composed_decision_hints(people, days, active, {}, off, work, choices,
                {'day': shift_metrics(data['shifts'][0])}, data['policy'], values,
                time.monotonic() + 5, movable_people={'p0'})
        self.assertEqual([p['id'] for p in builder.call_args.args[0]], ['p0'])
        self.assertEqual(set(result), set(values))
        for day in days:
            self.assertEqual(result[off['p0', day].index], 1)
            self.assertEqual(result[work['p0', day].index], 0)
            self.assertEqual(result[choices['p0', day]['day'].index], 0)
            self.assertEqual(result[off['p1', day].index], 0)
            self.assertEqual(result[work['p1', day].index], 1)
            for variable in choices['p1', day].values():
                self.assertEqual(result[variable.index], 1)

    def make_group(self, mode='UNTIMED'):
        model = cp_model.CpModel()
        days = ['2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']
        people = [{'id': str(i), 'fixedOffDays': [], 'scheduleMode': mode} for i in range(4)]
        work = {(p['id'], day): model.new_bool_var(f'w:{p["id"]}:{day}')
                for p in people for day in days}
        values = {v.index: int(day == days[2]) for (_, day), v in work.items()}
        policy = {'closedDates': [], 'holidayDates': [], 'authorizedHolidayDates': []}
        groups = {'sector': [p['id'] for p in people]}
        return model, days, people, work, values, policy, groups

    def test_equal_personal_totals_no_longer_hide_one_staffed_sunday(self):
        model, days, people, work, values, policy, groups = self.make_group()
        totals = {6: {}, 5: {}}
        for p in people:
            total = 4 - sum(work[p['id'], day] for day in days)
            totals[6][p['id']] = total, 4
            totals[5][p['id']] = 0, 0
            model.add(sum(work[p['id'], day] for day in days) == 1)
        personal, _ = weekend_objectives(model, groups, totals, Snapshot(values), values)
        self.assertEqual(Snapshot(values).value(sum(personal)), 0)
        spreads, presence, untimed = sunday_distribution(
            model, groups, people, days, work, {}, policy, values)
        self.assertEqual(Snapshot(values).value(sum(spreads)), 10000)
        self.assertEqual(untimed, spreads)
        # An explicit lock and an independent sector deficit must survive.
        model.add(work['0', days[2]] == 1)
        deficit = model.new_int_var(0, 4, 'protected-sector-deficit')
        model.add(deficit + sum(work.values()) == 4)
        values[deficit.index] = 0
        objective = sum(personal + spreads)
        result, _, phases = improve(model, [objective], values, time.monotonic() + 2,
            ['SUNDAY_BALANCE'], context=ImprovementContext(
                protected_groups={'SUNDAY_BALANCE': personal + spreads + presence},
                employee_groups=list(groups.values()),
                decision_variables={v.index: key for key, v in work.items()}))
        self.assertEqual(Snapshot(result).value(objective), 0)
        self.assertEqual([sum(result[work[p['id'], day].index] for p in people) for day in days], [1, 1, 1, 1])
        self.assertEqual(result[work['0', days[2]].index], 1)
        self.assertEqual(result[deficit.index], 0)
        self.assertTrue(phases)

    def test_date_concentration_releases_a_group_with_equal_personal_rates(self):
        model, days, people, work, values, policy, groups = self.make_group('TIMED')
        for p in people:
            rate = model.new_int_var(0, 10000, 'weekend-rate:6:' + p['id'])
            values[rate.index] = 7500
        old_variables = [model.get_int_var_from_proto_index(i) for i in range(len(model.proto.variables))]
        self.assertEqual(_movable_people(old_variables, values, list(groups.values())), set())
        spreads, _, untimed = sunday_distribution(model, groups, people, days, work, {}, policy, values)
        self.assertEqual(untimed, [])
        variables = [model.get_int_var_from_proto_index(i) for i in range(len(model.proto.variables))]
        self.assertEqual(_movable_people(variables, values, list(groups.values())), {'0', '1', '2', '3'})
        self.assertEqual(values[spreads[0].index], 10000)

    def test_closure_absence_and_forced_rest_are_not_missing_presence(self):
        model, days, people, work, values, policy, groups = self.make_group()
        policy['closedDates'] = [days[3]]
        people[0]['fixedOffDays'] = [6]
        baseline = {('1', days[0]): {'kind': 'ABSENCE'}, ('2', days[1]): {'kind': 'OFF', 'locked': True}}
        for (pid, day), variable in work.items():
            values[variable.index] = int(pid != '0' and (pid, day) not in baseline)
        spreads, _, _ = sunday_distribution(model, groups, people, days, work, baseline, policy, values)
        self.assertEqual(values[spreads[0].index], 0)
        rates = [v for v in model.proto.variables if v.name.startswith('sunday-date-rate:')]
        self.assertEqual(len(rates), 3)
        self.assertTrue(all(days[3] not in v.name for v in rates))
        self.assertEqual(model.validate(), '')

    def test_seed_staggers_sundays_before_optional_pair_preferences(self):
        data = fixture(people=8, weeks=4, start_date='2026-11-30')
        data['policy']['_restRulesVersion'] = 2
        data['policy']['_visibleMonth'] = '2026-12'
        for person in data['employees']:
            person['history'] = []
        days = days_between(data['startDate'], data['endDate'])
        active = {p['id']: days for p in data['employees']}
        choices = {(p['id'], day): {'day': 1} for p in data['employees'] for day in days}
        metrics = {'day': shift_metrics(data['shifts'][0])}
        # Deliberately conflicting optional aesthetics previously won before load.
        def prefer_common_sunday(person, entries, *_):
            return (0, -int(entries.get('2026-12-06', {}).get('kind') == 'OFF'))
        with patch('hints._spacing_rank', side_effect=prefer_common_sunday):
            proposals = balanced_rest_hints(data['employees'], days, active, {}, choices, metrics,
                                            data['policy'], instant, sunday_limit)
        self.assertEqual(len(proposals), 8)
        rests = [sum(entries.get(day, {}).get('kind') == 'OFF' for entries in proposals.values())
                 for day in days if day.endswith(('12-06', '12-13', '12-20', '12-27'))]
        self.assertLess(max(rests) - min(rests), 8)
        self.assertTrue(all(entry['kind'] != 'OFF' for entries in proposals.values()
                            for day, entry in entries.items() if day in ('2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26')))

    def test_coverage_geometry_is_shared_without_dropping_people(self):
        counts = []
        for size in (1, 8):
            data = fixture(people=size)
            day = data['startDate']
            data['demands'] = [{'date': day, 'sector': 'Reposição', 'role': '',
                                'start': 480, 'end': 720, 'minimum': 1, 'estimated': True}]
            model = cp_model.CpModel()
            variables = {p['id']: model.new_bool_var('clock:' + p['id']) for p in data['employees']}
            choices = {(pid, day): {'day': v} for pid, v in variables.items()}
            values = {v.index: 1 for v in variables.values()}
            with patch('solver.instant', wraps=instant) as clock:
                terms = _coverage(model, data, data['employees'], choices,
                    {'day': data['shifts'][0]}, time.monotonic(), 'ESTIMATED', values)
            counts.append(clock.call_count)
            self.assertEqual(Snapshot(values).value(sum(terms)), 0)
            self.assertEqual(model.validate(), '')
            gap = next(c for c in model.proto.constraints if len(c.linear.vars) == size + 1)
            self.assertTrue(set(v.index for v in variables.values()).issubset(gap.linear.vars))
        self.assertEqual(counts[0], counts[1])

    def test_repeated_coverage_repairs_flatten_and_bound_once(self):
        model = cp_model.CpModel()
        work = {(str(i), '2026-12-06'): model.new_bool_var(f'w:{i}:2026-12-06') for i in range(4)}
        values = {v.index: 1 for v in work.values()}
        objective = sum(work.values())
        class UnknownEngine:
            def __init__(self):
                self.parameters = SimpleNamespace()
            def solve(self, _):
                return cp_model.UNKNOWN
            def status_name(self, _):
                return 'UNKNOWN'
        with patch('optimization.cp_model.CpSolver', UnknownEngine), \
                patch('optimization._phase_budget', return_value=3), \
                patch('optimization._objective_floor', wraps=optimization._objective_floor) as floor:
            result, proven, phases = improve(model, [objective], values, time.monotonic() + 5,
                ['COVERAGE'], context=ImprovementContext(
                    decision_variables={v.index: key for key, v in work.items()},
                    initial_repair_groups=[{str(i)} for i in range(4)]))
        self.assertEqual(len(phases), 5)
        self.assertEqual(floor.call_count, 1)
        self.assertEqual(result, values)
        self.assertFalse(proven)


if __name__ == '__main__':
    unittest.main()
