"""Offline regressions for bounded, fail-closed OSV pagination."""
import io
import json
import unittest
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from audit_dependencies import main, query


class QueryTests(unittest.TestCase):
    def setUp(self):
        self.items = [{"name": "example", "version": "1.0.0"}]

    @staticmethod
    def response(results):
        return io.BytesIO(json.dumps({"results": results}).encode())

    def test_empty_inventory_does_not_request(self):
        with patch("audit_dependencies.urllib.request.urlopen") as request:
            self.assertEqual(query([]), {})
        request.assert_not_called()

    def test_empty_final_page_tokens_remain_compatible(self):
        for result in ({}, {"next_page_token": None}, {"next_page_token": ""}):
            with self.subTest(result=result):
                with patch("audit_dependencies.urllib.request.urlopen", return_value=self.response([result])):
                    self.assertEqual(query(self.items), {0: []})

    def test_only_unfinished_packages_are_queried_again(self):
        items = self.items + [{"name": "other", "version": "2.0.0"}]
        responses = [self.response([
            {"vulns": [{"id": "TEST-B"}], "next_page_token": "next"},
            {"vulns": [{"id": "TEST-C"}]},
        ]), self.response([{"vulns": [{"id": "TEST-A"}, {"id": "TEST-B"}]}])]
        with patch("audit_dependencies.urllib.request.urlopen", side_effect=responses) as request:
            self.assertEqual(query(items), {0: ["TEST-A", "TEST-B"], 1: ["TEST-C"]})
        self.assertEqual(request.call_count, 2)
        body = json.loads(request.call_args_list[1].args[0].data)
        self.assertEqual(body["queries"], [{
            "package": {"name": "example", "ecosystem": "crates.io"},
            "version": "1.0.0", "page_token": "next",
        }])

    def test_completion_on_last_allowed_request_succeeds(self):
        responses = [self.response([{"next_page_token": f"page-{i}"}]) for i in range(29)]
        responses.append(self.response([{"vulns": [{"id": "TEST-LAST"}]}]))
        with patch("audit_dependencies.urllib.request.urlopen", side_effect=responses) as request:
            self.assertEqual(query(self.items), {0: ["TEST-LAST"]})
        self.assertEqual(request.call_count, 30)

    def test_incomplete_last_allowed_request_fails_closed(self):
        responses = [self.response([{"next_page_token": f"page-{i}"}]) for i in range(30)]
        with patch("audit_dependencies.urllib.request.urlopen", side_effect=responses) as request:
            with self.assertRaisesRegex(ValueError, "^PAGINATION_LIMIT$"):
                query(self.items)
        self.assertEqual(request.call_count, 30)

    def test_non_string_continuation_tokens_are_rejected(self):
        for token in (False, 0, 0.0, [], {}, True, 1, ["next"], {"page": 2}):
            with self.subTest(token=token):
                with patch("audit_dependencies.urllib.request.urlopen", return_value=self.response([
                    {"next_page_token": token},
                ])):
                    with self.assertRaisesRegex(ValueError, "^PAGINATION$"):
                        query(self.items)

    def test_repeated_token_fails_closed(self):
        responses = [self.response([{"next_page_token": "same"}]) for _ in range(2)]
        with patch("audit_dependencies.urllib.request.urlopen", side_effect=responses) as request:
            with self.assertRaisesRegex(ValueError, "^PAGINATION$"):
                query(self.items)
        self.assertEqual(request.call_count, 2)

    def test_large_token_is_rejected(self):
        with patch("audit_dependencies.urllib.request.urlopen", return_value=self.response([
            {"next_page_token": "x" * 4097},
        ])):
            with self.assertRaisesRegex(ValueError, "^PAGINATION$"):
                query(self.items)

    def test_batches_stay_bounded(self):
        items = [{"name": f"example-{i}", "version": "1.0.0"} for i in range(101)]
        responses = [self.response([{}] * size) for size in (50, 50, 1)]
        with patch("audit_dependencies.urllib.request.urlopen", side_effect=responses) as request:
            self.assertEqual(query(items), {i: [] for i in range(101)})
        self.assertEqual([len(json.loads(call.args[0].data)["queries"])
                          for call in request.call_args_list], [50, 50, 1])

    def test_invalid_response_shapes_fail_closed(self):
        for results, error in (([], "RESULT_COUNT"), ([{"error": "failed"}], "RESULT"),
                               ([{"vulns": None}], "ADVISORIES"),
                               ([{"vulns": [{"id": "bad id"}]}], "ADVISORY_ID")):
            with self.subTest(error=error):
                with patch("audit_dependencies.urllib.request.urlopen", return_value=self.response(results)):
                    with self.assertRaisesRegex(ValueError, f"^{error}$"):
                        query(self.items)



class MainTests(unittest.TestCase):
    def run_audit(self, first_result=None, network_error=None):
        registry = "registry+https://github.com/rust-lang/crates.io-index"
        metadata = {
            "packages": [
                {"id": "app", "name": "perfectutilitares-solverforge-spike"},
                {"id": "sf", "name": "solverforge", "version": "0.31.2", "source": None, "license": "Apache-2.0"},
                {"id": "json", "name": "serde_json", "version": "1.0.149", "source": registry, "license": "MIT OR Apache-2.0"},
            ],
            "resolve": {"nodes": [
                {"id": "app", "deps": [{"pkg": "sf"}, {"pkg": "json"}]},
                {"id": "sf", "deps": []}, {"id": "json", "deps": []},
            ]},
        }
        lock = "".join(
            f'[[package]]\nname = "{name}"\nversion = "{version}"\n'
            f'source = "{registry}"\nchecksum = "{"a" * 64}"\n'
            for name, version in (("anyhow", "1.0.103"), ("serde_json", "1.0.149"))
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            metadata_path, lock_path, output = root / "metadata.json", root / "Cargo.lock", root / "report.json"
            metadata_path.write_text(json.dumps(metadata))
            lock_path.write_text(lock)
            response = QueryTests.response([first_result if first_result is not None else {}, {}, {}])
            with patch("audit_dependencies.sys.argv", ["audit_dependencies.py", str(metadata_path), str(lock_path), str(output)]), \
                    patch("audit_dependencies.urllib.request.urlopen", return_value=response, side_effect=network_error), \
                    redirect_stdout(io.StringIO()):
                status = main()
            return status, json.loads(output.read_text())

    def test_complete_audit_keeps_resolved_and_full_lock_scopes(self):
        status, report = self.run_audit()
        self.assertEqual(status, 0)
        self.assertEqual(report["status"], "NO_MATCHES_IN_RESOLVED_CRATE_SCOPE")
        self.assertEqual(report["resolvedCrates"], 2)
        self.assertEqual(report["lockedRegistryCrates"], 2)
        self.assertIs(report["reviewedLockCorrections"][0]["reachable"], False)

    def test_unreachable_lock_advisory_still_blocks_success(self):
        status, report = self.run_audit({"vulns": [{"id": "TEST-LOCK"}]})
        self.assertEqual(status, 1)
        self.assertEqual(report["status"], "REVIEW_REQUIRED")
        self.assertEqual(report["componentsWithAdvisories"], 0)
        self.assertEqual(report["lockedComponentsWithAdvisories"], 1)

    def test_malformed_pagination_cannot_produce_a_clean_audit(self):
        for token in (False, 0, 0.0, [], {}):
            with self.subTest(token=token):
                status, report = self.run_audit({"next_page_token": token})
                self.assertEqual(status, 1)
                self.assertEqual(report, {"status": "INCONCLUSIVE", "reason": "INVENTORY_OR_OSV_QUERY_FAILED"})

    def test_network_failure_remains_inconclusive(self):
        status, report = self.run_audit(network_error=OSError("synthetic network failure"))
        self.assertEqual(status, 1)
        self.assertEqual(report["status"], "INCONCLUSIVE")


if __name__ == "__main__":
    unittest.main()
