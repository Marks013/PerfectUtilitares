"""Executable unit/CLI tests for the new complete-execution gate."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

import qualify_execution as gate

SCRIPT = Path(__file__).with_name('qualify_execution.py')


class ExecutionGateTests(unittest.TestCase):
    def setUp(self):
        self.success = dict.fromkeys(gate.REQUIRED_STEPS, 'success')

    def test_complete_success_passes_without_certifying_production(self):
        report = gate.qualify(self.success)
        self.assertEqual(report['decision'], 'QUALIFICATION_PASSED')
        self.assertEqual(report['failedSteps'], [])
        self.assertIs(report['productionCertified'], False)

    def test_every_failure_blocks_qualification(self):
        for step in gate.REQUIRED_STEPS:
            with self.subTest(step=step):
                report = gate.qualify(dict(self.success, **{step: 'failure'}))
                self.assertEqual(report['decision'], 'QUALIFICATION_NOT_PROVEN')
                self.assertEqual(report['failedSteps'], [{'step': step, 'outcome': 'failure'}])

    def test_skipped_and_cancelled_are_not_success(self):
        for step in gate.REQUIRED_STEPS:
            for status in ('skipped', 'cancelled'):
                with self.subTest(step=step, status=status):
                    self.assertEqual(gate.qualify(dict(self.success, **{step: status}))['decision'],
                                     'QUALIFICATION_NOT_PROVEN')

    def test_missing_step_blocks(self):
        for step in gate.REQUIRED_STEPS:
            value = dict(self.success)
            del value[step]
            with self.subTest(step=step):
                report = gate.qualify(value)
                self.assertEqual(report['decision'], 'QUALIFICATION_NOT_PROVEN')
                self.assertEqual(report['failedSteps'], [{'step': step, 'outcome': 'missing'}])

    def test_truthy_values_do_not_pass(self):
        for value in (True, 1, 'true', 'SUCCESS', '', None, ['success'], {'outcome': 'success'}):
            with self.subTest(value=value):
                self.assertEqual(gate.qualify(dict(self.success, tail=value))['decision'],
                                 'QUALIFICATION_NOT_PROVEN')

    def test_successful_conclusion_cannot_mask_failed_outcome(self):
        report = gate.qualify(dict(self.success, tail={'outcome':'failure', 'conclusion':'success'}))
        self.assertEqual(report['decision'], 'QUALIFICATION_NOT_PROVEN')

    def test_unknown_extra_steps_do_not_replace_required_ones(self):
        report = gate.qualify({'some_other_test': 'success'})
        self.assertEqual(len(report['failedSteps']), len(gate.REQUIRED_STEPS))

    def test_untrusted_values_are_never_echoed(self):
        marker = 'DO_NOT_LOG_PRIVATE_VALUE'
        report = gate.qualify(dict(self.success, tail=marker))
        self.assertNotIn(marker, json.dumps(report))
        self.assertEqual(report['failedSteps'], [{'step':'tail', 'outcome':'invalid'}])

    def run_cli(self, outcomes):
        env = {f'FORGE_{name.upper()}': str(value) for name, value in outcomes.items()}
        return subprocess.run([sys.executable, str(SCRIPT)], env=env, capture_output=True, text=True, check=False)

    def test_cli_success_returns_zero_and_json(self):
        result = self.run_cli(self.success)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['decision'], 'QUALIFICATION_PASSED')

    def test_cli_failed_quality_returns_one(self):
        result = self.run_cli(dict(self.success, expanded_quality='failure', tail='skipped'))
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['decision'], 'QUALIFICATION_NOT_PROVEN')
        self.assertEqual(len(report['failedSteps']), 2)

    def test_cli_missing_environment_cannot_pass(self):
        result = self.run_cli({})
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(json.loads(result.stdout)['decision'], 'QUALIFICATION_NOT_PROVEN')


if __name__ == '__main__':
    unittest.main()
