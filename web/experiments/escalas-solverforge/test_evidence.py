import copy
import unittest
from audit_dependencies import inventory, lock_inventory
from prepare_workspace import ANYHOW_OLD, ANYHOW_PATCHED, ENTRY, verify_lock
from verify_comparison import native, pair_detail, sector_vector, p50, paired_stats, verify_curve, e2_noninferiority, SCENARIOS, verify_tail, tail_percentile, adaptive_gain, verify_personal

class EvidenceTests(unittest.TestCase):
    def test_resolved_lock_checksum_required(self):
        metadata={"packages":[{"id":"app","name":"perfectutilitares-solverforge-spike"},{"id":"sf","name":"solverforge","version":"0.31.2","license":"Apache-2.0","source":None},
            {"id":"json","name":"serde_json","version":"1.0.149","source":"registry+https://github.com/rust-lang/crates.io-index","license":"MIT OR Apache-2.0"}],
            "resolve":{"nodes":[{"id":"app","deps":[{"pkg":"sf"},{"pkg":"json"}]},{"id":"sf","deps":[]},{"id":"json","deps":[]}]}}
        lock={"package":[{"name":"serde_json","version":"1.0.149","source":"registry+https://github.com/rust-lang/crates.io-index","checksum":"a"*64}]}
        self.assertEqual(len(inventory(metadata,lock)),2)
        lock["package"][0]["checksum"]="bad"
        with self.assertRaises(ValueError):inventory(metadata,lock)

    def test_zero_to_positive_deficit_is_not_a_tie(self):
        profile={"includedOnWire":2,"days":7,"confirmedDemands":0}
        vector=dict(horizon=0,month=0,sundays=0,monthSundays=0,closing=0,peak=0,presence=list(range(7)))
        before={"finalAssessment":{"metrics":{"normalizedEstimatedShortage":0,"coverageAudit":[vector]}}}
        after=copy.deepcopy(before)
        after["finalAssessment"]["metrics"]["normalizedEstimatedShortage"]=60
        after["finalAssessment"]["metrics"]["coverageAudit"][0].update(horizon=60,month=60,sundays=60,monthSundays=60,peak=1)
        pair={"comparable":True,"regressed":False,"improved":False,"retained":False,"reason":"ACCEPTED","productReason":"ACCEPTED"}
        with self.assertRaises(ValueError):pair_detail(pair,before,after,profile,True)

    def test_full_lock_inventory_includes_unreachable_crates(self):
        records={"package":[{"name":"anyhow","version":"1.0.102","source":"registry+https://github.com/rust-lang/crates.io-index","checksum":"b"*64},
                            {"name":"local","version":"0.1.0"}]}
        self.assertEqual([p["name"] for p in lock_inventory(records)],["anyhow"])
        records["package"][0]["checksum"]="bad"
        with self.assertRaises(ValueError):lock_inventory(records)

    def test_tail_requires_complete_balanced_samples(self):
        self.assertIsNone(tail_percentile(list(range(29))))
        self.assertEqual(tail_percentile(list(range(1,33))),31)
        with self.assertRaises(ValueError):verify_tail([])

    def test_adaptive_gain_requires_full_pairs_and_product_noninferiority(self):
        a={"productSeconds":12,"cgroup":{"cpuUsageUsec":11000000,"memoryPeakBytes":6000000}}
        b={"productSeconds":2,"cgroup":{"cpuUsageUsec":1000000,"memoryPeakBytes":5000000},
            "forge":{"nativeSearch":True,"resultSource":"NATIVE"}}
        comparisons={k:{"comparable":32,"regressions":0,"retained":0} for k in ("ortools","timefold","native-12")}
        rows=[(copy.deepcopy(a),copy.deepcopy(b)) for _ in range(32)]
        self.assertEqual(adaptive_gain(rows,comparisons)["decision"],"ADAPTIVE_GAIN_OBSERVED")
        self.assertEqual(adaptive_gain(rows[:-1],comparisons)["decision"],"ADAPTIVE_GAIN_NOT_PROVEN")
        comparisons["timefold"]["retained"]=1
        self.assertEqual(adaptive_gain(rows,comparisons)["decision"],"ADAPTIVE_GAIN_NOT_PROVEN")
        comparisons["timefold"]["retained"]=0
        for _,candidate in rows:candidate["productSeconds"]=11
        self.assertEqual(adaptive_gain(rows,comparisons)["decision"],"ADAPTIVE_GAIN_NOT_PROVEN")

    def test_personal_parity_requires_full_corpus(self):
        with self.assertRaises(ValueError):verify_personal([])
        with self.assertRaises(ValueError):verify_personal([{}]*26)

    def test_curve_requires_full_balanced_evidence(self):
        with self.assertRaises(ValueError):verify_curve([])

    def test_only_reviewed_lock_delta_is_allowed(self):
        original=ANYHOW_OLD+"\n"
        verify_lock(original,ANYHOW_PATCHED+"\n"+ENTRY)
        for modified in (ANYHOW_OLD+"\n"+ENTRY,ANYHOW_PATCHED+"\n"+ENTRY+"extra"):
            with self.assertRaises(ValueError):verify_lock(original,modified)

    def test_e2_gate_rejects_valid_but_regressed_proposals(self):
        pair={"comparable":6,"regressions":0,"productRetentions":0}
        report={"decision":"EXPLORATORY_VALID_TRIPLE","scenarios":[{"scenario":name,"samplesPerEngine":6,
            "pairs":{"ortools->solverforge":dict(pair),"timefold->solverforge":dict(pair)}} for name in SCENARIOS]}
        self.assertEqual(e2_noninferiority(report)["decision"],"E2_NONINFERIORITY_OBSERVED")
        report["scenarios"][1]["pairs"]["ortools->solverforge"]["regressions"]=1
        with self.assertRaises(ValueError):e2_noninferiority(report)

    def test_even_sample_median_is_midpoint(self):
        self.assertEqual(p50([6, 1, 3, 2, 5, 4]), 3.5)
        self.assertIsNone(p50([]))

    def test_paired_delta_and_zero_baseline(self):
        result = paired_stats([0, 100, 200], [60, 80, 150])
        self.assertEqual(result["samples"], 3)
        self.assertEqual(result["deltaP50"], -20)
        self.assertEqual(result["positiveBaselineSamples"], 2)
        self.assertEqual(result["reductionPercentP50"], 22.5)
        self.assertIsNone(paired_stats([0], [60])["reductionPercentP50"])
        with self.assertRaises(ValueError):
            paired_stats([1, 2], [1])

    def test_adaptive_retention_cannot_claim_native_improvement(self):
        profile={"includedOnWire":10,"activePositions":70}
        row={"forge":{"version":"0.31.2","budgetSeconds":12,"partialModel":True,"mode":"ADAPTIVE","nativeSearch":True,
             "entities":10,"positions":70,"initialized":10,"allowedPatterns":150,"seedComplete":True,
             "mapSeconds":.1,"seedSeconds":.1,"searchSeconds":1,"initialCost":[0]*13,"finalCost":[0]*13,
             "nativeCost":[0,1,0,0,0,0,0,0,0,0,0,0,0],"stagnationApplied":True,"resultSource":"SEED_RETAINED",
             "repair":{"sectors":1,"projections":10,"reconstructed":2,"accepted":1,"deadlineReached":False,"projectionLimitHits":0,
             "rest":{"attempted":1,"acceptedSingle":1,"acceptedPair":0,"beforePairs":1,"afterPairs":0,
                 "deadlineReached":False,"limitReached":False}}},
             "finalAssessment":{"metrics":{"normalizedEstimatedShortage":0,"restAudit":{"correctableExcess":0,
                 "adjustablePairs":0,"concentration":0,"weeklyRepetitions":0}}},"processSeconds":1.3}
        native(row,profile,adaptive=True)
        for key,value in (("resultSource","NATIVE"),("nativeCost",None),("nativeSearch",False)):
            invalid=copy.deepcopy(row);invalid["forge"][key]=value
            with self.assertRaises(ValueError):native(invalid,profile,adaptive=True)
        invalid=copy.deepcopy(row);invalid["forge"]["repair"]["accepted"]=2
        with self.assertRaises(ValueError):native(invalid,profile,adaptive=True)

    def test_seed_only_cannot_claim_native_search(self):
        profile={"includedOnWire":10,"activePositions":70}
        row={"forge":{"version":"0.31.2","budgetSeconds":12,"partialModel":True,"mode":"SEED_ONLY","nativeSearch":True,
             "entities":10,"positions":70,"initialized":10,"allowedPatterns":150,"seedComplete":True,
             "mapSeconds":.1,"seedSeconds":.1,"searchSeconds":0,"initialCost":[0]*13,"finalCost":[0]*13},
             "finalAssessment":{"metrics":{"normalizedEstimatedShortage":0}},"processSeconds":.2}
        with self.assertRaises(ValueError):native(row,profile,True)

if __name__=="__main__":
    unittest.main()
