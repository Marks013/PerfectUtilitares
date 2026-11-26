"""Verify the locked upstream workspace, dependency inventory and demo output.

Only synthetic upstream examples/public package metadata. Does not certify
PerfectUtilitares business semantics or the complete native toolchain.
"""
from collections import Counter
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import re
import sys
import tomllib

REVISION = "78889c3ff9fda158c70e6a1f67f8c7f0fdae922e"
LOCK_BLOB = "8d748afc1df1702f11d247d471edea6fda9dc4f8"
REGISTRY = "registry+https://github.com/rust-lang/crates.io-index"
VERSION = "0.31.2"
CORE = {"solverforge", "solverforge-core", "solverforge-macros", "solverforge-scoring",
        "solverforge-config", "solverforge-solver", "solverforge-cvrp"}
ALL_CRATES = CORE | {"solverforge-bridge", "solverforge-console"}
NURSES = {"Amina", "Bruno", "Chiara"}


def check(ok, code):
    if not ok:
        raise ValueError(code)


def git_blob(raw):
    return hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()


def inspect_lock(raw, expected_blob=LOCK_BLOB):
    check(git_blob(raw) == expected_blob, "LOCK_IDENTITY")
    doc = tomllib.loads(raw.decode("utf-8"))
    entries = doc.get("package")
    check(isinstance(entries, list) and 0 < len(entries) <= 500, "LOCK_FORMAT")
    seen = set()
    result = []
    for item in entries:
        name, version, source = item["name"], item["version"], item.get("source")
        key = (name, version, source)
        check(isinstance(name, str) and isinstance(version, str) and key not in seen, "LOCK_PACKAGE")
        seen.add(key)
        checksum = item.get("checksum")
        if source is not None:
            check(source == REGISTRY and isinstance(checksum, str)
                  and re.fullmatch("[0-9a-f]{64}", checksum) is not None, "LOCK_REGISTRY_CHECKSUM")
        else:
            check(checksum is None and ((name in ALL_CRATES and version == VERSION)
                  or (name in {"minimal-shift-scheduling", "list-tsp", "mixed-job-shop",
                               "nqueens", "scalar-graph-coloring"} and version == "0.0.0")), "LOCK_LOCAL_PACKAGE")
        result.append({"name": name, "version": version, "source": source, "checksum": checksum})
    check({p["name"] for p in result if p["source"] is None} >= ALL_CRATES, "LOCK_SOLVER_CRATES")
    return result


def inspect_metadata(lock, metadata):
    check(metadata.get("version") == 1 and isinstance(metadata.get("packages"), list), "METADATA_FORMAT")
    indexed = {(p["name"], p["version"], p["source"]): dict(p) for p in lock}
    ids = set()
    seen = set()
    for pkg in metadata["packages"]:
        key = (pkg["name"], pkg["version"], pkg.get("source"))
        check(key in indexed and pkg["id"] not in ids and key not in seen, "METADATA_LOCK_MISMATCH")
        ids.add(pkg["id"])
        seen.add(key)
        license_ = pkg.get("license")
        license_file = pkg.get("license_file")
        check(license_ is None or isinstance(license_, str), "LICENSE_METADATA")
        check(license_file is None or isinstance(license_file, str), "LICENSE_FILE_METADATA")
        # Do not copy local paths or full Cargo metadata to the report.
        indexed[key].update({"presentInArm64Metadata": True, "license": license_,
                             "declaresLicenseFile": bool(license_file)})
    resolved = metadata.get("resolve")
    check(isinstance(resolved, dict) and isinstance(resolved.get("nodes"), list), "RESOLVE_FORMAT")
    nodes = {node["id"]: node for node in resolved["nodes"]}
    by_id = {pkg["id"]: pkg for pkg in metadata["packages"]}
    check(set(nodes) <= ids, "RESOLVE_UNKNOWN_PACKAGE")
    roots = [pkg["id"] for pkg in metadata["packages"] if pkg["name"] == "minimal-shift-scheduling"
             and pkg.get("source") is None]
    check(len(roots) == 1 and roots[0] in nodes, "EXAMPLE_ROOT")
    # Cargo metadata may unify features across workspace members; this is a
    # conservative normal/build dependency closure, not binary reachability.
    stack = [roots[0]]
    visited = set()
    while stack:
        node_id = stack.pop()
        if node_id in visited:
            continue
        check(node_id in nodes, "RESOLVE_DEPENDENCY_MISSING")
        visited.add(node_id)
        for dep in nodes[node_id].get("deps", []):
            kinds = dep.get("dep_kinds", [])
            if any(kind.get("kind") in (None, "normal", "build") for kind in kinds):
                stack.append(dep["pkg"])
    used = {by_id[node_id]["name"] for node_id in visited}
    check(CORE <= used, "FACADE_DEPENDENCIES")
    check("solverforge-bridge" not in used, "UNEXPECTED_BINDING")
    for node_id in visited:
        pkg = by_id[node_id]
        key = (pkg["name"], pkg["version"], pkg.get("source"))
        indexed[key]["inConservativeExampleClosure"] = True
        indexed[key]["resolvedFeatures"] = sorted(nodes[node_id].get("features", []))
    records = sorted(indexed.values(), key=lambda p: (p["name"], p["version"], p["source"] or ""))
    return {"upstreamRevision": REVISION, "cargoLockBlob": LOCK_BLOB,
            "workspaceLockPackages": len(records),
            "registryPackages": sum(p["source"] is not None for p in records),
            "conservativeExampleClosure": len(visited),
            "metadataScope": "arm64-filtered-workspace-feature-union-not-binary-reachability",
            "licenseMetadataNeedsReview": [p["name"] for p in records
                if p.get("inConservativeExampleClosure") and not p.get("license") and not p.get("declaresLicenseFile")],
            "packages": records}


def verify_rustsec(report, lock_count, database_commit, now=None):
    db = report.get("database")
    check(isinstance(db, dict) and db.get("last-commit") == database_commit
          and re.fullmatch("[0-9a-f]{40}", database_commit) is not None
          and type(db.get("advisory-count")) is int and db["advisory-count"] > 0,
          "RUSTSEC_DATABASE")
    stamp = datetime.fromisoformat(db["last-updated"].replace("Z", "+00:00"))
    age = (now or datetime.now(timezone.utc)) - stamp
    check(-timedelta(minutes=5) <= age <= timedelta(days=30), "RUSTSEC_DATABASE_STALE")
    check(report.get("lockfile", {}).get("dependency-count") == lock_count, "RUSTSEC_LOCK_SCOPE")
    settings = report.get("settings")
    check(isinstance(settings, dict) and settings.get("ignore") == []
          and settings.get("target_arch") == [] and settings.get("target_os") == []
          and settings.get("severity") is None, "RUSTSEC_FILTERS")
    check(report.get("vulnerabilities") == {"found": False, "count": 0, "list": []}, "RUSTSEC_FINDINGS")
    warnings = report.get("warnings")
    check(isinstance(warnings, dict) and all(value == [] for value in warnings.values()), "RUSTSEC_WARNINGS")
    return {"status": "NO_RUSTSEC_FINDINGS_IN_LOCKED_SCOPE", "databaseCommit": database_commit,
            "databaseUpdatedAt": db["last-updated"], "advisoriesChecked": db["advisory-count"],
            "lockPackages": lock_count, "universalSecurityCertification": False}


def verify_demo(raw):
    score = None
    assignments = {}
    for line in raw.splitlines():
        if line == "score: 0hard/0soft":
            check(score is None, "DUPLICATE_SCORE")
            score = line
            continue
        match = re.fullmatch(r"day ([0-5]) slot ([01]) -> (Amina|Bruno|Chiara)", line)
        check(match is not None, "UNEXPECTED_DEMO_OUTPUT")
        day, slot, nurse = int(match[1]), int(match[2]), match[3]
        check((day, slot) not in assignments, "DUPLICATE_DEMO_CELL")
        assignments[day, slot] = nurse
    check(score is not None and set(assignments) == {(d, s) for d in range(6) for s in range(2)}, "DEMO_INCOMPLETE")
    for day in range(6):
        check(assignments[day, 0] != assignments[day, 1], "DEMO_DOUBLE_BOOKING")
    totals = Counter(assignments.values())
    check(set(totals) == NURSES and all(count == 4 for count in totals.values()), "DEMO_WORKLOAD")
    for nurse in NURSES:
        for start in range(4):
            check(not all(nurse in {assignments[d, 0], assignments[d, 1]} for d in range(start, start + 3)),
                  "DEMO_STREAK")
    return {"status": "UPSTREAM_SMOKE_VALID", "assignments": 12, "days": 6,
            "people": 3, "hard": 0, "soft": 0, "productionParity": False}


def main():
    mode = sys.argv[1]
    if mode == "inventory":
        lock = inspect_lock(Path(sys.argv[2]).read_bytes())
        output = inspect_metadata(lock, json.loads(Path(sys.argv[3]).read_text()))
    elif mode == "rustsec":
        lock = inspect_lock(Path(sys.argv[2]).read_bytes())
        report = json.loads(Path(sys.argv[3]).read_text())
        commit = Path(sys.argv[4]).read_text().splitlines()[0]
        output = verify_rustsec(report, len(lock), commit)
    elif mode == "demo":
        output = verify_demo(Path(sys.argv[2]).read_text())
    else:
        raise ValueError("MODE")
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as error:
        code = str(error)
        print("SOLVERFORGE_INSTALLATION_REJECTED:" + (code if re.fullmatch("[A-Z_]{1,80}", code)
              else "INVALID_EVIDENCE"), file=sys.stderr)
        sys.exit(1)
