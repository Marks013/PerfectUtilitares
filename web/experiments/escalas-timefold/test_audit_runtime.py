import copy
from datetime import datetime, timedelta, timezone
import unittest
from audit_runtime import (summarize, PLUGINS, JRE, JDK, JAVA_PACKAGE_VERSION,
                           parse_binary_inventory, verify_scan_identity, verify_db)


class ImageAuditTests(unittest.TestCase):
    def raw_inventory(self, build=True):
        packages = [JRE, JDK] if build else [JRE]
        rows = [f"PACKAGE\t{p}\t{JAVA_PACKAGE_VERSION}\tarm64\topenjdk-21\tinstall ok installed" for p in packages]
        home = "/usr/lib/jvm/java-21-openjdk-arm64"
        files = [("java", "/bin/java", JRE), ("libjvm", "/lib/server/libjvm.so", JRE),
                 ("modules", "/lib/modules", JRE)]
        if build:
            files.append(("javac", "/bin/javac", JDK))
        rows += [f"FILE\t{name}\t{home}{path}\t{owner}\t{'a' * 64}" for name, path, owner in files]
        return "\n".join(rows + ["VERIFIED\t" + ("build" if build else "runtime") + "\tarm64"])

    def inventory(self, build=True):
        return parse_binary_inventory(self.raw_inventory(build), build)

    def report(self, build=True):
        inventory = self.inventory(build)
        return {"Results": [
            {"Class": "os-pkgs", "Type": "ubuntu", "Packages": [
                {"Name": p, "Version": v["version"], "Arch": v["arch"], "SrcName": v["source"],
                 "SrcVersion": v["version"], "AnalyzedBy": "dpkg", "Repository": {"Class": "official"},
                 "InstalledFiles": [f["path"] for f in inventory["files"].values() if f["package"] == p]}
                for p, v in inventory["packages"].items()]},
            {"Class": "lang-pkgs", "Type": "jar",
             "Packages": [{"Name": k, "Version": v} for k, v in PLUGINS.items()]}
        ]}

    def test_scope_report(self):
        for build in (True, False):
            with self.subTest(build=build):
                result = summarize(self.report(build), build, self.inventory(build))
                self.assertEqual(result["status"], "NO_HIGH_OR_CRITICAL_MATCHES_IN_INVENTORIED_SCOPE")
                self.assertTrue(result["jdkBinaryBoundToScanner"])

    def test_unbound_inventory_is_inconclusive_not_clean(self):
        self.assertEqual(summarize(self.report(), True)["status"], "INCONCLUSIVE")

    def test_missing_jdk_is_inconclusive_not_clean(self):
        report = self.report()
        report["Results"][0]["Packages"][0] = {"Name": "base-files", "Version": "1"}
        self.assertIn("JDK_BINARY_COVERAGE_UNPROVEN", summarize(report, True, self.inventory())["coverageGaps"])

    def test_rejects_wrong_scanned_package_version_source_or_architecture(self):
        for key, value in (("Version", "21.0.12"), ("SrcVersion", "21.0.12"), ("SrcName", "other"),
                           ("Arch", "amd64"), ("AnalyzedBy", "jar"), ("Repository", {"Class": "third-party"})):
            with self.subTest(key=key):
                report = self.report()
                report["Results"][0]["Packages"][0][key] = value
                self.assertFalse(summarize(report, True, self.inventory())["jdkBinaryBoundToScanner"])

    def test_rejects_uninventoried_binary(self):
        report = self.report()
        report["Results"][0]["Packages"][0]["InstalledFiles"].remove(
            "/usr/lib/jvm/java-21-openjdk-arm64/lib/server/libjvm.so")
        self.assertEqual(summarize(report, True, self.inventory())["status"], "INCONCLUSIVE")

    def test_rejects_binary_inventory_mutations(self):
        raw = self.raw_inventory()
        for changed in (raw.replace(JAVA_PACKAGE_VERSION, "21.0.12"),
                        raw.replace("/bin/java\t", "/tmp/java\t"),
                        raw.replace("FILE\tlibjvm", "FILE\tjava"),
                        raw.replace("a" * 64, "x" * 64),
                        raw.replace("VERIFIED\tbuild", "VERIFIED\truntime"),
                        raw + "\n" + raw.splitlines()[0]):
            with self.subTest(changed=changed[:100]):
                with self.assertRaises(ValueError):
                    parse_binary_inventory(changed, True)

    def test_rejects_extra_compiler_in_runtime(self):
        with self.assertRaises(ValueError):
            parse_binary_inventory(self.raw_inventory(True), False)

    def test_missing_plugins_is_inconclusive(self):
        report = self.report()
        report["Results"][1]["Packages"].pop()
        self.assertEqual(summarize(report, True, self.inventory())["status"], "INCONCLUSIVE")

    def test_high_jdk_vulnerability_requires_review(self):
        report = self.report()
        report["Results"][0]["Vulnerabilities"] = [
            {"VulnerabilityID": "CVE-2099-0001", "Severity": "HIGH", "PkgName": JRE}]
        result = summarize(report, True, self.inventory())
        self.assertEqual(result["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["jdkAdvisories"], [{"id": "CVE-2099-0001", "severity": "HIGH"}])

    def test_high_findings_retain_coordinates_and_fix_versions(self):
        report = self.report()
        finding = {"VulnerabilityID": "CVE-2099-0001", "Severity": "HIGH",
                   "PkgName": "org.example:library", "InstalledVersion": "1.0", "FixedVersion": "1.1"}
        report["Results"][1]["Vulnerabilities"] = [finding, finding]
        result = summarize(report, True, self.inventory())
        self.assertEqual(result["vulnerabilityOccurrences"]["HIGH"], 2)
        self.assertEqual(result["highCriticalFindings"], [{"id": "CVE-2099-0001", "package": "org.example:library",
                         "installed": "1.0", "fixed": "1.1", "severity": "HIGH"}])
        self.assertEqual(result["status"], "REVIEW_REQUIRED")

    def test_scan_is_bound_to_exact_image_and_os(self):
        now = datetime(2026, 11, 26, tzinfo=timezone.utc)
        image = "sha256:" + "a" * 64
        report = {"ArtifactType": "container_image", "ArtifactName": image,
                  "Trivy": {"Version": "0.76.2"}, "CreatedAt": now.isoformat(),
                  "Metadata": {"ImageID": image, "OS": {"Family": "ubuntu", "Name": "24.04"}}}
        verify_scan_identity(report, image, now)
        for key, value in (("ArtifactName", "sha256:" + "b" * 64),
                           ("CreatedAt", (now - timedelta(days=1)).isoformat())):
            changed = copy.deepcopy(report)
            changed[key] = value
            with self.assertRaises(ValueError):
                verify_scan_identity(changed, image, now)

    def test_database_freshness(self):
        now = datetime(2026, 11, 26, tzinfo=timezone.utc)
        self.assertEqual(verify_db({"UpdatedAt": now.isoformat()}, now), now.isoformat())
        with self.assertRaisesRegex(ValueError, "TRIVY_DB_STALE"):
            verify_db({"UpdatedAt": (now - timedelta(days=3)).isoformat()}, now)

    def test_malformed_report_fails(self):
        with self.assertRaises(ValueError):
            summarize({"Results": "invalid"})


if __name__ == "__main__":
    unittest.main()
