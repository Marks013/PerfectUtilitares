"""Resolved Rust graph inventory and OSV audit, no private input or credentials."""
import json
import pathlib
import re
import sys
import tomllib
import urllib.request
from datetime import datetime, timezone

UPSTREAM = "78889c3ff9fda158c70e6a1f67f8c7f0fdae922e"
NAME = re.compile(r"[A-Za-z0-9_.+-]{1,120}")
SHA = re.compile(r"[0-9a-f]{64}")

def require(ok, code):
    if not ok:
        raise ValueError(code)

def inventory(metadata, lock):
    packages = {p["id"]:p for p in metadata["packages"]}
    nodes = {n["id"]:n for n in metadata["resolve"]["nodes"]}
    roots = [p for p in packages.values() if p["name"]=="perfectutilitares-solverforge-spike"]
    require(len(roots)==1,"ROOT")
    root = roots[0]["id"]
    registry = {(p["name"],p["version"]):p for p in lock["package"] if p.get("source","").startswith("registry+")}
    pending,visited,items=[root],set(),[]
    while pending:
        identifier=pending.pop()
        if identifier in visited:
            continue
        visited.add(identifier)
        p=packages[identifier]
        pending.extend(d["pkg"] for d in nodes[identifier]["deps"])
        if identifier==root:
            continue
        name,version=p["name"],p["version"]
        require(NAME.fullmatch(name) and NAME.fullmatch(version),"COORDINATES")
        source=p.get("source")
        if source is None:
            require((name=="solverforge" or name.startswith("solverforge-")) and version=="0.31.2","PATH_DEPENDENCY")
            provenance={"source":"pinned-official-workspace","revision":UPSTREAM}
        else:
            require(source=="registry+https://github.com/rust-lang/crates.io-index","REGISTRY_SOURCE")
            record=registry.get((name,version))
            require(record and SHA.fullmatch(record.get("checksum","")),"LOCK_CHECKSUM")
            provenance={"source":"crates.io","checksum":record["checksum"]}
        license_=p.get("license")
        require(isinstance(license_,str) and 0<len(license_)<=250 or p.get("license_file"),"LICENSE_METADATA")
        items.append({"name":name,"version":version,"license":license_,**provenance})
    require(any(p["name"]=="solverforge" for p in items) and len(items)<=500,"RESOLVED_GRAPH")
    return sorted(items,key=lambda p:(p["name"],p["version"]))

def lock_inventory(lock):
    result = {}
    for p in lock["package"]:
        source = p.get("source")
        if source is None:
            continue
        require(source == "registry+https://github.com/rust-lang/crates.io-index", "LOCK_REGISTRY")
        name, version = p["name"], p["version"]
        require(NAME.fullmatch(name) and NAME.fullmatch(version) and SHA.fullmatch(p.get("checksum", "")), "LOCK_COORDINATE")
        require((name, version) not in result, "LOCK_DUPLICATE")
        result[name, version] = {"name": name, "version": version, "checksum": p["checksum"], "source": "crates.io"}
    require(0 < len(result) <= 500, "LOCK_SCOPE")
    return [result[key] for key in sorted(result)]


def query(items):
    pending=[(i,None) for i in range(len(items))]
    seen=set()
    matches={i:set() for i in range(len(items))}
    for _ in range(30):
        if not pending:
            break
        batch,pending=pending[:50],pending[50:]
        queries=[]
        for i,token in batch:
            p=items[i]
            q={"package":{"name":p["name"],"ecosystem":"crates.io"},"version":p["version"]}
            if token is not None:q["page_token"]=token
            queries.append(q)
        req=urllib.request.Request("https://api.osv.dev/v1/querybatch",
             data=json.dumps({"queries":queries}).encode(),headers={"Content-Type":"application/json"})
        with urllib.request.urlopen(req,timeout=20) as response:
            raw=response.read(4*1024*1024+1)
        require(len(raw)<=4*1024*1024,"RESPONSE_LIMIT")
        result=json.loads(raw)["results"]
        require(isinstance(result,list) and len(result)==len(batch),"RESULT_COUNT")
        for (i,_),r in zip(batch,result):
            require(isinstance(r,dict) and "error" not in r,"RESULT")
            findings=r.get("vulns",[])
            require(isinstance(findings,list),"ADVISORIES")
            for v in findings:
                value=v.get("id")
                require(isinstance(value,str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,120}",value),"ADVISORY_ID")
                matches[i].add(value)
            token=r.get("next_page_token")
            require(token is None or isinstance(token,str),"PAGINATION")
            if token:
                require(len(token)<=4096 and (i,token) not in seen,"PAGINATION")
                seen.add((i,token))
                pending.append((i,token))
    require(not pending,"PAGINATION_LIMIT")
    return {i:sorted(v) for i,v in matches.items()}

def main():
    metadata_path,lock_path,output=map(pathlib.Path,sys.argv[1:4])
    try:
        lock = tomllib.loads(lock_path.read_text())
        items=inventory(json.loads(metadata_path.read_text()),lock)
        locked=lock_inventory(lock)
        coordinates={(p["name"],p["version"]):p for p in locked}
        for p in items:
            coordinates.setdefault((p["name"],p["version"]),p)
        queried=[coordinates[key] for key in sorted(coordinates)]
        found=query(queried)
        by_key={(p["name"],p["version"]):found[i] for i,p in enumerate(queried)}
        resolved_keys={(p["name"],p["version"]) for p in items}
        for item in items:item["advisories"]=by_key[item["name"],item["version"]]
        for item in locked:
            key=(item["name"],item["version"])
            item["advisories"]=by_key[key]
            item["reachable"]=key in resolved_keys
        count=sum(bool(p["advisories"]) for p in items)
        lock_count=sum(bool(p["advisories"]) for p in locked)
        historical=[{"id":"RUSTSEC-2026-0190","name":"anyhow","version":"1.0.102","reachable":p["reachable"],
                     "evidence":"prior RustSec run 45737356746; verify against current advisory before adoption"}
                    for p in locked if (p["name"],p["version"])==("anyhow","1.0.102")]
        corrected=[{"id":"RUSTSEC-2026-0190","name":"anyhow","version":"1.0.103",
                    "reachable":p["reachable"],"advisories":p["advisories"],
                    "source":"https://github.com/RustSec/advisory-db/blob/main/crates/anyhow/RUSTSEC-2026-0190.md"}
                   for p in locked if (p["name"],p["version"])==("anyhow","1.0.103")]
        require(len(corrected)==1 and corrected[0]["reachable"] is False,"ANYHOW_PATCH_SCOPE_DRIFT")
        report={"status":"REVIEW_REQUIRED" if count or lock_count or historical else "NO_MATCHES_IN_RESOLVED_CRATE_SCOPE",
                "checkedAt":datetime.now(timezone.utc).isoformat(),"upstreamRevision":UPSTREAM,
                "resolvedCrates":len(items),"componentsWithAdvisories":count,"components":items,
                "lockedRegistryCrates":len(locked),"lockedComponentsWithAdvisories":lock_count,
                "lockedRegistryInventory":locked,"historicalUnresolvedFindings":historical,
                "reviewedLockCorrections":corrected,
                "scope":"reachable cargo graph and entire pinned registry lock; not rustc, std or musl",
                "notProductionOrLegalCertification":True}
    except (OSError,ValueError,KeyError,TypeError,AttributeError,OverflowError):
        report={"status":"INCONCLUSIVE","reason":"INVENTORY_OR_OSV_QUERY_FAILED"}
    output.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({k:v for k,v in report.items() if k not in ("components","lockedRegistryInventory")},separators=(",",":")))
    return 0 if report["status"]=="NO_MATCHES_IN_RESOLVED_CRATE_SCOPE" else 1

if __name__=="__main__":
    sys.exit(main())
