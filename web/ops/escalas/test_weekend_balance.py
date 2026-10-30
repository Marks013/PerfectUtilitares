"""Independent weekend-priority and cross-week neighborhood regressions."""
import time
import unittest
from datetime import date, timedelta

from ortools.sat.python import cp_model
from candidate_optimization import Snapshot, improve, _movable_weeks
from unittest.mock import patch
from weekend_balance import available_weekends, weekend_objectives
from candidate_solver import solve
from test_solver import fixture


class WeekendRegressionTests(unittest.TestCase):
    def test_sunday_has_its_own_priority_before_saturday(self):
        data = fixture(people=3, weeks=1)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        names = [phase['objective'] for phase in result['optimization']['phases']]
        self.assertIn('SUNDAY_BALANCE', names)
        self.assertIn('SATURDAY_BALANCE', names)
        self.assertLess(names.index('SUNDAY_BALANCE'), names.index('SATURDAY_BALANCE'))

    def test_two_week_exchange_preserves_joint_constraint_and_finds_improvement(self):
        model = cp_model.CpModel()
        days = [(date(2026, 11, 2) + timedelta(days=i)).isoformat() for i in range(21)]
        rests = {day: model.new_bool_var('o:p:'+day) for day in days}
        first, second = rests['2026-11-08'], rests['2026-11-15']
        # Neither week can change alone. This is a joint constraint, not a sector split.
        model.add(first == second)
        for day, variable in rests.items():
            if variable.index not in (first.index, second.index):
                model.add(variable == 0)
        coverage = model.new_int_var(0, 0, 'coverage')
        pads = [model.new_int_var(0, 0, 'padding:'+str(i)) for i in range(3000)]
        values = {v.index: int(v.index in (first.index, second.index)) for v in [*rests.values(), coverage, *pads]}
        values, proven, phases = improve(model, [coverage, first+second], values,
            time.monotonic()+3, ['COVERAGE', 'SUNDAY_BALANCE'])
        self.assertEqual(values[first.index]+values[second.index], 0)
        self.assertEqual(values[coverage.index], 0)
        self.assertFalse(proven)
        self.assertEqual(phases[-1]['searchScope'], 'ROLLING_WEEKS')


class WeekendPriorityTests(unittest.TestCase):
    def test_sunday_neighborhood_selection_does_not_follow_saturday_occupancy(self):
        model = cp_model.CpModel()
        rate = model.new_int_var(0, 10000, 'weekend-rate:6:p')
        variables, values = [rate], {rate.index: 5000}
        for day, value in [('2026-11-07', 0), ('2026-11-08', 1),
                           ('2026-11-14', 1), ('2026-11-15', 0),
                           ('2026-11-21', 0), ('2026-11-22', 1)]:
            variable = model.new_bool_var('weekend-occupied:p:'+day)
            variables.append(variable)
            values[variable.index] = value
        days = [(date(2026, 11, 2) + timedelta(days=i)).isoformat() for i in range(21)]
        self.assertEqual(_movable_weeks(variables, values, days, 'SUNDAY_BALANCE', 1), [0, 2])

    def test_saturday_gain_cannot_purchase_a_worse_sunday_rate(self):
        model = cp_model.CpModel()
        state = model.new_bool_var('trade')
        sunday = model.new_int_var(0, 1, 'sunday-total')
        saturday = model.new_int_var(0, 1, 'saturday-total')
        model.add(sunday == state)
        model.add(saturday + state == 1)
        values = {state.index: 1, sunday.index: 1, saturday.index: 0}
        goals = {6: {'a': (sunday, 2), 'b': (0, 2)},
                 5: {'a': (saturday, 1), 'b': (0, 1)}}
        sundays, saturdays = weekend_objectives(model, {'same': ['a', 'b']}, goals, Snapshot(values), values)
        # Independent exhaustive oracle: state 0 => (Sunday 0, Saturday 10000),
        # state 1 => (Sunday 5000, Saturday 0). A combined sum chooses state 1.
        model.minimize(sum(sundays) + sum(saturdays))
        combined = cp_model.CpSolver()
        self.assertEqual(combined.solve(model), cp_model.OPTIMAL)
        self.assertEqual(combined.value(state), 1)
        actual, proven, phases = improve(model, [sum(sundays), sum(saturdays)], values,
            time.monotonic()+2, ['SUNDAY_BALANCE', 'SATURDAY_BALANCE'],
            protected_groups={'SUNDAY_BALANCE': sundays})
        self.assertEqual(actual[state.index], 0)
        self.assertEqual([actual[v.index] for v in sundays+saturdays], [0, 10000])
        self.assertTrue(proven)
        self.assertTrue(all(p['searchScope'] == 'GLOBAL' for p in phases))
        self.assertEqual(phases[0]['initialValue'], 5000)

    def test_fixed_sunday_rest_is_not_counted_as_an_available_rotation_opportunity(self):
        data = fixture(people=3, weeks=2)
        data['employees'][0]['fixedOffDays'] = [6]
        seen = []
        def capture(*args, **kwargs):
            seen.append(args[2][6]['p0'][1])
            return weekend_objectives(*args, **kwargs)
        with patch('candidate_solver.weekend_objectives', capture):
            result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertEqual(seen, [0])
        self.assertTrue(all(a['kind'] == 'OFF' for a in result['assignments']
            if a['employeeId'] == 'p0' and date.fromisoformat(a['date']).weekday() == 6))

    def test_explicit_unavailability_is_excluded_but_an_unlocked_draft_rest_is_available(self):
        data = fixture(people=1, weeks=6)
        person, policy = data['employees'][0], data['policy']
        days = ['2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13']
        policy['closedDates'], policy['holidayDates'] = ['2026-11-29'], ['2026-12-06']
        baseline = {
            ('p0', '2026-11-08'): {'kind': 'ABSENCE'},
            ('p0', '2026-11-15'): {'kind': 'OFF', 'locked': True},
            ('p0', '2026-11-22'): {'kind': 'OFF'},
        }
        self.assertEqual(available_weekends(person, days, baseline, policy), ['2026-11-22', '2026-12-13'])
        policy['_simulation'] = True
        self.assertEqual(available_weekends(person, days, baseline, policy), ['2026-11-22', '2026-12-06', '2026-12-13'])
        person['fixedOffDays'] = [6]
        self.assertEqual(available_weekends(person, days, baseline, policy), [])

    def test_a_group_without_available_sundays_is_not_a_rotation_debt(self):
        model = cp_model.CpModel()
        values = {}
        totals = {6: {'absent': (0, 0), 'present': (1, 2)},
                  5: {'absent': (0, 0), 'present': (0, 2)}}
        sundays, saturdays = weekend_objectives(model, {'same': ['absent', 'present']},
            totals, Snapshot(values), values)
        self.assertEqual((sundays, saturdays), ([], []))
        self.assertEqual(len(model.proto.variables), 0)

    def test_later_preference_cannot_move_sunday_imbalance_to_another_group(self):
        model = cp_model.CpModel()
        a, b = model.new_int_var(0, 2, 'group-a'), model.new_int_var(0, 2, 'group-b')
        preference = model.new_bool_var('preference')
        model.add_allowed_assignments([a, b, preference], [(2, 0, 1), (0, 2, 0)])
        native = cp_model.CpSolver.solve
        calls = []
        def first_unknown(engine, current, *args, **kwargs):
            calls.append(True)
            return cp_model.UNKNOWN if len(calls) == 1 else native(engine, current, *args, **kwargs)
        with patch.object(cp_model.CpSolver, 'solve', first_unknown):
            actual, proven, phases = improve(model, [a+b, preference],
                {a.index: 2, b.index: 0, preference.index: 1}, time.monotonic()+2,
                ['SUNDAY_BALANCE', 'PREFERENCES'], protected_groups={'SUNDAY_BALANCE': [a, b]})
        self.assertEqual([actual[v.index] for v in (a, b, preference)], [2, 0, 1])
        self.assertFalse(proven)
        self.assertEqual(phases[0]['status'], 'UNKNOWN')

    def test_incidental_group_improvement_remains_protected(self):
        model = cp_model.CpModel()
        a, b = model.new_int_var(0, 2, 'group-a'), model.new_int_var(0, 2, 'group-b')
        saturday, preference = model.new_bool_var('saturday'), model.new_bool_var('preference')
        model.add_allowed_assignments([a, b, saturday, preference],
            [(2, 2, 1, 1), (1, 1, 0, 1), (0, 2, 0, 0)])
        native = cp_model.CpSolver.solve
        calls = []
        def choose_incidental_gain(engine, current, *args, **kwargs):
            calls.append(True)
            if len(calls) == 1:
                return cp_model.UNKNOWN
            if len(calls) == 2:
                current = current.clone()
                current.add(current.get_int_var_from_proto_index(a.index) == 1)
                current.add(current.get_int_var_from_proto_index(b.index) == 1)
            return native(engine, current, *args, **kwargs)
        with patch.object(cp_model.CpSolver, 'solve', choose_incidental_gain):
            actual, proven, _ = improve(model, [a+b, saturday, preference],
                {a.index: 2, b.index: 2, saturday.index: 1, preference.index: 1}, time.monotonic()+2,
                ['SUNDAY_BALANCE', 'SATURDAY_BALANCE', 'PREFERENCES'],
                protected_groups={'SUNDAY_BALANCE': [a, b]})
        self.assertEqual([actual[v.index] for v in (a, b, saturday, preference)], [1, 1, 0, 1])
        self.assertFalse(proven)


class CooperativeControlTests(unittest.TestCase):
    class Cancelled(Exception):
        pass

    class Control:
        def __init__(self, stop_on_solve=None, stop_on_checkpoint=None):
            self.searches, self.checks = 0, 0
            self.stop_on_solve, self.stop_on_checkpoint = stop_on_solve, stop_on_checkpoint

        def checkpoint(self):
            self.checks += 1
            if self.checks == self.stop_on_checkpoint:
                raise CooperativeControlTests.Cancelled()

        def solve(self, engine, model):
            self.searches += 1
            if self.searches == self.stop_on_solve:
                raise CooperativeControlTests.Cancelled()
            return engine.solve(model)

    def test_control_runs_seed_and_later_searches_without_changing_input(self):
        import copy
        data = fixture(people=3)
        original = copy.deepcopy(data)
        control = self.Control()
        result = solve(data, control=control)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertGreater(control.checks, 10)
        self.assertGreater(control.searches, 1)
        self.assertEqual(data, original)

    def test_cancel_during_construction_propagates_without_a_mathematical_status(self):
        with self.assertRaises(self.Cancelled):
            solve(fixture(), control=self.Control(stop_on_checkpoint=3))

    def test_cancel_during_later_search_propagates_without_assignments(self):
        with self.assertRaises(self.Cancelled):
            solve(fixture(people=3), control=self.Control(stop_on_solve=2))

    def test_unattempted_goals_are_reported_without_fabricating_phase_results(self):
        native = improve
        def no_time(model, objectives, values, deadline, *args, **kwargs):
            return native(model, objectives, values, time.monotonic()-1, *args, **kwargs)
        with patch('candidate_solver.improve', no_time):
            result = solve(fixture(people=3))
        self.assertEqual(result['status'], 'FEASIBLE')
        self.assertEqual(result['optimization']['phases'], [])
        self.assertIn('SUNDAY_BALANCE', result['optimization']['unattemptedObjectives'])
        self.assertEqual(len(result['assignments']), 21)


if __name__ == '__main__':
    unittest.main()
