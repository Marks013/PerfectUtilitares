"""Native phase callbacks preserve cancellation and immutable-input guarantees; CP-SAT engine callbacks are retired."""
from contract_fixtures import fixture
from solver import solve
import unittest

class WeekendRegressionTests(unittest.TestCase):
    def test_sunday_has_its_own_priority_before_saturday(self):
        data = fixture(people=3, weeks=1)
        result = solve(data)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        names = [phase['objective'] for phase in result['optimization']['phases']]
        self.assertIn('SUNDAY_BALANCE', names)
        self.assertIn('SATURDAY_BALANCE', names)
        self.assertLess(names.index('SUNDAY_BALANCE'), names.index('SATURDAY_BALANCE'))

class CooperativeControlTests(unittest.TestCase):
    class Cancelled(Exception):
        pass


    class Control:
        def __init__(self, stop_on_phase=None, stop_on_checkpoint=None):
            self.phases, self.checks = [], 0
            self.stop_on_phase, self.stop_on_checkpoint = stop_on_phase, stop_on_checkpoint

        def checkpoint(self):
            self.checks += 1
            if self.checks == self.stop_on_checkpoint:
                raise CooperativeControlTests.Cancelled()

        def on_phase(self, phase):
            self.phases.append(phase)
            if phase == self.stop_on_phase:
                raise CooperativeControlTests.Cancelled()


    def test_control_runs_seed_and_later_searches_without_changing_input(self):
        import copy
        data = fixture(people=3)
        original = copy.deepcopy(data)
        control = self.Control()
        result = solve(data, control=control)
        self.assertIn(result['status'], ('OPTIMAL', 'FEASIBLE'))
        self.assertGreater(control.checks, 10)
        self.assertEqual(control.phases, ["CONSTRUCTION", "REFINEMENT"])
        self.assertEqual(data, original)

    def test_cancel_during_construction_propagates_without_a_mathematical_status(self):
        with self.assertRaises(self.Cancelled):
            solve(fixture(), control=self.Control(stop_on_checkpoint=3))

    def test_cancel_during_later_search_propagates_without_assignments(self):
        with self.assertRaises(self.Cancelled):
            solve(fixture(people=3), control=self.Control(stop_on_phase="REFINEMENT"))
