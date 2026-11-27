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

    def test_native_ports_preserve_historical_identity_and_executable_destinations(self):
        import ast
        import re
        inventory=json.loads(Path(__file__).with_name('migration-test-inventory.json').read_text())
        keys=set()
        for entry in inventory['tests'] + inventory.get('additionalPublicPorts', []):
            key=(entry['source'],entry['class'],entry['test'])
            self.assertNotIn(key,keys)
            keys.add(key)
            self.assertIn(entry['status'],('retained_unchanged','port_or_retirement_review_required','ported_native_contract'))
            if entry['status'] != 'ported_native_contract':
                continue
            self.assertTrue(re.fullmatch(r'[0-9a-f]{64}',entry['historical_body_sha256']))
            self.assertTrue(entry['port_reason'])
            source=Path(__file__).parent / Path(entry['destination']).name
            cls=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.ClassDef) and n.name==entry['class'])
            self.assertTrue(any(isinstance(n,ast.FunctionDef) and n.name==entry['test'] for n in cls.body))
