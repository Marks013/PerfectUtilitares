"""Reject missing time classification before the production CP-SAT model consumes a clock."""
import copy
import unittest

from model_input import ModelInputError, validate_model_input
from contract_fixtures import fixture


class ShiftContinuityContractTests(unittest.TestCase):
    def test_valid_contiguous_work_and_break(self):
        data = fixture(42)
        before = copy.deepcopy(data)
        validate_model_input(data)
        self.assertEqual(data, before)

    def test_gap_between_work_blocks_is_rejected(self):
        data = fixture(42)
        data["shifts"][0]["segments"][2]["start"] += 120
        with self.assertRaises(ModelInputError):
            validate_model_input(data)

    def test_overlap_between_work_blocks_is_rejected(self):
        data = fixture(42)
        data["shifts"][0]["segments"][2]["start"] -= 5
        with self.assertRaises(ModelInputError):
            validate_model_input(data)

    def test_paid_pause_remains_valid_when_contiguous(self):
        data = fixture(42)
        data["shifts"][0]["segments"][1]["kind"] = "PAID_BREAK"
        validate_model_input(data)


if __name__ == "__main__":
    unittest.main()
