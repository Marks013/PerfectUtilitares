"""Verify the E1 exploratory JSONL independently of its producer.

This checks completeness/identity/arithmetic/acceptance flags, not legal rules,
which are checked in the existing TypeScript client. Never prints row contents.
"""
import json
import math
import re
import sys

BASE = "f78c691edbeaf16283f534bcacd8db1b4b7d5e66"
RESOURCES = {"cpus": 1, "memoryMiB": 1536, "pids": 64}
# Only the predeclared cold baseline. Stress and negative controls are observations.
CASES = {
    "team-10-week": (5, True),
    "branch-50-four-weeks": (5, True),
    "branch-115-six-weeks": (5, True),
    "december-representative": (5, True),
    "hours-only-with-grid": (5, True),
    "team-10-week-repair": (5, True),
    "december-presence-recovery": (1, False),
    "stress-250-six-weeks": (1, False),
}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha(value, length):
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{%d}" % length, value))


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def valid_timely(row):
    assessment = row.get("finalAssessment") or {}
    comparison = assessment.get("comparison") or {}
    return (row.get("timely") is True and row.get("errorCode") is None
            and assessment.get("valid") is True and assessment.get("complete") is True
            and comparison.get("regressed") is not True)


def verify(rows, cases=CASES):
    require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows), "ROW_FORMAT")
    allowed = {"reference-only", "measurement", "summary"}
    require(all(row.get("kind") in allowed for row in rows), "UNKNOWN_ROW_KIND")
    references = [row for row in rows if row["kind"] == "reference-only"]
    require(len(references) == 1, "REFERENCE_ONLY_COUNT")
    reference = references[0]
    require(reference.get("scenario") == "hours-reference-only" and reference.get("valid") is True
            and reference.get("assignments") == 0 and reference.get("readyToPublish") is False, "REFERENCE_ONLY")
    revision, evaluator = reference.get("revision"), reference.get("evaluatorTree")
    require(sha(revision, 40) and sha(evaluator, 40), "SOURCE_IDENTITY")
    measured = [row for row in rows if row["kind"] == "measurement"]
    summaries = [row for row in rows if row["kind"] == "summary"]
    require(len(measured) == sum(count for count, _ in cases.values()) and len(summaries) == len(cases), "ROW_COUNT")
    require(all(row.get("scenario") in cases for row in measured + summaries), "UNEXPECTED_SCENARIO")
    image = None
    reports = []
    for name, (count, expect_valid) in cases.items():
        trials = [row for row in measured if row["scenario"] == name]
        totals = [row for row in summaries if row["scenario"] == name]
        require(len(trials) == count and len(totals) == 1, "SCENARIO_COUNT")
        require(all(type(row.get("repetition")) is int for row in trials)
                and sorted(row["repetition"] for row in trials) == list(range(count)), "PAIR_INDEX")
        summary = totals[0]
        input_hash, profile = trials[0].get("inputHash"), trials[0].get("profile")
        require(sha(input_hash, 64) and isinstance(profile, dict), "INPUT_IDENTITY")
        special = name == "december-presence-recovery"
        budget = 32 if special else 20
        require(profile.get("searchBudgetSeconds") == (23 if special else 12)
                and profile.get("processBudgetSeconds") == (27 if special else 18)
                and profile.get("transportBudgetSeconds") == budget, "DEADLINE")
        require(type(profile.get("activePositions")) is int and profile["activePositions"] > 0, "WORKLOAD")
        if special:
            require(profile.get("lockedAssignments") == 14 and profile.get("protectedBands", 0) > 0, "SPECIAL_FIXTURE")
        for row in trials + totals:
            require(row.get("engine") == "ortools" and row.get("baselineRevision") == BASE
                    and row.get("revision") == revision and row.get("evaluatorTree") == evaluator
                    and row.get("inputHash") == input_hash and row.get("profile") == profile
                    and row.get("arch") == "arm64" and row.get("resources") == RESOURCES
                    and row.get("sampleKind") == "cold-container" and row.get("hostCapacityMeasured") is False
                    and row.get("liveHttpMeasured") is False, "IDENTITY_OR_PROFILE_DRIFT")
        for row in trials:
            identity = row.get("identity")
            require(isinstance(identity, dict) and identity.get("revision") == BASE
                    and identity.get("architecture") == "arm64", "IMAGE_REVISION")
            digest = identity.get("image")
            require(isinstance(digest, str) and digest.startswith("sha256:") and sha(digest[7:], 64), "IMAGE_DIGEST")
            if image is None:
                image = digest
            require(image == digest, "IMAGE_DRIFT")
            require(number(row.get("productSeconds")) and number(row.get("engineSeconds"))
                    and row["productSeconds"] >= row["engineSeconds"], "TIMING")
            require(row.get("timely") is (row["productSeconds"] <= budget and row["engineSeconds"] <= budget), "TIMELY_FLAG")
            require(row.get("maxRssKiB") is None or number(row["maxRssKiB"]), "RSS")
            raw = row.get("rawAssessment") or {}
            final = row.get("finalAssessment") or {}
            require(row.get("rawStatus") in (None, "FEASIBLE", "OPTIMAL", "UNKNOWN", "INFEASIBLE", "MODEL_INVALID"), "STATUS")
            raw_feasible = row.get("rawStatus") in ("FEASIBLE", "OPTIMAL")
            # A claimed feasible-but-invalid raw candidate is always a blocker.
            require(not raw_feasible or (raw.get("valid") is True and raw.get("complete") is True
                    and raw.get("errors") == []), "RAW_FEASIBLE_INVALID")
            if row.get("finalStatus") in ("FEASIBLE", "OPTIMAL"):
                require(final.get("valid") is True and final.get("complete") is True
                        and final.get("errors") == [], "FINAL_FEASIBLE_INVALID")
            for assessment in (raw, final):
                if assessment.get("valid") is True:
                    metric = (assessment.get("metrics") or {}).get("shortagePersonMinutes")
                    require(number(metric), "SHORTAGE_METRIC")
            expected_new = (valid_timely(row) and row.get("outcome") == "NEW_PROPOSAL"
                            and row.get("unchangedReference") is False)
            expected_engine = (expected_new and row.get("sameAsRaw") is True and raw_feasible
                               and raw.get("valid") is True)
            require(row.get("acceptedNew") is expected_new and row.get("engineNew") is expected_engine, "ATTRIBUTION")
            if special:
                require(not expected_new, "LOCKED_RECOVERY_CHANGED")
        valid = sum(valid_timely(row) for row in trials)
        accepted = sum(row["acceptedNew"] for row in trials)
        engine_new = sum(row["engineNew"] for row in trials)
        require(summary.get("samples") == count and summary.get("validTimely") == valid
                and summary.get("acceptedNew") == accepted and summary.get("engineNew") == engine_new
                and summary.get("notEngineNew") == count - engine_new
                and summary.get("rejectedRawFeasible") == 0, "SUMMARY_COUNTS")
        require(summary.get("decision") == "EXPLORATORY_NOT_CERTIFIED", "DECISION")
        require(summary.get("successP95Seconds") is None and summary.get("tailSampleSufficient") is False, "UNSUPPORTED_TAIL")
        require(not expect_valid or valid > 0, "NO_VALID_BASELINE")
        if name in ("team-10-week", "branch-50-four-weeks", "branch-115-six-weeks", "december-representative"):
            require(engine_new > 0, "NO_NEW_ENGINE_PROPOSAL")
        reports.append({"scenario": name, "samples": count, "validTimely": valid, "engineNew": engine_new})
    return reports


if __name__ == "__main__":
    try:
        with open(sys.argv[1], encoding="utf-8") as stream:
            result = verify([json.loads(line) for line in stream if line.strip()])
        print(json.dumps({"verification": "EXPLORATORY_EVIDENCE_COMPLETE", "scenarios": result}, separators=(",", ":")))
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError, OverflowError):
        print("Cross-engine exploratory evidence rejected.", file=sys.stderr)
        sys.exit(1)
