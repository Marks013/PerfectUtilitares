"""Coverage-focused polish regressions using the production optimizer."""
import time
import unittest

from ortools.sat.python import cp_model
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
        self.assertEqual(phases[-1]['objective'], 'SECONDARY_POLISH')
        members = {member['objective']: member for member in phases[-1]['members']}
        self.assertEqual(set(members), {'COVERAGE', 'SUNDAY_COVERAGE', 'STABILITY', 'PREFERENCES'})
        self.assertTrue(all(member['incumbentValue'] <= member['initialValue'] for member in members.values()))
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
                self.assertTrue(all(member['incumbentValue'] <= member['initialValue']
                                    for member in phases[-1]['members']))
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


if __name__ == '__main__':
    unittest.main()
