/** Run with <python-executable>, or --docker <existing-local-image> for an isolated processor. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateEscala } from "../../src/lib/escalas/validation.ts";
import { dateRange, visibleDates } from "../../src/lib/escalas/dates.ts";

const runtime = process.argv[2];
const image = process.argv[3];
if (!runtime || (runtime === "--docker" && !image)) {
  throw new Error("Informe o Python com OR-Tools instalado ou --docker <imagem local>.");
}
const directory = fileURLToPath(new URL("../../ops/escalas/", import.meta.url));
const source = `
import json, calendar, copy
from datetime import date, timedelta
from test_solver import fixture, make_untimed
from solver import solve, days_between

scenarios = []
data = fixture(42, people=4, weeks=2)
data["demands"] = [{"id": f"day-{index}", "date": day, "sector": "Reposição",
                    "start": 480, "end": 720, "minimum": 1}
                   for index, day in enumerate(days_between(data["startDate"], data["endDate"]))]
scenarios.append(("timed-42h-confirmed-coverage", data, {"publishable": True}))

data = fixture(40, people=3, weeks=2)
for person in data["employees"]:
    make_untimed(person)
    person["scheduleMode"] = "MISSING"
data["shifts"] = []
scenarios.append(("missing-clock-presence-only", data, {"missing": True}))

data = fixture(40, people=1, weeks=4)
make_untimed(data["employees"][0])
data["employees"][0].update(history=[], historyKnown=False, sundayRestRule="PROTECTIVE")
scenarios.append(("single-leader-protective-rotation", data, {}))

data = fixture(40)
make_untimed(data["employees"][0])
data["employees"][0]["scheduleMode"] = "MISSING"
for entry in data["employees"][0]["history"][-6:]:
    entry["kind"] = "DUTY"
scenarios.append(("history-six-duties-boundary-rest", data, {"firstOff": True, "missing": True}))

for month, expected_days in [("2026-02", 28), ("2024-02", 29), ("2026-11", 30), ("2026-10", 31)]:
    year, number = map(int, month.split("-"))
    first = date(year, number, 1)
    last = date(year, number, calendar.monthrange(year, number)[1])
    start = first - timedelta(days=first.weekday())
    end = last + timedelta(days=6 - last.weekday())
    data = fixture(40, people=2, weeks=((end - start).days + 1) // 7, start_date=start.isoformat())
    data["visibleMonth"] = month
    data["policy"].update(validFrom="2020-01-01", validUntil="2030-12-31")
    for person in data["employees"]:
        person.update(history=[], historyKnown=False, sundayRestRule="PROTECTIVE")
    scenarios.append((f"civil-month-{expected_days}-days", data, {"visibleDays": expected_days}))

data = fixture(40)
for entry in data["employees"][0]["history"][-6:]:
    entry.update(kind="WORK", shiftId="day")
data["assignments"] = [{"employeeId": "p0", "date": data["startDate"], "kind": "WORK",
                        "shiftId": "day", "locked": True}]
scenarios.append(("infeasible-seven-day-streak", data, {"infeasible": "WORK_STREAK"}))

data = fixture(40)
make_untimed(data["employees"][0])
data["employees"][0]["scheduleMode"] = "MISSING"
data["demands"] = [{"id": "confirmed", "date": data["startDate"], "sector": "Reposição",
                    "start": 480, "end": 720, "minimum": 1}]
scenarios.append(("missing-clock-cannot-fill-hourly-minimum", data, {"infeasible": "COVERAGE_DEFICIT"}))

data = fixture(40)
person = data["employees"][0]
make_untimed(person)
person["scheduleMode"] = "MISSING"
person["planningFuture"] = [{"employeeId": "p0", "date": (date.fromisoformat(data["endDate"]) + timedelta(days=offset)).isoformat(),
                             "kind": "DUTY"} for offset in range(1, 7)]
scenarios.append(("future-six-duties-preserve-boundary-rest", data, {"missing": True, "lastOff": True, "currentDays": 7}))
blocked = copy.deepcopy(data)
blocked["assignments"] = [{"employeeId": "p0", "date": data["endDate"], "kind": "DUTY", "locked": True}]
scenarios.append(("future-six-duties-reject-locked-work", blocked, {"infeasible": "WORK_STREAK"}))

data = fixture(40)
person = data["employees"][0]
make_untimed(person)
person["sundayRestRule"] = "PROTECTIVE"
person["planningFuture"] = [{"employeeId": "p0", "date": "2026-11-15", "kind": "DUTY"}]
scenarios.append(("future-sunday-preserves-current-rest", data, {"lastOff": True, "currentDays": 7}))
blocked = copy.deepcopy(data)
blocked["assignments"] = [{"employeeId": "p0", "date": data["endDate"], "kind": "DUTY", "locked": True}]
scenarios.append(("future-sunday-rejects-locked-work", blocked, {"infeasible": "SUNDAY_ROTATION"}))

data = fixture(40)
person = data["employees"][0]
data["shifts"].append({"id": "late", "name": "Tarde", "segments": [
    {"start": 780, "end": 1020, "kind": "WORK"}, {"start": 1020, "end": 1080, "kind": "BREAK"},
    {"start": 1080, "end": 1320, "kind": "WORK"}]})
person["shiftIds"] = ["day", "late"]
person["planningFuture"] = [{"employeeId": "p0", "date": "2026-11-09", "kind": "WORK", "shiftId": "day"}]
scenarios.append(("future-shift-preserves-intershift-rest", data, {"lastNotShift": "late", "totalMinutes": 2400, "currentDays": 7}))
blocked = copy.deepcopy(data)
blocked["assignments"] = [{"employeeId": "p0", "date": data["endDate"], "kind": "WORK", "shiftId": "late", "locked": True}]
scenarios.append(("future-shift-rejects-short-locked-rest", blocked, {"infeasible": "INTER_SHIFT_REST"}))
blocked = copy.deepcopy(data)
blocked["employees"][0]["planningFuture"] = [{"employeeId": "p0", "date": "2026-11-09", "kind": "OFF"},
                                           {"employeeId": "p0", "date": "2026-11-10", "kind": "WORK", "shiftId": "day"}]
blocked["assignments"] = [{"employeeId": "p0", "date": data["endDate"], "kind": "WORK", "shiftId": "late", "locked": True}]
scenarios.append(("future-rest-rejects-short-weekly-interval", blocked, {"infeasible": "WEEKLY_REST"}))

data = fixture(40)
person = data["employees"][0]
make_untimed(person)
person["offPattern"] = "CONSECUTIVE"
person["planningFuture"] = [{"employeeId": "p0", "date": "2026-11-09", "kind": "OFF"},
                             {"employeeId": "p0", "date": "2026-11-10", "kind": "DUTY"}]
scenarios.append(("future-consecutive-rest-preserves-current-neighbor", data, {"lastOff": True, "currentDays": 7}))
blocked = copy.deepcopy(data)
blocked["assignments"] = [{"employeeId": "p0", "date": day, "kind": "OFF" if index < 2 else "DUTY",
                           **({"locked": True} if day == data["endDate"] else {})}
                          for index, day in enumerate(days_between(data["startDate"], data["endDate"]))]
scenarios.append(("future-consecutive-rest-rejects-locked-work", blocked, {"infeasible": "CONSECUTIVE_OFF"}))

data = fixture(40)
person = data["employees"][0]
make_untimed(person)
person.update(offMode="FIXED", fixedOffDays=[0, 6], offPattern="CONSECUTIVE")
person["planningFuture"] = [{"employeeId": "p0", "date": "2026-11-09", "kind": "DUTY"}]
data["assignments"] = [{"employeeId": "p0", "date": day, "kind": "OFF" if index in (0, 6) else "DUTY"}
                       for index, day in enumerate(days_between(data["startDate"], data["endDate"]))]
scenarios.append(("future-work-overrides-inferred-rest-reservation", data, {"infeasible": "CONSECUTIVE_OFF"}))

data = fixture(40)
person = data["employees"][0]
data["shifts"].append({"id": "night", "name": "Noturno", "segments": [
    {"start": 1200, "end": 1440, "kind": "WORK"}, {"start": 1440, "end": 1500, "kind": "BREAK"},
    {"start": 1500, "end": 1740, "kind": "WORK"}]})
person["shiftIds"].append("night")
person["planningFuture"] = [{"employeeId": "p0", "date": "2026-11-09", "kind": "OFF"}]
data["assignments"] = [{"employeeId": "p0", "date": data["endDate"], "kind": "WORK", "shiftId": "night", "locked": True}]
scenarios.append(("current-overnight-cannot-occupy-future-rest", data, {"infeasible": "OFF_OCCUPIED"}))

for name, data, expectations in scenarios:
    print(json.dumps({"name": name, "input": data, "result": solve(data), "expectations": expectations}))
`;
const command = runtime === "--docker" ? "sudo" : runtime;
const args = runtime === "--docker" ? [
  "docker", "run", "--rm", "-i", "--pull=never", "--network", "none", "--read-only",
  "--cpus=1", "--memory=1536m", "--mount", `type=bind,src=${directory},dst=/model,readonly`,
  "--workdir", "/model", "--env", "PYTHONDONTWRITEBYTECODE=1", "--entrypoint", "python", image, "-",
] : ["-"];
const result = spawnSync(command, args, {
  cwd: directory, input: source, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
});
if (result.error || result.status !== 0) {
  throw new Error("A execução dos cenários sintéticos no processador falhou.");
}
let passed = 0;
for (const line of result.stdout.trim().split("\n")) {
  const { name, input, result: solved, expectations } = JSON.parse(line);
  if (expectations.infeasible) {
    assert.equal(solved.status, "INFEASIBLE", name);
    assert.deepEqual(solved.assignments, [], name);
    const validation = validateEscala(input);
    assert(validation.issues.some((issue) => issue.code === expectations.infeasible && issue.severity === "ERROR"), name);
  } else {
    assert(["FEASIBLE", "OPTIMAL"].includes(solved.status), name);
    const expected = input.employees.filter((person) => person.planningEnabled !== false).flatMap((person) =>
      dateRange(input.startDate, input.endDate)
        .filter((day) => day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil))
        .map((day) => `${person.id}\0${day}`),
    ).sort();
    const actual = solved.assignments.map((entry) => `${entry.employeeId}\0${entry.date}`).sort();
    assert.deepEqual(actual, expected, `${name}: resposta completa, sem datas ausentes ou duplicadas`);
    for (const previous of input.assignments.filter((entry) => entry.locked || entry.kind === "ABSENCE")) {
      const proposed = solved.assignments.find((entry) => entry.employeeId === previous.employeeId && entry.date === previous.date);
      assert.equal(proposed?.kind, previous.kind, name);
      assert.equal(proposed?.shiftId, previous.shiftId, name);
      if (previous.locked) assert(proposed?.locked, name);
    }
    const validation = validateEscala({ ...input, assignments: solved.assignments });
    assert(validation.valid, `${name}: ${validation.issues.filter((issue) => issue.severity === "ERROR").map((issue) => issue.code).join(", ")}`);
    if (expectations.publishable) assert(validation.readyToPublish, name);
    if (expectations.missing) {
      assert(!validation.readyToPublish, name);
      assert(validation.issues.some((issue) => issue.code === "MISSING_SCHEDULE"), name);
      assert(solved.assignments.every((entry) => entry.kind !== "WORK" && !entry.shiftId), name);
      assert(validation.summaries.every((summary) => summary.workedMinutes === 0), name);
    }
    if (expectations.firstOff) {
      assert(solved.assignments.filter((entry) => entry.date === input.startDate).every((entry) => entry.kind === "OFF"), name);
    }
    if (expectations.lastOff) {
      assert(solved.assignments.filter((entry) => entry.date === input.endDate).every((entry) => entry.kind === "OFF"), name);
    }
    if (expectations.lastNotShift) {
      assert(solved.assignments.filter((entry) => entry.date === input.endDate).every((entry) => entry.shiftId !== expectations.lastNotShift), name);
    }
    if (expectations.currentDays) {
      assert(validation.summaries.every((summary) => summary.workDays + summary.offDays === expectations.currentDays), name);
    }
    if (expectations.totalMinutes) {
      assert.equal(validation.summaries.reduce((sum, summary) => sum + summary.workedMinutes, 0), expectations.totalMinutes, name);
    }
    if (expectations.visibleDays) {
      assert.equal(visibleDates(input).length, expectations.visibleDays, name);
      assert(validation.summaries.every((summary) => summary.workDays + summary.offDays === expectations.visibleDays), name);
    }
  }
  passed++;
  console.log(JSON.stringify({ scenario: name, verified: true, status: solved.status, seconds: solved.wallTimeSeconds }));
}
assert.equal(passed, 21, "Todos os cenários devem ter sido executados.");
console.log(JSON.stringify({ verified: true, scenarios: passed, processor: "CP-SAT", verifier: "TypeScript independent" }));
