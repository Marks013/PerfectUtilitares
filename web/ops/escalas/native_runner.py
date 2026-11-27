"""Bounded stdlib-only transport to an owned SolverForge process group."""

import json
import math
import os
from pathlib import Path
from datetime import date, timedelta
import selectors
import signal
import subprocess
from control import SolveTimedOut

MAX_BYTES = 8 * 1024 * 1024
DEFAULT_BINARY = "/usr/local/bin/solverforge"


class NativeError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


def executable(binary=None):
    name = binary or os.environ.get("ESCALAS_SOLVER_BINARY", DEFAULT_BINARY)
    if not isinstance(name, str) or not Path(name).is_absolute():
        raise NativeError(503, "SOLVER_UNAVAILABLE")
    path = Path(name)
    if not path.is_file() or not os.access(path, os.X_OK):
        raise NativeError(503, "SOLVER_UNAVAILABLE")
    return str(path)


def _stop(process):
    # Reap only our child; terminate descendants sharing its private group.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()
    for stream in (process.stdin, process.stdout):
        if stream is not None:
            stream.close()


def _exchange(command, request, control):
    control.checkpoint()
    environment = {
        "PATH": "/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "America/Sao_Paulo",
        "RAYON_NUM_THREADS": "1",
    }
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
            close_fds=True,
            start_new_session=True,
        )
    except OSError:
        raise NativeError(503, "SOLVER_UNAVAILABLE") from None
    output = bytearray()
    try:
        with selectors.DefaultSelector() as selector:
            for stream in (process.stdin, process.stdout):
                os.set_blocking(stream.fileno(), False)
            selector.register(process.stdin, selectors.EVENT_WRITE)
            selector.register(process.stdout, selectors.EVENT_READ)
            offset = 0
            while (
                selector.get_map()
                or os.waitid(
                    os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT
                )
                is None
            ):
                control.checkpoint()
                for key, _events in selector.select(0.02):
                    stream = key.fileobj
                    if stream is process.stdin:
                        try:
                            offset += os.write(
                                stream.fileno(), request[offset : offset + 65536]
                            )
                        except BlockingIOError:
                            continue
                        except BrokenPipeError:
                            offset = len(request)
                        if offset == len(request):
                            selector.unregister(stream)
                            stream.close()
                    else:
                        try:
                            data = os.read(stream.fileno(), 65536)
                        except BlockingIOError:
                            continue
                        if not data:
                            selector.unregister(stream)
                            stream.close()
                        else:
                            if len(output) + len(data) > MAX_BYTES:
                                raise NativeError(502, "SOLVER_RESPONSE_INVALID")
                            output.extend(data)
            control.checkpoint()
    finally:
        _stop(process)
    if process.returncode == 124:
        raise SolveTimedOut()
    if process.returncode != 0:
        raise NativeError(500, "SOLVER_FAILED")
    return bytes(output)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("DUPLICATE_KEY")
        result[key] = value
    return result


def _constant(_value):
    raise ValueError("NONFINITE_JSON")


def _body(raw):
    try:
        reply = json.loads(
            raw.decode("utf-8"), object_pairs_hook=_object, parse_constant=_constant
        )
    except (ValueError, UnicodeError, RecursionError):
        raise NativeError(502, "SOLVER_RESPONSE_INVALID") from None
    if not isinstance(reply, dict) or type(reply.get("httpStatus")) is not int:
        raise NativeError(502, "SOLVER_RESPONSE_INVALID")
    status, body = reply["httpStatus"], reply.get("body")
    if not isinstance(body, dict):
        raise NativeError(502, "SOLVER_RESPONSE_INVALID")
    if status == 400 and body.get("error") == "SPIKE_UNSUPPORTED_INPUT":
        raise NativeError(422, "SOLVER_UNSUPPORTED_INPUT")
    if status == 504:
        raise SolveTimedOut()
    if status == 413:
        raise NativeError(413, "INVALID_LENGTH")
    if status != 200:
        raise NativeError(500, "SOLVER_FAILED")
    state, rows, seconds = (
        body.get("status"),
        body.get("assignments"),
        body.get("wallTimeSeconds"),
    )
    if (
        state not in ("FEASIBLE", "OPTIMAL", "UNKNOWN", "INFEASIBLE", "MODEL_INVALID")
        or not isinstance(rows, list)
        or len(rows) > 12000
        or type(seconds) not in (int, float)
        or not math.isfinite(seconds)
        or seconds < 0
        or state not in ("FEASIBLE", "OPTIMAL")
        and rows
    ):
        raise NativeError(502, "SOLVER_RESPONSE_INVALID")
    seen = set()
    for row in rows:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("employeeId"), str)
            or not isinstance(row.get("date"), str)
            or row.get("kind") not in ("WORK", "DUTY", "OFF", "ABSENCE", "HOLIDAY")
            or "locked" in row
            and type(row["locked"]) is not bool
            or (row["kind"] == "WORK") != isinstance(row.get("shiftId"), str)
        ):
            raise NativeError(502, "SOLVER_RESPONSE_INVALID")
        key = row["employeeId"], row["date"]
        if key in seen:
            raise NativeError(502, "SOLVER_RESPONSE_INVALID")
        seen.add(key)
    return body


def _corresponds(body, payload):
    """Transport integrity, not a replacement for independent labor validation."""
    if body["status"] not in ("FEASIBLE", "OPTIMAL"):
        return body
    try:
        first, last = date.fromisoformat(payload["startDate"]), date.fromisoformat(payload["endDate"])
        if not 0 <= (last - first).days < 42:
            raise ValueError("HORIZON")
        dates = [(first + timedelta(days=n)).isoformat() for n in range((last-first).days+1)]
        people = {p["id"]:p for p in payload["employees"] if p.get("planningEnabled", True)}
        expected = {(pid, day) for pid,p in people.items() for day in dates
                    if day >= p.get("activeFrom", "") and (not p.get("activeUntil") or day <= p["activeUntil"])}
        excluded = {p["id"] for p in payload["employees"] if p.get("planningEnabled") is False}
        preserve_all = payload.get("generationMode") == "HOURS_ONLY"
        retained = {(r["employeeId"], r["date"]): r for r in payload["assignments"]
                    if r["employeeId"] in excluded and (preserve_all or r.get("locked")
                                                         or r["kind"] in ("ABSENCE", "HOLIDAY"))}
        rows = body["assignments"]
        actual = {(r["employeeId"], r["date"]): r for r in rows}
        if set(actual) != expected | set(retained) or len(actual) != len(rows):
            raise ValueError("POSITIONS")
        shifts = {s["id"] for s in payload["shifts"]}
        for row in rows:
            if row["employeeId"] in excluded:
                if row != retained.get((row["employeeId"], row["date"])):
                    raise ValueError("RETAINED_DISABLED")
                continue
            person = people[row["employeeId"]]
            untimed = person.get("scheduleMode") in ("UNTIMED", "MISSING")
            if row["kind"] == "WORK" and (untimed or row["shiftId"] not in shifts):
                raise ValueError("SHIFT")
            if row["kind"] == "DUTY" and not untimed:
                raise ValueError("DUTY")
        for old in payload["assignments"]:
            if old["employeeId"] not in people:
                continue
            key = old["employeeId"], old["date"]
            if preserve_all:
                new = actual.get(key)
                if not new or any(field not in new or new[field] != value for field, value in old.items()
                                  if field != "shiftId" or old["kind"] != "WORK"):
                    raise ValueError("HOURS_ONLY_RECORD")
            if old.get("locked") or old["kind"] in ("ABSENCE", "HOLIDAY"):
                new = actual.get(key)
                if (not new or new["kind"] != old["kind"]
                        or old.get("locked") and (not new.get("locked") or new.get("shiftId") != old.get("shiftId"))):
                    raise ValueError("PROTECTED")
    except (KeyError, TypeError, ValueError, OverflowError):
        raise NativeError(502, "SOLVER_RESPONSE_INVALID") from None
    return body


def run_native(payload, control, *, binary=None, prefix=()):
    """prefix is an internal test seam; never read from payload or environment."""
    control.checkpoint()
    try:
        request = json.dumps(
            {"input": payload},
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (ValueError, TypeError, UnicodeError):
        raise NativeError(400, "INVALID_MODEL_INPUT") from None
    if len(request) > MAX_BYTES:
        raise NativeError(413, "INVALID_LENGTH")
    return _corresponds(_body(
        _exchange([executable(binary), *prefix, "--service"], request, control)
    ), payload)
