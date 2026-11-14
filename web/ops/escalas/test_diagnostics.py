"""Diagnostic preparation consumes the original deadline, without a CP search."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from ortools.sat.python import cp_model
from diagnostics import ConflictRegistry, MESSAGES


class DiagnosticBudgetContracts(unittest.TestCase):
    def prepare(self, clock, preparation_seconds):
        diagnostic = Mock()
        diagnostic.proto = SimpleNamespace(constraints=[
            SimpleNamespace(enforcement_literal=[])])
        diagnostic.new_bool_var.return_value = SimpleNamespace(index=7)
        model = Mock()

        def clone():
            clock[0] += preparation_seconds
            return diagnostic

        model.clone.side_effect = clone
        registry = ConflictRegistry()
        registry.groups = {'REST': [0]}
        return registry, model, diagnostic

    def test_insufficient_initial_balance_never_clones_or_allocates_an_engine(self):
        clock = [100.0]
        registry, model, _ = self.prepare(clock, 0.0)
        with patch('diagnostics.time.monotonic', side_effect=lambda: clock[0]), \
                patch('diagnostics.cp_model.CpSolver') as engine:
            result = registry.diagnose(model, 100.12)
        self.assertEqual(result, [])
        model.clone.assert_not_called()
        engine.assert_not_called()

    def test_preparation_exhaustion_never_allocates_or_calls_an_engine(self):
        clock = [100.0]
        registry, model, diagnostic = self.prepare(clock, 0.48)
        with patch('diagnostics.time.monotonic', side_effect=lambda: clock[0]), \
                patch('diagnostics.cp_model.CpSolver') as engine:
            result = registry.diagnose(model, 100.6)
        self.assertEqual(result, [])
        model.clone.assert_called_once_with()
        diagnostic.add_assumption.assert_called_once()
        engine.assert_not_called()

    def test_engine_uses_post_preparation_balance_and_keeps_the_existing_cap(self):
        for deadline, expected in ((100.8, 0.5), (104.0, 0.75)):
            with self.subTest(deadline=deadline):
                clock = [100.0]
                registry, model, diagnostic = self.prepare(clock, 0.2)
                with patch('diagnostics.time.monotonic', side_effect=lambda: clock[0]), \
                        patch('diagnostics.cp_model.CpSolver') as factory:
                    engine = factory.return_value
                    engine.solve.return_value = cp_model.INFEASIBLE
                    engine.sufficient_assumptions_for_infeasibility.return_value = [7]
                    result = registry.diagnose(model, deadline)
                self.assertEqual(engine.parameters.num_workers, 1)
                self.assertAlmostEqual(engine.parameters.max_time_in_seconds, expected)
                engine.solve.assert_called_once_with(diagnostic)
                self.assertEqual(result, [{'family': 'REST', 'message': MESSAGES['REST']}])
                model.clear_hints.assert_not_called()
                model.clear_objective.assert_not_called()
                self.assertEqual(diagnostic.proto.constraints[0].enforcement_literal, [7])

    def test_unknown_diagnosis_never_claims_a_conflict_family(self):
        clock = [100.0]
        registry, model, _ = self.prepare(clock, 0.2)
        with patch('diagnostics.time.monotonic', side_effect=lambda: clock[0]), \
                patch('diagnostics.cp_model.CpSolver') as factory:
            engine = factory.return_value
            engine.solve.return_value = cp_model.UNKNOWN
            result = registry.diagnose(model, 100.8)
        self.assertEqual(result, [])
        engine.sufficient_assumptions_for_infeasibility.assert_not_called()


if __name__ == '__main__':
    unittest.main()
