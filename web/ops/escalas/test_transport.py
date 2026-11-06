"""Exercise body limits without a server, process, model search or private data."""
from email.message import Message
from io import BytesIO
import json
import unittest

from server import Handler, MAX_BODY
from service_operations import OperationError


class TransportBoundaryTests(unittest.TestCase):
    def handler(self, body, length=None):
        handler = object.__new__(Handler)
        handler.headers = Message()
        handler.headers["Content-Type"] = "application/json"
        handler.headers["Content-Length"] = str(len(body) if length is None else length)
        handler.rfile = BytesIO(body)
        return handler

    def test_accepts_context_envelope_between_five_and_eight_mib(self):
        body = json.dumps({"input": {"context": "x" * (6 * 1024 * 1024)}}).encode()
        self.assertGreater(len(body), 5 * 1024 * 1024)
        result = self.handler(body)._body(MAX_BODY)
        self.assertEqual(len(result["input"]["context"]), 6 * 1024 * 1024)

    def test_counts_utf8_bytes_and_rejects_excess_before_reading(self):
        body = json.dumps({"input": {"context": "漢" * (3 * 1024 * 1024)}}, ensure_ascii=False).encode()
        self.assertGreater(len(body), MAX_BODY)
        handler = self.handler(body)
        with self.assertRaises(OperationError) as raised:
            handler._body(MAX_BODY)
        self.assertEqual(raised.exception.status, 413)
        self.assertEqual(handler.rfile.tell(), 0)

    def test_accepts_exactly_eight_mib(self):
        document = b'{"input":{}}'
        body = document + b" " * (MAX_BODY - len(document))
        self.assertEqual(len(body), 8 * 1024 * 1024)
        self.assertEqual(self.handler(body)._body(MAX_BODY), {"input": {}})

    def test_rejects_one_byte_above_eight_mib_before_reading(self):
        handler = self.handler(b"", MAX_BODY + 1)
        with self.assertRaises(OperationError) as raised:
            handler._body(MAX_BODY)
        self.assertEqual(raised.exception.status, 413)
        self.assertEqual(handler.rfile.tell(), 0)

    def test_keeps_cancellation_body_limit_separate(self):
        with self.assertRaises(OperationError) as raised:
            self.handler(b"x" * 1025)._body(1024)
        self.assertEqual(raised.exception.status, 413)
