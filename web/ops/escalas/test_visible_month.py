"""Regression for the shared TS/Python legacy visible-month presentation contract."""
import copy
import time
import unittest

from ortools.sat.python import cp_model
from optimization import Snapshot, improve
from solver import _coverage, _coverage_month


class VisibleMonthTests(unittest.TestCase):
    def test_infers_only_exact_calendar_month_horizons(self):
        for start, end, expected in [
            ('2026-10-26', '2026-12-06', '2026-11'),
            ('2025-12-29', '2026-02-01', '2026-01'),
            ('2028-01-31', '2028-03-05', '2028-02'),
            ('2026-02-23', '2026-04-05', '2026-03'),
            ('2026-11-02', '2026-11-08', None),
            ('2026-10-26', '2026-11-29', None),
            ('2026-11-01', '2026-12-05', None),
        ]:
            with self.subTest(start=start, end=end):
                data = {'startDate': start, 'endDate': end}
                before = copy.deepcopy(data)
                self.assertEqual(_coverage_month(data), expected)
                self.assertEqual(data, before)
        self.assertIsNone(_coverage_month({}))

    def test_explicit_visible_month_is_retained(self):
        data = {'startDate': '2026-09-28', 'endDate': '2026-11-08', 'visibleMonth': '2026-10'}
        self.assertEqual(_coverage_month(data), '2026-10')

    def test_legacy_month_guard_prevents_border_compensation(self):
        data = {'startDate': '2026-10-26', 'endDate': '2026-12-06', 'demands': [
            {'id': 'visible', 'date': '2026-11-01', 'sector': 'Reposição', 'start': 480, 'end': 600, 'minimum': 1, 'estimated': True},
            {'id': 'border', 'date': '2026-12-06', 'sector': 'Reposição', 'start': 480, 'end': 720, 'minimum': 1, 'estimated': True},
        ]}
        model = cp_model.CpModel()
        border, visible = model.new_bool_var('border'), model.new_bool_var('visible')
        model.add(border + visible == 1)
        people = [{'id': 'p0', 'sector': 'Reposição', 'role': 'Repositor', 'activeFrom': '2020-01-01', 'history': []}]
        choices = {('p0', '2026-12-06'): {'day': border}, ('p0', '2026-11-01'): {'day': visible}}
        shifts = {'day': {'id': 'day', 'segments': [{'start': 480, 'end': 720, 'kind': 'WORK'}]}}
        values = {border.index: 0, visible.index: 1}
        sectors, sundays, monthly_sectors, monthly_sundays = {}, {}, {}, {}
        goals = _coverage(model, data, people, choices, shifts, time.monotonic(), 'ESTIMATED', values, sundays, sectors, monthly_sundays, monthly_sectors)
        self.assertEqual(Snapshot(values).value(sum(monthly_sectors['Reposição'])), 0)
        self.assertEqual(Snapshot(values).value(sum(monthly_sundays['Reposição'])), 0)
        guards = [sum(terms) for scope in (sectors, sundays, monthly_sectors, monthly_sundays) for terms in scope.values()]
        result, _, _ = improve(model, [sum(goals)], values, time.monotonic() + 1, ['COVERAGE'], protected_groups={'COVERAGE': guards})
        self.assertEqual(result[visible.index], 1)
        self.assertEqual(Snapshot(result).value(sum(goals)), 240)


if __name__ == '__main__':
    unittest.main()
