"""Original public contracts retained during engine migration; assertions unchanged."""
from contract_fixtures import fixture
from model_input import ModelInputError
from model_input import validate_model_input
from solver import solve
import copy
import unittest

class MovementCoverageTests(unittest.TestCase):
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
