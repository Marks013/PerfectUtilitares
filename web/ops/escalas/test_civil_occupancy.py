"""Independent civil-date occupancy for native results; no optimization backend."""
import unittest
from solver import occupied_dates


class CivilOccupancyTests(unittest.TestCase):
    def test_paid_pause_occupies_a_date_but_unpaid_meal_does_not(self):
        self.assertEqual(occupied_dates("2026-11-01", {"segments": [
            {"kind": "WORK", "start": 1200, "end": 1440},
            {"kind": "BREAK", "start": 1440, "end": 1500}]}), {"2026-11-01"})
        self.assertEqual(occupied_dates("2026-11-01", {"segments": [
            {"kind": "WORK", "start": 1200, "end": 1440},
            {"kind": "PAID_BREAK", "start": 1440, "end": 1455}]}), {"2026-11-01", "2026-11-02"})

    def test_midnight_exclusive_end_does_not_invent_a_second_date(self):
        self.assertEqual(occupied_dates("2026-12-31", {"segments": [
            {"kind": "WORK", "start": 1200, "end": 1440}]}), {"2026-12-31"})
        self.assertEqual(occupied_dates("2026-12-31", {"segments": [
            {"kind": "WORK", "start": 1200, "end": 1441}]}), {"2026-12-31", "2027-01-01"})
