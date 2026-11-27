"""Explicit release blocker: cleanup cannot erase unported behavior contracts."""
import json
from pathlib import Path
import unittest

class MigrationReadinessTests(unittest.TestCase):
    def test_every_retired_test_has_a_reviewed_migration_disposition(self):
        path=Path(__file__).with_name("migration-test-inventory.json")
        inventory=json.loads(path.read_text())
        pending=[r for r in inventory["tests"] if r["status"]=="port_or_retirement_review_required"]
        self.assertEqual(len(pending),0,f"{len(pending)} previous contracts require port or explicit retirement review; SolverForge is not release-qualified")
