"""Focused Sunday date distribution and bounded preparation regressions."""
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ortools.sat.python import cp_model
import optimization
from optimization import ImprovementContext, Snapshot, _movable_people, improve
from solver import _coverage, days_between, instant, shift_metrics, sunday_limit
from hints import balanced_rest_hints
from test_solver import fixture
from weekend_balance import sunday_distribution, weekend_objectives


class SundayDistributionTests(unittest.TestCase):
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
