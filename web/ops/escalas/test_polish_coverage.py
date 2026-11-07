"""Coverage-focused polish regressions using the production optimizer."""
import time
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model
import optimization
from optimization import Snapshot, _polish_people, improve


class CoveragePolishTests(unittest.TestCase):
    class DeferredSearch:
        """Leave earlier phases unfinished, then run the real joint CP-SAT model."""
        def __init__(self):
            self.calls = 0

        def checkpoint(self):
            pass

        def solve(self, engine, model):
            self.calls += 1
            return cp_model.UNKNOWN if self.calls <= 2 else engine.solve(model)

    def test_joint_polish_reduces_real_weekend_gaps_after_unfinished_searches(self):
        model = cp_model.CpModel()
        days = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
        work = {(pid, day): model.new_bool_var(f'w:{pid}:{day}')
                for pid in ('p', 'q') for day in days}
        for pid in ('p', 'q'):
            model.add(sum(work[pid, day] for day in days) == 2)
        gaps = {}
        for day in days[2:]:
            present = sum(work[pid, day] for pid in ('p', 'q'))
            model.add(present <= 1)
            gaps[day] = model.new_int_var(0, 1, f'gap:{day}')
            model.add(gaps[day] == 1 - present)
        coverage, sunday = sum(gaps.values()), gaps[days[-1]]
        stability = sum(1 - work[pid, day] for pid in ('p', 'q') for day in days[2:])
        preference = -sum(1 - work[pid, days[0]] for pid in ('p', 'q'))
        values = {variable.index: int(day in days[:2]) for (pid, day), variable in work.items()}
        values.update({variable.index: 1 for variable in gaps.values()})
        control = self.DeferredSearch()
        actual, proven, phases = improve(model, [coverage, sunday, stability, preference], values,
            time.monotonic() + 2, ['COVERAGE', 'SUNDAY_COVERAGE', 'STABILITY', 'PREFERENCES'],
            control=control, protected_groups={'COVERAGE': [coverage, sunday]})
        snapshot = Snapshot(actual)
        self.assertEqual([snapshot.value(coverage), snapshot.value(sunday)], [0, 0])
        self.assertEqual(snapshot.value(stability), 2)
        self.assertEqual(snapshot.value(preference), -2)
        for pid in ('p', 'q'):
            self.assertEqual(sum(snapshot.value(work[pid, day]) for day in days), 2)
        self.assertEqual([phase['status'] for phase in phases[:2]], ['UNKNOWN', 'UNKNOWN'])
        self.assertEqual([phase['objective'] for phase in phases],
                         ['COVERAGE', 'SUNDAY_COVERAGE', 'STABILITY', 'PREFERENCES'])
        self.assertTrue(all(phase['incumbentValue'] <= phase['initialValue'] for phase in phases))
        self.assertFalse(proven)

    def test_joint_gain_cannot_be_funded_by_another_sector_or_its_sunday_loss(self):
        for protected in (False, True):
            with self.subTest(protected=protected):
                model = cp_model.CpModel()
                weekday_transfer = model.new_bool_var('weekday-transfer')
                sunday_transfer = model.new_bool_var('sunday-transfer')
                sector_a = model.new_int_var(0, 4, 'sector-a-gap')
                model.add(sector_a == 4 - 2 * weekday_transfer - 2 * sunday_transfer)
                sector_b = weekday_transfer
                sunday_a, sunday_b = 2 - 2 * sunday_transfer, sunday_transfer
                coverage = sector_a + sector_b + sunday_b
                sunday = sunday_a + sunday_b
                stability = 2 - weekday_transfer - sunday_transfer
                preference = -weekday_transfer - sunday_transfer
                values = {weekday_transfer.index: 0, sunday_transfer.index: 0, sector_a.index: 4}
                guards = {'COVERAGE': [sector_a, sector_b, sunday_a, sunday_b]} if protected else {}
                actual, proven, phases = improve(model, [coverage, sunday, stability, preference], values,
                    time.monotonic() + 2, ['COVERAGE', 'SUNDAY_COVERAGE', 'STABILITY', 'PREFERENCES'],
                    control=self.DeferredSearch(), protected_groups=guards)
                snapshot = Snapshot(actual)
                self.assertEqual([actual[weekday_transfer.index], actual[sunday_transfer.index]],
                                 [0, 0] if protected else [1, 1])
                self.assertEqual(snapshot.value(coverage), 4 if protected else 2)
                if protected:
                    self.assertEqual(snapshot.value(sector_b), 0)
                    self.assertEqual(snapshot.value(sunday_b), 0)
                self.assertTrue(all(phase['incumbentValue'] <= phase['initialValue']
                                    for phase in phases))
                self.assertFalse(proven)

    def test_shortage_releases_whole_sector_even_when_other_changed_people_have_no_gap(self):
        model = cp_model.CpModel()
        deficient = [f'cashier:{index:02}' for index in range(34)]
        changed_peers = [f'admin:{index:02}' for index in range(20)]
        variables = [model.new_bool_var('changed:' + pid) for pid in deficient + changed_peers]
        values = {variable.index: int(index >= len(deficient)) for index, variable in enumerate(variables)}
        cash_gap = model.new_int_var(0, 100, 'cash-gap')
        admin_gap = model.new_int_var(0, 100, 'admin-gap')
        cash_sunday = model.new_int_var(0, 10, 'cash-sunday')
        admin_sunday = model.new_int_var(0, 10, 'admin-sunday')
        values.update({cash_gap.index: 10, admin_gap.index: 0, cash_sunday.index: 2, admin_sunday.index: 0})
        selected = _polish_people(variables, values, [deficient, changed_peers],
            coverage_groups={'cash': deficient, 'admin': changed_peers},
            shortages={'cash': [cash_gap], 'admin': [admin_gap]},
            sunday_shortages={'cash': [cash_sunday], 'admin': [admin_sunday]})
        self.assertEqual(selected, set(deficient))

    def test_weekday_only_shortage_is_eligible_without_a_sunday_reference(self):
        model = cp_model.CpModel()
        bakery, cash = ['baker:1', 'baker:2'], ['cashier:1', 'cashier:2']
        changed = [model.new_bool_var('changed:' + pid) for pid in bakery + cash]
        values = {variable.index: int(index >= len(bakery)) for index, variable in enumerate(changed)}
        bakery_gap = model.new_int_var(0, 500, 'bakery-gap')
        cash_gap = model.new_int_var(0, 500, 'cash-gap')
        values.update({bakery_gap.index: 300, cash_gap.index: 0})
        selected = _polish_people(changed, values, [bakery, cash],
            coverage_groups={'bakery': bakery, 'cash': cash},
            shortages={'bakery': [bakery_gap], 'cash': [cash_gap]}, sunday_shortages={})
        self.assertEqual(selected, set(bakery))

    def test_impossible_empty_sector_does_not_hide_a_staffed_sector_with_gaps(self):
        model = cp_model.CpModel()
        bakery, cash = ['baker:1', 'baker:2'], ['cashier:1', 'cashier:2']
        changed = [model.new_bool_var('changed:' + pid) for pid in bakery + cash]
        values = {variable.index: int(index >= len(bakery)) for index, variable in enumerate(changed)}
        impossible = model.new_int_var(0, 10000, 'empty-gap')
        bakery_gap = model.new_int_var(0, 500, 'bakery-gap')
        values.update({impossible.index: 10000, bakery_gap.index: 300})
        selected = _polish_people(changed, values, [bakery, cash],
            coverage_groups={'empty': [], 'bakery': bakery, 'cash': cash},
            shortages={'empty': [impossible], 'bakery': [bakery_gap]})
        self.assertTrue(set(bakery).issubset(selected))
        self.assertEqual(selected, set(bakery))

    def test_large_deficient_sector_keeps_the_search_neighborhood_bounded(self):
        model = cp_model.CpModel()
        members = [f'person:{index:02}' for index in range(50)]
        changed = [model.new_bool_var('changed:' + pid) for pid in members]
        values = {variable.index: int(index >= 40) for index, variable in enumerate(changed)}
        shortage = model.new_int_var(0, 100, 'gap')
        values[shortage.index] = 50
        selected = _polish_people(changed, values, [members], coverage_groups={'sector': members},
            shortages={'sector': [shortage]})
        self.assertEqual(len(selected), 36)
        self.assertTrue(selected.issubset(set(members)))
        self.assertTrue(set(members[40:]).issubset(selected))


class ProtectedBoundDeduplicationTests(unittest.TestCase):
    @staticmethod
    def upper_bounds(model, variable):
        return [list(constraint.linear.domain)[-1]
                for constraint in model.proto.constraints
                if list(constraint.linear.vars) == [variable.index]
                and list(constraint.linear.coeffs) == [1]
                and list(constraint.linear.domain)[0] == -(2 ** 63)]

    def test_repeated_group_and_visited_bounds_are_registered_only_once(self):
        model = cp_model.CpModel()
        names = ['COVERAGE', 'SUNDAY_COVERAGE', 'SUNDAY_BALANCE',
                 'STABILITY', 'PREFERENCES']
        goals = [model.new_int_var(0, 4, name) for name in names]
        guard = model.new_int_var(0, 4, 'sector-guard')
        values = {variable.index: 1 for variable in goals + [guard]}
        for variable in goals + [guard]:
            model.add(variable == 1)
        with patch.object(optimization, '_upper_bound_key',
                          wraps=optimization._upper_bound_key) as normalized:
            result, proven, phases = improve(
                model, goals, values, time.monotonic() + 1, names,
                protected_groups={'COVERAGE': [guard, guard + 2]})
        guard_offsets = [call.args[0][2] for call in normalized.call_args_list
                         if call.args[0][0] == (guard.index,)]
        self.assertEqual(guard_offsets, [0, 2])
        self.assertEqual(result, values)
        self.assertFalse(proven)
        self.assertEqual(len(phases), 5)
        self.assertTrue(all(phase['status'] == 'OPTIMAL' for phase in phases))
        self.assertEqual(self.upper_bounds(model, guard), [1])
        self.assertEqual(self.upper_bounds(model, goals[0]), [1])

    def test_tightened_guard_is_added_and_cannot_be_lost_later(self):
        model = cp_model.CpModel()
        first = model.new_int_var(0, 2, 'coverage')
        later = model.new_bool_var('later')
        guard = model.new_int_var(0, 2, 'sector-guard')
        model.add_allowed_assignments([first, later, guard],
                                      [(2, 1, 2), (1, 1, 0), (1, 0, 1)])
        values = {first.index: 2, later.index: 1, guard.index: 2}
        seen = []

        class ObserveSearch:
            def checkpoint(self):
                pass

            def solve(self, engine, current):
                if not seen:
                    current.add(guard == 0)
                status = engine.solve(current)
                seen.append((engine.value(first), engine.value(later),
                             engine.value(guard)))
                return status

        result, _, _ = improve(
            model, [first, later], values, time.monotonic() + 1,
            ['COVERAGE', 'SUNDAY_COVERAGE'], control=ObserveSearch(),
            protected_groups={'COVERAGE': [guard]})
        self.assertEqual(seen, [(1, 1, 0), (1, 1, 0)])
        self.assertEqual(result[guard.index], 0)
        self.assertEqual(self.upper_bounds(model, guard), [2, 0])

    def test_duplicate_group_provenance_stays_conservative(self):
        model = cp_model.CpModel()
        goals = [model.new_int_var(0, 2, name) for name in ('a', 'b')]
        guard = model.new_int_var(0, 2, 'guard')
        values = {variable.index: 1 for variable in goals + [guard]}
        for variable in goals + [guard]:
            model.add(variable == 1)
        _, proven, _ = improve(
            model, goals, values, time.monotonic() + 1,
            ['COVERAGE', 'SUNDAY_COVERAGE'],
            protected_groups={'COVERAGE': [guard, guard]})
        self.assertFalse(proven)
        self.assertEqual(self.upper_bounds(model, guard), [1])


if __name__ == '__main__':
    unittest.main()
