"""Responsibilities and movement are soft daily goals, never fictional hourly coverage."""
import copy
import unittest
from solver import solve
from leadership import responsibility
from test_solver import fixture, make_untimed

class LeadershipTests(unittest.TestCase):
    def scenario(self, people=2):
        data = fixture(40, people=people)
        for person in data['employees']:
            make_untimed(person)
            person['role'] = 'ENC. REPOSICAO'
        data['shifts'] = []
        data['movementPriorities'] = [{'startDate': data['startDate'], 'endDate': data['startDate'],
                                       'sector': 'Reposição', 'level': 'HIGH'}]
        return data

    def test_text_inference_never_assigns_a_manager_to_another_sector(self):
        self.assertEqual(responsibility({'role': 'Encarregado', 'sector': 'Padaria'})['sectors'], ['Padaria'])
        self.assertEqual(responsibility({'role': 'ENC Padaria', 'sector': 'Padaria'})['role'], 'SECTOR')
        self.assertEqual(responsibility({'role': 'Gerente', 'sector': 'Loja'})['sectors'], [])
        self.assertEqual(responsibility({'role': 'Repositor', 'sector': 'Loja'})['role'], 'NONE')

    def test_manual_override_is_preserved(self):
        person = {'role': 'Encarregado', 'sector': 'Padaria',
                  'leadership': {'role': 'NONE', 'source': 'MANUAL', 'sectors': []}}
        self.assertEqual(responsibility(person), person['leadership'])

    def test_one_or_two_sector_leaders_can_cover_a_critical_weekday(self):
        for count in (1, 2):
            with self.subTest(people=count):
                data = self.scenario(count)
                before = copy.deepcopy(data)
                result = solve(data)
                self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
                self.assertEqual(result['optimization']['leadership']['criticalSectorDaysWithoutLeader'], 0)
                self.assertFalse(result['optimization']['leadership']['timedCoverageIncluded'])
                self.assertTrue(any(item['date'] == data['startDate'] and item['kind'] == 'DUTY' for item in result['assignments']))
                self.assertTrue(all(item['kind'] != 'WORK' and 'shiftId' not in item for item in result['assignments']))
                self.assertEqual(data, before)

    def test_unavailable_leaders_are_reported_without_infeasibility_or_lost_absences(self):
        data = self.scenario()
        data['assignments'] = [{'employeeId': person['id'], 'date': data['startDate'], 'kind': 'ABSENCE'} for person in data['employees']]
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
        self.assertEqual(result['optimization']['leadership']['criticalSectorDaysWithoutLeader'], 1)
        for absence in data['assignments']:
            self.assertIn(absence, result['assignments'])

    def test_unassigned_branch_manager_does_not_fill_sector_leadership(self):
        data = self.scenario(1)
        data['employees'][0]['role'] = 'Gerente'
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
        self.assertEqual(result['optimization']['leadership']['criticalSectorDaysWithoutLeader'], 1)
        data['employees'][0]['leadership'] = {'role': 'BRANCH', 'source': 'MANUAL', 'sectors': ['Reposição']}
        result = solve(data)
        self.assertEqual(result['optimization']['leadership']['criticalSectorDaysWithoutLeader'], 0)

    def test_no_movement_is_not_a_weekend_peak_and_adds_no_objective(self):
        data = self.scenario()
        del data['movementPriorities']
        result = solve(data)
        self.assertNotIn('leadership', result['optimization'])
        self.assertFalse(any(phase['objective'] == 'LEADERSHIP' for phase in result['optimization']['phases']))

    def test_closed_days_do_not_create_critical_leadership_gaps(self):
        data = self.scenario()
        data['policy']['closedDates'] = [data['startDate']]
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'), result)
        self.assertNotIn('leadership', result['optimization'])
