"""Preserved HTTP security contracts; original assertions, native service fixture."""
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
from contract_fixtures import supported_fixture

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
