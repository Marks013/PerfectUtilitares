"""Explicit supermarket movement influences existing estimates, never creates staffing demand."""
import copy
import time
import unittest

from ortools.sat.python import cp_model
from leadership import leadership_objective, leadership_summary, movement_priority
from optimization import ImprovementContext, Snapshot, improve
from model_input import ModelInputError, validate_model_input
from solver import _coverage, solve
from test_solver import fixture


class MovementCoverageTests(unittest.TestCase):
    def coverage_model(self, priorities=None, initial_high=0):
        low_day, high_day, sector = '2026-11-02', '2026-11-03', 'Reposição'
        model = cp_model.CpModel()
        low, high = model.new_bool_var('low'), model.new_bool_var('high')
        model.add(low + high == 1)
        people = [{'id': 'p', 'sector': sector, 'role': 'Repositor', 'history': []}]
        shifts = {'day': {'segments': [{'start': 480, 'end': 540, 'kind': 'WORK'}]}}
        data = {'startDate': low_day, 'endDate': '2026-11-08', 'policy': fixture()['policy'], 'demands': [
            {'date': day, 'sector': sector, 'start': 480, 'end': 540, 'minimum': 1, 'estimated': True}
            for day in (low_day, high_day)]}
        if priorities is not None:
            data['movementPriorities'] = priorities
        values = {low.index: 1 - initial_high, high.index: initial_high}
        sectors, prioritized, movement = {}, {}, []
        coverage = _coverage(model, data, people, {('p', low_day): {'day': low}, ('p', high_day): {'day': high}},
                             shifts, time.monotonic(), 'ESTIMATED', values, sector_terms=sectors,
                             movement_terms=movement, priority_terms=prioritized)
        return model, data, values, low, high, coverage, sectors, prioritized, movement

    def test_no_priorities_adds_no_movement_objective_or_priority_guard(self):
        model, _, values, _, _, coverage, sectors, guards, movement = self.coverage_model()
        self.assertEqual(movement, [])
        self.assertEqual(guards, {})
        self.assertEqual(Snapshot(values).value(sum(coverage)), 60)
        self.assertEqual(Snapshot(values).value(sum(sectors['Reposição'])), 60)
        self.assertEqual(len(model.proto.variables), 4)

    def test_prioritizes_high_movement_at_equal_sector_shortage(self):
        priorities = [{'startDate': '2026-11-03', 'endDate': '2026-11-03', 'sector': 'Reposição', 'level': 'HIGH'},
                      {'startDate': '2026-11-02', 'endDate': '2026-11-02', 'sector': 'Reposição', 'level': 'LOW'}]
        model, data, values, low, high, coverage, sectors, guards, movement = self.coverage_model(priorities)
        original = copy.deepcopy(data)
        protected = [sum(terms) for terms in sectors.values()] + [sum(terms) for terms in guards.values()]
        actual, _, phases = improve(model, [sum(coverage), sum(movement)], values, time.monotonic() + 1,
                                    ['COVERAGE', 'MOVEMENT_COVERAGE'],
                                    context=ImprovementContext(protected_groups={'COVERAGE': protected}))
        self.assertEqual([actual[low.index], actual[high.index]], [0, 1])
        self.assertEqual(Snapshot(actual).value(sum(coverage)), 60)
        self.assertEqual(Snapshot(values).value(sum(movement)), 180)
        self.assertEqual(Snapshot(actual).value(sum(movement)), 60)
        self.assertEqual(phases[-1]['objective'], 'MOVEMENT_COVERAGE')
        self.assertEqual(data, original)
        self.assertEqual(len(model.proto.variables), 4)

    def test_high_day_cannot_be_spent_on_another_secondary_preference(self):
        priorities = [{'startDate': '2026-11-03', 'endDate': '2026-11-03', 'sector': 'Reposição', 'level': 'HIGH'}]
        model, _, values, low, high, coverage, sectors, guards, movement = self.coverage_model(priorities, initial_high=1)
        protected = [sum(terms) for terms in sectors.values()] + [sum(terms) for terms in guards.values()]
        actual, _, _ = improve(model, [sum(coverage), high], values, time.monotonic() + 1,
                              ['COVERAGE', 'PREFERENCES'],
                              context=ImprovementContext(protected_groups={'COVERAGE': protected}))
        self.assertEqual([actual[low.index], actual[high.index]], [0, 1])
        self.assertEqual(Snapshot(actual).value(sum(guards['Reposição', '2026-11-03'])), 0)
        self.assertEqual(Snapshot(actual).value(sum(movement)), 120)

    def test_high_movement_cannot_take_existing_sunday_coverage(self):
        sector, weekday, sunday = 'Caixa', '2026-11-03', '2026-11-08'
        model = cp_model.CpModel()
        peak, sun = model.new_bool_var('peak'), model.new_bool_var('sunday')
        model.add(peak + sun == 1)
        people = [{'id': 'p', 'sector': sector, 'role': 'Caixa', 'history': []}]
        shifts = {'day': {'segments': [{'start': 480, 'end': 540, 'kind': 'WORK'}]}}
        data = {'startDate': '2026-11-02', 'endDate': sunday, 'policy': fixture()['policy'],
                'movementPriorities': [{'startDate': weekday, 'endDate': weekday, 'sector': sector, 'level': 'HIGH'}],
                'demands': [{'date': day, 'sector': sector, 'start': 480, 'end': 540, 'minimum': 1, 'estimated': True}
                            for day in (weekday, sunday)]}
        values = {peak.index: 0, sun.index: 1}
        sectors, sundays, prioritized, movement = {}, {}, {}, []
        coverage = _coverage(model, data, people, {('p', weekday): {'day': peak}, ('p', sunday): {'day': sun}},
                             shifts, time.monotonic(), 'ESTIMATED', values, sunday_terms=sundays,
                             sector_terms=sectors, movement_terms=movement, priority_terms=prioritized)
        guards = [sum(terms) for scope in (sectors, sundays, prioritized) for terms in scope.values()]
        actual, _, _ = improve(model, [sum(coverage), sum(movement)], values, time.monotonic() + 1,
                              ['COVERAGE', 'MOVEMENT_COVERAGE'],
                              context=ImprovementContext(protected_groups={'COVERAGE': guards}))
        self.assertEqual([actual[peak.index], actual[sun.index]], [0, 1])
        self.assertEqual(Snapshot(actual).value(sum(sundays[sector])), 0)
        self.assertEqual(Snapshot(actual).value(sum(coverage)), 60)

    def test_sector_override_and_overlap_match_leadership_priority(self):
        priorities = [{'startDate': '2026-11-02', 'endDate': '2026-11-08', 'level': 'HIGH'},
                      {'startDate': '2026-11-03', 'endDate': '2026-11-03', 'sector': 'Reposição', 'level': 'LOW'}]
        self.assertEqual(movement_priority(priorities, 'Reposição', '2026-11-03'), 1)
        self.assertEqual(movement_priority(priorities, 'Caixa', '2026-11-03'), 3)
        self.assertIsNone(movement_priority(priorities, 'Caixa', '2026-11-09'))
        priorities.append({'startDate': '2026-11-03', 'endDate': '2026-11-03', 'sector': 'Reposição', 'level': 'NORMAL'})
        self.assertEqual(movement_priority(priorities, 'Reposição', '2026-11-03'), 2)

    def test_leader_present_is_exact_without_minimizing_leadership(self):
        data = fixture(40)
        person = data['employees'][0]
        person['role'] = 'ENC. REPOSICAO'
        day = data['startDate']
        data['movementPriorities'] = [{'startDate': day, 'endDate': day, 'level': 'HIGH'}]
        model = cp_model.CpModel()
        present = model.new_bool_var('present')
        model.add(present == 1)
        values = {present.index: 1}
        _, checks = leadership_objective(model, data, [person], [day], {(person['id'], day): present}, values)
        # Maximize the auxiliary deliberately: it must still reflect actual presence.
        model.maximize(checks[0][3])
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(leadership_summary(checks, engine)['criticalSectorDaysWithoutLeader'], 0)

    def test_missing_leader_remains_an_honest_soft_gap(self):
        data = fixture(40)
        day = data['startDate']
        data['movementPriorities'] = [{'startDate': day, 'endDate': day, 'level': 'HIGH'}]
        model = cp_model.CpModel()
        _, checks = leadership_objective(model, data, data['employees'], [day], {}, {})
        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(leadership_summary(checks, engine)['criticalSectorDaysWithoutLeader'], 1)

    def test_production_pipeline_exposes_movement_phase_and_preserves_input(self):
        data = fixture(40, people=2)
        day = data['startDate']
        data['movementPriorities'] = [{'startDate': day, 'endDate': day, 'sector': 'Reposição', 'level': 'HIGH'}]
        data['demands'] = [{'id': 'estimate', 'date': day, 'sector': 'Reposição', 'start': 480,
                            'end': 540, 'minimum': 2, 'estimated': True}]
        before = copy.deepcopy(data)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertIn('MOVEMENT_COVERAGE', [phase['objective'] for phase in result['optimization']['phases']])
        self.assertEqual(data, before)

    def test_unknown_movement_sector_is_rejected_without_echoing_its_name(self):
        data = fixture(40)
        data['movementPriorities'] = [{'startDate': data['startDate'], 'endDate': data['endDate'],
                                       'sector': 'private-unknown-sector', 'level': 'HIGH'}]
        with self.assertRaises(ModelInputError) as error:
            validate_model_input(data)
        self.assertEqual(error.exception.fields, [{'path': 'movementPriorities[0].sector', 'reason': 'UNKNOWN_REFERENCE'}])
        self.assertNotIn('private', str(error.exception.fields))

    def test_sector_with_demand_but_no_employee_is_valid_for_a_gap_alert(self):
        data = fixture(40)
        data['demands'] = [{'date': data['startDate'], 'sector': 'Balcão', 'start': 480,
                            'end': 540, 'minimum': 1, 'estimated': True}]
        data['movementPriorities'] = [{'startDate': data['startDate'], 'endDate': data['endDate'],
                                       'sector': 'Balcão', 'level': 'HIGH'}]
        validate_model_input(data)
        model, movement, guards = cp_model.CpModel(), [], {}
        values = {}
        coverage = _coverage(model, data, data['employees'], {}, {}, time.monotonic(), 'ESTIMATED', values,
                             movement_terms=movement, priority_terms=guards)
        self.assertEqual(Snapshot(values).value(sum(coverage)), 60)
        self.assertEqual(Snapshot(values).value(sum(movement)), 180)


if __name__ == '__main__':
    unittest.main()
