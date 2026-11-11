from optimization import ImprovementContext
"""Operational priorities remain movable without sacrificing protected coverage."""
import time
import unittest

from ortools.sat.python import cp_model
from optimization import _phase_budget, _polish_people, improve
from solver import _rest_repair_groups
from test_solver import fixture


class PolishPriorityTests(unittest.TestCase):
    def test_rest_improvement_may_change_an_initially_unchanged_roster(self):
        model = cp_model.CpModel()
        moved = model.new_bool_var('moved')
        distribution = 1 - moved
        stability = moved
        values, _, phases = improve(
            model, [distribution, stability], {moved.index: 0},
            time.monotonic() + 1, ['REST_DISTRIBUTION', 'STABILITY'])
        self.assertEqual(values[moved.index], 1)
        self.assertEqual([p['objective'] for p in phases], ['REST_DISTRIBUTION', 'STABILITY'])
        self.assertEqual(phases[0]['incumbentValue'], 0)
        self.assertEqual(phases[1]['incumbentValue'], 1)

    def test_lower_priority_cannot_undo_rest_improvement(self):
        model = cp_model.CpModel()
        moved = model.new_bool_var('moved')
        values, _, _ = improve(
            model, [1 - moved, moved, moved], {moved.index: 0},
            time.monotonic() + 1, ['REST_DISTRIBUTION', 'STABILITY', 'TIE_BREAK'])
        self.assertEqual(values[moved.index], 1)

    def test_rest_improvement_cannot_spend_another_sectors_coverage(self):
        model = cp_model.CpModel()
        moved = model.new_bool_var('moved')
        coverage = model.new_int_var(0, 1, 'coverage')
        model.add(coverage == moved)
        values, _, _ = improve(
            model, [coverage, 1 - moved, moved], {moved.index: 0, coverage.index: 0},
            time.monotonic() + 1, ['COVERAGE', 'REST_DISTRIBUTION', 'STABILITY'],
            context=ImprovementContext(protected_groups={'COVERAGE': [coverage]}))
        self.assertEqual(values[moved.index], 0)
        self.assertEqual(values[coverage.index], 0)

    def test_remaining_goals_receive_equal_not_geometric_shares(self):
        names = ['COVERAGE', 'SUNDAY_COVERAGE', 'SUNDAY_BALANCE',
                 'REST_DISTRIBUTION', 'REST_ROTATION', 'STABILITY', 'TIE_BREAK']
        self.assertEqual(_phase_budget(8, names, 3), 2)
        self.assertEqual(_phase_budget(6, names, 4), 2)
        self.assertEqual(_phase_budget(4, names, 5), 2)
        self.assertEqual(_phase_budget(2, names, 6), 2)

    def test_sector_choice_uses_deficit_before_number_of_changed_people(self):
        model = cp_model.CpModel()
        a = model.new_bool_var('changed:a')
        b = model.new_bool_var('changed:b')
        gap_a = model.new_int_var(0, 100, 'gap-a')
        gap_b = model.new_int_var(0, 100, 'gap-b')
        values = {a.index: 0, b.index: 1, gap_a.index: 50, gap_b.index: 1}
        selected = _polish_people([a, b], values, [['a'], ['b']],
            coverage_groups={'a': ['a'], 'b': ['b']},
            shortages={'a': [gap_a], 'b': [gap_b]})
        self.assertEqual(selected, {'a'})

    def test_sector_choice_rotates_instead_of_reexamining_only_the_first(self):
        model = cp_model.CpModel()
        a = model.new_bool_var('changed:a')
        b = model.new_bool_var('changed:b')
        gap_a = model.new_int_var(0, 100, 'gap-a')
        gap_b = model.new_int_var(0, 100, 'gap-b')
        values = {a.index: 0, b.index: 0, gap_a.index: 50, gap_b.index: 10}
        args = dict(coverage_groups={'a': ['a'], 'b': ['b']},
                    shortages={'a': [gap_a], 'b': [gap_b]})
        self.assertEqual(_polish_people([a, b], values, [['a'], ['b']], attempt=0, **args), {'a'})
        self.assertEqual(_polish_people([a, b], values, [['a'], ['b']], attempt=1, **args), {'b'})


class SingletonRepairTests(unittest.TestCase):
    def test_single_timed_person_with_a_positive_empty_day_is_eligible(self):
        data = fixture(42, people=1)
        model = cp_model.CpModel()
        day = '2026-11-08'
        variable = model.new_bool_var('work')
        groups = _rest_repair_groups(data['employees'], [day], {('p0', day): variable}, {},
            {variable.index: 0}, data['policy'],
            [{'sector': 'Reposição', 'date': day, 'minimum': 1}])
        self.assertEqual(groups, [{'p0'}])

    def test_single_available_peer_after_absence_is_eligible(self):
        data = fixture(42, people=2)
        model = cp_model.CpModel()
        day = '2026-11-08'
        work = {(p['id'], day): model.new_bool_var(p['id']) for p in data['employees']}
        baseline = {('p1', day): {'kind': 'ABSENCE'}}
        groups = _rest_repair_groups(data['employees'], [day], work, baseline,
            {v.index: 0 for v in work.values()}, data['policy'],
            [{'sector': 'Reposição', 'date': day, 'minimum': 1}])
        self.assertEqual(groups, [{'p0', 'p1'}])

    def test_partial_deficit_is_repaired_without_waiting_for_an_empty_day(self):
        data = fixture(42, people=2)
        model = cp_model.CpModel()
        day = '2026-11-08'
        work = {(p['id'], day): model.new_bool_var(p['id']) for p in data['employees']}
        shortage = model.new_int_var(0, 504, 'shortage')
        values = {v.index: 1 for v in work.values()}
        values[shortage.index] = 100
        groups = _rest_repair_groups(data['employees'], [day], work, {}, values,
            data['policy'], [{'sector': 'Reposição', 'date': day, 'minimum': 2}],
            sector_shortages={'Reposição': [shortage]})
        self.assertEqual(groups, [{'p0', 'p1'}])


if __name__ == '__main__':
    unittest.main()
