"""Independent rest equivalence and bounded-search regression cases."""
import itertools
import time
import unittest
from unittest.mock import patch
from datetime import date, timedelta

from ortools.sat.python import cp_model
from solver import _rest, instant, shift_metrics
from test_solver import fixture


class RestEquivalenceTests(unittest.TestCase):
    def check_schedule(self, events, off_dates, expected):
        data = fixture()
        person = data['employees'][0]
        shifts = {
            'early': {'segments': [{'start': 300, 'end': 804, 'kind': 'WORK'}]},
            'late': {'segments': [{'start': 840, 'end': 1344, 'kind': 'WORK'}]},
            'night': {'segments': [{'start': 1200, 'end': 1704, 'kind': 'WORK'}]},
        }
        metrics = {sid: shift_metrics(s) for sid, s in shifts.items()}
        dates = ['2026-11-02', '2026-11-03', '2026-11-04']
        model = cp_model.CpModel()
        choices, off, prior = {}, {}, {}
        for day, sid in events:
            if day in dates:
                options = {key: model.new_bool_var(day + key) for key in shifts}
                for key, var in options.items():
                    model.add(var == int(key == sid))
                choices[person['id'], day] = options
            else:
                prior[day] = {'kind': 'WORK', 'shiftId': sid}
        for day in dates:
            off[person['id'], day] = int(day in off_dates)
        _rest(model, person, dates, choices, off, prior, shifts, metrics, data['policy'])
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model) in (cp_model.OPTIMAL, cp_model.FEASIBLE), expected,
                         (events, off_dates))

    def test_enumerated_clocks_match_original_pairwise_rest_specification(self):
        clocks = {'early': (300, 804), 'late': (840, 1344), 'night': (1200, 1704)}
        for first_day, second_day in [('2026-11-01', '2026-11-02'),
                                      ('2026-11-02', '2026-11-03'),
                                      ('2026-11-02', '2026-11-04'),
                                      ('2026-11-04', '2026-11-05')]:
            for left, right, rested in itertools.product(clocks, clocks, (False, True)):
                gap = instant(second_day, clocks[right][0]) - instant(first_day, clocks[left][1])
                delta = (date.fromisoformat(second_day) - date.fromisoformat(first_day)).days
                expected = gap >= 660 and not (delta > 1 and rested and gap < 2100)
                self.check_schedule([(first_day, left), (second_day, right)],
                                    {'2026-11-03'} if rested else set(), expected)

    def test_rest_construction_grows_by_days_not_pairs_of_alternative_shifts(self):
        data = fixture(people=1, weeks=6)
        person = data['employees'][0]
        dates = [(date(2026, 11, 2) + timedelta(days=i)).isoformat() for i in range(42)]
        shifts = {f's{i}': {'segments': [{'start': 300 + i * 45, 'end': 804 + i * 45, 'kind': 'WORK'}]}
                  for i in range(12)}
        metrics = {sid: shift_metrics(s) for sid, s in shifts.items()}
        model = cp_model.CpModel()
        choices, off = {}, {}
        for day in dates:
            options = {sid: model.new_bool_var(day + sid) for sid in shifts}
            model.add(sum(options.values()) <= 1)
            choices[person['id'], day] = options
            off[person['id'], day] = model.new_bool_var('off' + day)
        initial = len(model.proto.constraints)
        _rest(model, person, dates, choices, off, {}, shifts, metrics, data['policy'])
        self.assertLess(len(model.proto.constraints) - initial, 450)


class SearchContinuationTests(unittest.TestCase):
    def test_unknown_phase_preserves_incumbent_and_runs_next_real_objective(self):
        from optimization import improve
        model = cp_model.CpModel()
        x, y = model.new_bool_var('coverage'), model.new_bool_var('preference')
        model.add(x + y >= 1)
        native = cp_model.CpSolver.solve
        calls = []
        def first_unknown(engine, current, *args, **kwargs):
            calls.append(len(current.proto.objective.vars))
            if len(calls) == 1:
                return cp_model.UNKNOWN
            return native(engine, current, *args, **kwargs)
        with patch.object(cp_model.CpSolver, 'solve', first_unknown):
            values, proven, phases = improve(model, [x, y], {x.index: 1, y.index: 1}, time.monotonic() + 2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(values[y.index], 0)
        self.assertFalse(proven)
        self.assertEqual([phase['status'] for phase in phases], ['UNKNOWN', 'OPTIMAL'])

    def test_incidental_improvement_of_prior_goal_cannot_be_lost_later(self):
        from optimization import improve
        model = cp_model.CpModel()
        coverage = model.new_int_var(0, 2, 'coverage')
        distribution, preference = model.new_bool_var('distribution'), model.new_bool_var('preference')
        model.add_allowed_assignments([coverage, distribution, preference], [(2, 1, 1), (0, 0, 1), (1, 0, 0)])
        original = cp_model.CpSolver.solve
        calls = []
        def choose_improved_coverage(engine, current, *args, **kwargs):
            calls.append(True)
            if len(calls) == 1:
                return cp_model.UNKNOWN
            if len(calls) == 2:
                clone = current.clone()
                clone.add(clone.get_int_var_from_proto_index(coverage.index) == 0)
                return original(engine, clone, *args, **kwargs)
            return original(engine, current, *args, **kwargs)
        with patch.object(cp_model.CpSolver, 'solve', choose_improved_coverage):
            values, proven, _ = improve(model, [coverage, distribution, preference],
                {coverage.index: 2, distribution.index: 1, preference.index: 1}, time.monotonic() + 2)
        self.assertEqual([values[v.index] for v in (coverage, distribution, preference)], [0, 0, 1])
        self.assertFalse(proven)

    def test_all_nonempty_goals_run_with_a_real_baseline_and_preferences(self):
        import solver as scheduling
        data = fixture(people=3, weeks=1)
        days = scheduling.days_between(data['startDate'], data['endDate'])
        data['assignments'] = [{'employeeId': p['id'], 'date': day,
            'kind': 'WORK' if index < 5 else 'OFF', **({'shiftId': 'day'} if index < 5 else {})}
            for p in data['employees'] for index, day in enumerate(days)]
        for person in data['employees']:
            person['preferredOffDays'] = [4]
        data['demands'] = [{'date': days[0], 'sector': 'Reposição', 'start': 480,
                            'end': 720, 'minimum': 2, 'estimated': True}]
        result = scheduling.solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        phases = result['optimization']['phases']
        self.assertEqual([phase['objective'] for phase in phases], ['COVERAGE', 'WEEKEND_BALANCE',
            'REST_DISTRIBUTION', 'REST_ROTATION', 'PEOPLE_CHANGED', 'STABILITY', 'PREFERENCES', 'TIE_BREAK'])
        self.assertTrue(all(phase['status'] in ('OPTIMAL', 'FEASIBLE') for phase in phases))
        self.assertEqual(len(result['assignments']), 21)

    def test_secondary_goal_never_worsens_incumbent_coverage(self):
        from optimization import improve
        model = cp_model.CpModel()
        shortage, preference = model.new_bool_var('shortage'), model.new_bool_var('preference')
        model.add(shortage + preference >= 1)
        values, proven, phases = improve(model, [shortage, preference],
                                         {shortage.index: 0, preference.index: 1}, time.monotonic() + 2)
        self.assertEqual(values[shortage.index], 0)
        self.assertEqual(values[preference.index], 1)
        self.assertTrue(proven)
        self.assertTrue(phases)


if __name__ == '__main__':
    unittest.main()
