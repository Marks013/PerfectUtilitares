"""Adversarial mutations: the verifier must fail closed."""
import copy
import unittest
from verify_e2 import BASE, RESOURCES, ENGINES, verify


def rows():
    out = []
    shared = dict(scenario="team-10-week", inputHash="c"*64, revision="a"*40,
                  evaluatorTree="b"*40, baselineRevision=BASE, arch="arm64", resources=RESOURCES,
                  sampleKind="cold-container", hostCapacityMeasured=False, liveHttpMeasured=False,
                  profile=dict(activePositions=70, includedOnWire=10, days=7, mode="DAYS_AND_HOURS",
                               searchBudgetSeconds=12, processBudgetSeconds=18, transportBudgetSeconds=20,
                               savedAssignments=0))
    for engine in ENGINES:
        assessment = dict(valid=True, complete=True, errors=[], comparison=None,
                          metrics=dict(shortagePersonMinutes=60, normalizedEstimatedShortage=60))
        row = dict(shared, kind="measurement", repetition=0, engine=engine, rawStatus="FEASIBLE",
                   finalStatus="FEASIBLE", httpStatus=200, processSeconds=10, engineSeconds=11, productSeconds=12,
                   timely=True, errorCode=None, acceptedNew=True, engineNew=True, sameAsRaw=True,
                   unchangedReference=False, outcome="NEW_PROPOSAL", rawAssessment=assessment,
                   finalAssessment=copy.deepcopy(assessment), identity=dict(architecture="arm64",
                   image="sha256:"+("d" if engine=="ortools" else "e")*64,
                   revision=BASE if engine=="ortools" else shared["revision"]))
        if engine == "timefold":
            row["spike"] = dict(partialModel=True, entities=70, initialized=10, bands=28, windows=10,
                                mappingSeconds=.1, firstFeasibleSeconds=.8)
        out.append(row)
    out.append(dict(shared, kind="paired-coverage", repetition=0, comparable=True,
                    improved=False, regressed=False, reason="EQUAL"))
    for engine in ENGINES:
        out.append(dict(shared, kind="summary", engine=engine, samples=1, validTimely=1, acceptedNew=1,
                        engineNew=1, notEngineNew=0, rejectedRawFeasible=0, decision="EXPLORATORY_NOT_CERTIFIED",
                        successP50Seconds=12, maxProductSeconds=12, medianEstimatedShortage=60,
                        medianNormalizedEstimatedShortage=60, successP95Seconds=None, tailSampleSufficient=False,
                        cgroupSamples=0, medianContainerCpuSeconds=None, maxContainerMemoryPeakBytes=None))
    return copy.deepcopy(out)


class EvidenceTests(unittest.TestCase):
    def validate(self, data):
        return verify(data, ("team-10-week",), 1)

    def test_valid(self):
        self.assertEqual(self.validate(rows())[0]["comparablePairs"], 1)

    def test_mutations(self):
        mutations = [
            (0, "productSeconds", 99), (0, "productSeconds", -1),
            (0, "unchangedReference", True), (0, "outcome", "REFERENCE_RETAINED"),
            (0, "engineNew", False), (0, "timely", False),
            (1, "processSeconds", 13), (1, "httpStatus", 500),
            (2, "comparable", False), (3, "validTimely", 0),
            (3, "medianNormalizedEstimatedShortage", 999), (3, "successP95Seconds", 12),
            (1, "evaluatorTree", "f"*40), (1, "repetition", True),
        ]
        for index, key, value in mutations:
            with self.subTest(key=key, value=value):
                data = rows()
                data[index][key] = value
                with self.assertRaises(ValueError):
                    self.validate(data)

    def test_cgroup_samples_and_missing_are_distinct(self):
        data = rows()
        sample = dict(version=2, scope="container-before-response", cpuUsageUsec=1234567,
                      memoryPeakBytes=167772160, memoryLimitBytes=1610612736,
                      cpuQuotaUsec=100000, cpuPeriodUsec=100000, pidsLimit=64)
        data[1]["cgroup"] = sample
        data[4].update(cgroupSamples=1, medianContainerCpuSeconds=1.234567,
                       maxContainerMemoryPeakBytes=167772160)
        report = self.validate(data)[0]
        self.assertEqual(report["timefold"]["cgroupSamples"], 1)
        self.assertEqual(report["ortools"]["cgroupMissing"], 1)
        data[1]["cgroup"]["cpuQuotaUsec"] = 200000
        with self.assertRaises(ValueError):
            self.validate(data)

    def test_quality_regression_is_visible_not_confused_with_validity(self):
        data = rows()
        data[2].update(regressed=True, improved=False, reason="SECTOR_COVERAGE",
                       regression=dict(metric="DEFICIT_PERSON_MINUTES", scope="SUNDAYS",
                                       before=0, after=60, delta=60))
        report = self.validate(data)[0]
        self.assertEqual(report["regressedPairs"], 1)
        self.assertEqual(report["qualityDecision"], "REGRESSION_OBSERVED")
        self.assertEqual(report["pairReasons"], {"SECTOR_COVERAGE": 1})
        del data[2]["regression"]
        with self.assertRaises(ValueError):
            self.validate(data)

    def test_contradictory_pair_outcomes_are_rejected(self):
        data = rows()
        data[2].update(regressed=True, improved=True)
        with self.assertRaises(ValueError):
            self.validate(data)

    def test_incomplete_result(self):
        data = rows()
        data[1]["finalAssessment"]["complete"] = False
        data[1]["finalAssessment"]["errors"] = ["MISSING"]
        with self.assertRaises(ValueError):
            self.validate(data)

    def test_swapped_order(self):
        data = rows()
        data[0], data[1] = data[1], data[0]
        with self.assertRaises(ValueError):
            self.validate(data)

    def test_missing_trial(self):
        with self.assertRaises(ValueError):
            self.validate(rows()[1:])


if __name__ == "__main__":
    unittest.main()
