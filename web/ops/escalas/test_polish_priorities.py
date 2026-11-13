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


class RepairOrderTests(unittest.TestCase):
    def test_magnitude_precedes_empty_days_with_sunday_and_empty_tiebreaks(self):
        cases = [
            ('TOTAL_BEFORE_EMPTY_SUNDAY', '2026-11-08', 0, 1, 0, 0, 0, 1000, False),
            ('TOTAL_BEFORE_EMPTY_WEEKDAY', '2026-11-04', 0, 1, 0, 100, 0, 1000, False),
            ('TOTAL_BEFORE_SUNDAY_DEFICIT', '2026-11-08', 1, 1, 100, 1, 100, 1000, False),
            ('TOTAL_DEFICIT', '2026-11-04', 1, 1, 0, 0, 100, 10, True),
            ('SUNDAY_TIEBREAK', '2026-11-08', 1, 1, 100, 1, 1000, 1000, True),
            ('EMPTY_TIEBREAK', '2026-11-08', 0, 1, 0, 0, 1000, 1000, True),
        ]
        for name, day, large_work, small_work, large_sunday, small_sunday, large_gap, small_gap, large_first in cases:
            with self.subTest(priority=name):
                data = fixture(42, people=11)
                model = cp_model.CpModel()
                large = {person['id'] for person in data['employees'][:9]}
                for person in data['employees']:
                    person['sector'] = 'Maior' if person['id'] in large else 'Menor'
                work = {(person['id'], day): model.new_bool_var(person['id']) for person in data['employees']}
                values = {variable.index: large_work if pid in large else small_work
                          for (pid, _), variable in work.items()}
                demands = [{'sector': sector, 'date': day, 'minimum': 1} for sector in ('Maior', 'Menor')]
                groups = _rest_repair_groups(data['employees'], [day], work, {}, values, data['policy'], demands,
                    sector_shortages={'Maior': [large_gap], 'Menor': [small_gap]},
                    sunday_shortages={'Maior': [large_sunday], 'Menor': [small_sunday]})
                small = {person['id'] for person in data['employees'][9:]}
                self.assertEqual(groups[0], large if large_first else small)
                self.assertEqual(groups[1], small if large_first else large)

    def test_four_group_cap_does_not_displace_a_higher_priority_large_sector(self):
        data = fixture(42, people=37)
        expected = []
        for index, person in enumerate(data['employees']):
            person['sector'] = str(min(index // 9, 4))
        for index in range(4):
            expected.append({person['id'] for person in data['employees'] if person['sector'] == str(index)})
        groups = _rest_repair_groups(data['employees'], ['2026-11-08'], {}, {}, {}, data['policy'], [],
            sector_shortages={str(index): [100 - 10 * index] for index in range(4)} | {'4': [1]})
        self.assertEqual(groups, expected)
        self.assertEqual(len(groups), 4)

    def test_small_union_retains_its_best_priority_and_sixteen_person_limit(self):
        data = fixture(42, people=26)
        for index, person in enumerate(data['employees']):
            person['sector'] = 'A' if index < 8 else 'B' if index < 16 else 'C' if index < 25 else 'D'
        groups = _rest_repair_groups(data['employees'], ['2026-11-08'], {}, {}, {}, data['policy'], [],
            sector_shortages={'A': [100], 'B': [10], 'C': [50], 'D': [5]})
        self.assertEqual(groups, [
            {person['id'] for person in data['employees'][:16]},
            {person['id'] for person in data['employees'][16:25]},
            {data['employees'][25]['id']},
        ])
        self.assertEqual(len(groups[0]), 16)


if __name__ == '__main__':
    unittest.main()
