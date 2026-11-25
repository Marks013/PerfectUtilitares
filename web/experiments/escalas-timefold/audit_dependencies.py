"""Audit only public Maven coordinates and hashes. Never scan payroll inputs.
The returned status concerns the resolved Java dependencies, not the base OS,
JDK, Maven plugins, legal compatibility, runtime exploitability, or production.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.request

ENDPOINT = "https://api.osv.dev/v1/querybatch"
COORD = re.compile(r"[A-Za-z0-9_.+~-]{1,160}")
SHA256 = re.compile(r"[0-9a-f]{64}")
ADVISORY = re.compile(r"[A-Za-z0-9_.:-]{1,120}")
PINNED = {("ai.timefold.solver", "timefold-solver-core"): "2.8.0",
          ("com.fasterxml.jackson.core", "jackson-databind"): "2.22.4"}
# Screening list only; other licenses/expressions require a human review, not rejection as unlawful.
RECOGNIZED = {"Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC",
              "EPL-2.0", "EDL-1.0", "CDDL-1.0", "CDDL-1.1",
              "GPL-2.0-with-classpath-exception", "GPL-2.0-only WITH Classpath-exception-2.0"}


# Specific dual-license review, bound to the exact artifact observed in
# GitHub Actions 45713735471. Do not globally allow CC0 or arbitrary OR expressions.
HDR_COORD = ("org.hdrhistogram", "HdrHistogram", "2.2.2")
HDR_SHA256 = "22d1d4316c4ec13a68b559e98c8256d69071593731da96136640f864fa14fad8"
HDR_LICENSE_SOURCE = "https://github.com/HdrHistogram/HdrHistogram/blob/HdrHistogram-2.2.2/LICENSE.txt"


def license_screen(key, item):
    licenses = item["licenses"]
    if key == HDR_COORD:
        if (item["sha256"] == HDR_SHA256 and licenses == ["BSD-2-Clause", "CC0-1.0"]):
            return False, "REVIEWED_BSD_2_CLAUSE_ALTERNATIVE", HDR_LICENSE_SOURCE
        # A changed binary or license set needs review even when all new names
        # happen to be recognized. Do not transfer a decision to another hash.
        return True, "REVIEWED_ARTIFACT_DRIFT", None
    if not licenses or not all(x in RECOGNIZED for x in licenses):
        return True, "UNCLASSIFIED_LICENSE_METADATA", None
    return False, "RECOGNIZED_METADATA_ONLY", None


def require(ok, code):
    if not ok:
        raise ValueError(code)


def load_bom(path):
    raw = path.read_bytes()
    doc = json.loads(raw)
    require(isinstance(doc, dict) and doc.get("bomFormat") == "CycloneDX", "BOM_FORMAT")
    components = doc.get("components")
    require(isinstance(components, list) and 0 < len(components) <= 500, "BOM_COMPONENTS")
    found = {}
    for component in components:
        require(isinstance(component, dict) and component.get("type") == "library", "COMPONENT_TYPE")
        coord = tuple(component.get(k) for k in ("group", "name", "version"))
        require(all(isinstance(x, str) and COORD.fullmatch(x) for x in coord), "COMPONENT_COORDINATES")
        require(not coord[0].startswith("br.perfectutilitares"), "PRIVATE_COMPONENT")
        require(isinstance(component.get("purl"), str) and component["purl"].startswith("pkg:maven/"),
                "COMPONENT_ECOSYSTEM")
        require(coord not in found, "DUPLICATE_COORDINATES")
        hashes = [str(item.get("content", "")).lower() for item in component.get("hashes", [])
                  if item.get("alg") == "SHA-256"]
        require(len(hashes) == 1 and SHA256.fullmatch(hashes[0]), "COMPONENT_HASH")
        licenses = []
        for item in component.get("licenses", []):
            if "expression" in item:
                value = item["expression"]
            else:
                license_ = item.get("license", {})
                value = license_.get("id") or license_.get("name")
            if isinstance(value, str) and 0 < len(value) <= 250:
                licenses.append(value)
        found[coord] = {"sha256": hashes[0], "licenses": sorted(set(licenses))}
    for (group, name), version in PINNED.items():
        require((group, name, version) in found, "PINNED_DEPENDENCY_MISSING")
        require(sum(key[:2] == (group, name) for key in found) == 1, "PINNED_DEPENDENCY_DRIFT")
    return found, hashlib.sha256(raw).hexdigest()


def check_jars(path, runtime):
    actual = Counter()
    names = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        fields = line.split()
        require(len(fields) == 2 and SHA256.fullmatch(fields[0])
                and re.fullmatch(r"[A-Za-z0-9_.+~-]+\.jar", fields[1])
                and fields[1] not in names, "JAR_MANIFEST")
        actual[fields[0]] += 1
        names.add(fields[1])
    expected = Counter(info["sha256"] for info in runtime.values())
    require(bool(actual) and actual == expected, "RUNTIME_BOM_JAR_MISMATCH")


def post(queries):
    data = json.dumps({"queries": queries}, separators=(",", ":")).encode()
    request = urllib.request.Request(ENDPOINT, data=data,
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "PerfectUtilitares-E2-dependency-audit/1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    require(len(raw) <= 4 * 1024 * 1024, "OSV_RESPONSE_LIMIT")
    return json.loads(raw)


def query_all(coords, send=post):
    found = {key: set() for key in coords}
    seen = set()
    pending = [(key, None) for key in sorted(coords)]
    # Bound requests and fail closed instead of treating partial pagination as clean.
    requests = 0
    while pending:
        requests += 1
        require(requests <= 30, "OSV_PAGINATION_LIMIT")
        batch, pending = pending[:50], pending[50:]
        queries = []
        for (group, name, version), token in batch:
            query = {"package": {"ecosystem": "Maven", "name": f"{group}:{name}"}, "version": version}
            if token is not None:
                query["page_token"] = token
            queries.append(query)
        reply = send(queries)
        require(isinstance(reply, dict) and isinstance(reply.get("results"), list)
                and len(reply["results"]) == len(batch), "OSV_RESULT_COUNT")
        for (key, _), item in zip(batch, reply["results"]):
            require(isinstance(item, dict), "OSV_RESULT_FORMAT")
            vulns = item.get("vulns", [])
            require(isinstance(vulns, list), "OSV_VULNS")
            for vuln in vulns:
                identifier = vuln.get("id") if isinstance(vuln, dict) else None
                require(isinstance(identifier, str) and ADVISORY.fullmatch(identifier), "OSV_ADVISORY_ID")
                found[key].add(identifier)
            token = item.get("next_page_token")
            if token:
                require(isinstance(token, str) and len(token) <= 4096 and (key, token) not in seen,
                        "OSV_PAGE_TOKEN")
                seen.add((key, token))
                pending.append((key, token))
    return {key: sorted(ids) for key, ids in found.items()}


def audit(folder, send=post):
    runtime, runtime_hash = load_bom(folder / "runtime.json")
    all_deps, all_hash = load_bom(folder / "with-tests.json")
    require(runtime.keys() <= all_deps.keys() and all(runtime[k] == all_deps[k] for k in runtime),
            "BOM_SCOPE_DRIFT")
    require(not any(k[0].startswith(("org.junit", "org.opentest4j", "org.apiguardian")) for k in runtime),
            "TEST_DEPENDENCY_IN_RUNTIME")
    require(any(k[:2] == ("org.junit.jupiter", "junit-jupiter") for k in all_deps), "TEST_SCOPE_MISSING")
    check_jars(folder / "runtime-jars.sha256", runtime)
    advisories = query_all(all_deps.keys(), send)
    rows = []
    for key in sorted(all_deps):
        item = all_deps[key]
        licenses = item["licenses"]
        review, basis, source = license_screen(key, item)
        rows.append({"group": key[0], "artifact": key[1], "version": key[2],
                     "scope": "runtime" if key in runtime else "test-only",
                     "sha256": item["sha256"], "licenses": licenses,
                     "licenseReview": review, "licenseBasis": basis, "licenseSource": source,
                     "advisories": advisories[key]})
    findings = sum(bool(row["advisories"]) or row["licenseReview"] for row in rows)
    return {"status": "REVIEW_REQUIRED" if findings else "NO_MATCHES_IN_CHECKED_SCOPE",
            "source": "OSV public Maven advisory API", "checkedAt": datetime.now(timezone.utc).isoformat(),
            "runtimeBomSha256": runtime_hash, "withTestsBomSha256": all_hash,
            "runtimeComponents": len(runtime), "testOnlyComponents": len(all_deps) - len(runtime),
            "componentsWithAdvisories": sum(bool(row["advisories"]) for row in rows),
            "componentsNeedingLicenseReview": sum(row["licenseReview"] for row in rows),
            "components": rows}


def main():
    folder = Path(sys.argv[1])
    try:
        report = audit(folder)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        # No raw exceptions, request/response payload, credentials or local paths.
        report = {"status": "INCONCLUSIVE", "reason": "INVENTORY_OR_ADVISORY_QUERY_FAILED",
                  "checkedAt": datetime.now(timezone.utc).isoformat()}
    (folder / "dependency-audit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "components"}, separators=(",", ":")))
    # Public coordinates only; the full license metadata stays in the artifact.
    # Show the precise pending review without requiring a ZIP download.
    for row in report.get("components", []):
        if row["licenseReview"] or row["advisories"] or row["licenseSource"] is not None:
            print(json.dumps({k: row[k] for k in ("group", "artifact", "version", "scope",
                         "sha256", "licenseReview", "licenseBasis", "licenseSource", "advisories")},
                             separators=(",", ":")))
    return 0 if report["status"] == "NO_MATCHES_IN_CHECKED_SCOPE" else 1


if __name__ == "__main__":
    sys.exit(main())
