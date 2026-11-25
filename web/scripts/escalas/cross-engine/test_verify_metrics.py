"""Mutation tests of the E1 JSONL verifier (no Docker required)."""
import copy
import unittest
from verify_metrics import BASE, RESOURCES, verify


def evidence():
    revision, evaluator, input_hash = "a" * 40, "b" * 40, "c" * 64
    profile = {"activePositions": 70, "searchBudgetSeconds": 12, "processBudgetSeconds": 18, "transportBudgetSeconds": 20}
    shared = {"scenario": "team-10-week", "engine": "ortools", "baselineRevision": BASE,
              "revision": revision, "evaluatorTree": evaluator, "inputHash": input_hash,
              "profile": profile, "arch": "arm64", "resources": RESOURCES,
              "sampleKind": "cold-container", "hostCapacityMeasured": False, "liveHttpMeasured": False}
    assessment = {"valid": True, "complete": True, "errors": [], "comparison": None,
                  "metrics": {"shortagePersonMinutes": 12}}
    measurement = {**shared, "kind": "measurement", "repetition": 0,
                   "identity": {"image": "sha256:" + "d" * 64, "revision": BASE, "architecture": "arm64"},
                   "productSeconds": 12.5, "engineSeconds": 12, "timely": True, "maxRssKiB": 100,
                   "rawStatus": "FEASIBLE", "finalStatus": "FEASIBLE", "rawAssessment": assessment,
                   "finalAssessment": copy.deepcopy(assessment), "errorCode": None, "outcome": "NEW_PROPOSAL",
                   "unchangedReference": False, "sameAsRaw": True, "engineNew": True, "acceptedNew": True}
    summary = {**shared, "kind": "summary", "samples": 1, "validTimely": 1, "acceptedNew": 1,
               "engineNew": 1, "notEngineNew": 0, "rejectedRawFeasible": 0,
               "decision": "EXPLORATORY_NOT_CERTIFIED", "successP95Seconds": None, "tailSampleSufficient": False}
    reference = {"kind": "reference-only", "scenario": "hours-reference-only", "revision": revision,
                 "evaluatorTree": evaluator, "valid": True, "assignments": 0, "readyToPublish": False}
    return copy.deepcopy([reference, measurement, summary])


class EvidenceTests(unittest.TestCase):
    cases = {"team-10-week": (1, True)}

    def test_accepts_complete_evidence(self):
        self.assertEqual(verify(evidence(), self.cases)[0]["engineNew"], 1)

    def test_rejects_missing_trial_and_duplicate(self):
        rows = evidence()
        for modified in ([rows[0], rows[2]], rows + [rows[1]]):
            with self.assertRaises(ValueError):
                verify(modified, self.cases)

    def test_rejects_identity_drift(self):
        rows = evidence()
        rows[1]["inputHash"] = "e" * 64
        with self.assertRaises(ValueError):
            verify(rows, self.cases)

    def test_rejects_invalid_raw_feasible(self):
        rows = evidence()
        rows[1]["rawAssessment"]["valid"] = False
        with self.assertRaises(ValueError):
            verify(rows, self.cases)

    def test_rejects_retained_reference_counted_as_new(self):
        rows = evidence()
        rows[1]["unchangedReference"] = True
        with self.assertRaises(ValueError):
            verify(rows, self.cases)

    def test_rejects_late_result_and_fake_percentile(self):
        rows = evidence()
        rows[1]["productSeconds"] = 21
        with self.assertRaises(ValueError):
            verify(rows, self.cases)
        rows = evidence()
        rows[2]["successP95Seconds"] = 12.5
        with self.assertRaises(ValueError):
            verify(rows, self.cases)

    def test_rejects_recovery_input_rejection_as_a_valid_negative_control(self):
        rows = evidence()
        for row in rows[1:]:
            row["scenario"] = "december-presence-recovery"
            row["profile"] = {"activePositions": 14, "lockedAssignments": 14, "protectedBands": 4,
                              "mode": "DAYS_AND_HOURS", "searchBudgetSeconds": 23,
                              "processBudgetSeconds": 27, "transportBudgetSeconds": 32}
        rows[1].update(httpStatus=400, rawStatus=None, finalStatus=None, rawAssessment=None, finalAssessment=None,
                       errorCode="SOLVER_INVALID_INPUT", outcome="OTHER", acceptedNew=False, engineNew=False)
        rows[2].update(validTimely=0, acceptedNew=0, engineNew=0, notEngineNew=1)
        with self.assertRaisesRegex(ValueError, "SPECIAL_NOT_SOLVED"):
            verify(rows, {"december-presence-recovery": (1, False)})
        rows[1].update(httpStatus=200, rawStatus="UNKNOWN", finalStatus="UNKNOWN", errorCode=None, outcome="SEARCH_UNFINISHED")
        self.assertEqual(verify(rows, {"december-presence-recovery": (1, False)})[0]["engineNew"], 0)

    def test_rejects_december_without_explicit_paid_holiday(self):
        rows = evidence()
        for row in rows[1:]:
            row["scenario"] = "december-representative"
        with self.assertRaisesRegex(ValueError, "DECEMBER_PAID_HOLIDAY_MISSING"):
            verify(rows, {"december-representative": (1, True)})
        for row in rows[1:]:
            row["profile"]["paidHolidayCount"] = 1
        self.assertEqual(verify(rows, {"december-representative": (1, True)})[0]["engineNew"], 1)

    def test_rejects_invented_summary(self):
        rows = evidence()
        rows[2]["engineNew"] = 0
        with self.assertRaises(ValueError):
            verify(rows, self.cases)


if __name__ == "__main__":
    unittest.main()
