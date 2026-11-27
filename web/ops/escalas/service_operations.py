"""Bounded operation control. Records contain capabilities' hashes, never models."""
from dataclasses import dataclass
import hmac
import threading
import time

from control import SolveCancelled, SolveControl, SolveTimedOut
from native_runner import NativeError
from solver import solve

MAX_RECORDS = 256
RECORD_TTL_SECONDS = 120
PROCESS_TIMEOUT_SECONDS = 18.0
TERMINAL = {"COMPLETED", "CANCELLED", "FAILED", "TIMED_OUT"}


class OperationError(Exception):
    def __init__(self, status, code, state=None):
        super().__init__(code)
        self.status, self.code, self.state = status, code, state


@dataclass
class Operation:
    request_id: str
    token_hash: bytes
    state: str
    expires: float
    event: object = None


class Operations:
    def __init__(self, max_records=MAX_RECORDS, ttl=RECORD_TTL_SECONDS):
        self.records = {}
        self.active_id = None
        self.lock = threading.RLock()
        self.closing = False
        self.max_records, self.ttl = max_records, ttl

    def _purge(self):
        now = time.monotonic()
        for key in [key for key, value in self.records.items()
                    if value.state in TERMINAL and value.expires <= now]:
            del self.records[key]

    def _existing(self, request_id, token_hash):
        current = self.records.get(request_id)
        if current and not hmac.compare_digest(current.token_hash, token_hash):
            raise OperationError(404, "SOLVER_OPERATION_NOT_FOUND")
        return current

    def start(self, request_id, token_hash):
        with self.lock:
            self._purge()
            if self.closing:
                raise OperationError(503, "SOLVER_UNAVAILABLE")
            current = self._existing(request_id, token_hash)
            if current:
                if current.state == "CANCELLED":
                    raise OperationError(409, "SOLVER_CANCELLED", "CANCELLED")
                code = "SOLVER_OPERATION_ACTIVE" if current.state not in TERMINAL else "SOLVER_OPERATION_FINISHED"
                raise OperationError(409, code, current.state)
            if self.active_id is not None:
                raise OperationError(429, "SOLVER_BUSY")
            if len(self.records) >= self.max_records:
                raise OperationError(503, "SOLVER_CONTROL_CAPACITY")
            operation = Operation(request_id, token_hash, "RUNNING", time.monotonic() + self.ttl,
                                  threading.Event())
            self.records[request_id] = operation
            self.active_id = request_id
            return operation

    def cancel(self, request_id, token_hash):
        with self.lock:
            self._purge()
            current = self._existing(request_id, token_hash)
            if current is None:
                if len(self.records) >= self.max_records:
                    raise OperationError(503, "SOLVER_CONTROL_CAPACITY")
                # Covers cancellation reaching the service before its solve request.
                current = Operation(request_id, token_hash, "CANCELLED", time.monotonic() + self.ttl)
                self.records[request_id] = current
            elif current.state not in TERMINAL:
                current.state = "CANCEL_REQUESTED"
                current.event.set()
            return current.state

    def finish(self, operation, state):
        with self.lock:
            # Only call after the native runner has reaped its exact owned process group.
            operation.state = "CANCELLED" if operation.state == "CANCEL_REQUESTED" else state
            operation.expires = time.monotonic() + self.ttl
            operation.event = None
            if self.active_id == operation.request_id:
                self.active_id = None
            return operation.state

    def cancel_all(self):
        with self.lock:
            self.closing = True
            for current in self.records.values():
                if current.state not in TERMINAL:
                    current.state = "CANCEL_REQUESTED"
                    current.event.set()


def run_operation(payload, operation, timeout=PROCESS_TIMEOUT_SECONDS, target=solve):
    """The native runner owns cleanup before finish releases the computation slot."""
    control = SolveControl(operation.event, time.monotonic() + timeout)
    try:
        control.checkpoint()
        result = target(payload, control=control)
        control.checkpoint()
        return {"state": "COMPLETED", "result": result}
    except SolveCancelled:
        return {"state": "CANCELLED"}
    except SolveTimedOut:
        return {"state": "TIMED_OUT"}
    except NativeError as error:
        return {"state": "FAILED", "error": error.code, "httpStatus": error.status}
    except (ValueError, KeyError, TypeError, OverflowError):
        return {"state": "FAILED", "error": "INVALID_MODEL_INPUT", "httpStatus": 400}
    except Exception:
        return {"state": "FAILED", "error": "SOLVER_FAILED", "httpStatus": 500}
