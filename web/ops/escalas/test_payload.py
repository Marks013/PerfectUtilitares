"""Private API payload failures expose field paths, never submitted values."""
import copy
import unittest
from model_input import ModelInputError, validate_model_input
from test_solver import fixture


class ModelInputTests(unittest.TestCase):
    def test_real_valid_fixture_and_scoped_history_are_accepted(self):
        data = fixture(40, people=2)
        for person in data["employees"]:
            for assignment in person["history"]:
                assignment.pop("employeeId", None)
        before = copy.deepcopy(data)
        validate_model_input(data)
        self.assertEqual(data, before)

    def test_missing_objects_produce_a_safe_field_error(self):
        for change, expected in (({"policy": None}, "policy"), ({"employees": "private"}, "employees"),
                                 ({"startDate": "private-invalid-date"}, "startDate")):
            data = fixture(40)
            data.update(change)
            with self.assertRaises(ModelInputError) as error:
                validate_model_input(data)
            self.assertEqual(error.exception.fields[0]["path"], expected)
            self.assertEqual(str(error.exception), "INVALID_MODEL_INPUT")
            self.assertNotIn("private", str(error.exception.fields))

    def test_unknown_shift_and_invalid_segments_are_rejected(self):
        data = fixture(40)
        data["employees"][0]["shiftIds"] = ["unknown-private-id"]
        with self.assertRaises(ModelInputError) as error:
            validate_model_input(data)
        self.assertEqual(error.exception.fields[0]["reason"], "UNKNOWN_REFERENCE")
        data = fixture(40)
        data["shifts"][0]["segments"][1]["start"] = 0
        with self.assertRaises(ModelInputError):
            validate_model_input(data)

    def test_optional_leadership_and_movement_reject_invalid_shapes_before_solving(self):
        for field, value in (("leadership", "private-value"), ("movementPriorities", "private-value")):
            data = fixture(40)
            target = data['employees'][0] if field == 'leadership' else data
            target[field] = value
            with self.assertRaises(ModelInputError) as error:
                validate_model_input(data)
            self.assertNotIn('private-value', str(error.exception.fields))
        data = fixture(40)
        data['employees'][0]['leadership'] = {'role': 'SECTOR', 'source': 'MANUAL', 'sectors': ['Reposição']}
        data['movementPriorities'] = [{'startDate': data['startDate'], 'endDate': data['endDate'], 'level': 'HIGH'}]
        validate_model_input(data)
