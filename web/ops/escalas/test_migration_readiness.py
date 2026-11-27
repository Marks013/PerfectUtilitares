"""Explicit release blocker: cleanup cannot erase unported behavior contracts."""
import json
from pathlib import Path
import unittest


def validate_native_destination(entry, root):
    """Validate source identity/registration; execution is the mandatory Rust CI job.

    This is not a substitute for cargo test and does not certify equivalence.
    Only reviewed top-level tests in the pinned native package are admitted.
    """
    import hashlib
    import re
    path = Path(entry['destination'])
    prefix = Path('web/experiments/escalas-solverforge/src')
    if path.is_absolute() or '..' in path.parts or not path.is_relative_to(prefix) or path.suffix != '.rs':
        raise ValueError('Native test destination must be inside the native source tree')
    root = root.resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Native test destination escapes the repository')
    source = target.read_text()
    expected = entry.get('destination_file_sha256', '')
    if not re.fullmatch(r'[0-9a-f]{64}', expected) or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise ValueError('Native test destination content changed')
    relative = path.relative_to(prefix).with_suffix('')
    function = entry.get('native_test', '').split('::')
    if len(function) != len(relative.parts) + 1 or function[:-1] != list(relative.parts) or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', function[-1]):
        raise ValueError('Native test identity does not match its destination')
    # The supported registration syntax is deliberately narrow and fail-closed.
    clean = re.sub(r'/\*.*?\*/|//[^\n]*', '', source, flags=re.S)
    lines = clean.splitlines()
    found = [i for i, line in enumerate(lines) if re.fullmatch(r'fn ' + re.escape(function[-1]) + r'\(\)\s*\{.*', line)]
    if len(found) != 1:
        raise ValueError('Native test function missing or ambiguous')
    attributes = []
    i = found[0] - 1
    while i >= 0 and (not lines[i].strip() or lines[i].strip().startswith('#[')):
        if lines[i].strip():
            attributes.append(lines[i].strip())
        i -= 1
    if attributes != ['#[test]']:
        raise ValueError('Native test is not unconditional and enabled')
    parent = target.parent.with_suffix('.rs')
    parent_source = re.sub(r'/\*.*?\*/|//[^\n]*', '', parent.read_text(), flags=re.S)
    lines = parent_source.splitlines()
    found = [i for i, line in enumerate(lines) if line.strip() == f'mod {path.stem};']
    if len(found) != 1:
        raise ValueError('Native test module is not registered for cargo test')
    attributes = []
    i = found[0] - 1
    while i >= 0 and (not lines[i].strip() or lines[i].strip().startswith('#[')):
        if lines[i].strip():
            attributes.append(lines[i].strip())
        i -= 1
    if attributes != ['#[cfg(test)]']:
        raise ValueError('Native test module is conditionally disabled')

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
            if entry.get('destination_language') == 'rust':
                validate_native_destination(entry, Path(__file__).resolve().parents[3])
                continue
            source=Path(__file__).parent / Path(entry['destination']).name
            cls=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.ClassDef) and n.name==entry['class'])
            self.assertTrue(any(isinstance(n,ast.FunctionDef) and n.name==entry['test'] for n in cls.body))
