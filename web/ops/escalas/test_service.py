"""Actual authenticated HTTP -> owned SolverForge process; no CP-SAT fallback."""

import copy
import http.client
import json
import secrets
import sys
import threading
import time
import unittest
from uuid import uuid4
from contract_fixtures import fixture, supported_fixture
from native_runner import run_native
from server import SolverHTTPServer
from service_operations import OperationError, Operations
from solver import solve


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.secret = secrets.token_hex(32).encode()
        self.server = SolverHTTPServer(("127.0.0.1", 0), self.secret)
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.01}
        )
        self.thread.start()

    def tearDown(self):
        self.server.operations.cancel_all()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)
        self.assertFalse(self.thread.is_alive())
        self.assertIsNone(self.server.operations.active_id)

    def identity(self):
        return str(uuid4()), secrets.token_hex(32)

    def request(self, path, payload, identity=None, auth=True):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + self.secret.decode()
        if identity:
            headers["X-Request-ID"], headers["X-Cancel-Token"] = identity
        conn = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=20
        )
        try:
            conn.request("POST", path, json.dumps(payload), headers)
            res = conn.getresponse()
            return res.status, json.loads(res.read())
        finally:
            conn.close()

    def test_actual_native_success_is_complete_and_preserves_input(self):
        data = supported_fixture()
        old = copy.deepcopy(data)
        status, result = self.request("/solve", {"input": data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["assignments"]), 21)
        self.assertEqual(data, old)
        for person in data["employees"]:
            rows = [a for a in result["assignments"] if a["employeeId"] == person["id"]]
            self.assertEqual(sum(a["kind"] == "WORK" for a in rows), 5)
            self.assertEqual(sum(a["kind"] == "OFF" for a in rows), 2)
            self.assertEqual(
                next(a for a in rows if a["date"] == "2026-11-07")["kind"], "WORK"
            )

    def test_legacy_default_contract_succeeds_over_real_http(self):
        data = fixture(40)
        before = copy.deepcopy(data)
        status, result = self.request("/solve", {"input": data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["assignments"]), 7)
        self.assertEqual(sum(a["kind"] == "WORK" for a in result["assignments"]), 5)
        self.assertEqual(data, before)

    def test_unsupported_real_contract_is_explicit_not_fabricated_feasibility(self):
        data = fixture()
        data["policy"]["normativeProfile"] = "UNMODELED_POLICY"
        status, result = self.request("/solve", {"input": data}, self.identity())
        self.assertEqual(status, 422)
        self.assertEqual(result["error"], "SOLVER_UNSUPPORTED_INPUT")
        self.assertNotIn("assignments", result)

    def test_authentication_precedes_parsing_and_slot_allocation(self):
        status, result = self.request(
            "/solve", {"bad": "input"}, self.identity(), auth=False
        )
        self.assertEqual(status, 401)
        self.assertNotIn("fields", result)
        self.assertIsNone(self.server.operations.active_id)

    def test_bad_input_is_400_and_never_claims_slot(self):
        status, result = self.request("/solve", {"input": {}}, self.identity())
        self.assertEqual(status, 400)
        self.assertIsNone(self.server.operations.active_id)
        self.assertEqual(result["error"], "INVALID_MODEL_INPUT")

    def test_precancellation_is_honored(self):
        identity = self.identity()
        status, _ = self.request(
            "/cancel", dict(zip(("requestId", "cancelToken"), identity))
        )
        self.assertEqual(status, 200)
        status, result = self.request(
            "/solve", {"input": supported_fixture()}, identity
        )
        self.assertEqual((status, result["error"]), (409, "SOLVER_CANCELLED"))

    def test_cancel_busy_and_capability_isolation(self):
        def stalled(data, control):
            return run_native(
                data,
                control,
                binary=sys.executable,
                prefix=("-c", "import time;time.sleep(10)"),
            )

        self.server.solver_target = stalled
        identity = self.identity()
        out = []
        request = threading.Thread(
            target=lambda: out.append(
                self.request("/solve", {"input": supported_fixture()}, identity)
            )
        )
        request.start()
        try:
            until = time.monotonic() + 2
            while self.server.operations.active_id is None and time.monotonic() < until:
                time.sleep(0.01)
            self.assertEqual(self.server.operations.active_id, identity[0])
            status, _ = self.request(
                "/solve", {"input": supported_fixture()}, self.identity()
            )
            self.assertEqual(status, 429)
            status, _ = self.request(
                "/cancel",
                {"requestId": identity[0], "cancelToken": secrets.token_hex(32)},
            )
            self.assertEqual(status, 404)
            status, _ = self.request(
                "/cancel", dict(zip(("requestId", "cancelToken"), identity))
            )
            self.assertEqual(status, 200)
        finally:
            self.server.operations.cancel_all()
            request.join(3)
        self.assertFalse(request.is_alive())
        self.assertEqual(out[0][0], 409)
        self.assertEqual(out[0][1]["error"], "SOLVER_CANCELLED")

    def test_native_deadline_is_504_and_slot_released(self):
        self.server.operation_timeout = 0.12
        self.server.solver_target = lambda data, control: run_native(
            data,
            control,
            binary=sys.executable,
            prefix=("-c", "import time;time.sleep(10)"),
        )
        status, result = self.request(
            "/solve", {"input": supported_fixture()}, self.identity()
        )
        self.assertEqual((status, result["error"]), (504, "SOLVER_TIMED_OUT"))
        self.assertIsNone(self.server.operations.active_id)

    def test_unknown_route_does_not_invoke_solver(self):
        status, _ = self.request("/not-a-route", {}, self.identity())
        self.assertEqual(status, 404)


class RegistryTests(unittest.TestCase):
    def test_capacity_replay_and_shutdown_fail_closed(self):
        ops = Operations(max_records=1)
        item = ops.start("first", b"a" * 32)
        with self.assertRaises(OperationError) as caught:
            ops.start("first", b"b" * 32)
        self.assertEqual(caught.exception.status, 404)
        ops.finish(item, "COMPLETED")
        with self.assertRaises(OperationError) as caught:
            ops.start("second", b"a" * 32)
        self.assertEqual(caught.exception.status, 503)
        ops.cancel_all()
        with self.assertRaises(OperationError):
            ops.start("third", b"a" * 32)
