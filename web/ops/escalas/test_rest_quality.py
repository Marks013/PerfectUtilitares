"""Monthly pair semantics and bounded refinement independently exercised."""
import unittest
from datetime import date, timedelta
from ortools.sat.python import cp_model
from hints import _spacing_rank
from optimization import Snapshot, _phase_budget
from rest_quality import rest_pair_summary, build_rest_quality
from leadership import leadership_objective
from test_solver import fixture, make_untimed


class RestQualityTests(unittest.TestCase):
    def data(self):
        data = fixture(40, people=1, weeks=5, start_date='2026-11-30')
        data['visibleMonth'] = '2026-12'
        person = data['employees'][0]
        person['history'] = []
        make_untimed(person)
        data['assignments'] = [{'employeeId': 'p0', 'date': day, 'kind': 'DUTY'}
            for day in [(date.fromisoformat(data['startDate']) + timedelta(days=i)).isoformat() for i in range(35)]]
        return data

    def off(self, data, *days, locked=False):
        for item in data['assignments']:
            if item['date'] in days:
                item.update(kind='OFF', locked=locked)

    def test_pair_belongs_to_second_day_and_does_not_invent_unknown_boundary(self):
        data = self.data()
        self.off(data, '2026-11-30', '2026-12-01', '2026-12-31', '2027-01-01')
        summary = rest_pair_summary(data)
        self.assertEqual((summary['totalPairs'], summary['adjustablePairs']), (1, 1))
        data['assignments'] = [item for item in data['assignments'] if item['date'] != '2026-11-30']
        self.assertEqual(rest_pair_summary(data)['totalPairs'], 0)

    def test_forced_excess_is_reported_but_does_not_create_adjustable_allowance(self):
        data = self.data()
        self.off(data, '2026-12-02', '2026-12-03', '2026-12-09', '2026-12-10', locked=True)
        self.off(data, '2026-12-16', '2026-12-17')
        summary = rest_pair_summary(data)
        self.assertEqual((summary['totalPairs'], summary['imposedPairs'], summary['adjustablePairs'], summary['correctableExcess']), (3, 2, 1, 1))
        for item in data['assignments']:
            if item['date'] == '2026-12-17': item['locked'] = True
            if item['date'] == '2026-12-16': item['locked'] = True
        self.assertEqual(rest_pair_summary(data)['correctableExcess'], 0)

    def test_absence_holiday_and_explicit_consecutive_preference_are_not_penalized(self):
        data = self.data()
        self.off(data, '2026-12-02', '2026-12-03')
        data['employees'][0]['offPattern'] = 'CONSECUTIVE'
        summary = rest_pair_summary(data)
        self.assertEqual((summary['totalPairs'], summary['adjustablePairs'], summary['correctableExcess']), (1, 0, 0))
        for kind in ('ABSENCE', 'HOLIDAY'):
            data['assignments'][3]['kind'] = kind
            self.assertEqual(rest_pair_summary(data)['totalPairs'], 0)

    def test_only_adjustable_excess_counts_and_second_day_respects_active_dates(self):
        data = self.data()
        self.off(data, '2026-12-02', '2026-12-03', '2026-12-09', '2026-12-10', '2026-12-16', '2026-12-17', locked=True)
        summary = rest_pair_summary(data)
        self.assertEqual((summary['totalPairs'], summary['peopleAboveTarget']), (3, 0))
        data['employees'][0]['activeFrom'] = '2026-12-10'
        data['employees'][0]['activeUntil'] = '2026-12-15'
        self.assertEqual(rest_pair_summary(data)['totalPairs'], 1)

    def test_objective_reduces_pairs_even_when_everyone_is_below_two(self):
        data = self.data()
        self.off(data, '2026-12-02', '2026-12-03')
        model, values, offs = cp_model.CpModel(), {}, {}
        for item in data['assignments']:
            var = model.new_bool_var('o:p0:'+item['date'])
            offs['p0', item['date']] = var
            values[var.index] = int(item['kind'] == 'OFF')
        quality = build_rest_quality(model, data, data['employees'], offs, values, [['p0']])
        self.assertGreater(Snapshot(values).value(quality['objective']), 0)
        self.assertEqual(Snapshot(values).value(quality['excess']['p0']), 0)
        model.minimize(quality['objective'])
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(quality['objective']), 0)

    def test_padding_pairs_cannot_be_transferred_to_another_person_outside_the_month(self):
        data = self.data()
        person = data['employees'][0]
        person['history'] = [{'employeeId': 'p0', 'date': '2026-11-29', 'kind': 'OFF'}]
        peer = {**person, 'id': 'p1', 'history': [{'employeeId': 'p1', 'date': '2026-11-29', 'kind': 'OFF'}]}
        data['employees'].append(peer)
        data['assignments'] += [{**item, 'employeeId': 'p1'} for item in data['assignments']]
        self.off(data, '2026-11-30')
        next(item for item in data['assignments'] if item['employeeId'] == 'p1' and item['date'] == '2026-11-30')['kind'] = 'DUTY'
        model, values, offs = cp_model.CpModel(), {}, {}
        state = model.new_bool_var('transfer')
        values[state.index] = 1
        for item in data['assignments']:
            var = model.new_bool_var('o:'+item['employeeId']+':'+item['date'])
            offs[item['employeeId'], item['date']] = var
            values[var.index] = int(item['kind'] == 'OFF')
            if item['date'] == '2026-11-30':
                model.add(var == (state if item['employeeId'] == 'p0' else 1-state))
            else:
                model.add(var == 0)
        quality = build_rest_quality(model, data, data['employees'], offs, values, [['p0', 'p1']])
        for expression in quality['guards']:
            model.add(expression <= Snapshot(values).value(expression))
        model.minimize(state)
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(state), 1)

    def test_hint_rank_penalizes_pairs_and_known_future_boundary_but_not_an_unknown_day(self):
        data = self.data()
        person, policy = data['employees'][0], data['policy']
        entries = {'2026-12-02': {'kind': 'OFF'}, '2026-12-03': {'kind': 'OFF'}}
        self.assertEqual(_spacing_rank(person, entries, {}, {}, policy), (0, 1))
        entries['2026-12-03'] = {'kind': 'DUTY'}
        self.assertEqual(_spacing_rank(person, entries, {}, {}, policy), (0, 0))
        self.assertEqual(_spacing_rank(person, entries, {'2026-12-01': {'kind': 'OFF'}}, {}, policy), (0, 1))

    def test_hint_excess_uses_the_visible_month_not_technical_padding(self):
        data = self.data()
        person = data['employees'][0]
        policy = {**data['policy'], '_visibleMonth': '2026-12'}
        entries = {day: {'kind': 'OFF'} for day in
                   ('2026-11-02', '2026-11-03', '2026-11-09', '2026-11-10',
                    '2026-12-02', '2026-12-03', '2026-12-09', '2026-12-10')}
        self.assertEqual(_spacing_rank(person, entries, {}, {}, policy), (0, 2))

    def test_coverage_budget_reserves_spacing_time_and_spacing_receives_it(self):
        from optimization import MIN_PHASE_BUDGET
        from test_sunday_production import production_goal_names
        names = production_goal_names()
        remaining, allocated = 10.0, {}
        for index, name in enumerate(names):
            allocated[name] = _phase_budget(remaining, names, index)
            remaining -= allocated[name]
        self.assertAlmostEqual(allocated['COVERAGE'], 5.5)
        self.assertGreaterEqual(allocated['REST_SPACING'], MIN_PHASE_BUDGET)
        self.assertGreaterEqual(allocated['UNTIMED_ROTATION'], MIN_PHASE_BUDGET)
        self.assertGreaterEqual(allocated['LEADERSHIP'], MIN_PHASE_BUDGET)
        self.assertAlmostEqual(sum(allocated.values()), 10.0)
        self.assertAlmostEqual(remaining, 0.0)

    def test_high_leadership_is_protected_without_inventing_hourly_coverage(self):
        data = fixture(40, people=2)
        for person in data['employees']:
            make_untimed(person)
            person['leadership'] = {'role': 'SECTOR', 'sectors': ['Reposição']}
        day = data['startDate']
        data['movementPriorities'] = [{'startDate': day, 'endDate': day, 'sector': 'Reposição', 'level': 'HIGH'}]
        model = cp_model.CpModel()
        variables = [model.new_bool_var('w:'+p['id']) for p in data['employees']]
        values = {variables[0].index: 1, variables[1].index: 0}
        work = {(p['id'], day): var for p, var in zip(data['employees'], variables)}
        terms, checks = leadership_objective(model, data, data['employees'], [day], work, values)
        model.minimize(sum(variables))
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(sum(engine.value(var) for var in variables), 1)


if __name__ == '__main__':
    unittest.main()
