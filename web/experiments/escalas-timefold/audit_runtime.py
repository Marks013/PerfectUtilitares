"""Scope-aware image audit. Never equate no matches with complete JDK coverage."""
import json
import re
from datetime import datetime, timezone, timedelta
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
JAVA_PACKAGE_VERSION = "21.0.13.1+2-1~24.04.1"
JRE = "openjdk-21-jre-headless"
JDK = "openjdk-21-jdk-headless"
JAVA_ADVISORY = "https://ubuntu.com/security/notices/USN-9156-1"
SHA256 = re.compile(r"[0-9a-f]{64}")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def expected_packages(build):
    return {JRE, JDK} if build else {JRE}


def parse_binary_inventory(raw, build=False):
    packages, files, marker = {}, {}, None
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) == 6 and parts[0] == "PACKAGE":
            _, name, version, arch, source, status = parts
            require(name in expected_packages(build) and name not in packages, "JDK_PACKAGE_SET")
            require(version == JAVA_PACKAGE_VERSION and arch in ("arm64", "amd64")
                    and source == "openjdk-21" and status == "install ok installed", "JDK_PACKAGE_IDENTITY")
            packages[name] = {"version": version, "arch": arch, "source": source}
        elif len(parts) == 5 and parts[0] == "FILE":
            _, name, path, package, digest = parts
            require(name not in files and SHA256.fullmatch(digest), "JDK_FILE_IDENTITY")
            files[name] = {"path": path, "package": package, "sha256": digest}
        elif len(parts) == 3 and parts[0] == "VERIFIED":
            require(marker is None, "JDK_VERIFY_MARKER")
            marker = parts[1:]
        else:
            raise ValueError("JDK_INVENTORY_FORMAT")
    require(set(packages) == expected_packages(build), "JDK_PACKAGE_SET")
    arch = packages[JRE]["arch"]
    require(all(p["arch"] == arch for p in packages.values()), "JDK_ARCH_DRIFT")
    require(marker == ["build" if build else "runtime", arch], "JDK_VERIFY_MARKER")
    home = "/usr/lib/jvm/java-21-openjdk-" + arch
    expected = {"java": ("/bin/java", JRE), "libjvm": ("/lib/server/libjvm.so", JRE),
                "modules": ("/lib/modules", JRE)}
    if build:
        expected["javac"] = ("/bin/javac", JDK)
    require(set(files) == set(expected), "JDK_FILE_SET")
    for name, (path, owner) in expected.items():
        require(files[name]["path"] == home + path and files[name]["package"] == owner,
                "JDK_FILE_OWNER_OR_PATH")
    return {"packages": packages, "files": files, "arch": arch}


def verify_scan_identity(report, image, now=None):
    require(IMAGE_ID.fullmatch(image) is not None, "IMAGE_ID")
    metadata = report.get("Metadata") or {}
    os_info = metadata.get("OS") or {}
    require(report.get("ArtifactType") == "container_image" and report.get("ArtifactName") == image
            and metadata.get("ImageID") == image, "SCAN_IMAGE_IDENTITY")
    require(os_info.get("Family") == "ubuntu" and os_info.get("Name") == "24.04", "SCAN_OS_IDENTITY")
    require((report.get("Trivy") or {}).get("Version") == "0.76.2", "SCAN_TOOL_VERSION")
    stamp = datetime.fromisoformat(report["CreatedAt"].replace("Z", "+00:00"))
    age = (now or datetime.now(timezone.utc)) - stamp
    require(-timedelta(minutes=5) <= age <= timedelta(hours=2), "SCAN_AGE")


def verify_db(metadata, now=None):
    stamp = datetime.fromisoformat(metadata["UpdatedAt"].replace("Z", "+00:00"))
    age = (now or datetime.now(timezone.utc)) - stamp
    require(-timedelta(minutes=5) <= age <= timedelta(hours=48), "TRIVY_DB_STALE")
    return metadata["UpdatedAt"]


def summarize(report, build=False, binary_inventory=None):
    require(isinstance(report, dict) and isinstance(report.get("Results"), list), "SCAN_SCHEMA")
    results = report["Results"]
    counts = {key: 0 for key in SEVERITIES}
    packages = set()
    high_findings = set()
    os_packages = 0
    java_packages = 0
    jdk_packages = {}
    jdk_findings = set()
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
            if kind == "os-pkgs" and result.get("Type") == "ubuntu" and name.startswith("openjdk-"):
                require(name not in jdk_packages, "DUPLICATE_JDK_SCAN_PACKAGE")
                jdk_packages[name] = pkg
        for vuln in vulnerabilities:
            require(isinstance(vuln, dict) and isinstance(vuln.get("VulnerabilityID"), str), "SCAN_VULNERABILITY")
            severity = vuln.get("Severity", "UNKNOWN")
            require(severity in SEVERITIES, "SCAN_SEVERITY")
            counts[severity] += 1
            if kind == "os-pkgs" and str(vuln.get("PkgName", "")).startswith("openjdk-"):
                jdk_findings.add((vuln["VulnerabilityID"], severity))
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
    jdk_bound = False
    if binary_inventory is not None and set(jdk_packages) == expected_packages(build):
        jdk_bound = True
        for name, expected in binary_inventory["packages"].items():
            package = jdk_packages[name]
            if (package.get("Version") != expected["version"]
                    or package.get("SrcName") != expected["source"]
                    or package.get("SrcVersion") != expected["version"]
                    or package.get("Arch") != expected["arch"]
                    or package.get("AnalyzedBy") != "dpkg"
                    or (package.get("Repository") or {}).get("Class") != "official"):
                jdk_bound = False
        for evidence in binary_inventory["files"].values():
            package = jdk_packages[evidence["package"]]
            if evidence["path"] not in (package.get("InstalledFiles") or []):
                jdk_bound = False
    if not jdk_bound:
        missing.append("JDK_BINARY_COVERAGE_UNPROVEN")
    if missing_plugins:
        missing.append("MAVEN_PLUGIN_COVERAGE_INCOMPLETE")
    return {"osPackages": os_packages, "javaPackages": java_packages,
            "jdkPackagesDetected": len(jdk_packages), "jdkBinaryBoundToScanner": jdk_bound,
            "jdkAdvisories": [{"id": i, "severity": s} for i, s in sorted(jdk_findings)],
            "missingRequiredPlugins": missing_plugins,
            "vulnerabilityOccurrences": counts, "coverageGaps": missing,
            "highCriticalFindings": [{"id": v[0], "package": v[1], "installed": v[2],
                                      "fixed": v[3], "severity": v[4]} for v in sorted(high_findings)],
            "status": "REVIEW_REQUIRED" if counts["HIGH"] or counts["CRITICAL"] else
                      "INCONCLUSIVE" if missing else "NO_HIGH_OR_CRITICAL_MATCHES_IN_INVENTORIED_SCOPE"}


def main():
    folder = Path(sys.argv[1])
    try:
        java, scans = {}, {}
        db_updated = verify_db(json.loads((folder / "trivy-db-metadata.json").read_text()))
        for target in ("runtime", "build"):
            build_mode = target == "build"
            image = (folder / f"{target}-image.txt").read_text().strip()
            version = (folder / f"{target}-java-version.txt").read_text()
            release = (folder / f"{target}-java-release.txt").read_text()
            require('21.0.13.1' in version and 'JAVA_VERSION="21.0.13.1"' in release
                    and 'IMPLEMENTOR="Ubuntu"' in release, "JDK_PATCH_VERSION_MISMATCH")
            inventory = parse_binary_inventory((folder / f"{target}-jdk-inventory.tsv").read_text(), build_mode)
            require(inventory["arch"] == "arm64", "JDK_AUDIT_ARCH")
            report = json.loads((folder / f"{target}-trivy.json").read_text())
            verify_scan_identity(report, image)
            require((report["Metadata"].get("ImageConfig") or {}).get("architecture") == inventory["arch"],
                    "SCAN_ARCH_IDENTITY")
            scans[target] = summarize(report, build_mode, inventory)
            java[target] = {"image": image, "packageVersion": JAVA_PACKAGE_VERSION, "vendor": "Ubuntu",
                            "patchAdvisory": JAVA_ADVISORY, "inventory": inventory,
                            "binaryAdvisoryCoverageProven": scans[target]["jdkBinaryBoundToScanner"]}
        for name in ("java", "libjvm", "modules"):
            require(java["runtime"]["inventory"]["files"][name] == java["build"]["inventory"]["files"][name],
                    "BUILD_RUNTIME_JRE_DRIFT")
        maven = (folder / "build-maven-version.txt").read_text()
        require("Apache Maven 3.10.2" in maven, "MAVEN_PATCH_VERSION_MISMATCH")
        runtime, build = scans["runtime"], scans["build"]
        result = {"scope": "runtime-and-build-images", "runtime": runtime, "build": build,
                  "javaPatchProvenance": java, "trivyDatabaseUpdatedAt": db_updated,
                  "mavenVersion": "3.10.2", "notLegalOrProductionCertification": True}
        result["decision"] = "REVIEW_REQUIRED" if "REVIEW_REQUIRED" in (runtime["status"], build["status"]) else (
            "INCONCLUSIVE" if "INCONCLUSIVE" in (runtime["status"], build["status"]) else "SCOPED_NO_HIGH_CRITICAL_MATCHES")
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        code = str(error)
        result = {"decision": "INCONCLUSIVE", "reason": code if re.fullmatch("[A-Z_]{1,80}", code)
                  else "SCAN_MISSING_OR_INVALID"}
    (folder / "runtime-audit-summary.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["decision"] == "SCOPED_NO_HIGH_CRITICAL_MATCHES" else 1


if __name__ == "__main__":
    sys.exit(main())
