"""Variable rests avoid three-day blocks without changing explicit decisions."""
import copy
import unittest
from datetime import date, timedelta

from ortools.sat.python import cp_model
from optimization import Snapshot, _phase_budget, _spacing_people
import solver
from solver import _rest_distribution, _rest_spacing, _streaks, solve
from test_solver import fixture, make_untimed


class VariableRestTests(unittest.TestCase):
    def window(self, off_mode="VARIABLE", baseline=None, prior=None, active=None):
        data = fixture(40)
        person = data["employees"][0]
        person["offMode"] = off_mode
        dates = ["2026-11-08", "2026-11-09", "2026-11-10"]
        active = dates if active is None else active
        model = cp_model.CpModel()
        offs = {("p0", day): model.new_bool_var("off:" + day) for day in active}
        solver._variable_rest_streaks(model, person, dates, offs, prior or {}, active,
                              baseline or {}, data["policy"])
        for variable in offs.values():
            model.add(variable == 1)
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        return engine.solve(model)

    def test_existing_streak_model_rejects_three_offs_across_two_weeks(self):
        data = fixture(40)
        person = data['employees'][0]
        dates = ['2026-11-08', '2026-11-09', '2026-11-10']
        model = cp_model.CpModel()
        offs = {('p0', day): model.new_bool_var('off:' + day) for day in dates}
        work = {('p0', day): model.new_bool_var('work:' + day) for day in dates}
        _streaks(model, person, dates, work, offs, {}, dates, data['policy'])
        for key in offs:
            model.add(offs[key] == 1)
            model.add(work[key] == 0)
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.INFEASIBLE)

    def test_sunday_monday_tuesday_offs_are_not_allowed_in_variable_mode(self):
        self.assertEqual(self.window(), cp_model.INFEASIBLE)

    def test_only_off_counts_absence_and_closed_holiday_break_the_block(self):
        for kind in ("ABSENCE", "HOLIDAY"):
            middle = ("p0", "2026-11-09")
            data = fixture(40)
            model = cp_model.CpModel()
            offs = {("p0", day): model.new_bool_var(day) for day in ("2026-11-08", "2026-11-09", "2026-11-10")}
            baseline = {middle: {"kind": kind}}
            solver._variable_rest_streaks(model, data["employees"][0], [key[1] for key in offs], offs, {},
                                  [key[1] for key in offs], baseline, data["policy"])
            for key, variable in offs.items():
                model.add(variable == int(key != middle))
            engine = cp_model.CpSolver()
            engine.parameters.num_workers = 1
            self.assertEqual(engine.solve(model), cp_model.OPTIMAL)

    def test_explicit_fixed_mode_and_fully_locked_offs_are_preserved(self):
        self.assertEqual(self.window("FIXED"), cp_model.OPTIMAL)
        baseline = {("p0", day): {"kind": "OFF", "locked": True}
                    for day in ("2026-11-08", "2026-11-09", "2026-11-10")}
        self.assertEqual(self.window(baseline=baseline), cp_model.OPTIMAL)

    def test_history_and_future_rests_constrain_only_a_current_mutable_day(self):
        dates = ["2026-11-08", "2026-11-09", "2026-11-10"]
        for active in ([dates[-1]], [dates[0]]):
            prior = {day: {"kind": "OFF"} for day in dates if day not in active}
            self.assertEqual(self.window(prior=prior, active=active), cp_model.INFEASIBLE)
            baseline = {("p0", active[0]): {"kind": "OFF", "locked": True}}
            self.assertEqual(self.window(prior=prior, active=active, baseline=baseline), cp_model.OPTIMAL)
        prior = {day: {"kind": "OFF"} for day in dates}
        self.assertEqual(self.window(prior=prior, active=[]), cp_model.OPTIMAL)

    def test_fixed_off_weekdays_in_variable_legacy_records_are_not_overwritten(self):
        data = fixture(40)
        person = data["employees"][0]
        person["fixedOffDays"] = [0, 1, 6]
        model = cp_model.CpModel()
        dates = ["2026-11-08", "2026-11-09", "2026-11-10"]
        offs = {("p0", day): model.new_bool_var(day) for day in dates}
        solver._variable_rest_streaks(model, person, dates, offs, {}, dates, {}, data["policy"])
        for variable in offs.values():
            model.add(variable == 1)
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)


class RestSpacingTests(unittest.TestCase):
    def test_rest_goals_reserve_time_without_changing_the_coverage_share(self):
        names = ['COVERAGE', 'SUNDAY_BALANCE', 'REST_SPACING', 'UNTIMED_ROTATION', 'STABILITY']
        self.assertAlmostEqual(_phase_budget(10, names, 0), 5.5)
        self.assertEqual(_phase_budget(8, names, 1), 1)
        self.assertEqual(_phase_budget(7, names, 2), 3)
        self.assertEqual(_phase_budget(4, names, 3), 3)
        self.assertEqual(_phase_budget(1, names, 4), 1)

    def test_spacing_neighborhood_keeps_untimed_sector_exchange_partners(self):
        model = cp_model.CpModel()
        first = model.new_bool_var('rest-pair:enc:day')
        second = model.new_bool_var('rest-pair:timed:day')
        groups = {'Balcão': ['enc', 'peer'], 'Outro': ['timed']}
        selected = _spacing_people(groups, {'enc': [first], 'timed': [second]},
                                   {first.index: 1, second.index: 0})
        self.assertEqual(selected, {'enc', 'peer'})

    def spacing(self, kinds, off_pattern='ANY', off_mode='VARIABLE'):
        data = fixture(40)
        person = data['employees'][0]
        person.update(offPattern=off_pattern, offMode=off_mode)
        model, values, offs, baseline = cp_model.CpModel(), {}, {}, {}
        dates = [(date.fromisoformat(data['startDate']) + timedelta(days=index)).isoformat() for index in range(len(kinds))]
        for day, kind in zip(dates, kinds):
            variable = model.new_bool_var(day)
            offs['p0', day] = variable
            values[variable.index] = int(kind == 'OFF')
            baseline['p0', day] = {'kind': kind}
        terms, by_person = _rest_spacing(model, [person], dates, offs, baseline, {'p0': {}}, data['policy'], values)
        return Snapshot(values).value(sum(terms)), by_person

    def test_pairs_are_soft_costs_but_absence_and_holiday_are_not_off(self):
        self.assertEqual(self.spacing(['OFF', 'OFF', 'DUTY'])[0], 1)
        self.assertEqual(self.spacing(['OFF', 'DUTY', 'OFF'])[0], 0)
        for kind in ('ABSENCE', 'HOLIDAY'):
            self.assertEqual(self.spacing(['OFF', kind, 'OFF'])[0], 0)

    def test_explicit_consecutive_preferences_and_fixed_modes_are_not_penalized(self):
        for pattern in ('CONSECUTIVE', 'PREFER_CONSECUTIVE'):
            self.assertEqual(self.spacing(['OFF', 'OFF'], off_pattern=pattern), (0, {}))
        for mode in ('FIXED', 'MIXED'):
            self.assertEqual(self.spacing(['OFF', 'OFF'], off_mode=mode), (0, {}))

    def test_saved_variable_triple_is_repaired_without_removing_locks(self):
        data = fixture(40, weeks=2)
        data['employees'][0]['history'] = []
        offs = {'2026-11-04', '2026-11-08', '2026-11-09', '2026-11-10'}
        data['assignments'] = []
        for index in range(14):
            day = (date.fromisoformat(data['startDate']) + timedelta(days=index)).isoformat()
            assignment = {'employeeId': 'p0', 'date': day, 'kind': 'OFF' if day in offs else 'WORK'}
            if assignment['kind'] == 'WORK':
                assignment['shiftId'] = 'day'
            if day == '2026-11-08':
                assignment['locked'] = True
            data['assignments'].append(assignment)
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'), result)
        sequence = 0
        for assignment in result['assignments']:
            sequence = sequence + 1 if assignment['kind'] == 'OFF' else 0
            self.assertLessEqual(sequence, 2)
        locked = next(entry for entry in result['assignments'] if entry['date'] == '2026-11-08')
        self.assertEqual(locked, next(entry for entry in before['assignments'] if entry['date'] == '2026-11-08'))
        phases = [entry['objective'] for entry in result['optimization']['phases']]
        self.assertIn('REST_SPACING', phases)
        self.assertEqual(data, before)


class UntimedRotationTests(unittest.TestCase):
    def rotation_cost(self, counts):
        data = fixture(40, weeks=4)
        person = data["employees"][0]
        make_untimed(person)
        person["history"] = []
        dates = [(date.fromisoformat(data["startDate"]) + timedelta(days=index)).isoformat() for index in range(28)]
        model, values, offs = cp_model.CpModel(), {}, {}
        remaining = dict(enumerate(counts))
        for day in dates:
            weekday = date.fromisoformat(day).weekday()
            variable = model.new_bool_var(day)
            offs["p0", day] = variable
            values[variable.index] = int(remaining[weekday] > 0)
            remaining[weekday] -= values[variable.index]
        terms = []
        _, linear = _rest_distribution(model, [person], dates, offs, {"p0": dates}, {}, {"p0": {}},
                                       data["policy"], values, untimed_rotation=terms)
        snapshot = Snapshot(values)
        return snapshot.value(sum(linear)), snapshot.value(sum(terms))

    def test_convex_cost_breaks_the_linear_saturation_tie(self):
        concentrated = self.rotation_cost([4, 2, 2, 0, 0, 0, 0])
        distributed = self.rotation_cost([3, 3, 2, 0, 0, 0, 0])
        self.assertEqual(concentrated[0], distributed[0])
        self.assertGreater(concentrated[1], distributed[1])

    def test_untimed_rotation_runs_before_cosmetic_goals_and_varies_weekday_rests(self):
        data = fixture(40, weeks=4)
        person = data["employees"][0]
        make_untimed(person)
        person["history"] = []
        data["assignments"] = [{"employeeId": "p0", "date": (date.fromisoformat(data["startDate"]) + timedelta(days=index)).isoformat(),
                                "kind": "OFF" if index % 7 in (0, 6) else "DUTY"} for index in range(28)]
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result["status"], ("FEASIBLE", "OPTIMAL"), result)
        phases = [entry["objective"] for entry in result["optimization"]["phases"]]
        self.assertIn("UNTIMED_ROTATION", phases)
        if "SATURDAY_BALANCE" in phases:
            self.assertLess(phases.index("UNTIMED_ROTATION"), phases.index("SATURDAY_BALANCE"))
        off_weekdays = [date.fromisoformat(entry["date"]).weekday() for entry in result["assignments"] if entry["kind"] == "OFF"]
        self.assertGreater(len(set(off_weekdays)), 2)
        self.assertTrue(all(entry["kind"] in ("OFF", "DUTY") for entry in result["assignments"]))
        self.assertEqual(data, before)
