import copy
import unittest
from audit_dependencies import inventory, lock_inventory
from verify_comparison import native, pair_detail, sector_vector, p50, paired_stats, verify_curve

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

    def test_curve_requires_full_balanced_evidence(self):
        with self.assertRaises(ValueError):verify_curve([])

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

    def test_seed_only_cannot_claim_native_search(self):
        profile={"includedOnWire":10,"activePositions":70}
        row={"forge":{"version":"0.31.2","budgetSeconds":12,"partialModel":True,"mode":"SEED_ONLY","nativeSearch":True,
             "entities":10,"positions":70,"initialized":10,"allowedPatterns":150,"seedComplete":True,
             "mapSeconds":.1,"seedSeconds":.1,"searchSeconds":0,"initialCost":[0]*9,"finalCost":[0]*9},
             "finalAssessment":{"metrics":{"normalizedEstimatedShortage":0}},"processSeconds":.2}
        with self.assertRaises(ValueError):native(row,profile,True)

if __name__=="__main__":
    unittest.main()
