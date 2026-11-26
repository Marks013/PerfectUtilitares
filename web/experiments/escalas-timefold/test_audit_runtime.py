import unittest
from audit_runtime import summarize, PLUGINS

class ImageAuditTests(unittest.TestCase):
    def report(self):
        return {"Results": [
            {"Class": "os-pkgs", "Packages": [{"Name": "openjdk-21", "Version": "21.0.12"}]},
            {"Class": "lang-pkgs", "Type": "jar",
             "Packages": [{"Name": k, "Version": v} for k, v in PLUGINS.items()]}
        ]}

    def test_scope_report(self):
        self.assertEqual(summarize(self.report(), True)["status"],
                         "NO_HIGH_OR_CRITICAL_MATCHES_IN_INVENTORIED_SCOPE")

    def test_missing_jdk_is_inconclusive_not_clean(self):
        report = self.report()
        report["Results"][0]["Packages"][0] = {"Name": "base-files", "Version": "1"}
        self.assertIn("JDK_BINARY_COVERAGE_UNPROVEN", summarize(report, True)["coverageGaps"])

    def test_missing_plugins_is_inconclusive(self):
        report = self.report()
        report["Results"][1]["Packages"].pop()
        self.assertEqual(summarize(report, True)["status"], "INCONCLUSIVE")

    def test_high_vulnerability_requires_review(self):
        report = self.report()
        report["Results"][0]["Vulnerabilities"] = [{"VulnerabilityID": "CVE-2099-0001", "Severity": "HIGH"}]
        self.assertEqual(summarize(report, True)["status"], "REVIEW_REQUIRED")

    def test_high_findings_retain_coordinates_and_fix_versions(self):
        report = self.report()
        finding = {"VulnerabilityID": "CVE-2099-0001", "Severity": "HIGH",
                   "PkgName": "org.example:library", "InstalledVersion": "1.0", "FixedVersion": "1.1"}
        report["Results"][1]["Vulnerabilities"] = [finding, finding]
        result = summarize(report, True)
        self.assertEqual(result["vulnerabilityOccurrences"]["HIGH"], 2)
        self.assertEqual(result["highCriticalFindings"], [{"id": "CVE-2099-0001", "package": "org.example:library",
                         "installed": "1.0", "fixed": "1.1", "severity": "HIGH"}])
        self.assertEqual(result["status"], "REVIEW_REQUIRED")

    def test_malformed_report_fails(self):
        with self.assertRaises(ValueError):
            summarize({"Results": "invalid"})

if __name__ == "__main__":
    unittest.main()
