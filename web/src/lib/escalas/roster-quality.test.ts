import { describe, expect, it } from "vitest";
import { newEmployee } from "../../components/escalas/workspace-model";
import { newLegacyInput as newInput } from "./legacy-calendar-test-fixture";
import { alignPersistedCoverageTarget, selectVerifiedRoster, coverageQuality, compareRosterCoverage, frozenCoverageComparison, isOperationallyReusable, isReusableRoster } from "./roster-quality";
import { buildCoveragePresence, coverageAt } from "./coverage-presence";
import { frozenCoverageService } from "./coverage-protection";
import { validateEscala } from "./validation";
import type { EscalaAssignment, EscalaInput } from "./types";
import { addDays, dateRange } from "./dates";
import { weekendBalance } from "./weekend-balance";

function fixture(): EscalaInput {
  const input = newInput("06", "Teste", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
  input.simulation = true; input.restRulesVersion = 1;
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.employees = ["a", "b"].map(id => ({ ...newEmployee(42, "day"), id, name: id, registration: id, sector: "Loja", role: "Operador", activeFrom: "2020-01-01" }));
  input.assignments = input.employees.flatMap(person => Array.from({ length: 7 }, (_, day) => {
    const off = (person.id === "a" ? [1, 6] : [5, 6]).includes(day);
    return { employeeId: person.id, date: `2026-11-0${day + 2}`, kind: off ? "OFF" as const : "WORK" as const, ...(!off ? { shiftId: "day" } : {}) };
  }));
  return input;
}
function swap(input: EscalaInput): EscalaInput {
  return { ...input, assignments: input.assignments.map(record => record.employeeId === "a" && record.date === "2026-11-03" ? { ...record, kind: "WORK" as const, shiftId: "day" }
    : record.employeeId === "a" && record.date === "2026-11-04" ? { employeeId: record.employeeId, date: record.date, kind: "OFF" as const } : record) };
}

function frozenFixture() {
  const saved = fixture(), prepared = structuredClone(saved);
  const mandatory = { id: "hard", date: "2026-11-04", sector: "Loja", start: 480, end: 540, minimum: 1 };
  saved.demands = [mandatory, { ...mandatory, id: "persisted", date: "2026-11-03", estimated: true }];
  saved.coverageBasis = "coverage-v1:0123456789abcdef";
  prepared.demands = [mandatory, { ...mandatory, id: "recalculated", date: "2026-11-05", estimated: true }];
  prepared.coverageBasis = "coverage-v2:fedcba9876543210";
  prepared.restRulesVersion = 3;
  prepared.assignments = prepared.assignments.slice(1); // Preparation may discard obsolete clock assignments.
  return { saved, prepared };
}

const twoSundays = ["2026-11-08", "2026-11-15"] as const;
function sundayCoverageFixture(schedules: ReadonlyArray<readonly [boolean, boolean]>): EscalaInput {
  const input = fixture();
  input.endDate = twoSundays[1];
  input.employees = schedules.map((_, index) => ({ ...input.employees[0], id: "person-" + index, registration: String(index),
    maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE" }));
  input.assignments = input.employees.flatMap((person, index) => dateRange(input.startDate, input.endDate).map((date, day): EscalaAssignment => {
    const weekday = day % 7;
    const work = index === 0 ? [0, 1, 3, 4, 6].includes(weekday)
      : [0, 1, 4, 5, schedules[index][Math.floor(day / 7)] ? 6 : 3].includes(weekday);
    return { employeeId: person.id, date, kind: work ? "WORK" : "OFF", ...(work ? { shiftId: "day" } : {}) };
  }));
  input.demands = twoSundays.map(date => ({ id: date, date, sector: "Loja", role: "Operador",
    start: 480, end: 540, minimum: schedules.length, estimated: true }));
  return input;
}

describe("authoritative frozen staffing target", () => {
  it("optimizes on the saved estimates even with an incomplete preparation, without changing its stale basis", () => {
    const { saved, prepared } = frozenFixture();
    expect(compareRosterCoverage(saved, prepared).comparable).toBe(false);
    const aligned = alignPersistedCoverageTarget(saved, prepared);
    expect(aligned).toEqual({ ...prepared, demands: saved.demands, coverageBasis: saved.coverageBasis });
    expect(prepared.demands.map(demand => demand.id)).toEqual(["hard", "recalculated"]);
  });

  it.each([
    ["changed minimum", (input: EscalaInput) => { input.demands[0] = { ...input.demands[0], minimum: 2 }; }],
    ["changed calendar", (input: EscalaInput) => { input.planningWeekStartsOn = "SUNDAY"; }],
    ["changed cohort", (input: EscalaInput) => { input.employees[0].role = "Outro cargo"; }],
    ["changed protected date", (input: EscalaInput) => { input.assignments[0].locked = true; }],
    ["changed scenario mode", (input: EscalaInput) => { input.generationMode = "HOURS_ONLY"; }],
    ["changed reference policy", (input: EscalaInput) => { input.policy.minMealMinutes = 90; }],
    ["unreviewed scenario", (input: EscalaInput) => { input.needsRegeneration = true; }],
  ] as const)("keeps the prepared ruler for %s", (_label, change) => {
    const { saved, prepared } = frozenFixture();
    change(prepared);
    expect(alignPersistedCoverageTarget(saved, prepared)).toBe(prepared);
  });
});

describe("frozen Sunday comparator parity", () => {
  function staffing(input: EscalaInput) {
    const presence = buildCoveragePresence(input);
    return twoSundays.map(date => coverageAt(presence, date, "Loja", 480, "Operador").length);
  }

  it("rotates an unchanged deficit across two staffed Sundays without imposing the saved per-date floor", () => {
    const reference = sundayCoverageFixture([[true, true], [true, false]]);
    const proposal = sundayCoverageFixture([[true, true], [false, true]]);
    const original = structuredClone(reference);
    expect(validateEscala(reference).valid).toBe(true);
    expect(validateEscala(proposal).valid).toBe(true);
    expect(reference.demands.map(demand => demand.minimum)).toEqual([2, 2]);
    const previousFloor = staffing(reference), rotated = staffing(proposal);
    expect(previousFloor).toEqual([2, 1]);
    expect(rotated).toEqual([1, 2]);
    expect(rotated.every((present, index) => present >= previousFloor[index])).toBe(false);
    expect([...coverageQuality(proposal).present].sort()).toEqual([...coverageQuality(reference).present].sort());
    expect(frozenCoverageService(proposal)).toEqual(frozenCoverageService(reference));
    expect(compareRosterCoverage(reference, proposal)).toEqual({ comparable: true, regressed: false, improved: false, reason: "ACCEPTED" });

    const limits = frozenCoverageComparison(reference);
    expect(limits?.sectors).toEqual([{ sector: "Loja", horizon: 60, month: 60, sundays: 60, monthSundays: 60, closing: 0, peak: 1 }]);
    expect(limits?.bands).toHaveLength(8);
    for (const scope of ["HORIZON", "MONTH", "SUNDAYS", "MONTH_SUNDAYS"]) {
      for (const role of [null, "Operador"]) {
        expect(limits?.bands).toContainEqual({ scope, sector: "Loja", role, start: 480, end: 540, maximum: 1, peak: 1 });
      }
    }
    expect(frozenCoverageComparison(proposal)).toEqual(limits);
    expect(reference).toEqual(original);
  });

  it("rejects a real increase in Sunday deficit against the saved ruler, even if the candidate removes estimates", () => {
    const reference = sundayCoverageFixture([[true, true], [true, false]]);
    const proposal = { ...sundayCoverageFixture([[true, true], [false, false]]), demands: [] };
    expect(staffing(proposal)).toEqual([1, 1]);
    expect(compareRosterCoverage(reference, proposal)).toMatchObject({ comparable: true, regressed: true, reason: "SECTOR_COVERAGE",
      regression: { sector: "Loja", scope: "HORIZON", metric: "DEFICIT_PERSON_MINUTES", before: 60, after: 120, delta: 60 } });
  });

  it("rejects a worse peak when Sunday deficit, service and presence are unchanged", () => {
    const reference = sundayCoverageFixture([[true, true], [true, true], [true, false], [false, true]]);
    const proposal = sundayCoverageFixture([[true, true], [true, true], [true, false], [true, false]]);
    expect(staffing(reference)).toEqual([3, 3]);
    expect(staffing(proposal)).toEqual([4, 2]);
    const limits = frozenCoverageComparison(reference);
    expect(limits?.sectors).toEqual([{ sector: "Loja", horizon: 120, month: 120, sundays: 120, monthSundays: 120, closing: 0, peak: 1 }]);
    expect(limits?.bands).toContainEqual({ scope: "MONTH_SUNDAYS", sector: "Loja", role: "Operador", start: 480, end: 540, maximum: 2, peak: 1 });
    expect(compareRosterCoverage(reference, proposal)).toMatchObject({ comparable: true, regressed: true, reason: "SECTOR_PEAK",
      regression: { sector: "Loja", scope: "HORIZON", metric: "PEAK_MISSING", before: 1, after: 2, delta: 1 } });
  });
});

describe("independent incumbent quality acceptance", () => {
  it("does not compare AFASTADOS demand or rank administrative attendance, but keeps the saved records", () => {
    const input = fixture();
    input.employees.push({ ...input.employees[0], id: "admin", registration: "admin", sector: "  Afastádos  " });
    input.assignments.push({ employeeId: "admin", date: "2026-11-03", kind: "WORK", shiftId: "day" });
    input.demands.push({ id: "admin", date: "2026-11-03", sector: "AFASTADOS", start: 480, end: 600, minimum: 9 });
    const proposal = { ...input, assignments: input.assignments.filter(day => day.employeeId !== "admin") };
    expect(coverageQuality(input).daily.size).toBe(0);
    expect(compareRosterCoverage(input, proposal)).toEqual({ comparable: true, improved: false, regressed: false, reason: "ACCEPTED" });
    const decisions: string[] = [];
    expect(selectVerifiedRoster(input, proposal, reason => decisions.push(reason))).toEqual({ input, retainedReference: true });
    expect(decisions).toEqual(["PROTECTED_ASSIGNMENT"]);
  });

  it("does not empty a staffed sector day merely because no hourly minimum was entered", () => {
    const input = fixture(); input.employees = input.employees.slice(0, 1);
    input.assignments = input.assignments.filter(record => record.employeeId === "a");
    expect(validateEscala(input).valid).toBe(true);
    expect(coverageQuality(input).present.size).toBe(5);
    expect(selectVerifiedRoster(input, swap(input)).retainedReference).toBe(true);
  });
  it("accepts lower sector shortage and peak while preserving daily presence", () => {
    const input = fixture();
    input.demands = [{ id: "tue", date: "2026-11-03", sector: "Loja", start: 480, end: 720, minimum: 3, estimated: true },
      { id: "wed", date: "2026-11-04", sector: "Loja", start: 480, end: 540, minimum: 2, estimated: true }];
    expect(validateEscala(input).valid).toBe(true);
    const proposal = swap(input), original = structuredClone(input);
    const before = coverageQuality(input), after = coverageQuality(proposal);
    const total = (daily: Map<string, number>) => [...daily.values()].reduce((sum, value) => sum + value, 0);
    expect(validateEscala(proposal).valid).toBe(true);
    expect([total(before.daily), total(after.daily)]).toEqual([480, 300]);
    expect([before.daily.get("Loja\0" + "2026-11-04") ?? 0, after.daily.get("Loja\0" + "2026-11-04")]).toEqual([0, 60]);
    expect([before.peaks.get("Loja"), after.peaks.get("Loja")]).toEqual([2, 1]);
    expect([...after.present].sort()).toEqual([...before.present].sort());
    const decisions: string[] = [];
    expect(selectVerifiedRoster(input, proposal, reason => decisions.push(reason))).toEqual({ input: proposal, retainedReference: false });
    expect(decisions).toEqual(["OPERATIONAL_IMPROVEMENT"]);
    expect(input).toEqual(original);
  });
  it("rejects a worse sector peak even when the total estimated shortage improves", () => {
    const input = fixture();
    input.demands = [{ id: "tue", date: "2026-11-03", sector: "Loja", start: 480, end: 720, minimum: 3, estimated: true },
      { id: "wed", date: "2026-11-04", sector: "Loja", start: 480, end: 540, minimum: 5, estimated: true }];
    const proposal = swap(input), before = coverageQuality(input), after = coverageQuality(proposal);
    expect(validateEscala(proposal).valid).toBe(true);
    expect([...before.daily.values()].reduce((sum, value) => sum + value, 0)).toBe(660);
    expect([...after.daily.values()].reduce((sum, value) => sum + value, 0)).toBe(480);
    expect([before.peaks.get("Loja"), after.peaks.get("Loja")]).toEqual([3, 4]);
    const decisions: string[] = [];
    expect(selectVerifiedRoster(input, proposal, reason => decisions.push(reason))).toEqual({ input, retainedReference: true });
    expect(decisions).toEqual(["SECTOR_PEAK"]);
  });
  it("accepts a real gain with no sacrificed day and leaves both inputs untouched", () => {
    const input = fixture(); input.demands = [{ id: "tue", date: "2026-11-03", sector: "Loja", start: 480, end: 720, minimum: 2, estimated: true }];
    const proposal = swap(input), original = structuredClone(input);
    expect(selectVerifiedRoster(input, proposal)).toEqual({ input: proposal, retainedReference: false });
    expect(input).toEqual(original);
  });
  function exchangeBoth(input: EscalaInput) {
    input.assignments = input.assignments.map((day): EscalaAssignment => day.employeeId === "b" && day.date === "2026-11-04"
      ? { employeeId: day.employeeId, date: day.date, kind: "OFF" }
      : day.employeeId === "b" && day.date === "2026-11-07" ? { ...day, kind: "WORK", shiftId: input.employees[1].shiftIds[0] } : day);
    return { ...swap(input), assignments: swap(input).assignments.map((day): EscalaAssignment =>
      day.employeeId === "b" && day.date === "2026-11-03" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" }
        : day.employeeId === "b" && day.date === "2026-11-04" ? { ...day, kind: "WORK", shiftId: input.employees[1].shiftIds[0] } : day) };
  }
  it("does not compensate lost zelador coverage with a fiscal gain in the same sector", () => {
    const input = fixture();
    input.employees[0].role = "Fiscal"; input.employees[1].role = "Zelador";
    input.demands = [{ id: "fiscal", date: "2026-11-03", sector: "Loja", role: "Fiscal", start: 480, end: 720, minimum: 2, estimated: true },
      { id: "zelador", date: "2026-11-03", sector: "Loja", role: "Zelador", start: 480, end: 540, minimum: 1, estimated: true }];
    const proposal = exchangeBoth(input), original = structuredClone(input);
    expect(validateEscala(input).valid).toBe(true);
    expect(validateEscala(proposal).valid).toBe(true);
    const total = (value: EscalaInput) => [...coverageQuality(value).daily.values()].reduce((sum, count) => sum + count, 0);
    expect([total(input), total(proposal)]).toEqual([480, 300]);
    expect(compareRosterCoverage(input, proposal)).toMatchObject({ comparable: true, regressed: true, reason: "ROLE_TIME_COVERAGE",
      regression: { sector: "Loja", role: "Zelador", metric: "DEFICIT_PERSON_MINUTES", start: 480, end: 540, before: 0, after: 60, delta: 60 } });
    expect(selectVerifiedRoster(input, proposal)).toEqual({ input, retainedReference: true });
    expect(input).toEqual(original);
  });
  it("does not compensate a lunch-window loss with a morning gain for the same role", () => {
    const input = fixture();
    input.shifts.push({ id: "late", name: "Tarde", segments: [
      { start: 600, end: 840, kind: "WORK" }, { start: 840, end: 900, kind: "BREAK" },
      { start: 900, end: 1164, kind: "WORK" },
    ] });
    input.employees[1].shiftIds = ["late"];
    input.assignments = input.assignments.map(day => day.employeeId === "b" && day.kind === "WORK" ? { ...day, shiftId: "late" } : day);
    input.demands = [{ id: "morning", date: "2026-11-03", sector: "Loja", role: "Operador", start: 480, end: 600, minimum: 1, estimated: true },
      { id: "lunch", date: "2026-11-03", sector: "Loja", role: "Operador", start: 720, end: 780, minimum: 1, estimated: true }];
    const proposal = exchangeBoth(input);
    expect(validateEscala(input).valid).toBe(true);
    expect(validateEscala(proposal).valid).toBe(true);
    expect(compareRosterCoverage(input, proposal)).toMatchObject({ regressed: true, reason: "ROLE_TIME_COVERAGE" });
    expect(selectVerifiedRoster(input, proposal).retainedReference).toBe(true);
  });
  it("permits date rotation inside an unchanged role and effective clock vector", () => {
    const input = fixture();
    input.demands = ["2026-11-03", "2026-11-04"].map(date => ({ id: date, date, sector: "Loja", role: "Operador", start: 480, end: 720, minimum: 1, estimated: true }));
    const proposal = exchangeBoth(input);
    expect(compareRosterCoverage(input, proposal)).toMatchObject({ comparable: true, regressed: false });
    expect(selectVerifiedRoster(input, proposal).retainedReference).toBe(false);
  });
  it("keeps the original ruler when the proposal supplies a different estimate", () => {
    const input = fixture();
    input.demands = [{ id: "tue", date: "2026-11-03", sector: "Loja", start: 480, end: 720, minimum: 3, estimated: true },
      { id: "wed", date: "2026-11-04", sector: "Loja", start: 480, end: 540, minimum: 5, estimated: true }];
    const original = structuredClone(input), proposal = swap(input);
    proposal.demands = [];
    expect(compareRosterCoverage(input, proposal)).toMatchObject({ regressed: true, reason: "SECTOR_PEAK" });
    expect(input).toEqual(original);
    expect(proposal.demands).toEqual([]);
  });
  it("does not treat a legitimate workload change as a comparable incumbent", () => {
    const input = fixture(), proposal = structuredClone(input);
    proposal.defaultWeeklyHours = 40; proposal.employees.forEach(person => { person.weeklyHours = 40; });
    proposal.shifts[0].segments[2].end = 1020;
    expect(validateEscala(proposal).valid).toBe(true);
    expect(compareRosterCoverage(input, proposal)).toMatchObject({ comparable: false, reason: "REFERENCE_NOT_COMPARABLE" });
    expect(selectVerifiedRoster(input, proposal)).toEqual({ input: proposal, retainedReference: false });
  });

  it.each(["old-workload", "incomplete", "missing-clock"] as const)("protects current 40h leadership with a non-comparable %s historical ruler", kind => {
    const historical = fixture();
    historical.employees[0].role = "Encarregado";
    historical.movementPriorities = [{ startDate: "2026-11-04", endDate: "2026-11-04", sector: "Loja", level: "HIGH" }];
    const current = structuredClone(historical);
    current.defaultWeeklyHours = 40;
    current.employees.forEach(person => { person.weeklyHours = 40; });
    current.shifts[0].segments[2].end = 1020;
    if (kind === "incomplete") historical.assignments = [];
    if (kind === "missing-clock") historical.employees[0].scheduleMode = "MISSING";
    const proposal = swap(current), original = structuredClone(historical), decisions: string[] = [];
    expect(validateEscala(current).valid).toBe(true);
    expect(validateEscala(proposal).valid).toBe(true);
    expect(compareRosterCoverage(historical, proposal).comparable).toBe(false);
    expect(selectVerifiedRoster(current, proposal, reason => decisions.push(reason), historical)).toEqual({ input: current, retainedReference: true });
    expect(decisions).toEqual(["PRIORITY_LEADERSHIP"]);
    expect(current.defaultWeeklyHours).toBe(40);
    expect(historical).toEqual(original);
  });
  it("does not label a current-scenario acceptance as a gain against an old workload", () => {
    const historical = fixture(), current = structuredClone(historical);
    current.defaultWeeklyHours = 40; current.employees.forEach(person => { person.weeklyHours = 40; });
    current.shifts[0].segments[2].end = 1020;
    const proposal = swap(current), decisions: string[] = [];
    expect(selectVerifiedRoster(current, proposal, reason => decisions.push(reason), historical)).toEqual({ input: proposal, retainedReference: false });
    expect(decisions).toEqual(["REFERENCE_NOT_COMPARABLE"]);
    expect(compareRosterCoverage(historical, proposal)).toMatchObject({ comparable: false, improved: false });
  });
  it("permits 2/0 to 1/1 date rotation with different reference boundaries and the same 960 person-minute deficit", () => {
    const input = fixture();
    input.defaultWeeklyHours = 40; input.employees.forEach(person => { person.weeklyHours = 40; });
    input.shifts[0].segments[2].end = 1020;
    input.assignments = input.assignments.map((day): EscalaAssignment => day.date === "2026-11-03"
      ? { ...day, kind: "WORK", shiftId: "day" }
      : day.date === "2026-11-04" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" }
        : day.employeeId === "b" && day.date === "2026-11-07" ? { ...day, kind: "WORK", shiftId: "day" } : day);
    input.demands = [
      { id: "tue-am", date: "2026-11-03", sector: "Loja", role: "Operador", start: 480, end: 720, minimum: 2, estimated: true },
      { id: "tue-pm", date: "2026-11-03", sector: "Loja", role: "Operador", start: 780, end: 1020, minimum: 2, estimated: true },
      ...[[480, 600], [600, 720], [780, 900], [900, 1020]].map(([start, end], index) =>
        ({ id: `wed-${index}`, date: "2026-11-04", sector: "Loja", role: "Operador", start, end, minimum: 2, estimated: true })),
    ];
    const proposal: EscalaInput = { ...input, assignments: input.assignments.map((day): EscalaAssignment =>
      day.employeeId === "b" && day.date === "2026-11-03" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" }
        : day.employeeId === "b" && day.date === "2026-11-04" ? { ...day, kind: "WORK", shiftId: "day" } : day) };
    const total = (value: EscalaInput) => [...coverageQuality(value).daily.values()].reduce((sum, count) => sum + count, 0);
    const staffing = (value: EscalaInput, date: string) => value.assignments.filter(day => day.date === date && day.kind === "WORK").length;
    expect([staffing(input, "2026-11-03"), staffing(input, "2026-11-04")]).toEqual([2, 0]);
    expect([staffing(proposal, "2026-11-03"), staffing(proposal, "2026-11-04")]).toEqual([1, 1]);
    expect(validateEscala(input).valid).toBe(true);
    expect(validateEscala(proposal).valid).toBe(true);
    expect([total(input), total(proposal)]).toEqual([960, 960]);
    expect(compareRosterCoverage(input, proposal)).toMatchObject({ comparable: true, regressed: false });
    expect(selectVerifiedRoster(input, proposal)).toEqual({ input: proposal, retainedReference: false });
  });

  it("distinguishes publication pendings from an incumbent with an unresolved operational meal interval", () => {
    const current = fixture(), pendingMeal = structuredClone(current);
    pendingMeal.shifts[0].segments[1].end = 900;
    pendingMeal.shifts[0].segments[2].start = 900;
    pendingMeal.shifts[0].segments[2].end = 1164;
    const validation = validateEscala(pendingMeal);
    expect(validation.valid).toBe(true);
    expect(validation.readyToPublish).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: "MEAL_INTERVAL_EXCESSIVE", severity: "PENDING" }));
    expect(isReusableRoster(pendingMeal)).toBe(false);
    expect(isReusableRoster(current)).toBe(true);
    expect(selectVerifiedRoster(pendingMeal, current)).toEqual({ input: current, retainedReference: false });
    expect(selectVerifiedRoster(current, pendingMeal)).toEqual({ input: current, retainedReference: true });
    // Unknown commercial coverage remains distinct from a known incompatible clock.
    expect(validateEscala(current).issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_PENDING" }));
  });

  it.each([
    { code: "ESTIMATED_COVERAGE_GAP", severity: "WARNING" as const, expected: true },
    { code: "POLICY_PENDING", severity: "PENDING" as const, expected: true },
    { code: "COVERAGE_PENDING", severity: "PENDING" as const, expected: true },
    { code: "MIXED_42_SIMULATION", severity: "WARNING" as const, expected: true },
    { code: "DAY_PENDING", severity: "PENDING" as const, expected: false },
    { code: "MEAL_INTERVAL_EXCESSIVE", severity: "PENDING" as const, expected: false },
    { code: "NEW_OPERATIONAL_RULE", severity: "ERROR" as const, expected: false },
  ])("uses the precomputed operational verdict for $code without mutating it", ({ code, severity, expected }) => {
    const validation = { ...validateEscala(fixture()), valid: severity !== "ERROR", issues: [{ code, severity, message: "Classificação de teste" }] };
    const original = structuredClone(validation);
    expect(isOperationallyReusable(validation)).toBe(expected);
    expect(validation).toEqual(original);
  });

  it("uses summed and deduplicated function shortages, not the largest missing role", () => {
    const input = fixture(); input.assignments = []; input.employees = [];
    input.demands = [
      { id: "a", date: "2026-11-03", sector: "Loja", role: "Caixa", start: 480, end: 540, minimum: 2, estimated: true },
      { id: "b", date: "2026-11-03", sector: "Loja", role: "Caixa", start: 480, end: 540, minimum: 1, estimated: true },
      { id: "c", date: "2026-11-03", sector: "Loja", role: "Fiscal", start: 480, end: 540, minimum: 1, estimated: true },
    ];
    expect(coverageQuality(input).daily.get("Loja" + "\0" + "2026-11-03")).toBe(180);
  });
  it("retains the last responsible leader on a declared peak even without hourly demand", () => {
    const input = fixture(); input.employees[0].role = "Encarregado";
    input.movementPriorities = [{ startDate: "2026-11-04", endDate: "2026-11-04", sector: "Loja", level: "HIGH" }];
    expect(selectVerifiedRoster(input, swap(input)).retainedReference).toBe(true);
  });
  it("does not substitute a new unverified solution for an invalid comparison roster", () => {
    const input = fixture(); input.assignments = [];
    const proposal = fixture();
    expect(selectVerifiedRoster(input, proposal)).toEqual({ input: proposal, retainedReference: false });
  });
  it("accepts a verified v2 replacement instead of retaining an old Saturday OFF reference", () => {
    const reference = fixture();
    expect(validateEscala(reference).valid).toBe(true);
    reference.restRulesVersion = 2;
    const original = structuredClone(reference);
    const validation = validateEscala(reference);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some(issue => issue.code === "SATURDAY_REST_FORBIDDEN")).toBe(true);
    const proposal: EscalaInput = { ...reference, assignments: reference.assignments.map((record): EscalaAssignment => {
      if (record.employeeId !== "b") return record;
      if (record.date === "2026-11-07") return { ...record, kind: "WORK", shiftId: "day" };
      if (record.date === "2026-11-04") return { employeeId: record.employeeId, date: record.date, kind: "OFF" };
      return record;
    }) };
    expect(validateEscala(proposal).valid).toBe(true);
    expect(selectVerifiedRoster(reference, proposal)).toEqual({ input: proposal, retainedReference: false });
    expect(reference).toEqual(original);
  });
  it("compares Sunday rates using real availability and only known prior Sundays", () => {
    const input = fixture();
    input.endDate = "2026-11-15";
    input.assignments = input.assignments.concat(input.assignments.map(record => ({ ...record, date: addDays(record.date, 7) })));
    input.assignments = input.assignments.map((record): EscalaAssignment => {
      if (record.date === "2026-11-08") return { ...record, kind: "WORK", shiftId: "day" };
      if (record.date === "2026-11-04" || record.employeeId === "b" && record.date === "2026-11-09")
        return { employeeId: record.employeeId, date: record.date, kind: "OFF" };
      if (record.employeeId === "b" && record.date === "2026-11-14") return { ...record, kind: "WORK", shiftId: "day" };
      if (record.employeeId === "b" && record.date === "2026-11-15") return { employeeId: record.employeeId, date: record.date, kind: "ABSENCE" };
      return record;
    });
    expect(validateEscala(input).valid).toBe(true);
    // Both worked one Sunday: a had two available Sundays, b only one due to absence.
    expect(input.employees.map(person => input.assignments.filter(record => record.employeeId === person.id
      && record.date === "2026-11-08" && record.kind === "WORK").length)).toEqual([1, 1]);
    expect([...weekendBalance(input, 6).values()]).toEqual([5000]);
    // One known prior OFF makes b's rate 1/2 too; unknown history never adds availability.
    input.employees[1].history = [{ employeeId: "b", date: "2026-10-25", kind: "OFF" }];
    expect([...weekendBalance(input, 6).values()]).toEqual([0]);
  });
  it("keeps valid reference assignments when the processor changes a protected absence", () => {
    const input = fixture(); const day = input.assignments.find(record => record.employeeId === "a" && record.date === "2026-11-03");
    if (!day) throw new Error("Missing fixture day"); day.kind = "ABSENCE";
    expect(selectVerifiedRoster(input, swap(input)).retainedReference).toBe(true);
  });
});
