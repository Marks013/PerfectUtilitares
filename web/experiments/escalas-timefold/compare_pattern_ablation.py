"""Compare the optional pattern constructor against the unchanged default
search on the same runner. Both rounds must first pass the E2 verifier.
This is an exploratory block-order experiment, not a production gate.
"""
import json
from pathlib import Path
import sys
from verify_e2 import verify, check, quantile


CASE = "branch-50-four-weeks"


def compare(default_rows, pattern_rows):
    default_reports = verify(default_rows)
    pattern_report = verify(pattern_rows, (CASE,), 5, "PATTERN")[0]
    default_report = next(r for r in default_reports if r["scenario"] == CASE)
    default = [r for r in default_rows if r["scenario"] == CASE and r["kind"] == "measurement"]
    pattern = [r for r in pattern_rows if r["kind"] == "measurement"]
    for old, new in zip(default, pattern):
        for key in ("scenario", "engine", "repetition", "inputHash", "revision", "evaluatorTree",
                    "baselineRevision", "profile", "arch", "resources", "identity", "sampleKind"):
            check(old[key] == new[key], "ABLATION_IDENTITY_DRIFT")
    def metrics(rows, engine):
        trials = [r for r in rows if r["engine"] == engine]
        result = {
            "new": sum(r["engineNew"] for r in trials),
            "productP50Seconds": quantile([r["productSeconds"] for r in trials], .5),
            "normalizedShortageP50": quantile([r["finalAssessment"]["metrics"]["normalizedEstimatedShortage"] for r in trials], .5),
            "cgroupSamples": sum(r.get("cgroup") is not None for r in trials),
        }
        samples = [r["cgroup"] for r in trials if r.get("cgroup") is not None]
        result["cpuP50Seconds"] = quantile([s["cpuUsageUsec"] / 1_000_000 for s in samples], .5)
        result["peakMemoryBytes"] = max((s["memoryPeakBytes"] for s in samples), default=None)
        if engine == "timefold":
            result["firstInternalFeasibleP50Seconds"] = quantile([r["spike"]["firstFeasibleSeconds"] for r in trials], .5)
            result["seedP50Seconds"] = quantile([r["spike"]["seedSeconds"] for r in trials], .5)
            result["moveEvaluationsP50"] = quantile([r["spike"]["moveEvaluations"] for r in trials], .5)
            result["scoreCalculationsP50"] = quantile([r["spike"]["scoreCalculations"] for r in trials], .5)
            result["guardedSeeds"] = sum(r["spike"]["guardedSeed"] for r in trials)
        return result
    return {"decision": "PATTERN_ABLATION_EXPLORATORY_ONLY",
            "blockOrder": ["DEFAULT", "PATTERN"],
            "default": {e: metrics(default, e) for e in ("ortools", "timefold")},
            "pattern": {e: metrics(pattern, e) for e in ("ortools", "timefold")},
            "regressedPairs": {"default": default_report["regressedPairs"], "pattern": pattern_report["regressedPairs"]},
            "productRetainedPairs": {"default": default_report["productRetainedPairs"], "pattern": pattern_report["productRetainedPairs"]},
            "qualityDecision": {"default": default_report["qualityDecision"], "pattern": pattern_report["qualityDecision"]}}


def load(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


if __name__ == "__main__":
    try:
        print(json.dumps(compare(load(sys.argv[1]), load(sys.argv[2])), separators=(",", ":")))
    except (ValueError, OSError, KeyError, TypeError, IndexError, AttributeError):
        print("Pattern ablation rejected: evidence or identity mismatch", file=sys.stderr)
        sys.exit(1)
