"""A native port needs a hash-bound, compiled, non-ignored test destination."""
import hashlib
from pathlib import Path
import tempfile
import unittest
import test_migration_readiness as readiness


class NativeMigrationDestinationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = "web/experiments/escalas-solverforge/src/temporal/historical_coverage_tests.rs"
        target = self.root / self.path
        target.parent.mkdir(parents=True)
        self.parent = target.parent.with_suffix(".rs")
        self.parent.write_text("#[cfg(test)]\nmod historical_coverage_tests;\n")
        self.source = "#[test]\nfn old_contract() { assert_eq!(1, 1); }\n"
        self.entry = {"destination": self.path, "native_test": "temporal::historical_coverage_tests::old_contract"}
        self.write(self.source)

    def write(self, text):
        content = text.encode("utf-8")
        (self.root / self.path).write_bytes(content)
        self.entry["destination_file_sha256"] = hashlib.sha256(content).hexdigest()

    def verify(self, entry=None):
        self.assertTrue(hasattr(readiness, "validate_native_destination"), "native port destinations must be checked, not silently credited")
        return readiness.validate_native_destination(self.entry if entry is None else entry, self.root)

    def test_registered_native_test_is_accepted(self):
        self.assertIsNone(self.verify())

    def test_changed_file_missing_test_or_disabled_module_is_rejected(self):
        (self.root / self.path).write_text(self.source + "// changed\n")
        with self.assertRaises(ValueError):
            self.verify()
        self.write(self.source.replace("old_contract", "other"))
        with self.assertRaises(ValueError):
            self.verify()
        self.write(self.source)
        self.parent.write_text("// module removed\n")
        with self.assertRaises(ValueError):
            self.verify()

    def test_ignored_conditional_or_commented_tests_are_not_completed_ports(self):
        for source in ("#[ignore]\n" + self.source, self.source.replace("#[test]", "#[test]\n#[ignore]"),
                       "#[cfg(any())]\n" + self.source, "/*\n" + self.source + "*/\n"):
            with self.subTest(source=source):
                self.write(source)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_outside_repository_or_mismatched_native_identity_is_rejected(self):
        for change in ({"destination": "../outside.rs"}, {"destination": str(self.root / self.path)},
                       {"native_test": "other::old_contract"}, {"destination_file_sha256": "0" * 64}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.verify({**self.entry, **change})

    def test_conditionally_disabled_parent_module_cannot_be_credited(self):
        self.parent.write_text("#[cfg(any())]\n#[cfg(test)]\nmod historical_coverage_tests;\n")
        with self.assertRaises(ValueError):
            self.verify()
