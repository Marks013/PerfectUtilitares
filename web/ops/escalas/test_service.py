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

    def test_real_http_returns_measured_native_metadata_for_optional_demand_id(self):
        data = fixture(40)
        data["demands"] = [{"date": "2026-11-04", "sector": "Reposição",
                            "start": 480, "end": 540, "minimum": 1, "estimated": True}]
        original = copy.deepcopy(data)
        status, result = self.request("/solve", {"input": data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        metadata = result["optimization"]
        self.assertEqual(metadata["method"], "BOUNDED_LEXICOGRAPHIC_SEARCH")
        self.assertFalse(metadata["globalOptimalityProven"])
        self.assertTrue(metadata["phases"])
        self.assertTrue(all(not phase["proven"] for phase in metadata["phases"]))
        self.assertEqual(data, original)

    def test_real_http_distinguishes_proven_coverage_conflict_without_assignments(self):
        data = fixture(40)
        data["demands"] = [{"date": "2026-11-04", "sector": "Reposição",
                            "start": 480, "end": 540, "minimum": 2}]
        status, result = self.request("/solve", {"input": data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertEqual(result["assignments"], [])
        self.assertEqual(result["proofMethod"], "RELAXED_CAPACITY_BOUND")
        self.assertEqual(result["solverDiagnostics"][0]["family"], "COVERAGE")

    def test_unsupported_real_contract_is_explicit_not_fabricated_feasibility(self):
        data = fixture()
        data["policy"]["normativeProfile"] = "UNMODELED_POLICY"
        status, result = self.request("/solve", {"input": data}, self.identity())
        self.assertEqual(status, 422)
        self.assertEqual(result["error"], "SOLVER_UNSUPPORTED_INPUT")
        self.assertNotIn("assignments", result)

    def test_excluded_records_survive_real_http_without_becoming_staff(self):
        data = fixture(40, people=2)
        data["employees"][1].update(planningEnabled=False, sector="Excluded")
        saved = {"employeeId":"p1", "date":"2026-11-03", "kind":"WORK",
                 "shiftId":"day", "locked":True, "note":"preserved"}
        data["assignments"] = [saved, {"employeeId":"p1", "date":"2026-11-04", "kind":"OFF"}]
        before = copy.deepcopy(data)
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual([a for a in result["assignments"] if a["employeeId"] == "p1"], [saved])
        self.assertEqual(data, before)
        data["demands"] = [{"date":"2026-11-03", "sector":"Excluded", "start":480, "end":540, "minimum":1}]
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertEqual(result["assignments"], [])

    def test_disallowed_manual_clock_can_return_a_legal_rest_over_real_http(self):
        data = fixture(40)
        shift = copy.deepcopy(data["shifts"][0])
        shift["id"] = "too-long"
        shift["segments"][-1]["end"] += 60
        data["shifts"].append(shift)
        data["policy"]["dailyLimitMinutes"] = 480
        data["employees"][0]["manualShiftByDate"] = {"2026-11-04":"too-long"}
        before = copy.deepcopy(data)
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["assignments"]), 7)
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == "2026-11-04")["kind"], "OFF")
        self.assertEqual(data, before)

    def test_informational_documents_do_not_override_limits_over_real_http(self):
        data = fixture(40)
        data["policy"].update(normativeProfile="SINDECOMU_SUPERMARKETS_2026_2027",
                              collectiveAgreement={"reviewed":False,"validUntil":"2020-01-01"})
        before = copy.deepcopy(data)
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["assignments"]), 7)
        self.assertEqual(data, before)
        data["policy"]["dailyLimitMinutes"] = 300
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "INFEASIBLE")
        self.assertEqual(result["assignments"], [])

    def test_visible_month_does_not_invent_dates_outside_requested_week(self):
        data = fixture(40)
        data["visibleMonth"] = "2026-11"
        before = copy.deepcopy(data)
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertEqual(len(result["assignments"]), 7)
        self.assertTrue(all(data["startDate"] <= a["date"] <= data["endDate"] for a in result["assignments"]))
        self.assertEqual(data, before)

    def test_presence_only_keeps_daily_rests_without_inventing_hourly_intervals(self):
        from contract_fixtures import make_untimed
        data = fixture(40)
        make_untimed(data['employees'][0])
        data['policy'].update(minInterShiftMinutes=10000, minWeeklyRestMinutes=20000)
        before = copy.deepcopy(data)
        status, result = self.request('/solve', {'input':data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result['status'], 'FEASIBLE')
        self.assertEqual(sum(a['kind'] == 'DUTY' for a in result['assignments']), 5)
        self.assertEqual(sum(a['kind'] == 'OFF' for a in result['assignments']), 2)
        self.assertTrue(all('shiftId' not in a for a in result['assignments']))
        self.assertEqual(data, before)

    def test_real_http_preserves_each_objective_of_a_feasible_saved_grid(self):
        data = fixture(40, people=3)
        data["assignments"] = [{"employeeId": p["id"], "date": f"2026-11-{d:02}",
                                "kind": "WORK" if d <= 6 else "OFF",
                                **({"shiftId": "day"} if d <= 6 else {})}
                               for p in data["employees"] for d in range(2, 9)]
        for person in data["employees"]:
            person["preferredOffDays"] = [4]
        data["demands"] = [{"date": "2026-11-02", "sector": "Reposição", "start": 480,
                            "end": 720, "minimum": 2, "estimated": True}]
        original = copy.deepcopy(data)
        status, result = self.request("/solve", {"input": data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        self.assertTrue(all(p["incumbentValue"] <= p["initialValue"] for p in result["optimization"]["phases"]))
        self.assertEqual(result["assignments"], data["assignments"])
        self.assertEqual(data, original)

    def test_real_http_historical_night_counts_for_sunday_without_reopening_the_store(self):
        data = fixture(40, people=2, weeks=2)
        data["storeClosingMinutes"] = 1200
        data["shifts"].append({"id": "night", "segments": [
            {"kind": "WORK", "start": 1200, "end": 1440},
            {"kind": "BREAK", "start": 1440, "end": 1500},
            {"kind": "WORK", "start": 1500, "end": 1740}]})
        data["employees"][0]["history"][-2].update(kind="WORK", shiftId="night")
        data["demands"] = [{"date": d, "sector": "Reposição", "start": 480, "end": 720, "minimum": 1}
                           for d in ("2026-11-08", "2026-11-15")]
        original = copy.deepcopy(data)
        status, result = self.request("/solve", {"input": data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE")
        totals = {pid: sum(a["employeeId"] == pid and a["kind"] == "WORK" and a["date"] in
                           ("2026-11-08", "2026-11-15") for a in result["assignments"]) for pid in ("p0", "p1")}
        self.assertEqual(totals["p0"] + 1, totals["p1"])
        self.assertTrue(all(a.get("shiftId") != "night" for a in result["assignments"]))
        self.assertEqual(data, original)

    def test_real_http_closed_estimate_keeps_private_comparison_and_real_cost(self):
        data = fixture(40)
        data["storeClosingMinutes"] = 1080
        for key in ("closedDates", "holidayDates", "paidHolidayDates"):
            data["policy"][key] = ["2026-11-02"]
        data["demands"] = [{"date":"2026-11-02", "sector":"Reposição", "start":1020,
                            "end":1080, "minimum":1, "estimated":True}]
        cap = {"sector":"Reposição", "horizon":60, "month":60, "sundays":0,
               "monthSundays":0, "closing":0, "peak":1}
        data["_coverageComparison"] = {"sectors":[cap], "bands":[
            {"scope":scope, "sector":"Reposição", "role":None, "start":1020,
             "end":1080, "maximum":1, "peak":1} for scope in ("HORIZON", "MONTH")]}
        before = copy.deepcopy(data)
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "INFEASIBLE", result)
        self.assertEqual(result["assignments"], [])
        self.assertEqual(data, before)
        cap["closing"] = 60
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE", result)
        phases = {p["objective"]:p for p in result["optimization"]["phases"]}
        self.assertEqual(phases["COVERAGE"]["incumbentValue"], 60)
        self.assertEqual(phases["CLOSING_COVERAGE"]["incumbentValue"], 60)
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == "2026-11-02")["kind"], "HOLIDAY")

    def test_real_http_empty_demand_role_is_general_without_changing_registered_roles(self):
        data = fixture(40)
        data["demands"] = [{"date":"2026-11-04", "sector":"Reposição", "role":"",
                            "start":480, "end":540, "minimum":1}]
        before = copy.deepcopy(data)
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE", result)
        self.assertEqual(next(a for a in result["assignments"] if a["date"] == "2026-11-04")["kind"], "WORK")
        self.assertEqual(data, before)

    def test_duplicate_or_outside_native_hint_falls_back_over_real_http(self):
        for bad in ("duplicate", "outside"):
            with self.subTest(bad=bad):
                data = fixture(40)
                data["assignments"] = [{"employeeId":"p0", "date":f"2026-11-{d:02}",
                                        "kind":"WORK" if d <= 6 else "OFF",
                                        **({"shiftId":"day"} if d <= 6 else {})} for d in range(2,9)]
                data["_initialAssignments"] = copy.deepcopy(data["assignments"])
                if bad == "duplicate":
                    data["_initialAssignments"].append(copy.deepcopy(data["_initialAssignments"][0]))
                else:
                    data["_initialAssignments"][0]["date"] = "2026-11-09"
                before = copy.deepcopy(data)
                status, result = self.request("/solve", {"input":data}, self.identity())
                self.assertEqual(status, 200, result)
                self.assertEqual(result["status"], "FEASIBLE", result)
                self.assertEqual(result["assignments"], data["assignments"])
                self.assertEqual(data, before)

    def test_public_hint_schema_remains_strict_before_native_launch(self):
        for hint in ({"not":"a list"}, [{"employeeId":"other-tenant", "date":"2026-11-02", "kind":"OFF"}],
                     [{"employeeId":"p0", "date":"2026-11-02", "kind":"WORK", "shiftId":"retired"}]):
            with self.subTest(hint=hint):
                data = fixture(40)
                data["_initialAssignments"] = hint
                status, result = self.request("/solve", {"input":data}, self.identity())
                self.assertEqual(status, 400, result)
                self.assertNotIn("assignments", result)

    def test_valid_hint_keeps_saved_costs_and_disabled_protected_records_over_http(self):
        data = fixture(40, people=2)
        data["employees"][1]["planningEnabled"] = False
        data["assignments"] = [{"employeeId":"p0", "date":f"2026-11-{d:02}",
                                "kind":"WORK" if d <= 6 else "OFF",
                                **({"shiftId":"day"} if d <= 6 else {})} for d in range(2,9)]
        protected = {"employeeId":"p1", "date":"2026-11-03", "kind":"OFF", "locked":True}
        data["assignments"].append(protected)
        data["_initialAssignments"] = copy.deepcopy(data["assignments"])
        data["_initialAssignments"][3] = {"employeeId":"p0", "date":"2026-11-05", "kind":"OFF"}
        data["_initialAssignments"][5] = {"employeeId":"p0", "date":"2026-11-07", "kind":"WORK", "shiftId":"day"}
        before = copy.deepcopy(data)
        status, result = self.request("/solve", {"input":data}, self.identity())
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "FEASIBLE", result)
        phases = {p["objective"]:p for p in result["optimization"]["phases"]}
        self.assertEqual(phases["PEOPLE_CHANGED"]["initialValue"], 1)
        self.assertEqual(phases["STABILITY"]["initialValue"], 2)
        self.assertEqual([a for a in result["assignments"] if a["employeeId"] == "p1"], [protected])
        self.assertEqual(data, before)

    def test_non_scalar_assignment_references_are_rejected_without_server_failure(self):
        for field in ("employeeId", "shiftId"):
            for bad in (["p0" if field == "employeeId" else "day"], {"value":"not-a-reference"}):
                for location in ("assignments", "_initialAssignments"):
                    with self.subTest(field=field, bad=bad, location=location):
                        data = fixture(40)
                        row = {"employeeId":"p0", "date":"2026-11-03", "kind":"WORK", "shiftId":"day"}
                        row[field] = bad
                        data[location] = [row]
                        before = copy.deepcopy(data)
                        status, result = self.request("/solve", {"input":data}, self.identity())
                        self.assertEqual(status, 400, result)
                        self.assertNotIn("assignments", result)
                        self.assertEqual(data, before)

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
