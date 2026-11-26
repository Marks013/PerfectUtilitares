"""Scope-aware image audit. Never equate no matches with complete JDK coverage."""
import json
from pathlib import Path
import sys

PLUGINS = {
    "org.apache.maven.plugins:maven-compiler-plugin": "3.16.0",
    "org.apache.maven.plugins:maven-surefire-plugin": "3.6.1",
    "org.apache.maven.plugins:maven-dependency-plugin": "3.11.0",
    "org.apache.maven.plugins:maven-enforcer-plugin": "3.7.0",
    "org.apache.maven.plugins:maven-resources-plugin": "3.5.0",
    "org.apache.maven.plugins:maven-jar-plugin": "3.5.1",
}
SEVERITIES = ("UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def summarize(report, build=False):
    require(isinstance(report, dict) and isinstance(report.get("Results"), list), "SCAN_SCHEMA")
    results = report["Results"]
    counts = {key: 0 for key in SEVERITIES}
    packages = set()
    high_findings = set()
    os_packages = 0
    java_packages = 0
    jdk_packages = set()
    for result in results:
        require(isinstance(result, dict), "SCAN_RESULT")
        kind = result.get("Class")
        pkg_list = result.get("Packages") or []
        vulnerabilities = result.get("Vulnerabilities") or []
        require(isinstance(pkg_list, list) and isinstance(vulnerabilities, list), "SCAN_LIST")
        for pkg in pkg_list:
            require(isinstance(pkg, dict), "SCAN_PACKAGE")
            name, version = pkg.get("Name"), pkg.get("Version")
            if not isinstance(name, str) or not isinstance(version, str):
                continue
            packages.add((name, version))
            if kind == "os-pkgs":
                os_packages += 1
            if kind == "lang-pkgs" and result.get("Type") in ("jar", "pom"):
                java_packages += 1
            lower = name.lower()
            if ("temurin" in lower or "openjdk" in lower or "adoptium" in lower) and ("21" in lower or version.startswith("21")):
                jdk_packages.add((name, version))
        for vuln in vulnerabilities:
            require(isinstance(vuln, dict) and isinstance(vuln.get("VulnerabilityID"), str), "SCAN_VULNERABILITY")
            severity = vuln.get("Severity", "UNKNOWN")
            require(severity in SEVERITIES, "SCAN_SEVERITY")
            counts[severity] += 1
            if severity in ("HIGH", "CRITICAL"):
                fields = tuple(str(vuln.get(key, ""))[:300] for key in
                               ("VulnerabilityID", "PkgName", "InstalledVersion", "FixedVersion"))
                high_findings.add((*fields, severity))
    missing_plugins = [name for name, version in PLUGINS.items()
                       if build and (name, version) not in packages and (name.split(":")[1], version) not in packages]
    missing = []
    if not os_packages:
        missing.append("OS_PACKAGES_NOT_INVENTORIED")
    if not java_packages:
        missing.append("JAVA_PACKAGES_NOT_INVENTORIED")
    if not jdk_packages:
        missing.append("JDK_BINARY_COVERAGE_UNPROVEN")
    if missing_plugins:
        missing.append("MAVEN_PLUGIN_COVERAGE_INCOMPLETE")
    return {"osPackages": os_packages, "javaPackages": java_packages,
            "jdkPackagesDetected": len(jdk_packages), "missingRequiredPlugins": missing_plugins,
            "vulnerabilityOccurrences": counts, "coverageGaps": missing,
            "highCriticalFindings": [{"id": v[0], "package": v[1], "installed": v[2],
                                      "fixed": v[3], "severity": v[4]} for v in sorted(high_findings)],
            "status": "REVIEW_REQUIRED" if counts["HIGH"] or counts["CRITICAL"] else
                      "INCONCLUSIVE" if missing else "NO_HIGH_OR_CRITICAL_MATCHES_IN_INVENTORIED_SCOPE"}


def main():
    folder = Path(sys.argv[1])
    try:
        runtime = summarize(json.loads((folder / "runtime-trivy.json").read_text()))
        build = summarize(json.loads((folder / "build-trivy.json").read_text()), build=True)
        java = {}
        for target in ("runtime", "build"):
            version = (folder / f"{target}-java-version.txt").read_text()
            release = (folder / f"{target}-java-release.txt").read_text()
            require('21.0.13.1' in version and 'Temurin' in version
                    and 'JAVA_VERSION="21.0.13.1"' in release
                    and 'IMPLEMENTOR="Eclipse Adoptium"' in release, "JDK_PATCH_VERSION_MISMATCH")
            java[target] = {"version": "21.0.13.1", "vendor": "Eclipse Adoptium",
                            "patchedArchiveVerifiedAtBuild": True,
                            "binaryAdvisoryCoverageProven": not any(
                                gap == "JDK_BINARY_COVERAGE_UNPROVEN" for gap in
                                (runtime if target == "runtime" else build)["coverageGaps"])}
        maven = (folder / "build-maven-version.txt").read_text()
        require("Apache Maven 3.10.2" in maven, "MAVEN_PATCH_VERSION_MISMATCH")
        result = {"scope": "runtime-and-build-images", "runtime": runtime, "build": build,
                  "javaPatchProvenance": java, "mavenVersion": "3.10.2",
                  "notLegalOrProductionCertification": True}
        result["decision"] = "REVIEW_REQUIRED" if "REVIEW_REQUIRED" in (runtime["status"], build["status"]) else (
            "INCONCLUSIVE" if "INCONCLUSIVE" in (runtime["status"], build["status"]) else "SCOPED_NO_HIGH_CRITICAL_MATCHES")
    except (OSError, ValueError, KeyError, TypeError):
        result = {"decision": "INCONCLUSIVE", "reason": "SCAN_MISSING_OR_INVALID"}
    (folder / "runtime-audit-summary.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["decision"] == "SCOPED_NO_HIGH_CRITICAL_MATCHES" else 1


if __name__ == "__main__":
    sys.exit(main())
