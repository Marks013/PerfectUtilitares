"""E2 exploratory proof. No production acceptance or comparison winner."""
import json
import math
import re
import sys

SCENARIOS = ("team-10-week", "branch-50-four-weeks", "team-10-week-repair")
ENGINES = ("ortools", "timefold")
BASE = "f78c691edbeaf16283f534bcacd8db1b4b7d5e66"


def check(ok, code):
    if not ok:
        raise ValueError(code)


def verify(rows):
    check(all(r.get("kind") in ("measurement", "summary", "paired-coverage") for r in rows), "UNEXPECTED_ROW")
    check(len(rows) == 51, "ROW_COUNT")  # 3*(10 measurements + 5 pairs + 2 summaries)
    identities = {}
    reports = []
    for case in SCENARIOS:
        case_rows = [r for r in rows if r.get("scenario") == case]
        measurements = [r for r in case_rows if r["kind"] == "measurement"]
        pairs = [r for r in case_rows if r["kind"] == "paired-coverage"]
        summaries = [r for r in case_rows if r["kind"] == "summary"]
        check(len(measurements) == 10 and len(pairs) == 5 and len(summaries) == 2, "SCENARIO_COUNT:" + case)
        first = measurements[0]
        check(isinstance(first.get("inputHash"), str) and re.fullmatch("[0-9a-f]{64}", first["inputHash"]), "HASH")
        check(first.get("baselineRevision") == BASE and first.get("arch") == "arm64", "BASELINE")
        for r in case_rows:
            for k in ("inputHash", "revision", "evaluatorTree", "profile", "baselineRevision", "arch", "resources"):
                check(r.get(k) == first.get(k), "IDENTITY_DRIFT:" + case)
        check(first.get("resources") == {"cpus": 1, "memoryMiB": 1536, "pids": 64}, "QUOTA")
        for rep in range(5):
            actual = [r["engine"] for r in measurements if r["repetition"] == rep]
            expected = list(ENGINES if rep % 2 == 0 else reversed(ENGINES))
            check(actual == expected and sum(r["repetition"] == rep for r in pairs) == 1, "PAIR_ORDER")
        report = {"scenario": case}
        for engine in ENGINES:
            trials = [r for r in measurements if r.get("engine") == engine]
            check(len(trials) == 5, "TRIAL_COUNT")
            for r in trials:
                identity = r["identity"]
                check(identity["architecture"] == "arm64" and re.fullmatch("sha256:[0-9a-f]{64}", identity["image"]), "IMAGE")
                check(identity["revision"] == (BASE if engine == "ortools" else r["revision"]), "IMAGE_REVISION")
                check(identities.setdefault(engine, identity) == identity, "IMAGE_DRIFT")
                feasible = r.get("rawStatus") in ("FEASIBLE", "OPTIMAL")
                if engine == "timefold":
                    check(r.get("rawStatus") in ("FEASIBLE", "UNKNOWN") and r.get("httpStatus") == 200, "CANDIDATE_STATUS:" + case)
                if feasible:
                    check((r.get("rawAssessment") or {}).get("valid") is True
                          and (r.get("rawAssessment") or {}).get("complete") is True, "INVALID_FEASIBLE:" + case)
                    check((r.get("finalAssessment") or {}).get("valid") is True, "CLIENT_REJECTED:" + case)
                check(isinstance(r["productSeconds"], (float, int)) and math.isfinite(r["productSeconds"]), "TIME")
            accepted = sum(r.get("engineNew") is True for r in trials)
            valid = sum(r.get("timely") is True and (r.get("finalAssessment") or {}).get("valid") is True
                        and r.get("errorCode") is None for r in trials)
            summary = [r for r in summaries if r["engine"] == engine]
            check(len(summary) == 1 and summary[0]["samples"] == 5 and summary[0]["engineNew"] == accepted, "SUMMARY")
            report[engine] = {"valid": valid, "new": accepted}
            check(valid > 0, "NO_VALID_CANDIDATE:" + case + ":" + engine)
        reports.append(report)
    return reports


if __name__ == "__main__":
    try:
        with open(sys.argv[1], encoding="utf-8") as stream:
            rows = [json.loads(line) for line in stream if line.strip()]
        print(json.dumps({"decision": "E2_PARTIAL_EXPLORATION_ONLY", "scenarios": verify(rows)}))
    except (ValueError, KeyError, TypeError, OSError, IndexError) as error:
        # Fixed codes only, never print arbitrary row values or payload.
        reason = str(error)
        print("E2 evidence rejected: " + (reason if re.fullmatch("[A-Z_]+(?::[a-z0-9-]+){0,2}", reason) else "INVALID_EVIDENCE"), file=sys.stderr)
        sys.exit(1)
