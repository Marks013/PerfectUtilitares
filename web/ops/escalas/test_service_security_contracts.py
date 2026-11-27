"""Preserved HTTP security contracts; original assertions, native service fixture."""
import copy
import http.client
import json
import multiprocessing
import os
import pathlib
import secrets
import socket
import tempfile
import threading
import threading as CONTEXT
import time
import unittest
from uuid import uuid4
from control import SolveCancelled,SolveControl,SolveTimedOut
from server import MAX_BODY,SolverHTTPServer
from service_operations import OperationError,Operations
from service_security import load_secret,operation_identity
from contract_fixtures import fixture, supported_fixture
from solver import solve as solve_native


def _shifted_clock(day_shift, shift_id, delta):
    shift = copy.deepcopy(day_shift)
    shift["id"] = shift_id
    for segment in shift["segments"]:
        segment["start"] += delta
        segment["end"] += delta
    return shift


def _catalog_fixture(clock_count, options_count):
    data = fixture(40)
    for index in range(1, clock_count):
        data["shifts"].append(_shifted_clock(data["shifts"][0], f"clock-{index}", -index))
    choices = data["shifts"][:options_count - 1] + data["shifts"][-1:]
    data["employees"][0]["shiftIds"] = [shift["id"] for shift in choices]
    earliest = choices[-1]["segments"][0]["start"]
    data["demands"] = [
        {"date": "2026-11-04", "sector": "Reposição", "role": "Repositor",
         "start": earliest, "end": earliest + 1, "minimum": 1}
    ]
    return data


def _manual_period_fixture():
    data = fixture(40)
    data["restRulesVersion"] = 2
    data["generationMode"] = "HOURS_ONLY"
    data["shifts"].append(_shifted_clock(data["shifts"][0], "local-early", -60))
    data["employees"][0].update(
        scheduleMode="TIMED",
        fixedImportedShiftId="day",
        manualShiftBaseIds=["day"],
        manualShiftOverrides=[
            {"catalogCode": 1500, "shiftId": "local-early",
             "markings": ["07:00", "11:00", "12:00", "16:00"],
             "effectiveFrom": "2026-11-03", "effectiveUntil": "2026-11-04"}
        ],
        manualShiftByDate={"2026-11-03": "local-early", "2026-11-04": "local-early"},
    )
    for offset in range(2, 9):
        day = f"2026-11-{offset:02d}"
        row = {"employeeId": "p0", "date": day,
               "kind": "OFF" if offset in (4, 8) else "WORK"}
        if row["kind"] == "WORK":
            row["shiftId"] = "day"
        if offset == 2:
            row.update(locked=True, note="Bloqueio legítimo")
        data["assignments"].append(row)
    data["demands"] = [{"date": "2026-11-03", "sector": "Reposição",
                        "start": 420, "end": 480, "minimum": 1}]
    return data

class LegacyServiceTests(unittest.TestCase):
    def setUp(self):
        self.secret = secrets.token_urlsafe(32).encode("ascii")
        self.server = SolverHTTPServer(("127.0.0.1", 0), self.secret)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01})
        self.thread.start()

    def tearDown(self):
        self.server.operations.cancel_all()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.assertFalse(self.thread.is_alive())
        self.assertFalse(multiprocessing.active_children())

    def identity(self):
        return str(uuid4()), secrets.token_hex(32)

    def request(self, path, payload, identity=None, auth=True):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + self.secret.decode("ascii")
        if identity:
            headers["X-Request-ID"], headers["X-Cancel-Token"] = identity
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=25)
        try:
            connection.request("POST", path, json.dumps(payload), headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def solve(self, data=None, identity=None):
        return self.request("/solve", {"input": data or supported_fixture()}, identity or self.identity())

    def cancel(self, identity):
        return self.request("/cancel", {"requestId": identity[0], "cancelToken": identity[1]})

    def wait_active(self):
        until = time.monotonic() + 3
        while self.server.operations.active_id is None and time.monotonic() < until:
            time.sleep(0.01)
        self.assertIsNotNone(self.server.operations.active_id)

    def test_native_catalog_at_and_beyond_old_limits_can_use_the_last_choice(self):
        for clocks, options in ((13, 5), (120, 12)):
            with self.subTest(clocks=clocks, options=options):
                data = _catalog_fixture(clocks, options)
                status, result = self.solve(data)
                self.assertEqual(status, 200, result)
                self.assertEqual(result["status"], "FEASIBLE", result)
                self.assertEqual(len(result["assignments"]), 7)
                worked = {row["date"]: row["shiftId"] for row in result["assignments"]
                          if row["kind"] == "WORK"}
                self.assertEqual(len(worked), 5)
                self.assertEqual(worked["2026-11-04"], f"clock-{clocks - 1}")
                self.assertLessEqual(set(worked.values()), set(data["employees"][0]["shiftIds"]))

    def test_transport_still_rejects_catalog_and_employee_option_overflow(self):
        for clocks, options, field in ((121, 12, "shifts"), (120, 13, "employees[0].shiftIds")):
            with self.subTest(clocks=clocks, options=options):
                status, result = self.solve(_catalog_fixture(clocks, options))
                self.assertEqual(status, 400, result)
                self.assertEqual(result["error"], "INVALID_MODEL_INPUT")
                self.assertIn({"path": field, "reason": "TOO_MANY_ITEMS"}, result["fields"])
                self.assertIsNone(self.server.operations.active_id)

    def test_native_manual_period_changes_only_work_within_the_period(self):
        data = _manual_period_fixture()
        status, result = self.solve(data)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE", result)
        original = {row["date"]: row for row in data["assignments"]}
        proposed = {row["date"]: row for row in result["assignments"]}
        self.assertEqual(len(result["assignments"]), 7)
        self.assertEqual(proposed["2026-11-03"],
                         {**original["2026-11-03"], "shiftId": "local-early"})
        for day in original.keys() - {"2026-11-03"}:
            with self.subTest(day=day):
                self.assertEqual(proposed[day], original[day])
        self.assertEqual(data["employees"][0]["manualShiftBaseIds"], ["day"])

    def test_native_manual_period_rejects_inconsistent_effective_map_base_or_mode(self):
        for field, change in (
            ("manualShiftByDate", {"2026-11-03": "day", "2026-11-04": "local-early"}),
            ("manualShiftBaseIds", ["day", "local-early"]),
            ("scheduleMode", None),
        ):
            with self.subTest(field=field):
                data = _manual_period_fixture()
                if change is None:
                    del data["employees"][0][field]
                else:
                    data["employees"][0][field] = change
                status, result = self.solve(data)
                self.assertEqual(status, 422, result)
                self.assertEqual(result["error"], "SOLVER_UNSUPPORTED_INPUT")
                self.assertNotIn("assignments", result)
                self.assertIsNone(self.server.operations.active_id)

    def test_manual_period_cannot_replace_locked_work(self):
        data = _manual_period_fixture()
        data["assignments"][1]["locked"] = True
        status, result = self.solve(data)
        self.assertEqual(status, 400, result)
        self.assertEqual(result["error"], "INVALID_MODEL_INPUT")
        self.assertIn({"path": "employees[0].manualShiftByDate[0].shiftId",
                       "reason": "MANUAL_SHIFT_LOCK_CONFLICT"}, result["fields"])
        self.assertNotIn("assignments", result)
        self.assertIsNone(self.server.operations.active_id)

    def test_authenticated_real_native_cancellation_releases_slot_for_next_solve(self):
        phase_reached = threading.Event()
        release_phase = threading.Event()

        def observed_solve(data, control):
            def synchronize_on_native_phase(phase):
                if phase == "CONSTRUCTION":
                    phase_reached.set()
                    if not release_phase.wait(5):
                        raise AssertionError("HTTP cancellation was not exercised")

            control.on_phase = synchronize_on_native_phase
            return solve_native(data, control)

        self.server.solver_target = observed_solve
        identity = self.identity()
        cancelled = []
        request = threading.Thread(target=lambda: cancelled.append(self.solve(identity=identity)))
        request.start()
        try:
            self.assertTrue(phase_reached.wait(5), "native construction phase not observed")
            self.assertEqual(self.cancel(identity)[0], 200)
        finally:
            release_phase.set()
            request.join(5)
        self.assertFalse(request.is_alive())
        status, result = cancelled[0]
        self.assertEqual((status, result["error"]), (409, "SOLVER_CANCELLED"))
        self.assertIsNone(self.server.operations.active_id)
        self.server.solver_target = solve_native
        status, result = self.solve()
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE", result)

    def test_unauthorized_call_is_rejected_before_body_or_slot(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.putrequest("POST", "/solve")
        connection.putheader("Content-Length", str(MAX_BODY + 1))
        connection.endheaders()  # Deliberately do not send the body.
        started = time.monotonic()
        response = connection.getresponse()
        self.assertEqual(response.status, 401)
        self.assertEqual(json.loads(response.read()), {"error": "SOLVER_UNAUTHORIZED"})
        self.assertLess(time.monotonic() - started, 1)
        self.assertIsNone(self.server.operations.active_id)
        self.assertFalse(self.server.operations.records)
        connection.close()

    def test_wrong_and_duplicate_authorization_are_rejected(self):
        for values in [["Bearer " + "0" * len(self.secret)], ["Bearer " + self.secret.decode(), "Bearer " + self.secret.decode()]]:
            with self.subTest(count=len(values)):
                connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
                connection.putrequest("POST", "/solve")
                for value in values:
                    connection.putheader("Authorization", value)
                connection.putheader("Content-Length", "1")
                connection.endheaders()
                response = connection.getresponse()
                self.assertEqual(response.status, 401)
                response.read()
                connection.close()
        self.assertFalse(self.server.operations.records)

    def test_invalid_model_does_not_expose_personal_payload(self):
        status, result = self.solve({"secret": "PRIVATE_SENSITIVE_77"})
        self.assertEqual(status, 400)
        self.assertNotIn("PRIVATE_SENSITIVE_77", json.dumps(result))
        self.assertIsNone(self.server.operations.active_id)
        self.assertEqual(self.solve()[0], 200)

    def test_oversized_body_is_rejected_without_waiting_for_it(self):
        identity = self.identity()
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.putrequest("POST", "/solve")
        connection.putheader("Authorization", "Bearer " + self.secret.decode())
        connection.putheader("X-Request-ID", identity[0])
        connection.putheader("X-Cancel-Token", identity[1])
        connection.putheader("Content-Length", str(MAX_BODY + 1))
        connection.putheader("Content-Type", "application/json")
        connection.endheaders()
        response = connection.getresponse()
        self.assertEqual(response.status, 413)
        response.read()
        connection.close()
        self.assertIsNone(self.server.operations.active_id)

    def test_malformed_operation_is_rejected_before_work(self):
        bad = [("not-a-uuid", "a" * 64), (str(uuid4()), "x" * 64), (str(uuid4()).upper(), "a" * 64)]
        for identity in bad:
            with self.subTest(identity=identity[0]):
                self.assertEqual(self.solve(identity=identity)[0], 400)
        self.assertFalse(self.server.operations.records)

    def test_duplicate_lengths_and_transfer_encoding_are_rejected(self):
        for transfer in (False, True):
            connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
            identity = self.identity()
            connection.putrequest("POST", "/solve")
            connection.putheader("Authorization", "Bearer " + self.secret.decode())
            connection.putheader("X-Request-ID", identity[0])
            connection.putheader("X-Cancel-Token", identity[1])
            connection.putheader("Content-Length", "2")
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Transfer-Encoding" if transfer else "Content-Length", "chunked" if transfer else "2")
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            response.read()
            connection.close()
        self.assertFalse(self.server.operations.records)

    def test_connection_threads_are_bounded_and_recover(self):
        connections = []
        try:
            for _ in range(16):
                connection = socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2)
                connection.sendall(b"POST /solve HTTP/1.1\r\n")
                connections.append(connection)
            until = time.monotonic() + 2
            while self.server.handlers._value and time.monotonic() < until:
                time.sleep(0.01)
            self.assertEqual(self.server.handlers._value, 0)
            extra = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
            extra.request("GET", "/health")
            response = extra.getresponse()
            self.assertEqual(response.status, 503)
            response.read()
            extra.close()
            self.assertIsNone(self.server.operations.active_id)
        finally:
            for connection in connections:
                connection.close()
        until = time.monotonic() + 2
        while self.server.handlers._value < 16 and time.monotonic() < until:
            time.sleep(0.01)
        self.assertEqual(self.server.handlers._value, 16)
        self.assertEqual(self.solve()[0], 200)

    def test_health_returns_only_boolean(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.request("GET", "/health")
        response = connection.getresponse()
        self.assertEqual((response.status, json.loads(response.read())), (200, {"ok": True}))
        connection.close()

class LegacyControlTests(unittest.TestCase):
    def test_construction_checkpoint_distinguishes_timeout_and_cancel(self):
        event = CONTEXT.Event()
        with self.assertRaises(SolveTimedOut):
            SolveControl(event, time.monotonic() - 1).checkpoint()
        event.set()
        with self.assertRaises(SolveCancelled):
            SolveControl(event, time.monotonic() + 1).checkpoint()

    def test_registry_limits_records_and_does_not_expire_active_operation(self):
        operations = Operations(max_records=1, ttl=0.01)
        request_id, token_hash = operation_identity(str(uuid4()), secrets.token_hex(32))
        current = operations.start(request_id, token_hash)
        time.sleep(0.02)
        with self.assertRaises(OperationError) as context:
            operations.start(*operation_identity(str(uuid4()), secrets.token_hex(32)))
        self.assertEqual(context.exception.status, 429)
        self.assertEqual(operations.active_id, request_id)
        operations.finish(current, "COMPLETED")
        with self.assertRaises(OperationError) as context:
            operations.cancel(*operation_identity(str(uuid4()), secrets.token_hex(32)))
        self.assertEqual(context.exception.code, "SOLVER_CONTROL_CAPACITY")
        time.sleep(0.02)
        self.assertEqual(operations.cancel(*operation_identity(str(uuid4()), secrets.token_hex(32))), "CANCELLED")

    def test_terminal_transition_cancel_wins_only_when_requested_first(self):
        operations = Operations()
        identity = operation_identity(str(uuid4()), secrets.token_hex(32))
        current = operations.start(*identity)
        operations.cancel(*identity)
        self.assertEqual(operations.finish(current, "COMPLETED"), "CANCELLED")
        identity = operation_identity(str(uuid4()), secrets.token_hex(32))
        current = operations.start(*identity)
        self.assertEqual(operations.finish(current, "COMPLETED"), "COMPLETED")
        self.assertEqual(operations.cancel(*identity), "COMPLETED")

    def test_secret_file_requires_private_regular_file_and_strong_format(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "secret"
            expected = secrets.token_urlsafe(32).encode("ascii")
            target.write_bytes(expected + b"\n")
            target.chmod(0o600)
            self.assertEqual(load_secret(target), expected)
            target.chmod(0o644)
            with self.assertRaises(ValueError):
                load_secret(target)
            target.chmod(0o600)
            target.write_bytes(b"a" * 128 + b"\n\nignored")
            with self.assertRaises(ValueError):
                load_secret(target)
            target.write_bytes(b"weak")
            with self.assertRaises(ValueError):
                load_secret(target)
            fifo = pathlib.Path(directory) / "fifo"
            os.mkfifo(fifo, mode=0o600)
            with self.assertRaises(ValueError):
                load_secret(fifo)
            link = pathlib.Path(directory) / "link"
            link.symlink_to(target)
            with self.assertRaises(OSError):
                load_secret(link)
