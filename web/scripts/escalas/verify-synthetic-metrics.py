"""Validate synthetic solver benchmark evidence; never load production schedules."""
from __future__ import annotations

import json
import math
import pathlib
import re
import sys
from collections import defaultdict

SCENARIOS = {
    "team-10-week",
    "branch-50-four-weeks",
    "branch-115-six-weeks",
    "branch-115-six-weeks-untimed",
}
VARIANTS = ("baseline", "corrected")
COUNT_METRICS = (
    "sectorDaysAllOff",
    "sectorDaysWithoutKnownService",
    "sectorDaysWithUnverifiedPresence",
    "comparableOffSpread",
)
# The CI benchmark executes the two production-equivalent variants with identical bounds.
RESOURCE_PROFILE = {"workers": 1, "cpus": 1, "memoryMiB": 1536, "linearization": 0, "symmetry": 0}
IMAGE_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def number(value: object, *, positive: bool = False) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and (value > 0 if positive else value >= 0)


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def load_records(path: pathlib.Path) -> list[dict]:
    records = []
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.startswith("{") or '"kind"' not in line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid benchmark JSON at line {index}") from error
        require(type(record) is dict and record.get("kind") in ("measurement", "summary"),
                f"Unexpected benchmark record at line {index}")
        records.append(record)
    return records


def verify(records: list[dict], scenarios: list[str], repeats: int) -> list[dict]:
    require(scenarios and len(scenarios) == len(set(scenarios)) and set(scenarios) <= SCENARIOS,
            "Missing, repeated or unsupported synthetic scenarios")
    require(type(repeats) is int and 5 <= repeats <= 20, "Repetitions outside approved bounds")
    measurements = [row for row in records if row["kind"] == "measurement"]
    summaries = [row for row in records if row["kind"] == "summary"]
    require(len(measurements) == len(scenarios) * len(VARIANTS) * repeats,
            "Incomplete or unexpected measurements")
    require(len(summaries) == len(scenarios) * len(VARIANTS),
            "Incomplete or unexpected summaries")
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    reports: dict[tuple[str, str], dict] = {}
    for row in measurements:
        key = (row.get("scenario"), row.get("variant"))
        require(key[0] in scenarios and key[1] in VARIANTS, "Unexpected measured variant/scenario")
        grouped[key].append(row)
    for row in summaries:
        key = (row.get("scenario"), row.get("variant"))
        require(key[0] in scenarios and key[1] in VARIANTS and key not in reports,
                "Duplicate or unexpected benchmark summary")
        reports[key] = row
    output = []
    source_by_variant: dict[str, str] = {}
    images: set[str] = set()
    for scenario in scenarios:
        for variant in VARIANTS:
            key = scenario, variant
            rows, summary = grouped[key], reports[key]
            require(all(type(row.get("repetition")) is int for row in rows)
                    and {row["repetition"] for row in rows} == set(range(repeats)),
                    f"Duplicate or missing repetition: {key}")
            hashes = {row.get("sourceHash") for row in rows}
            require(len(hashes) == 1 and isinstance(next(iter(hashes)), str)
                    and re.fullmatch(r"[0-9a-f]{64}", next(iter(hashes))) is not None,
                    f"Missing or conflicting solver source hash: {key}")
            this_hash = next(iter(hashes))
            require(variant not in source_by_variant or source_by_variant[variant] == this_hash,
                    f"Solver source changed between synthetic scenarios: {variant}")
            source_by_variant[variant] = this_hash
            for row in rows:
                require(row.get("status") in ("FEASIBLE", "OPTIMAL") and row.get("errors") == [],
                        f"Solver infeasible or independent validation failed: {key}")
                require(number(row.get("seconds"), positive=True)
                        and number(row.get("maxRssKiB"), positive=True)
                        and number(row.get("shortagePersonMinutes")),
                        f"Invalid measured time, memory or coverage: {key}")
                image = row.get("image")
                require(type(image) is str and IMAGE_PATTERN.fullmatch(image) is not None,
                        f"Missing or invalid isolated Docker image ID: {key}")
                images.add(image)
                resources = row.get("resources")
                require(type(resources) is dict and set(resources) == set(RESOURCE_PROFILE)
                        and all(type(resources[name]) is int and resources[name] == expected
                                for name, expected in RESOURCE_PROFILE.items()),
                        f"Unexpected benchmark CPU/memory/solver settings: {key}")
                require(number(row.get("hostLoad1m")),
                        f"Missing or invalid runner load: {key}")
                for metric in COUNT_METRICS:
                    require(type(row.get(metric)) is int and row[metric] >= 0,
                            f"Missing or invalid Sunday metric {metric}: {key}")
            require(summary.get("samples") == repeats and summary.get("nonFeasible") == 0,
                    f"Incorrect summary sample count/status: {key}")
            expected = {
                "medianSeconds": percentile([row["seconds"] for row in rows], .5),
                "p95Seconds": percentile([row["seconds"] for row in rows], .95) if repeats >= 20 else None,
                "maxSeconds": max(row["seconds"] for row in rows),
                "peakRssKiB": max(row["maxRssKiB"] for row in rows),
                "medianShortage": percentile([row["shortagePersonMinutes"] for row in rows], .5),
                "medianComparableSundayOffSpread": percentile([row["comparableOffSpread"] for row in rows], .5),
                "medianSundaySectorDaysWithoutKnownService": percentile(
                    [row["sectorDaysWithoutKnownService"] for row in rows], .5),
            }
            for metric, value in expected.items():
                require(summary.get(metric) == value, f"Incorrect {metric}: {key}")
            require(summary.get("tailSampleSufficient") is (repeats >= 20),
                    f"Incorrect p95 sample disclosure: {key}")
    require(len(images) == 1, "Mixed isolated Docker image IDs across scenarios")
    for scenario in scenarios:
        before, after = reports[(scenario, "baseline")], reports[(scenario, "corrected")]
        if source_by_variant["baseline"] != source_by_variant["corrected"]:
            # Earlier coverage remains the priority over secondary Sunday fairness.
            # A same-source comparison is evidence instrumentation, not a
            # claim of algorithmic improvement or deterministic timings.
            for metric in ("medianShortage", "medianComparableSundayOffSpread",
                           "medianSundaySectorDaysWithoutKnownService"):
                require(after[metric] <= before[metric],
                        f"REGRESSION {scenario} {metric}: {before[metric]} -> {after[metric]}")
        output.append({
            "scenario": scenario,
            "sourceComparison": ("SAME_SOLVER_SOURCE" if source_by_variant["baseline"] == source_by_variant["corrected"]
                                 else "DISTINCT_SOLVER_SOURCE"),
            "samplesPerVariant": repeats,
            "p95Available": repeats >= 20,
            "medianShortageDelta": after["medianShortage"] - before["medianShortage"],
            "medianSundayOffSpreadDelta": (
                after["medianComparableSundayOffSpread"] - before["medianComparableSundayOffSpread"]),
            "medianSecondsDelta": round(after["medianSeconds"] - before["medianSeconds"], 6),
        })
    return output


def main() -> int:
    if len(sys.argv) < 4:
        print("Usage: verify-synthetic-metrics.py <log.jsonl> <repetitions> <scenario> [...]", file=sys.stderr)
        return 2
    try:
        result = verify(load_records(pathlib.Path(sys.argv[1])), sys.argv[3:], int(sys.argv[2]))
    except (OSError, ValueError) as error:
        print(f"Synthetic benchmark validation failed: {error}", file=sys.stderr)
        return 1
    for row in result:
        print(json.dumps({"kind": "comparison", **row}, sort_keys=True))
    if any(row["sourceComparison"] == "SAME_SOLVER_SOURCE" for row in result):
        print("NOTE: identical solver source is not evidence of an algorithmic improvement.")
    if any(not row["p95Available"] for row in result):
        print("NOTE: fewer than 20 repetitions; p95 intentionally not estimated.")
    print("Synthetic benchmark: independent validation and metrics contract passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
