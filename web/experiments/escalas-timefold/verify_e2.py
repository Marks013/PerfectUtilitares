"""Strict exploratory E2 evidence validation; never declares a comparative winner."""
import json
import math
import re
import sys

SCENARIOS = ("team-10-week", "branch-50-four-weeks", "team-10-week-repair")
ENGINES = ("ortools", "timefold")
BASE = "f78c691edbeaf16283f534bcacd8db1b4b7d5e66"
RESOURCES = {"cpus": 1, "memoryMiB": 1536, "pids": 64}


class EvidenceError(ValueError):
    pass


def check(ok, code):
    if not ok:
        raise EvidenceError(code)


def numeric(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def integer(value):
    return type(value) is int and value >= 0


def sha(value, size):
    return isinstance(value, str) and re.fullmatch("[0-9a-f]{%d}" % size, value) is not None


def quantile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def assessment_valid(value):
    return (isinstance(value, dict) and value.get("valid") is True
            and value.get("complete") is True and value.get("errors") == [])


def verify_cgroup(sample):
    if sample is None:
        return None
    check(isinstance(sample, dict) and sample.get("version") == 2
          and sample.get("scope") == "container-before-response", "CGROUP_SCOPE")
    check(integer(sample.get("cpuUsageUsec")) and integer(sample.get("memoryPeakBytes"))
          and sample["memoryPeakBytes"] > 0 and sample.get("memoryLimitBytes") == RESOURCES["memoryMiB"] * 1024 * 1024
          and sample.get("pidsLimit") == RESOURCES["pids"] and integer(sample.get("cpuQuotaUsec"))
          and integer(sample.get("cpuPeriodUsec")) and sample["cpuPeriodUsec"] > 0
          and sample["cpuQuotaUsec"] == sample["cpuPeriodUsec"], "CGROUP_LIMITS")
    return sample


def valid_timely(row):
    final = row.get("finalAssessment")
    return (row.get("timely") is True and row.get("errorCode") is None
            and row.get("finalStatus") in ("FEASIBLE", "OPTIMAL")
            and assessment_valid(final) and (final.get("comparison") or {}).get("regressed") is not True)


def verify(rows, scenarios=SCENARIOS, repetitions=5):
    check(isinstance(rows, list) and all(isinstance(r, dict) for r in rows), "ROW_FORMAT")
    check(all(r.get("kind") in ("measurement", "summary", "paired-coverage") for r in rows), "UNEXPECTED_ROW")
    check(len(rows) == len(scenarios) * (3 * repetitions + 2), "ROW_COUNT")
    check(all(r.get("scenario") in scenarios for r in rows), "UNKNOWN_SCENARIO")
    identity = {}
    reports = []
    global_source = None
    for case in scenarios:
        case_rows = [r for r in rows if r["scenario"] == case]
        measured = [r for r in case_rows if r["kind"] == "measurement"]
        pairs = [r for r in case_rows if r["kind"] == "paired-coverage"]
        summaries = [r for r in case_rows if r["kind"] == "summary"]
        check(len(measured) == 2 * repetitions and len(pairs) == repetitions and len(summaries) == 2, "SCENARIO_COUNT:" + case)
        first = measured[0]
        check(sha(first.get("inputHash"), 64) and sha(first.get("revision"), 40) and sha(first.get("evaluatorTree"), 40), "SOURCE_HASH")
        source = (first["revision"], first["evaluatorTree"])
        if global_source is None:
            global_source = source
        check(source == global_source, "GLOBAL_SOURCE_DRIFT")
        check(first.get("baselineRevision") == BASE and first.get("arch") == "arm64" and first.get("resources") == RESOURCES, "BASELINE")
        profile = first.get("profile")
        expected_people, expected_days = (50, 28) if case == "branch-50-four-weeks" else (10, 7)
        check(isinstance(profile, dict) and profile.get("activePositions") == expected_people * expected_days
              and profile.get("includedOnWire") == expected_people and profile.get("days") == expected_days
              and profile.get("mode") == "DAYS_AND_HOURS" and profile.get("searchBudgetSeconds") == 12
              and profile.get("processBudgetSeconds") == 18 and profile.get("transportBudgetSeconds") == 20
              and profile.get("savedAssignments") == (70 if case == "team-10-week-repair" else 0), "PROFILE:" + case)
        for row in case_rows:
            for key in ("inputHash", "revision", "evaluatorTree", "profile", "baselineRevision", "arch", "resources"):
                check(row.get(key) == first.get(key), "IDENTITY_DRIFT:" + case)
            check(row.get("sampleKind") == "cold-container" and row.get("hostCapacityMeasured") is False
                  and row.get("liveHttpMeasured") is False, "SAMPLE_KIND")
        expected_order = [(rep, engine) for rep in range(repetitions)
                          for engine in (ENGINES if rep % 2 == 0 else reversed(ENGINES))]
        check([(r.get("repetition"), r.get("engine")) for r in measured] == expected_order
              and all(type(r.get("repetition")) is int for r in measured + pairs)
              and [r["repetition"] for r in pairs] == list(range(repetitions)), "PAIR_ORDER")
        report = {"scenario": case}
        for engine in ENGINES:
            trials = [r for r in measured if r["engine"] == engine]
            resource_samples = [s for row in trials if (s := verify_cgroup(row.get("cgroup"))) is not None]
            for row in trials:
                image = row.get("identity")
                check(isinstance(image, dict) and image.get("architecture") == "arm64"
                      and isinstance(image.get("image"), str) and image["image"].startswith("sha256:")
                      and sha(image["image"][7:], 64), "IMAGE")
                check(image.get("revision") == (BASE if engine == "ortools" else row["revision"]), "IMAGE_REVISION")
                check(identity.setdefault(engine, image) == image, "IMAGE_DRIFT")
                check(numeric(row.get("engineSeconds")) and numeric(row.get("productSeconds"))
                      and row["engineSeconds"] <= row["productSeconds"], "TIME")
                check(row.get("timely") is (row["engineSeconds"] <= 20 and row["productSeconds"] <= 20), "TIMELY")
                status = row.get("rawStatus")
                check(row.get("httpStatus") == 200 and status in (("FEASIBLE", "UNKNOWN") if engine == "timefold"
                      else ("FEASIBLE", "OPTIMAL", "UNKNOWN", "INFEASIBLE")), "ENGINE_STATUS:" + case + ":" + engine)
                feasible = status in ("FEASIBLE", "OPTIMAL")
                raw, final = row.get("rawAssessment"), row.get("finalAssessment")
                check(not feasible or assessment_valid(raw), "INVALID_RAW:" + case)
                check(row.get("finalStatus") not in ("FEASIBLE", "OPTIMAL") or assessment_valid(final), "INVALID_FINAL:" + case)
                check(numeric(row.get("processSeconds")) and (not feasible or row["processSeconds"] <= 12.1), "SEARCH_DEADLINE:" + case)
                for assessment in (raw, final):
                    if assessment_valid(assessment):
                        metrics = assessment.get("metrics") or {}
                        check(integer(metrics.get("shortagePersonMinutes")) and integer(metrics.get("normalizedEstimatedShortage")), "SHORTAGE")
                for flag in ("acceptedNew", "engineNew", "sameAsRaw", "unchangedReference"):
                    check(type(row.get(flag)) is bool, "FLAG_TYPE")
                accepted = (valid_timely(row) and row.get("outcome") == "NEW_PROPOSAL" and not row["unchangedReference"])
                engine_new = accepted and row["sameAsRaw"] and feasible and assessment_valid(raw)
                check(row["acceptedNew"] is accepted and row["engineNew"] is engine_new, "ATTRIBUTION")
                if engine == "timefold":
                    t = row.get("spike") or {}
                    check(t.get("partialModel") is True and t.get("entities") == profile["activePositions"]
                          and integer(t.get("initialized")) and t["initialized"] <= t["entities"]
                          and integer(t.get("bands")) and t["bands"] > 0
                          and integer(t.get("windows")) and t["windows"] > 0
                          and numeric(t.get("mappingSeconds")) and t["mappingSeconds"] <= row["processSeconds"], "TELEMETRY")
                    value = t.get("firstFeasibleSeconds")
                    check(value is None or numeric(value) and t["mappingSeconds"] <= value <= row["processSeconds"], "FIRST_FEASIBLE")
                    check(not feasible or value is not None, "FIRST_FEASIBLE_MISSING")
            valid = sum(valid_timely(row) for row in trials)
            successes = [row for row in trials if row["engineNew"]]
            accepted = sum(row["acceptedNew"] for row in trials)
            totals = [r for r in summaries if r.get("engine") == engine]
            check(len(totals) == 1, "SUMMARY_COUNT")
            total = totals[0]
            check(total.get("samples") == repetitions and total.get("validTimely") == valid
                  and total.get("engineNew") == len(successes) and total.get("acceptedNew") == accepted
                  and total.get("notEngineNew") == repetitions - len(successes)
                  and total.get("rejectedRawFeasible") == 0 and total.get("decision") == "EXPLORATORY_NOT_CERTIFIED", "SUMMARY_COUNTS")
            check(total.get("successP50Seconds") == quantile([r["productSeconds"] for r in successes], .5)
                  and total.get("maxProductSeconds") == max(r["productSeconds"] for r in trials)
                  and total.get("medianEstimatedShortage") == quantile([r["finalAssessment"]["metrics"]["shortagePersonMinutes"] for r in successes], .5)
                  and total.get("medianNormalizedEstimatedShortage") == quantile([r["finalAssessment"]["metrics"]["normalizedEstimatedShortage"] for r in successes], .5)
                  and total.get("successP95Seconds") is None and total.get("tailSampleSufficient") is False, "SUMMARY_STATS")
            check(total.get("cgroupSamples") == len(resource_samples)
                  and total.get("medianContainerCpuSeconds") == quantile([s["cpuUsageUsec"] / 1_000_000 for s in resource_samples], .5)
                  and total.get("maxContainerMemoryPeakBytes") == max((s["memoryPeakBytes"] for s in resource_samples), default=None),
                  "CGROUP_SUMMARY")
            report[engine] = {"valid": valid, "new": len(successes), "cgroupSamples": len(resource_samples),
                              "cgroupMissing": repetitions - len(resource_samples),
                              "medianContainerCpuSeconds": total["medianContainerCpuSeconds"],
                              "maxContainerMemoryPeakBytes": total["maxContainerMemoryPeakBytes"]}
            # E2 generation must actually produce a new raw proposal every time.
            # Repair may legitimately retain its reference; it is not a gain.
            check(valid == repetitions, "VALID_TRIALS:" + case + ":" + engine)
            if case != "team-10-week-repair":
                check(len(successes) == repetitions, "NEW_TRIALS:" + case + ":" + engine)
        comparable = regressed = improved = 0
        reasons = {}
        for pair in pairs:
            actual = [r for r in measured if r["repetition"] == pair["repetition"]]
            both_new = all(r["engineNew"] for r in actual)
            check(pair.get("comparable") is both_new, "PAIR_COMPARABILITY:" + case)
            if both_new:
                comparable += 1
                check(type(pair.get("regressed")) is bool and type(pair.get("improved")) is bool
                      and isinstance(pair.get("reason"), str) and not (pair["regressed"] and pair["improved"]), "PAIR_RESULT")
                regressed += int(pair["regressed"])
                improved += int(pair["improved"])
                reasons[pair["reason"]] = reasons.get(pair["reason"], 0) + 1
                if pair["regressed"]:
                    loss = pair.get("regression")
                    check(isinstance(loss, dict) and set(loss) == {"metric", "scope", "before", "after", "delta"}
                          and isinstance(loss["metric"], str) and isinstance(loss["scope"], str)
                          and numeric(loss["before"]) and numeric(loss["after"])
                          and type(loss["delta"]) in (int, float) and math.isfinite(loss["delta"])
                          and loss["delta"] != 0, "PAIR_REGRESSION_DETAIL")
                else:
                    check("regression" not in pair, "PAIR_REGRESSION_DETAIL")
        report["comparablePairs"] = comparable
        report["nonComparablePairs"] = repetitions - comparable
        report["regressedPairs"] = regressed
        report["improvedPairs"] = improved
        report["pairReasons"] = reasons
        report["qualityDecision"] = ("REGRESSION_OBSERVED" if regressed
                                    else "INSUFFICIENT_COMPARABLE_PAIRS" if comparable < repetitions
                                    else "NO_REGRESSION_OBSERVED_EXPLORATORY")
        reports.append(report)
    return reports


if __name__ == "__main__":
    try:
        with open(sys.argv[1], encoding="utf-8") as stream:
            rows = [json.loads(line) for line in stream if line.strip()]
        smoke = len(sys.argv) == 3 and sys.argv[2] == "--smoke"
        result = verify(rows, ("team-10-week",), 1) if smoke else verify(rows)
        print(json.dumps({"decision": "E2_PARTIAL_EXPLORATION_ONLY", "scenarios": result}))
    except EvidenceError as error:
        print("E2 evidence rejected: " + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, OSError, IndexError, AttributeError, OverflowError):
        print("E2 evidence rejected: INVALID_EVIDENCE", file=sys.stderr)
        sys.exit(1)
