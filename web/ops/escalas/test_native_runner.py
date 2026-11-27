"""Bounded native process transport tests; fake processes need no executable tmpfs."""

import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from control import SolveCancelled, SolveControl, SolveTimedOut
from native_runner import NativeError, run_native


class NativeProcessTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.event = threading.Event()

    def run_code(self, code, seconds=2, payload=None):
        return run_native(
            payload or {"marker": "unchanged"},
            SolveControl(self.event, time.monotonic() + seconds),
            binary=sys.executable,
            prefix=("-c", code),
        )

    def test_valid_reply_exact_input_flags_and_sanitized_environment(self):
        code = 'import json,os,sys; v=json.load(sys.stdin); assert v=={"input":{"marker":"unchanged"}}; assert sys.argv[1:]==["--service"]; assert "MIGRATION_TEST_SECRET" not in os.environ; print(json.dumps({"httpStatus":200,"body":{"status":"UNKNOWN","assignments":[],"wallTimeSeconds":0}}))'
        with patch.dict(os.environ, {"MIGRATION_TEST_SECRET": "not-for-child"}):
            self.assertEqual(self.run_code(code)["status"], "UNKNOWN")

    def test_large_input_uses_partial_writes_without_deadlock(self):
        code = 'import json,sys; v=json.load(sys.stdin); assert len(v["input"]["data"])==262144; print(json.dumps({"httpStatus":200,"body":{"status":"UNKNOWN","assignments":[],"wallTimeSeconds":0}}))'
        self.assertEqual(
            self.run_code(code, payload={"data": "x" * 262144})["assignments"], []
        )

    def test_unsupported_input_is_not_infeasible_or_unknown(self):
        value = {
            "httpStatus": 400,
            "body": {
                "error": "SPIKE_UNSUPPORTED_INPUT",
                "failureType": "SYNTHETIC_ONLY",
            },
        }
        with self.assertRaises(NativeError) as raised:
            self.run_code("print(" + repr(json.dumps(value)) + ")")
        self.assertEqual(
            (raised.exception.status, raised.exception.code),
            (422, "SOLVER_UNSUPPORTED_INPUT"),
        )

    def test_cancel_kills_and_reaps_exact_child(self):
        pidfile = self.root / "pid"
        timer = threading.Timer(0.15, self.event.set)
        timer.start()
        try:
            with self.assertRaises(SolveCancelled):
                self.run_code(
                    "import os,time; open("
                    + repr(str(pidfile))
                    + ',"w").write(str(os.getpid())); time.sleep(10)'
                )
        finally:
            timer.cancel()
            timer.join()
        self.assertFalse(Path("/proc/" + pidfile.read_text()).exists())

    def test_timeout_kills_uncooperative_child(self):
        start = time.monotonic()
        with self.assertRaises(SolveTimedOut):
            self.run_code("import time; time.sleep(10)", seconds=0.12)
        self.assertLess(time.monotonic() - start, 1)

    def test_precancel_never_launches(self):
        self.event.set()
        marker = self.root / "started"
        with self.assertRaises(SolveCancelled):
            self.run_code("open(" + repr(str(marker)) + ',"w").write("bad")')
        self.assertFalse(marker.exists())

    def test_output_limit_terminates_native(self):
        with self.assertRaises(NativeError) as raised:
            self.run_code(
                'import sys,time; sys.stdout.write("x"*9000000);sys.stdout.flush();time.sleep(5)'
            )
        self.assertEqual(raised.exception.code, "SOLVER_RESPONSE_INVALID")

    def test_malformed_nonfinite_duplicate_and_wrong_schema_fail_closed(self):
        cases = [
            "not-json",
            "{}",
            "[]",
            '{"httpStatus":200,"body":{"status":"UNKNOWN","assignments":[],"wallTimeSeconds":NaN}}',
            '{"httpStatus":200,"httpStatus":200,"body":{}}',
            '{"httpStatus":true,"body":{}}',
            '{"httpStatus":200,"body":{"status":"UNKNOWN","assignments":[{}],"wallTimeSeconds":0}}',
        ]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(NativeError):
                self.run_code("print(" + repr(value) + ")")

    def test_crash_and_stderr_are_sanitized(self):
        with self.assertRaises(NativeError) as raised:
            self.run_code(
                'import sys;print("private-input",file=sys.stderr);sys.exit(9)'
            )
        self.assertEqual(str(raised.exception), "SOLVER_FAILED")

    def test_input_limit_prevents_launch(self):
        marker = self.root / "started"
        with self.assertRaises(NativeError) as raised:
            self.run_code(
                "open(" + repr(str(marker)) + ',"w").write("bad")',
                payload={"data": "x" * 8388608},
            )
        self.assertEqual(raised.exception.status, 413)
        self.assertFalse(marker.exists())

    def test_missing_and_relative_binary_fail_closed(self):
        for binary in ["relative", str(self.root / "missing")]:
            with self.subTest(binary=binary), self.assertRaises(NativeError) as raised:
                run_native(
                    {}, SolveControl(self.event, time.monotonic() + 1), binary=binary
                )
            self.assertEqual(raised.exception.code, "SOLVER_UNAVAILABLE")

    def test_native_watchdog_exit_is_timeout(self):
        with self.assertRaises(SolveTimedOut):
            self.run_code("import sys;sys.exit(124)")

    def test_feasible_reply_must_match_exact_input_and_protected_records(self):
        payload = {"startDate":"2026-11-01", "endDate":"2026-11-01",
                   "employees":[{"id":"employee-1","activeFrom":"","shiftIds":["day"],"scheduleMode":"TIMED"}],
                   "shifts":[{"id":"day"}],
                   "assignments":[{"employeeId":"employee-1","date":"2026-11-01","kind":"WORK","shiftId":"day","locked":True}]}
        valid = {"httpStatus":200,"body":{"status":"FEASIBLE","assignments":copy.deepcopy(payload["assignments"]),"wallTimeSeconds":0}}
        self.assertEqual(self.run_code("print("+repr(json.dumps(valid))+")", payload=payload)["assignments"],payload["assignments"])
        variants = [[],[{"employeeId":"other","date":"2026-11-01","kind":"OFF"}],
                    [{"employeeId":"employee-1","date":"2026-11-02","kind":"OFF"}],
                    [{"employeeId":"employee-1","date":"2026-11-01","kind":"WORK","shiftId":"unknown"}],
                    [{"employeeId":"employee-1","date":"2026-11-01","kind":"OFF"}],
                    [{"employeeId":"employee-1","date":"2026-11-01","kind":"WORK","shiftId":"day"}]]
        for rows in variants:
            value=copy.deepcopy(valid);value["body"]["assignments"]=rows
            with self.subTest(rows=rows):
                with self.assertRaises(NativeError) as raised:
                    self.run_code("print("+repr(json.dumps(value))+")",payload=payload)
                self.assertEqual(raised.exception.code,"SOLVER_RESPONSE_INVALID")

    def test_success_cannot_leave_an_inherited_pipe_child_running(self):
        pidfile=self.root/"descendant"
        code=('import os,time; pid=os.fork(); '
              'open('+repr(str(pidfile))+',"w").write(str(pid)) if pid else None; '
              'time.sleep(10) if not pid else None')
        with self.assertRaises(SolveTimedOut):
            self.run_code(code,seconds=0.25)
        pid=pidfile.read_text()
        for _ in range(50):
            stat=Path("/proc/"+pid+"/stat")
            if not stat.exists() or stat.read_text().split()[2]=="Z":break
            time.sleep(0.01)
        else:self.fail("owned descendant is still running")

    def test_deep_json_is_a_sanitized_protocol_error(self):
        with self.assertRaises(NativeError) as raised:
            self.run_code('print("["*3000+"0"+"]"*3000)')
        self.assertEqual(raised.exception.code,"SOLVER_RESPONSE_INVALID")


class DisabledRecordIntegrityTests(unittest.TestCase):
    def test_preserved_disabled_records_are_exact_and_never_new_allocations(self):
        from native_runner import _corresponds
        payload = {"startDate":"2026-11-02", "endDate":"2026-11-02",
                   "employees":[{"id":"active"}, {"id":"disabled", "planningEnabled":False}],
                   "shifts":[{"id":"day"}],
                   "assignments":[{"employeeId":"disabled", "date":"2026-11-02", "kind":"WORK", "shiftId":"day", "locked":True, "note":"preserved"}]}
        body = {"status":"FEASIBLE", "assignments":[{"employeeId":"active", "date":"2026-11-02", "kind":"OFF"}, *copy.deepcopy(payload["assignments"])]}
        self.assertEqual(_corresponds(body, payload), body)
        for change in ({"kind":"OFF"}, {"note":"changed"}, {"date":"2026-11-03"}):
            broken = copy.deepcopy(body)
            broken["assignments"][1].update(change)
            with self.subTest(change=change), self.assertRaises(NativeError):
                _corresponds(broken, payload)
        body["assignments"].pop()
        with self.assertRaises(NativeError):
            _corresponds(body, payload)

    def test_unlocked_disabled_rest_is_not_a_generated_position(self):
        from native_runner import _corresponds
        payload = {"startDate":"2026-11-02", "endDate":"2026-11-02",
                   "employees":[{"id":"active"}, {"id":"disabled", "planningEnabled":False}],
                   "shifts":[], "assignments":[{"employeeId":"disabled", "date":"2026-11-02", "kind":"OFF"}]}
        body = {"status":"FEASIBLE", "assignments":[{"employeeId":"active", "date":"2026-11-02", "kind":"OFF"}]}
        self.assertEqual(_corresponds(body, payload), body)
        body["assignments"].extend(copy.deepcopy(payload["assignments"]))
        with self.assertRaises(NativeError):
            _corresponds(body, payload)
        payload["generationMode"] = "HOURS_ONLY"
        self.assertEqual(_corresponds(body, payload), body)


class HoursOnlyIntegrityTests(unittest.TestCase):
    def test_only_clock_can_change_and_saved_metadata_is_not_discarded(self):
        from native_runner import _corresponds
        row = {"employeeId":"active", "date":"2026-11-02", "kind":"WORK", "shiftId":"old", "note":"kept"}
        payload = {"startDate":"2026-11-02", "endDate":"2026-11-02", "generationMode":"HOURS_ONLY",
                   "employees":[{"id":"active"}], "shifts":[{"id":"old"},{"id":"new"}], "assignments":[row]}
        body = {"status":"FEASIBLE", "assignments":[{**row,"shiftId":"new"}]}
        self.assertEqual(_corresponds(body, payload), body)
        changed = copy.deepcopy(body)
        changed["assignments"][0].update(kind="OFF")
        changed["assignments"][0].pop("shiftId")
        with self.assertRaises(NativeError):
            _corresponds(changed, payload)
        changed = copy.deepcopy(body)
        changed["assignments"][0].pop("note")
        with self.assertRaises(NativeError):
            _corresponds(changed, payload)
        payload["assignments"][0]["note"] = None
        changed = copy.deepcopy(body)
        changed["assignments"][0].pop("note")
        with self.assertRaises(NativeError):
            _corresponds(changed, payload)
