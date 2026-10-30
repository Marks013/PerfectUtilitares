"""Focused regressions for the shipped Sunday scheduling policy."""
import time
import unittest
from datetime import date, timedelta

from ortools.sat.python import cp_model
from optimization import Snapshot, improve, _movable_people
from solver import solve
from test_solver import fixture
from weekend_balance import available_weekends, weekend_objectives


class ProductionSundayTests(unittest.TestCase):
    def test_snapshot_evaluates_a_linear_total_without_a_search(self):
        model = cp_model.CpModel()
        x = model.new_int_var(0, 4, 'x')
        y = model.new_int_var(0, 4, 'y')
        snapshot = Snapshot({x.index: 3, y.index: 1})
        self.assertEqual(snapshot.value(3 * x - 2 * y + 7), 14)
        self.assertEqual(snapshot.value(x + y), 4)
        self.assertEqual(snapshot.value(5), 5)

    def test_only_available_sundays_count_as_rotation_opportunities(self):
        data = fixture(weeks=6)
        person, policy = data['employees'][0], data['policy']
        days = ['2026-11-08', '2026-11-15', '2026-11-22',
                '2026-11-29', '2026-12-06', '2026-12-13']
        policy['closedDates'] = ['2026-11-29']
        policy['holidayDates'] = ['2026-12-06']
        baseline = {
            ('p0', days[0]): {'kind': 'ABSENCE'},
            ('p0', days[1]): {'kind': 'OFF', 'locked': True},
            ('p0', days[2]): {'kind': 'OFF'},
        }
        self.assertEqual(available_weekends(person, days, baseline, policy),
                         [days[2], days[5]])
        policy['_simulation'] = True
        self.assertEqual(available_weekends(person, days, baseline, policy),
                         [days[2], days[4], days[5]])
        person['fixedOffDays'] = [6]
        self.assertEqual(available_weekends(person, days, baseline, policy), [])

    def test_saturday_cannot_purchase_a_worse_sunday_distribution(self):
        model = cp_model.CpModel()
        trade = model.new_bool_var('trade')
        sunday = model.new_int_var(0, 1, 'sunday-total')
        saturday = model.new_int_var(0, 1, 'saturday-total')
        model.add(sunday == trade)
        model.add(saturday + trade == 1)
        values = {trade.index: 1, sunday.index: 1, saturday.index: 0}
        totals = {6: {'a': (sunday, 2), 'b': (0, 2)},
                  5: {'a': (saturday, 1), 'b': (0, 1)}}
        sundays, saturdays = weekend_objectives(
            model, {'same': ['a', 'b']}, totals, Snapshot(values), values)
        # Exhaustive two-state oracle: the combined objective chooses trade=1
        # (5000 + 0) over trade=0 (0 + 10000), worsening the Sunday rate.
        model.minimize(sum(sundays) + sum(saturdays))
        combined = cp_model.CpSolver()
        self.assertEqual(combined.solve(model), cp_model.OPTIMAL)
        self.assertEqual(combined.value(trade), 1)
        actual, _, phases = improve(
            model, [sum(sundays), sum(saturdays)], values,
            time.monotonic() + 2, ['SUNDAY_BALANCE', 'SATURDAY_BALANCE'],
            protected_groups={'SUNDAY_BALANCE': sundays})
        self.assertEqual(actual[trade.index], 0)
        self.assertEqual([actual[v.index] for v in sundays + saturdays],
                         [0, 10000])
        self.assertEqual([p['objective'] for p in phases],
                         ['SUNDAY_BALANCE', 'SATURDAY_BALANCE'])

    def test_cross_week_exchange_retains_the_joint_model(self):
        model = cp_model.CpModel()
        days = [(date(2026, 11, 2) + timedelta(days=n)).isoformat()
                for n in range(21)]
        rests = {(pid, day): model.new_bool_var(f'o:{pid}:{day}')
                 for pid in ('p', 'q') for day in days}
        first, second = rests['p', '2026-11-08'], rests['p', '2026-11-15']
        model.add(first == second)
        for variable in rests.values():
            if variable.index not in (first.index, second.index):
                model.add(variable == 0)
        p_rate = model.new_int_var(0, 10000, 'weekend-rate:6:p')
        q_rate = model.new_int_var(0, 0, 'weekend-rate:6:q')
        model.add(p_rate == 5000 * (first + second))
        coverage = model.new_int_var(0, 0, 'coverage')
        padding = [model.new_int_var(0, 0, f'padding:{i}') for i in range(3000)]
        variables = [*rests.values(), p_rate, q_rate, coverage, *padding]
        values = {v.index: int(v.index in (first.index, second.index))
                  for v in variables}
        values[p_rate.index] = 10000
        actual, proven, phases = improve(
            model, [coverage, p_rate], values, time.monotonic() + 3,
            ['COVERAGE', 'SUNDAY_BALANCE'], employee_groups=[['p', 'q']])
        self.assertEqual(actual[first.index], 0)
        self.assertEqual(actual[second.index], 0)
        self.assertEqual(actual[coverage.index], 0)
        self.assertFalse(proven)
        self.assertEqual(phases[-1]['searchScope'], 'SELECTED_PEOPLE')

    def test_neighborhood_does_not_drop_tied_members_of_a_comparable_group(self):
        model = cp_model.CpModel()
        scores = {'high1': 10000, 'high2': 10000, 'low': 0, 'middle': 5000}
        variables = [model.new_int_var(0, 10000, f'weekend-rate:6:{pid}')
                     for pid in scores]
        values = {v.index: score for v, score in zip(variables, scores.values())}
        selected = _movable_people(variables, values, [list(scores)], limit=4)
        self.assertEqual(set(selected), set(scores))

    def test_shipped_solver_attempts_sunday_before_saturday(self):
        data = fixture(people=3)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertEqual(len(result['assignments']), 21)
        names = [phase['objective'] for phase in result['optimization']['phases']]
        self.assertIn('SUNDAY_BALANCE', names)
        self.assertIn('SATURDAY_BALANCE', names)
        self.assertLess(names.index('SUNDAY_BALANCE'), names.index('SATURDAY_BALANCE'))

    def test_later_preferences_cannot_transfer_sunday_debt_between_groups(self):
        model = cp_model.CpModel()
        a = model.new_int_var(0, 2, 'group-a')
        b = model.new_int_var(0, 2, 'group-b')
        preference = model.new_bool_var('preference')
        model.add_allowed_assignments([a, b, preference], [(2, 0, 1), (0, 2, 0)])
        observed = []

        class ObserveSearch:
            def checkpoint(self):
                pass

            def solve(self, engine, current):
                status = engine.solve(current)
                if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                    observed.append((engine.value(a), engine.value(b)))
                return status

        actual, _, phases = improve(
            model, [a + b, preference],
            {a.index: 2, b.index: 0, preference.index: 1},
            time.monotonic() + 2, ['SUNDAY_BALANCE', 'PREFERENCES'],
            protected_groups={'SUNDAY_BALANCE': [a, b]}, control=ObserveSearch())
        self.assertEqual(len(phases), 2)
        self.assertTrue(observed)
        self.assertEqual((actual[a.index], actual[b.index]), observed[0])
        # The alternate allocation has the same scalar Sunday sum. Only the
        # per-group guard prevents moving all of that debt to the other group.
        protected_zero = a if observed[0][0] == 0 else b
        challenge = model.clone()
        challenge.add(challenge.get_int_var_from_proto_index(protected_zero.index) >= 1)
        engine = cp_model.CpSolver()
        self.assertEqual(engine.solve(challenge), cp_model.INFEASIBLE)

    def test_expired_hint_budget_returns_without_a_partial_person(self):
        from hints import balanced_rest_hints
        from solver import instant, sunday_limit
        data = fixture()
        result = balanced_rest_hints(data['employees'], ['2026-11-02'], {}, {}, {}, {},
                                     data['policy'], instant, sunday_limit, deadline=time.monotonic() - 1)
        self.assertEqual(result, {})

    def test_no_current_sundays_does_not_create_a_historical_rotation_debt(self):
        from unittest.mock import patch
        data = fixture(people=3, weeks=2)
        data['employees'][0]['fixedOffDays'] = [6]
        observed = []
        def inspect(*args, **kwargs):
            observed.append(args[2][6]['p0'][1])
            return weekend_objectives(*args, **kwargs)
        with patch('solver.weekend_objectives', inspect):
            result = solve(data)
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(observed, [0])

    def test_explicit_decision_metadata_supports_colons_in_identifiers(self):
        model = cp_model.CpModel()
        days = [(date(2026, 11, 2) + timedelta(days=n)).isoformat() for n in range(21)]
        rests = [model.new_bool_var('o:p:leader:' + day) for day in days]
        target = model.new_bool_var('s:p:leader:2026-11-08:turno:manha')
        other = model.new_int_var(0, 0, 'weekend-rate:6:q')
        rate = model.new_int_var(0, 10000, 'weekend-rate:6:p:leader')
        model.add(rate == 10000 * target)
        model.add(target == rests[6])
        for index, variable in enumerate(rests):
            if index != 6:
                model.add(variable == 0)
        coverage = model.new_int_var(0, 0, 'coverage')
        padding = [model.new_int_var(0, 0, f'padding:{i}') for i in range(3000)]
        values = {v.index: int(v.index in (target.index, rests[6].index))
                  for v in [*rests, target, other, rate, coverage, *padding]}
        values[rate.index] = 10000
        decisions = {v.index: ('p:leader', day) for v, day in zip(rests, days)}
        decisions[target.index] = ('p:leader', days[6])
        actual, _, phases = improve(model, [coverage, rate], values, time.monotonic() + 2,
                                     ['COVERAGE', 'SUNDAY_BALANCE'],
                                     employee_groups=[['p:leader', 'q']], decision_variables=decisions)
        self.assertEqual(actual[target.index], 0)
        self.assertEqual(phases[-1]['searchScope'], 'SELECTED_PEOPLE')


class SavedDraftSundayTests(unittest.TestCase):
    def test_complete_feasible_draft_keeps_its_sunday_balance_during_coverage(self):
        data = fixture(people=2, weeks=2)
        days = [(date.fromisoformat(data['startDate']) + timedelta(days=n)).isoformat()
                for n in range(14)]
        for person in data['employees']:
            for day in days:
                entry = {'employeeId': person['id'], 'date': day,
                         'kind': 'OFF' if date.fromisoformat(day).weekday() >= 5 else 'WORK'}
                if entry['kind'] == 'WORK':
                    entry['shiftId'] = 'day'
                data['assignments'].append(entry)
        sundays = [day for day in days if date.fromisoformat(day).weekday() == 6]
        data['demands'] = [
            {'sector': 'Reposição', 'date': day, 'start': 480, 'end': 720,
             'minimum': 1, 'estimated': True} for day in sundays]
        observed = []

        class ObserveSearch:
            def checkpoint(self):
                pass

            def solve(self, engine, current):
                status = engine.solve(current)
                if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                    observed.append({variable.name: engine.value(variable)
                                     for index in range(len(current.proto.variables))
                                     for variable in [current.get_int_var_from_proto_index(index)]
                                     if variable.name.startswith('w:')})
                return status

        result = solve(data, control=ObserveSearch())
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertGreaterEqual(len(observed), 2)
        for entry in data['assignments']:
            name = f"w:{entry['employeeId']}:{entry['date']}"
            self.assertEqual(observed[0][name], int(entry['kind'] == 'WORK'))
        self.assertEqual(result['optimization']['phases'][0]['objective'], 'COVERAGE')
        # The saved draft starts with equal Sunday rates. Coverage may improve
        # presence, but not by transferring Sunday work to only one colleague.
        coverage_totals = [sum(observed[1][f"w:{p['id']}:{day}"] for day in sundays)
                           for p in data['employees']]
        self.assertEqual(max(coverage_totals) - min(coverage_totals), 0)
        final_totals = [sum(entry['kind'] == 'WORK' and entry['date'] in sundays
                            for entry in result['assignments'] if entry['employeeId'] == person['id'])
                        for person in data['employees']]
        self.assertEqual(max(final_totals) - min(final_totals), 0)

    def test_invalid_complete_draft_falls_back_to_a_real_feasible_proposal(self):
        data = fixture()
        data['assignments'] = [
            {'employeeId': 'p0',
             'date': (date.fromisoformat(data['startDate']) + timedelta(days=n)).isoformat(),
             'kind': 'WORK', 'shiftId': 'day'} for n in range(7)]
        observed = []

        class ObserveSearch:
            def checkpoint(self):
                pass

            def solve(self, engine, current):
                status = engine.solve(current)
                observed.append((status, engine.parameters.fix_variables_to_their_hinted_value))
                return status

        result = solve(data, control=ObserveSearch())
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertGreaterEqual(len(observed), 2)
        self.assertEqual(observed[0], (cp_model.INFEASIBLE, True))
        self.assertIn(observed[1][0], (cp_model.FEASIBLE, cp_model.OPTIMAL))
        self.assertFalse(observed[1][1])
        self.assertEqual(len(result['assignments']), 7)
        self.assertEqual(sum(a['kind'] == 'WORK' for a in result['assignments']), 5)
        self.assertEqual(sum(a['kind'] == 'OFF' for a in result['assignments']), 2)
        self.assertTrue(all(a['kind'] == 'WORK' for a in data['assignments']))


class SundayCoverageGuardTests(unittest.TestCase):
    def test_total_coverage_cannot_purchase_more_sunday_shortage(self):
        model = cp_model.CpModel()
        trade = model.new_bool_var('trade')
        weekday = model.new_int_var(0, 10, 'weekday-shortage')
        model.add(weekday == 10 * (1 - trade))
        sunday = 5 * trade
        values = {trade.index: 0, weekday.index: 10}
        actual, _, _ = improve(model, [weekday + sunday], values, time.monotonic() + 2,
                                ['COVERAGE'], protected_groups={'COVERAGE': [sunday]})
        self.assertEqual(actual[trade.index], 0)
        self.assertEqual(actual[weekday.index], 10)

    def test_adapting_clocks_reuses_the_existing_rest_pattern_as_a_hint(self):
        data = fixture(people=1, weeks=2)
        previous = solve(data)
        self.assertIn(previous['status'], ('FEASIBLE', 'OPTIMAL'))
        # Preparation removes incompatible unlocked WORK clocks, but keeps OFF.
        data['assignments'] = [a for a in previous['assignments'] if a['kind'] == 'OFF']
        expected = {a['date'] for a in data['assignments']}
        observed = []

        class InspectSeed:
            def checkpoint(self):
                pass

            def solve(self, engine, model):
                status = engine.solve(model)
                if not observed and status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
                    observed.append({variable.name[len('o:p0:'):] for index in range(len(model.proto.variables))
                                     for variable in [model.get_int_var_from_proto_index(index)]
                                     if variable.name.startswith('o:p0:') and engine.value(variable)})
                return status

        result = solve(data, control=InspectSeed())
        self.assertIn(result['status'], ('FEASIBLE', 'OPTIMAL'))
        self.assertEqual(observed[0], expected)
        self.assertEqual(len(result['assignments']), 14)


class SundayPresenceTests(unittest.TestCase):
    def test_staffed_sunday_sector_cannot_be_emptied_for_another_goal(self):
        from weekend_balance import preserve_sunday_presence
        model = cp_model.CpModel()
        a, b = model.new_bool_var('a'), model.new_bool_var('b')
        day = '2026-11-08'
        preserve_sunday_presence(model, [{'id': 'a', 'sector': 'Caixa'}, {'id': 'b', 'sector': 'Caixa'}],
                                 [day], {('a', day): a, ('b', day): b}, {a.index: 1, b.index: 0})
        model.minimize(a + b)
        engine = cp_model.CpSolver()
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(a) + engine.value(b), 1)

    def test_an_empty_reference_does_not_invent_an_operational_minimum(self):
        from weekend_balance import preserve_sunday_presence
        model = cp_model.CpModel()
        person = model.new_bool_var('person')
        day = '2026-11-08'
        preserve_sunday_presence(model, [{'id': 'a', 'sector': 'Caixa'}],
                                 [day], {('a', day): person}, {person.index: 0})
        model.minimize(person)
        engine = cp_model.CpSolver()
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(person), 0)


class SectorCoverageTests(unittest.TestCase):
    def test_sunday_shortage_is_protected_separately_for_each_sector(self):
        from solver import _coverage
        data = fixture(people=2)
        data['employees'][0]['sector'] = 'Caixa'
        data['employees'][1]['sector'] = 'Acougue'
        day = '2026-11-08'
        data['demands'] = [{'sector': sector, 'date': day, 'start': 480, 'end': 540,
                            'minimum': 1, 'estimated': True} for sector in ('Caixa', 'Acougue')]
        model = cp_model.CpModel()
        a, b = model.new_bool_var('a'), model.new_bool_var('b')
        values = {a.index: 1, b.index: 0}
        terms = {}
        _coverage(model, data, data['employees'], {('p0', day): {'day': a}, ('p1', day): {'day': b}},
                  {'day': data['shifts'][0]}, time.monotonic(), 'ESTIMATED', values, terms)
        self.assertEqual(set(terms), {'Caixa', 'Acougue'})
        self.assertEqual(Snapshot(values).value(sum(terms['Caixa'])), 0)
        self.assertEqual(Snapshot(values).value(sum(terms['Acougue'])), 60)


if __name__ == '__main__':
    unittest.main()
