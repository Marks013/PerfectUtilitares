"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
import solver
import unittest

class RejectionStageContracts(unittest.TestCase):
    def test_unrestricted_search_proves_incompatible_coverage(self):
        data = fixture()
        person = data['employees'][0]
        data['demands'] = [{'date': '2026-11-03', 'sector': person['sector'],
                            'role': person['role'], 'start': 480, 'end': 720, 'minimum': 2}]
        result = solver.solve(data)
        self.assertEqual(result['status'], 'INFEASIBLE')
        self.assertEqual(result['rejectionStage'], 'SEARCH')
        self.assertEqual(result['assignments'], [])
