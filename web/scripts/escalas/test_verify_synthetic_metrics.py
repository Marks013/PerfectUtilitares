"""Pure synthetic contract regression tests; no external services or personal records."""
import importlib.util
import pathlib
import unittest

file = pathlib.Path(__file__).with_name("verify-synthetic-metrics.py")
spec = importlib.util.spec_from_file_location("benchmark_contract", file)
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def records(repeats=5, same_source=True):
    scenarios = ["team-10-week", "branch-115-six-weeks-untimed"]
    data = []
    for scenario in scenarios:
        for variant in contract.VARIANTS:
            sha = "a" * 64 if same_source or variant == "baseline" else "b" * 64
            for i in range(repeats):
                data.append({"kind": "measurement", "scenario": scenario, "variant": variant,
                             "repetition": i, "sourceHash": sha, "status": "FEASIBLE", "errors": [],
                             "image": "sha256:" + "c" * 64, "hostLoad1m": 0.5,
                             "initialSeedHash": "d" * 64,
                             "resources": dict(contract.RESOURCE_PROFILE),
                             "seconds": 10 + i / 100, "maxRssKiB": 100 + i,
                             "shortagePersonMinutes": i, "comparableOffSpread": 0,
                             "sectorDaysAllOff": 0, "sectorDaysWithoutKnownService": 0,
                             "sectorDaysWithUnverifiedPresence": 0})
            data.append({"kind": "summary", "scenario": scenario, "variant": variant,
                         "samples": repeats, "nonFeasible": 0, "tailSampleSufficient": repeats >= 20,
                         "medianSeconds": contract.percentile([10 + i / 100 for i in range(repeats)], .5),
                         "p95Seconds": (contract.percentile([10 + i / 100 for i in range(repeats)], .95)
                                        if repeats >= 20 else None),
                         "maxSeconds": 10 + (repeats - 1) / 100,
                         "peakRssKiB": 100 + repeats - 1,
                         "medianShortage": contract.percentile(list(range(repeats)), .5),
                         "medianComparableSundayOffSpread": 0,
                         "medianSundaySectorDaysWithoutKnownService": 0})
    return data, scenarios


class ContractTest(unittest.TestCase):
    def test_five_samples_are_exploratory_not_p95(self):
        data, scenarios = records()
        reports = contract.verify(data, scenarios, 5)
        self.assertEqual(len(reports), 2)
        self.assertFalse(reports[0]["p95Available"])
        self.assertEqual(reports[0]["sourceComparison"], "SAME_SOLVER_SOURCE")

    def test_twenty_samples_support_p95_and_distinct_sources(self):
        data, scenarios = records(20, same_source=False)
        reports = contract.verify(data, scenarios, 20)
        self.assertTrue(reports[0]["p95Available"])
        self.assertEqual(reports[0]["sourceComparison"], "DISTINCT_SOLVER_SOURCE")

    def test_every_measurement_requires_an_anonymous_initial_seed_fingerprint(self):
        for value in (None, "", "invalid", "x" * 64):
            with self.subTest(value=value):
                data, scenarios = records()
                data[0]["initialSeedHash"] = value
                with self.assertRaisesRegex(ValueError, "initial feasibility fingerprint"):
                    contract.verify(data, scenarios, 5)

    def test_different_unpaired_initial_seeds_are_recorded_not_rejected(self):
        data, scenarios = records(same_source=False)
        data[0]["initialSeedHash"] = "e" * 64
        reports = contract.verify(data, scenarios, 5)
        self.assertEqual(len(reports), len(scenarios))
        self.assertEqual(reports[0]["sourceComparison"], "DISTINCT_SOLVER_SOURCE")

    def test_distinct_source_regressions_are_rejected_without_weakening_integrity(self):
        for metric, report in (
                ("shortagePersonMinutes", "medianShortage"),
                ("comparableOffSpread", "medianComparableSundayOffSpread"),
                ("sectorDaysWithoutKnownService", "medianSundaySectorDaysWithoutKnownService")):
            with self.subTest(metric=metric):
                data, scenarios = records(same_source=False)
                for row in data:
                    if row["variant"] == "corrected":
                        if row["kind"] == "measurement":
                            row[metric] += 1
                        else:
                            row[report] += 1
                with self.assertRaisesRegex(ValueError, "REGRESSION"):
                    contract.verify(data, scenarios, 5)

    def test_same_source_variability_is_not_misreported_as_algorithm_regression(self):
        data, scenarios = records(same_source=True)
        for row in data:
            if row["variant"] == "corrected":
                if row["kind"] == "measurement":
                    row["shortagePersonMinutes"] += 1
                else:
                    row["medianShortage"] += 1
        reports = contract.verify(data, scenarios, 5)
        self.assertTrue(all(row["sourceComparison"] == "SAME_SOLVER_SOURCE" for row in reports))

    def test_four_week_cross_role_scenario_requires_all_measured_samples(self):
        data, scenarios = records()
        for row in data:
            if row["scenario"] == scenarios[0]:
                row["scenario"] = "team-12-four-weeks"
        reports = contract.verify(data, ["team-12-four-weeks", scenarios[1]], 5)
        self.assertEqual(reports[0]["scenario"], "team-12-four-weeks")
        self.assertFalse(reports[0]["p95Available"])
        data.pop(0)
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            contract.verify(data, ["team-12-four-weeks", scenarios[1]], 5)

    def test_duplicate_repetition_is_rejected(self):
        data, scenarios = records()
        data[1]["repetition"] = 0
        with self.assertRaisesRegex(ValueError, "Duplicate or missing"):
            contract.verify(data, scenarios, 5)

    def test_invalid_solver_result_is_rejected(self):
        data, scenarios = records()
        data[0]["errors"] = ["RULE_ERROR"]
        with self.assertRaisesRegex(ValueError, "validation failed"):
            contract.verify(data, scenarios, 5)

    def test_wrong_shortage_is_rejected(self):
        data, scenarios = records()
        data[0]["shortagePersonMinutes"] = -1
        with self.assertRaisesRegex(ValueError, "coverage"):
            contract.verify(data, scenarios, 5)

    def test_falsified_summary_is_rejected(self):
        data, scenarios = records()
        data[5]["medianShortage"] = 999
        with self.assertRaisesRegex(ValueError, "Incorrect medianShortage"):
            contract.verify(data, scenarios, 5)

    def test_five_samples_cannot_claim_p95(self):
        data, scenarios = records()
        data[5]["p95Seconds"] = 10.04
        with self.assertRaisesRegex(ValueError, "Incorrect p95Seconds"):
            contract.verify(data, scenarios, 5)

    def test_missing_or_invalid_image_identity_is_rejected(self):
        data, scenarios = records()
        data[0]["image"] = "latest"
        with self.assertRaisesRegex(ValueError, "isolated Docker image"):
            contract.verify(data, scenarios, 5)

    def test_mixed_docker_images_are_rejected(self):
        data, scenarios = records()
        data[0]["image"] = "sha256:" + "d" * 64
        with self.assertRaisesRegex(ValueError, "Mixed isolated Docker image"):
            contract.verify(data, scenarios, 5)

    def test_changed_resource_budget_is_rejected(self):
        data, scenarios = records()
        data[0]["resources"]["memoryMiB"] = 8192
        with self.assertRaisesRegex(ValueError, "CPU/memory/solver settings"):
            contract.verify(data, scenarios, 5)

    def test_missing_host_load_is_rejected(self):
        data, scenarios = records()
        data[0].pop("hostLoad1m")
        with self.assertRaisesRegex(ValueError, "runner load"):
            contract.verify(data, scenarios, 5)

    def test_zero_duration_is_rejected(self):
        data, scenarios = records()
        data[0]["seconds"] = 0
        with self.assertRaisesRegex(ValueError, "time, memory or coverage"):
            contract.verify(data, scenarios, 5)

    def test_boolean_repetition_is_rejected(self):
        data, scenarios = records()
        data[0]["repetition"] = False
        with self.assertRaisesRegex(ValueError, "Duplicate or missing repetition"):
            contract.verify(data, scenarios, 5)

    def test_unexpected_scenario_is_rejected(self):
        data, scenarios = records()
        with self.assertRaisesRegex(ValueError, "unsupported"):
            contract.verify(data, [*scenarios, "private-roster"], 5)


if __name__ == "__main__":
    unittest.main()
