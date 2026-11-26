import copy
import unittest
from datetime import datetime, timezone, timedelta
from verify_installation import (verify_demo, inspect_lock, git_blob, inspect_metadata, verify_rustsec,
                                 ALL_CRATES, CORE, VERSION, REGISTRY)


class InstallationTests(unittest.TestCase):
    def demo(self):
        # Cyclic coverage, two shifts/day and four assignments/person.
        nurses = ("Amina", "Bruno", "Chiara")
        return "\n".join(["score: 0hard/0soft"] + [
            f"day {d} slot {s} -> {nurses[(d + s) % 3]}"
            for d in range(6) for s in range(2)])

    def test_valid_demo(self):
        self.assertEqual(verify_demo(self.demo())["assignments"], 12)

    def test_invalid_demo(self):
        raw = self.demo()
        for changed in (raw.replace("0hard", "-1hard"),
                        raw.replace("0soft", "-1soft"),
                        raw.replace("day 0 slot 1 -> Bruno", "day 0 slot 1 -> Amina"),
                        raw.replace("day 5 slot 1 -> Amina", "day 5 slot 1 -> Bruno"),
                        "\n".join(raw.splitlines()[:-1]), raw + "\n" + raw.splitlines()[1],
                        raw.replace("Chiara", "unassigned")):
            with self.subTest(changed=changed[:80]):
                with self.assertRaises(ValueError):
                    verify_demo(changed)

    def lock(self):
        return ("version = 4\n" + "".join(
            f'[[package]]\nname = "{name}"\nversion = "{VERSION}"\n'
            for name in sorted(ALL_CRATES))
            + f'[[package]]\nname = "serde"\nversion = "1.0.228"\nsource = "{REGISTRY}"\nchecksum = "{"a"*64}"\n').encode()

    def test_lock_integrity(self):
        raw = self.lock()
        self.assertEqual(len(inspect_lock(raw, git_blob(raw))), len(ALL_CRATES) + 1)
        with self.assertRaisesRegex(ValueError, "LOCK_IDENTITY"):
            inspect_lock(raw, "a" * 40)

    def test_inventory_resolves_normal_and_build_dependencies(self):
        lock = inspect_lock(self.lock(), git_blob(self.lock()))
        root = {"name": "minimal-shift-scheduling", "version": "0.0.0", "source": None, "checksum": None}
        lock.append(root)
        packages = [dict(p, id=p["name"], license="Apache-2.0") for p in lock]
        deps = [{"pkg": name, "dep_kinds": [{"kind": None}]} for name in sorted(CORE)]
        nodes = [dict(id=p["id"], deps=deps if p["id"] == root["name"] else [], features=[])
                 for p in packages]
        metadata = {"version": 1, "packages": packages, "resolve": {"nodes": nodes}}
        result = inspect_metadata(lock, metadata)
        self.assertEqual(result["conservativeExampleClosure"], len(CORE) + 1)
        metadata["packages"][0]["version"] = "9.9.9"
        with self.assertRaisesRegex(ValueError, "METADATA_LOCK_MISMATCH"):
            inspect_metadata(lock, metadata)

    def test_rustsec_requires_complete_unfiltered_fresh_report(self):
        now = datetime(2026, 11, 26, tzinfo=timezone.utc)
        report = {"database": {"last-commit": "b" * 40, "advisory-count": 1000,
                               "last-updated": now.isoformat()},
                  "lockfile": {"dependency-count": 101},
                  "settings": {"ignore": [], "target_arch": [], "target_os": [], "severity": None},
                  "vulnerabilities": {"found": False, "count": 0, "list": []}, "warnings": {}}
        self.assertEqual(verify_rustsec(report, 101, "b" * 40, now)["lockPackages"], 101)
        for field, key, value in (("settings", "ignore", ["RUSTSEC-2099-0001"]),
                                  ("lockfile", "dependency-count", 2),
                                  ("database", "last-updated", (now - timedelta(days=31)).isoformat()),
                                  ("database", "last-commit", "c" * 40),
                                  ("vulnerabilities", "count", 1),
                                  ("warnings", "unmaintained", [{"package": "example"}])):
            changed = copy.deepcopy(report)
            changed[field][key] = value
            with self.assertRaises(ValueError):
                verify_rustsec(changed, 101, "b" * 40, now)

    def test_untrusted_source_or_checksum_fails(self):
        raw = self.lock()
        for changed in (raw.replace(REGISTRY.encode(), b"git+https://example.invalid/other"),
                        raw.replace(b"a" * 64, b"x" * 64),
                        raw.replace(VERSION.encode(), b"0.31.3")):
            with self.assertRaises(ValueError):
                inspect_lock(changed, git_blob(changed))


if __name__ == "__main__":
    unittest.main()
