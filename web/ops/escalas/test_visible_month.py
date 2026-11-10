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

    def test_closing_coverage_improves_without_a_sunday_or_total_trade(self):
        monday, sunday, border = '2026-11-02', '2026-11-08', '2026-12-06'
        sector = 'Reposição'
        data = {'startDate': '2026-10-26', 'endDate': border, 'storeClosingMinutes': 1200, 'demands': [
            {'date': monday, 'sector': sector, 'start': 1080, 'end': 1140, 'minimum': 1, 'estimated': True},
            {'date': monday, 'sector': sector, 'start': 1140, 'end': 1200, 'minimum': 2, 'estimated': True},
            {'date': sunday, 'sector': sector, 'start': 1080, 'end': 1140, 'minimum': 1, 'estimated': True},
            {'date': border, 'sector': sector, 'start': 1140, 'end': 1200, 'minimum': 1, 'estimated': True},
        ]}
        model = cp_model.CpModel()
        early, late, sun, extra = [model.new_bool_var(name) for name in ('early', 'late', 'sun', 'extra')]
        model.add(early + late == 1)
        model.add(sun + extra == 1)  # A second closer would cost Sunday's coverage.
        employees = [{'id': pid, 'sector': sector, 'role': 'Repositor', 'history': []} for pid in ('p', 'q')]
        choices = {('p', monday): {'early': early, 'late': late}, ('q', monday): {'late': extra},
                   ('q', sunday): {'early': sun}}
        shifts = {'early': {'segments': [{'start': 1080, 'end': 1140, 'kind': 'WORK'}]},
                  'late': {'segments': [{'start': 1140, 'end': 1200, 'kind': 'WORK'}]}}
        initial = {early.index: 1, late.index: 0, sun.index: 1, extra.index: 0}
        sectors, sundays, closing = {}, {}, {}
        coverage = sum(_coverage(model, data, employees, choices, shifts, time.monotonic(),
                                 'ESTIMATED', initial, sundays, sectors, closing_terms=closing))
        sunday_coverage = sum(sundays[sector])
        closing_coverage = sum(closing[sector])
        goals = [coverage, sunday_coverage, closing_coverage]
        self.assertEqual([Snapshot(initial).value(goal) for goal in goals], [180, 60, 120])
        actual, _, phases = improve(
            model, goals, initial, time.monotonic() + 2,
            ['COVERAGE', 'SUNDAY_COVERAGE', 'CLOSING_COVERAGE'],
            protected_groups={'COVERAGE': [coverage, sunday_coverage, closing_coverage]})
        self.assertEqual([Snapshot(actual).value(goal) for goal in goals], [180, 60, 60])
        self.assertEqual([actual[late.index], actual[sun.index], actual[extra.index]], [1, 1, 0])
        self.assertEqual(phases[-1]['objective'], 'CLOSING_COVERAGE')
        self.assertEqual(phases[-1]['incumbentValue'], 60)

    def test_closing_at_midnight_only_weights_the_last_hour_and_reuses_gaps(self):
        day = '2026-11-02'
        data = {'startDate': day, 'endDate': '2026-11-08', 'storeClosingMinutes': 1440, 'demands': [
            {'date': day, 'sector': 'Caixa', 'start': 1365, 'end': 1440, 'minimum': 1, 'estimated': True},
        ]}
        model = cp_model.CpModel()
        works = model.new_bool_var('works')
        person = {'id': 'p', 'sector': 'Caixa', 'role': 'Caixa', 'history': []}
        shifts = {'late': {'segments': [{'start': 1380, 'end': 1410, 'kind': 'WORK'},
                                       {'start': 1410, 'end': 1440, 'kind': 'PAID_BREAK'}]}}
        choices = {('p', day): {'late': works}}
        without_closing = model.clone()
        _coverage(without_closing, data, [person], choices, shifts, time.monotonic(), 'ESTIMATED')
        values, closing = {works.index: 1}, {}
        total = _coverage(model, data, [person], choices, shifts, time.monotonic(),
                          'ESTIMATED', values, closing_terms=closing)
        self.assertEqual(len(model.proto.variables), len(without_closing.proto.variables))
        self.assertEqual(Snapshot(values).value(sum(total)), 45)
        self.assertEqual(Snapshot(values).value(sum(closing['Caixa'])), 30)

if __name__ == '__main__':
    unittest.main()
