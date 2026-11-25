"""Offline tests of inventory and advisory result integrity."""
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from audit_dependencies import audit, query_all


def component(group, name, version, license_="Apache-2.0"):
    digest = hashlib.sha256(f"{group}:{name}:{version}".encode()).hexdigest()
    return {"type": "library", "group": group, "name": name, "version": version,
            "purl": f"pkg:maven/{group}/{name}@{version}",
            "hashes": [{"alg": "SHA-256", "content": digest}],
            "licenses": [{"license": {"id": license_}}]}


class DependencyAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.runtime = [component("ai.timefold.solver", "timefold-solver-core", "2.8.0"),
                        component("com.fasterxml.jackson.core", "jackson-databind", "2.22.4")]
        self.test = component("org.junit.jupiter", "junit-jupiter", "5.13.4", "EPL-2.0")
        self.write()

    def write(self):
        for name, items in (("runtime", self.runtime), ("with-tests", self.runtime + [self.test])):
            (self.folder / f"{name}.json").write_text(json.dumps({"bomFormat": "CycloneDX", "components": items}))
        (self.folder / "runtime-jars.sha256").write_text("".join(
            f'{item["hashes"][0]["content"]}  {item["name"]}-{item["version"]}.jar\n' for item in self.runtime))

    @staticmethod
    def empty(queries):
        return {"results": [{} for _ in queries]}

    def test_no_matches_in_verified_scope(self):
        result = audit(self.folder, self.empty)
        self.assertEqual(result["status"], "NO_MATCHES_IN_CHECKED_SCOPE")
        self.assertEqual((result["runtimeComponents"], result["testOnlyComponents"]), (2, 1))

    def test_advisory_requires_review(self):
        result = audit(self.folder, lambda qs: {"results": [{"vulns": [{"id": "CVE-2099-1234"}]} for _ in qs]})
        self.assertEqual(result["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["componentsWithAdvisories"], 3)

    def test_missing_license_requires_review(self):
        self.test["licenses"] = []
        self.write()
        result = audit(self.folder, self.empty)
        self.assertEqual(result["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["componentsNeedingLicenseReview"], 1)

    def test_rejects_jar_mismatch(self):
        (self.folder / "runtime-jars.sha256").write_text("0" * 64 + "  wrong.jar\n")
        with self.assertRaisesRegex(ValueError, "RUNTIME_BOM_JAR_MISMATCH"):
            audit(self.folder, self.empty)

    def test_rejects_partial_query_response(self):
        with self.assertRaisesRegex(ValueError, "OSV_RESULT_COUNT"):
            audit(self.folder, lambda _: {"results": []})

    def test_pagination_is_complete(self):
        coords = [("org.example", "library", "1.0")]
        def send(queries):
            if "page_token" in queries[0]:
                return {"results": [{"vulns": [{"id": "GHSA-2222-2222-2222"}]}]}
            return {"results": [{"vulns": [{"id": "CVE-2099-1234"}], "next_page_token": "next"}]}
        self.assertEqual(query_all(coords, send)[coords[0]], ["CVE-2099-1234", "GHSA-2222-2222-2222"])

    def test_rejects_repeated_page_token(self):
        with self.assertRaisesRegex(ValueError, "OSV_PAGE_TOKEN"):
            query_all([("org.example", "library", "1.0")],
                      lambda _: {"results": [{"next_page_token": "same"}]})

    def test_rejects_unexpected_test_in_runtime(self):
        self.runtime.append(component("org.junit", "unexpected", "1"))
        self.write()
        with self.assertRaisesRegex(ValueError, "TEST_DEPENDENCY_IN_RUNTIME"):
            audit(self.folder, self.empty)


if __name__ == "__main__":
    unittest.main()
