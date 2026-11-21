"""Synthetic evidence: equal per-role Sunday rates can mask sector-wide OFF concentration.

This is a characterization test, not a new staffing rule or a solver change.
The proposed sector-wide tie-break is modeled only inside the test, downstream
of preserved role-specific coverage and mandatory Sunday-rest constraints.
"""
import time
import unittest

from ortools.sat.python import cp_model

from optimization import Snapshot
from solver import _clock_profiles, _coverage, _weekend_group_key, days_between
from test_solver import fixture
from weekend_balance import (
    available_weekends, preserve_sunday_presence, sunday_distribution,
    weekend_objectives,
)


SUNDAYS = ("2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27")


class SundayCrossRoleEvidenceTests(unittest.TestCase):
    def test_distinct_roles_hide_sector_off_spread_but_safe_exchange_exists(self):
        data = fixture(people=2, weeks=4, start_date="2026-11-30")
        fiscal, cleaner = data["employees"]
        for person, role, shift in (
            (fiscal, "FISCAL DE PREVENÇÃO/PERDAS", "morning"),
            (cleaner, "ZELADOR", "afternoon"),
        ):
            person.update(sector="ADMINISTRATIVO", role=role, shiftIds=[shift],
                          maxConsecutiveSundays=1, sundayRestRule="PROTECTIVE",
                          history=[])
        shifts = {
            "morning": {"segments": [{"start": 480, "end": 720, "kind": "WORK"}]},
            "afternoon": {"segments": [{"start": 720, "end": 960, "kind": "WORK"}]},
        }
        data["shifts"] = [dict(id=name, name=name, **shift) for name, shift in shifts.items()]
        data["demands"] = [
            {"date": day, "sector": "ADMINISTRATIVO", "role": person["role"],
             "start": start, "end": start + 240, "minimum": 1, "estimated": True}
            for person, start, relevant_days in (
                (fiscal, 480, SUNDAYS[::2]),
                (cleaner, 720, SUNDAYS[1::2]),
            )
            for day in relevant_days
        ]
        model = cp_model.CpModel()
        work = {(person["id"], day): model.new_bool_var(f'w:{person["id"]}:{day}')
                for person in data["employees"] for day in SUNDAYS}
        # Both people initially work the SAME alternate Sundays. Each already
        # obeys no consecutive working Sundays and has two monthly Sunday rests.
        values = {v.index: int(day in SUNDAYS[::2]) for (_, day), v in work.items()}
        for person in data["employees"]:
            pid = person["id"]
            model.add(sum(work[pid, day] for day in SUNDAYS) == 2)
            for first, second in zip(SUNDAYS, SUNDAYS[1:]):
                model.add(work[pid, first] + work[pid, second] <= 1)

        choices = {(person["id"], day): {person["shiftIds"][0]: work[person["id"], day]}
                   for person in data["employees"] for day in SUNDAYS}
        profiles = _clock_profiles(choices, shifts)
        groups = {}
        timeline = days_between(data["startDate"], data["endDate"])
        for person in data["employees"]:
            key = _weekend_group_key(person, timeline, profiles)
            groups.setdefault(key, []).append(person["id"])
        self.assertEqual(len(groups), 2)
        self.assertTrue(all(len(members) == 1 for members in groups.values()))

        weekend_totals = {5: {}, 6: {}}
        for person in data["employees"]:
            pid = person["id"]
            weekend_totals[6][pid] = (sum(1 - work[pid, day] for day in SUNDAYS), 4)
            weekend_totals[5][pid] = (0, 0)
        personal, saturday = weekend_objectives(
            model, groups, weekend_totals, Snapshot(values), values)
        date_spreads, _, untimed = sunday_distribution(
            model, groups, data["employees"], SUNDAYS, work, {}, data["policy"], values)
        # The current role/clock grouping skips singleton groups: its fairness
        # objective is empty even though the full sector is uneven.
        self.assertEqual((personal, saturday, date_spreads, untimed), ([], [], [], []))
        seed_present = [sum(values[work[p["id"], day].index] for p in data["employees"])
                        for day in SUNDAYS]
        self.assertEqual(seed_present, [2, 0, 2, 0])

        preserve_sunday_presence(model, data["employees"], SUNDAYS, work, values)
        role_guards = {}
        coverage = _coverage(
            model, data, data["employees"], choices, shifts, time.monotonic(),
            "ESTIMATED", values, role_terms=role_guards)
        self.assertIsInstance(coverage, list)
        self.assertGreater(Snapshot(values).value(sum(coverage)), 0)
        self.assertEqual({key[1] for key in role_guards}, {fiscal["role"], cleaner["role"]})
        baseline = Snapshot(values)
        model.add(sum(coverage) <= baseline.value(sum(coverage)))
        for terms in role_guards.values():
            model.add(sum(terms) <= baseline.value(sum(terms)))

        # Diagnostic-only candidate: lower-priority OFF count dispersion of
        # the WHOLE sector after every role/time coverage protection above.
        counts = [sum(work[p["id"], day] for p in data["employees"]) for day in SUNDAYS]
        maximum = model.new_int_var(0, 2, "sector-sunday-max-presence")
        minimum = model.new_int_var(0, 2, "sector-sunday-min-presence")
        spread = model.new_int_var(0, 2, "sector-sunday-off-spread")
        model.add_max_equality(maximum, counts)
        model.add_min_equality(minimum, counts)
        model.add(spread == maximum - minimum)
        model.minimize(spread)

        engine = cp_model.CpSolver()
        engine.parameters.num_workers = 1
        engine.parameters.max_time_in_seconds = 2
        self.assertEqual(engine.solve(model), cp_model.OPTIMAL)
        self.assertEqual(engine.value(spread), 0)
        self.assertEqual([engine.value(total) for total in counts], [1, 1, 1, 1])
        self.assertLessEqual(engine.value(sum(coverage)), baseline.value(sum(coverage)))
        for terms in role_guards.values():
            self.assertLessEqual(engine.value(sum(terms)), baseline.value(sum(terms)))
        for person in data["employees"]:
            self.assertEqual(sum(engine.value(work[person["id"], day]) for day in SUNDAYS), 2)
            self.assertTrue(all(engine.value(work[person["id"], first])
                                + engine.value(work[person["id"], second]) <= 1
                                for first, second in zip(SUNDAYS, SUNDAYS[1:])))

    def test_locked_rest_absence_closed_and_unauthorized_holiday_are_not_opportunities(self):
        person = fixture(people=1)["employees"][0]
        person["fixedOffDays"] = []
        policy = {
            "closedDates": [SUNDAYS[2]], "holidayDates": [SUNDAYS[3]],
            "authorizedHolidayDates": [],
        }
        previous = {
            (person["id"], SUNDAYS[0]): {"kind": "OFF", "locked": True},
            (person["id"], SUNDAYS[1]): {"kind": "ABSENCE"},
        }
        self.assertEqual(available_weekends(person, SUNDAYS, previous, policy), [])
        # Authorization changes only the holiday eligibility, not the locked
        # rest, absence, or explicit store closing.
        policy["authorizedHolidayDates"] = [SUNDAYS[3]]
        self.assertEqual(available_weekends(person, SUNDAYS, previous, policy), [SUNDAYS[3]])


if __name__ == "__main__":
    unittest.main()
