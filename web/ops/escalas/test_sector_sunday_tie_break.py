"""Regression for conservative cross-role sector Sunday distribution.

All inputs are synthetic. There are no production rosters, policy migrations,
or inferred hard staffing requirements.
"""
import time
import unittest
from unittest.mock import patch

from ortools.sat.python import cp_model

from optimization import (ImprovementContext, Snapshot, _movable_people,
                          _sector_sunday_people, improve)
from solver import _clock_profiles, _coverage, _weekend_group_key, days_between
from test_solver import fixture
from weekend_balance import (preserve_sunday_presence, sector_sunday_distribution,
                             sector_sunday_tie_break, sunday_balance_guards, sunday_distribution,
                             weekend_objectives)


SUNDAYS = ("2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27")


class SectorSundayTieBreakTests(unittest.TestCase):
    def synthetic_cross_role_case(self):
        data = fixture(people=2, weeks=4, start_date="2026-11-30")
        first, second = data['employees']
        shifts = {
            "morning": {"segments": [{"start": 480, "end": 720, "kind": "WORK"}]},
            "afternoon": {"segments": [{"start": 720, "end": 960, "kind": "WORK"}]},
        }
        for person, role, shift in (
            (first, "FISCAL DE PREVENÇÃO/PERDAS", "morning"),
            (second, "ZELADOR", "afternoon"),
        ):
            person.update(sector="ADMINISTRATIVO", role=role, shiftIds=[shift],
                          scheduleMode="TIMED", history=[], sundayRestRule="PROTECTIVE",
                          maxConsecutiveSundays=1)
        data['demands'] = [
            {"date": day, "sector": "ADMINISTRATIVO", "role": person['role'],
             "start": start, "end": start + 240, "minimum": 1, "estimated": True}
            for person, start, relevant in (
                (first, 480, SUNDAYS[::2]), (second, 720, SUNDAYS[1::2]))
            for day in relevant
        ]
        model = cp_model.CpModel()
        work = {(person['id'], day): model.new_bool_var(f'w:{person["id"]}:{day}')
                for person in data['employees'] for day in SUNDAYS}
        values = {variable.index: int(day in SUNDAYS[::2])
                  for (_, day), variable in work.items()}
        for person in data['employees']:
            pid = person['id']
            model.add(sum(work[pid, day] for day in SUNDAYS) == 2)
            for first_day, second_day in zip(SUNDAYS, SUNDAYS[1:]):
                model.add(work[pid, first_day] + work[pid, second_day] <= 1)
        choices = {(person['id'], day): {person['shiftIds'][0]: work[person['id'], day]}
                   for person in data['employees'] for day in SUNDAYS}
        groups = {}
        timeline = days_between(data["startDate"], data["endDate"])
        profiles = _clock_profiles(choices, shifts)
        for person in data['employees']:
            groups.setdefault(_weekend_group_key(person, timeline, profiles), []).append(person['id'])
        return data, model, work, values, groups, shifts, choices

    def test_cross_role_tie_break_finds_equal_sundays_without_losing_coverage(self):
        data, model, work, values, groups, shifts, choices = self.synthetic_cross_role_case()
        self.assertEqual(len(groups), 2)
        self.assertTrue(all(len(people) == 1 for people in groups.values()))
        weekly = {5: {}, 6: {}}
        for person in data['employees']:
            weekly[6][person['id']] = (sum(1 - work[person['id'], day] for day in SUNDAYS), 4)
            weekly[5][person['id']] = (0, 0)
        personal, saturday = weekend_objectives(model, groups, weekly, Snapshot(values), values)
        cohort_days, _, untimed = sunday_distribution(
            model, groups, data['employees'], SUNDAYS, work, {}, data['policy'], values)
        self.assertEqual((personal, saturday, cohort_days, untimed), ([], [], [], []))
        spreads, losses, upper = sector_sunday_distribution(
            model, groups, data['employees'], SUNDAYS, work, {}, data['policy'], values)
        self.assertEqual((len(spreads), len(losses), upper), (1, 1, 4))
        self.assertEqual(values[spreads[0].index], 10000)
        self.assertEqual(values[losses[0].index], 0)
        preserve_sunday_presence(model, data['employees'], SUNDAYS, work, values)

        protected_roles = {}
        coverage = _coverage(model, data, data['employees'], choices, shifts,
                             time.monotonic(), 'ESTIMATED', values, role_terms=protected_roles)
        self.assertIsInstance(coverage, list)
        self.assertGreater(Snapshot(values).value(sum(coverage)), 0)
        original = Snapshot(values)
        model.add(sum(coverage) <= original.value(sum(coverage)))
        for terms in protected_roles.values():
            model.add(sum(terms) <= original.value(sum(terms)))

        model.minimize(sector_sunday_tie_break(personal + cohort_days, spreads, losses, upper))
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 2
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(spreads[0]), 0)
        self.assertEqual(engine.value(losses[0]), 0)
        self.assertEqual([sum(engine.value(work[person['id'], day])
                              for person in data['employees']) for day in SUNDAYS], [1, 1, 1, 1])
        self.assertLessEqual(engine.value(sum(coverage)), original.value(sum(coverage)))
        for terms in protected_roles.values():
            self.assertLessEqual(engine.value(sum(terms)), original.value(sum(terms)))

    def test_soft_sector_metrics_do_not_hard_freeze_before_cohort_fairness(self):
        # Seed has the best sector spread and no presence loss, but worse
        # personal fairness. The alternative must remain admissible even if
        # its lower-priority sector spread and soft presence loss get worse.
        model = cp_model.CpModel()
        change = model.new_bool_var("exchange")
        personal = model.new_int_var(0, 1, "personal-spread")
        sector = model.new_int_var(0, 10000, "sector-spread")
        loss = model.new_int_var(0, 1, "eligible-presence-loss")
        model.add(personal + change == 1)
        model.add(sector == 10000 * change)
        model.add(loss == change)
        values = {change.index: 0, personal.index: 1, sector.index: 0, loss.index: 0}
        protected = sunday_balance_guards([personal], [])
        self.assertEqual(len(protected), 1)
        self.assertIs(protected[0], personal)
        objective = sector_sunday_tie_break([personal], [sector], [loss], 1)
        self.assertEqual(Snapshot(values).value(objective), 20002)
        outcome, _, phases = improve(model, [objective], values, time.monotonic() + 3,
            ['SUNDAY_BALANCE'], context=ImprovementContext(
                protected_groups={'SUNDAY_BALANCE': protected}))
        self.assertEqual(outcome[change.index], 1)
        self.assertEqual(outcome[personal.index], 0)
        self.assertEqual(outcome[sector.index], 10000)
        self.assertEqual(outcome[loss.index], 1)
        self.assertLess(Snapshot(outcome).value(objective), Snapshot(values).value(objective))
        self.assertTrue(phases)

    def test_sunday_sector_selection_releases_both_role_cohorts(self):
        data, model, work, values, groups, _, _ = self.synthetic_cross_role_case()
        spreads, losses, maximum = sector_sunday_distribution(
            model, groups, data['employees'], SUNDAYS, work, {}, data['policy'], values)
        self.assertEqual((len(spreads), len(losses), maximum), (1, 1, 4))
        variables = [model.get_int_var_from_proto_index(i)
                     for i in range(len(model.proto.variables))]
        # The legacy selector sees only comparable rates, no sector spread.
        self.assertEqual(_movable_people(variables, values, list(groups.values())), set())
        sectors = {'ADMINISTRATIVO': [person['id'] for person in data['employees']]}
        self.assertEqual(_sector_sunday_people(variables, values, sectors),
                         {person['id'] for person in data['employees']})

    def test_bounded_improve_releases_cross_role_sector_instead_of_singletons(self):
        model = cp_model.CpModel()
        coverage = model.new_int_var(0, 0, 'coverage')
        spread = model.new_int_var(0, 10000, 'sector-sunday-spread:0')
        model.add(spread == 10000)
        values = {coverage.index: 0, spread.index: 10000}
        decisions = {}
        # Eight distinct dates trigger the production restricted-search path.
        for index in range(8):
            pid = ('a', 'b')[index % 2]
            day = f'2026-12-{index + 1:02}'
            variable = model.new_bool_var(f'w:{pid}:{day}')
            model.add(variable == 0)
            values[variable.index] = 0
            decisions[variable.index] = (pid, day)
        with patch('optimization.LARGE_MODEL_VARIABLES', 1):
            result, _, phases = improve(
                model, [coverage, spread], values, time.monotonic() + 3,
                ['COVERAGE', 'SUNDAY_BALANCE'],
                context=ImprovementContext(employee_groups=[['a'], ['b']],
                    rest_spacing_groups={'ADMINISTRATIVO': ['a', 'b']},
                    decision_variables=decisions))
        selected = [phase for phase in phases if phase['objective'] == 'SUNDAY_BALANCE']
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]['searchScope'], 'SELECTED_PEOPLE')
        self.assertEqual(selected[0]['movablePeople'], 2)
        self.assertEqual(result[spread.index], 10000)

    def test_sector_neighborhood_never_truncates_oversized_cohorts(self):
        model = cp_model.CpModel()
        largest = model.new_int_var(0, 10000, 'sector-sunday-spread:0')
        smaller = model.new_int_var(0, 10000, 'sector-sunday-spread:1')
        values = {largest.index: 10000, smaller.index: 5000}
        variables = [largest, smaller]
        sectors = {'large': [f'p{i:02}' for i in range(37)],
                   'small': ['a', 'b']}
        self.assertEqual(_sector_sunday_people(variables, values, sectors, limit=36),
                         {'a', 'b'})
        self.assertEqual(_sector_sunday_people(variables, values, {'large': sectors['large']},
                                               limit=36), set())

    def test_sector_spread_cannot_purchase_worse_personal_fairness(self):
        model = cp_model.CpModel()
        exchange = model.new_bool_var('exchange')
        personal = model.new_int_var(0, 1, 'personal-spread')
        sector = model.new_int_var(0, 10000, 'sector-spread')
        model.add(personal == exchange)
        model.add(sector == 10000 * (1 - exchange))
        model.minimize(sector_sunday_tie_break([personal], [sector], [], 0))
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(personal), 0)
        self.assertEqual(engine.value(sector), 10000)

    def test_sector_spread_cannot_purchase_loss_of_incumbent_presence(self):
        model = cp_model.CpModel()
        exchange = model.new_bool_var('exchange')
        presence_loss = model.new_int_var(0, 1, 'presence-loss')
        sector = model.new_int_var(0, 10000, 'sector-spread')
        model.add(presence_loss == exchange)
        model.add(sector == 10000 * (1 - exchange))
        model.minimize(sector_sunday_tie_break([], [sector], [presence_loss], 1))
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(presence_loss), 0)
        self.assertEqual(engine.value(sector), 10000)

    def test_excludes_overnight_and_unverified_sectors_without_extra_variables(self):
        data, model, work, values, groups, _, _ = self.synthetic_cross_role_case()
        before = len(model.proto.variables)
        self.assertEqual(sector_sunday_distribution(model, groups, data['employees'], SUNDAYS,
            work, {}, data['policy'], values, excluded_sectors={'ADMINISTRATIVO'}), ([], [], 0))
        self.assertEqual(len(model.proto.variables), before)
        data['employees'][0]['scheduleMode'] = 'MISSING'
        self.assertEqual(sector_sunday_distribution(model, groups, data['employees'], SUNDAYS,
            work, {}, data['policy'], values), ([], [], 0))
        self.assertEqual(len(model.proto.variables), before)

    def test_unavailable_sundays_do_not_create_fake_sector_rates(self):
        data, model, work, values, groups, _, _ = self.synthetic_cross_role_case()
        data['policy']['closedDates'] = list(SUNDAYS[1:])
        spans, losses, maximum = sector_sunday_distribution(
            model, groups, data['employees'], SUNDAYS, work, {}, data['policy'], values)
        self.assertEqual((spans, losses, maximum), ([], [], 0))
        # An employee's protected absence is never counted as a free Sunday.
        data['policy']['closedDates'] = []
        data['policy']['holidayDates'] = list(SUNDAYS[1:])
        data['policy']['authorizedHolidayDates'] = []
        spans, losses, maximum = sector_sunday_distribution(
            model, groups, data['employees'], SUNDAYS, work,
            {(data['employees'][0]['id'], SUNDAYS[0]): {'kind': 'ABSENCE'}},
            data['policy'], values)
        self.assertEqual((spans, losses, maximum), ([], [], 0))


if __name__ == '__main__':
    unittest.main()
