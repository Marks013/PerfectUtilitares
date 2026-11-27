import copy
import unittest
from contract_fixtures import fixture, make_untimed
from model_input import ModelInputError, validate_model_input

class PresenceInputTests(unittest.TestCase):
    def test_hourly_gap_upper_bounds_do_not_invent_clocks_for_all_untimed_people(self):
        data=fixture(40)
        make_untimed(data['employees'][0])
        data['policy'].update(minInterShiftMinutes=10000,minWeeklyRestMinutes=20000)
        before=copy.deepcopy(data)
        validate_model_input(data)
        self.assertEqual(data,before)

    def test_any_timed_person_preserves_original_hourly_input_bounds(self):
        data=fixture(40,people=2)
        make_untimed(data['employees'][0])
        data['policy'].update(minInterShiftMinutes=10000,minWeeklyRestMinutes=20000)
        with self.assertRaises(ModelInputError):
            validate_model_input(data)

    def test_presence_only_does_not_accept_boolean_or_out_of_integer_range_gaps(self):
        data=fixture(40)
        make_untimed(data['employees'][0])
        for value in (True,-1,2147483648):
            with self.subTest(value=value):
                data['policy']['minInterShiftMinutes']=value
                with self.assertRaises(ModelInputError):
                    validate_model_input(data)
