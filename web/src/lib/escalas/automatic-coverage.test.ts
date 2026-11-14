import { describe, expect, it } from "vitest";
import { newInput } from "../../components/escalas/workspace-model";
import { coverageBasis, proposeAutomaticCoverage, retainCoverageReference } from "./automatic-coverage";
import { dateRange } from "./dates";
import { validateEscala } from "./validation";
import { materializeManualShiftOverrides, withManualShiftOverride } from "./shift-catalog/manual-override";
import type { EscalaEmployee, EscalaInput } from "./types";

function fixture(people = 1): EscalaInput {
  const input = newInput("02", "Filial de teste", "2026-11", 40);
  input.startDate = "2026-11-02";
  input.endDate = "2026-11-08";
  input.defaultWeeklyHours = 40;
  input.policy.closedDates = [];
  input.shifts = [{ id: "day", name: "Diurno", segments: [
    { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" },
  ] }];
  input.employees = Array.from({ length: people }, (_, i): EscalaEmployee => ({ id: `e${i}`, registration: `00${i}`, name: `Pessoa ${i}`, sector: "Loja", role: "Repositor", weeklyHours: 40, shiftIds: ["day"], activeFrom: "2020-01-01", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }));
  input.assignments = [];
  input.demands = [];
  return input;
}

const estimatedMinutes = (input: EscalaInput) => input.demands.filter(demand => demand.estimated === true)
  .reduce((sum, demand) => sum + demand.minimum * (demand.end - demand.start), 0);

function christmasFixture(people = 14) {
  const input = fixture(people);
  input.startDate = "2026-12-21"; input.endDate = "2026-12-27"; delete input.visibleMonth;
  input.restRulesVersion = 2;
  input.policy.closedDates = ["2026-12-25"];
  input.policy.holidayDates = ["2026-12-25"];
  input.policy.paidHolidayDates = ["2026-12-25"];
  return input;
}

function manualFixture(from = "2026-11-02", until = "2026-11-08") {
  const input = fixture(14); delete input.visibleMonth;
  input.employees = input.employees.map(person => withManualShiftOverride(person, {
    catalogCode: 1500, shiftId: "manual", markings: ["09:00", "13:00", "14:00", "18:00"], effectiveFrom: from, effectiveUntil: until,
  }));
  return materializeManualShiftOverrides(input);
}

describe("versioned calendar and effective manual coverage references", () => {
  it("uses the existing Christmas regime: four WORK, two OFF and one closed HOLIDAY", () => {
    const input = christmasFixture(), before = structuredClone(input);
    const proposal = proposeAutomaticCoverage(input);
    expect(estimatedMinutes(proposal)).toBe(14 * 4 * 480);
    expect(proposal.demands.some(demand => demand.date === "2026-12-25")).toBe(false);
    expect(proposal.demands.find(demand => demand.date === "2026-12-26" && demand.start === 480)?.minimum).toBeGreaterThan(0);
    const roster = structuredClone(input); roster.employees = [roster.employees[0]];
    roster.assignments = dateRange(input.startDate, input.endDate).map(date => ({ employeeId: "e0", date,
      kind: date === "2026-12-25" ? "HOLIDAY" as const : ["2026-12-21", "2026-12-27"].includes(date) ? "OFF" as const : "WORK" as const,
      ...(!["2026-12-21", "2026-12-25", "2026-12-27"].includes(date) ? { shiftId: "day" } : {}),
    }));
    expect(roster.assignments.filter(day => day.kind === "WORK")).toHaveLength(4);
    expect(roster.assignments.filter(day => day.kind === "OFF")).toHaveLength(2);
    expect(validateEscala(roster).issues.some(issue => ["FIVE_BY_TWO", "WEEKLY_MINUTES"].includes(issue.code))).toBe(false);
    expect(input).toEqual(before);
  });
  it("does not treat an ordinary closure as a paid weekday holiday", () => {
    const input = christmasFixture(); input.policy.paidHolidayDates = [];
    expect(estimatedMinutes(proposeAutomaticCoverage(input))).toBe(14 * 5 * 480);
    input.policy.paidHolidayDates = ["2026-12-25"]; input.policy.holidayDates = [];
    expect(estimatedMinutes(proposeAutomaticCoverage(input))).toBe(14 * 5 * 480);
  });
  it("keeps partial employment and AF bounded by actual availability, without imposing full-week equality", () => {
    const input = christmasFixture(1); input.employees[0].activeFrom = "2026-12-23"; input.employees[0].activeUntil = "2026-12-26";
    const proposal = proposeAutomaticCoverage(input);
    expect(estimatedMinutes(proposal)).toBe(3 * 480);
    expect(proposal.demands.filter(d => d.minimum > 0).every(d => d.date >= "2026-12-23" && d.date <= "2026-12-26" && d.date !== "2026-12-25")).toBe(true);
    const absent = christmasFixture(1);
    absent.assignments = [{ employeeId: "e0", date: "2026-12-21", kind: "ABSENCE", locked: true }];
    const before = structuredClone(absent), result = proposeAutomaticCoverage(absent);
    expect(estimatedMinutes(result)).toBeLessThanOrEqual(5 * 480);
    expect(result.demands.filter(d => d.date === "2026-12-21").every(d => d.minimum === 0)).toBe(true);
    expect(result.assignments).toEqual(absent.assignments); expect(absent).toEqual(before);
  });
  it("reserves locked WORK at full weight before distributing the reduced Christmas budget", () => {
    const input = christmasFixture(1);
    input.assignments = [{ employeeId: "e0", date: "2026-12-27", kind: "WORK", shiftId: "day", locked: true }];
    input.demands = [{ id: "explicit", date: "2026-12-21", sector: "Loja", role: "Repositor", start: 480, end: 600, minimum: 0, estimated: false }];
    const before = structuredClone(input), proposal = proposeAutomaticCoverage(input);
    expect(proposal.demands.filter(d => d.date === "2026-12-27").every(d => d.minimum === 1)).toBe(true);
    expect(proposal.demands).toContainEqual(input.demands[0]); expect(proposal.assignments).toEqual(input.assignments);
    expect(input).toEqual(before);
  });
  it("uses one fully manual clock rather than simultaneous base, manual and alternative clocks", () => {
    const input = manualFixture(), before = structuredClone(input), proposal = proposeAutomaticCoverage(input);
    expect(proposal.demands.filter(d => d.minimum > 0).every(d => d.start >= 540 && d.end <= 1080)).toBe(true);
    expect(proposal.demands.filter(d => d.minimum > 0).every(d => !(d.start < 840 && d.end > 780))).toBe(true);
    expect(estimatedMinutes(proposal)).toBe(14 * 5 * 480);
    expect(proposal.employees).toEqual(input.employees); expect(input).toEqual(before);
    const alternative = structuredClone(input);
    alternative.shifts.push({ id: "unused", name: "Unused", segments: [{ start: 840, end: 1320, kind: "WORK" }] });
    alternative.employees.forEach(person => { person.shiftIds.push("unused", "unused"); });
    expect(proposeAutomaticCoverage(alternative).demands).toEqual(proposal.demands);
    expect(coverageBasis(alternative)).toBe(coverageBasis(input));
  });
  it("uses each partial manual interval and returns to the base clock in an uncovered gap", () => {
    const input = manualFixture("2026-11-02", "2026-11-03");
    input.employees = input.employees.map(person => withManualShiftOverride(person, {
      catalogCode: 1500, shiftId: "manual", markings: ["09:00", "13:00", "14:00", "18:00"], effectiveFrom: "2026-11-05", effectiveUntil: "2026-11-08",
    }));
    const materialized = materializeManualShiftOverrides(input), proposal = proposeAutomaticCoverage(materialized);
    expect(proposal.demands.find(d => d.date === "2026-11-02" && d.start <= 480 && d.end > 480)?.minimum ?? 0).toBe(0);
    expect(proposal.demands.find(d => d.date === "2026-11-04" && d.start <= 480 && d.end > 480)?.minimum).toBeGreaterThan(0);
    expect(proposal.demands.find(d => d.date === "2026-11-05" && d.start <= 480 && d.end > 480)?.minimum ?? 0).toBe(0);
    expect(proposal.demands.find(d => d.date === "2026-11-04" && d.start <= 1050 && d.end > 1050)?.minimum ?? 0).toBe(0);
    expect(proposal.demands.find(d => d.date === "2026-11-05" && d.start <= 1050 && d.end > 1050)?.minimum).toBeGreaterThan(0);
    expect(estimatedMinutes(proposal)).toBeLessThanOrEqual(14 * 5 * 480);
  });
  it("does not replace a missing manual target with an unselected base clock or assign hours to ENC", () => {
    const input = manualFixture(); input.shifts = input.shifts.filter(shift => shift.id !== "manual");
    expect(proposeAutomaticCoverage(input).demands).toEqual([]);
    const untimed = manualFixture(); untimed.employees.forEach(person => { person.scheduleMode = "UNTIMED"; });
    expect(proposeAutomaticCoverage(untimed).demands).toEqual([]);
  });
  it("fingerprints actual manual clocks, their dates, protected holidays and the calendar version", () => {
    const base = fixture(), manual = manualFixture();
    expect(coverageBasis(base)).toMatch(/^coverage-v2:[a-f0-9]{16}$/);
    expect(coverageBasis(manual)).not.toBe(coverageBasis(fixture(14)));
    const partial = manualFixture("2026-11-03"); expect(coverageBasis(partial)).not.toBe(coverageBasis(manual));
    const changed = structuredClone(manual); changed.shifts.find(shift => shift.id === "manual")?.segments.forEach(s => { s.start += 15; s.end += 15; });
    expect(coverageBasis(changed)).not.toBe(coverageBasis(manual));
    const differentCalendar = christmasFixture(); differentCalendar.policy.paidHolidayDates = [];
    expect(coverageBasis(differentCalendar)).not.toBe(coverageBasis(christmasFixture()));
    const recordedHoliday = fixture(); recordedHoliday.assignments = [{ employeeId: "e0", date: recordedHoliday.startDate, kind: "HOLIDAY" }];
    expect(coverageBasis(recordedHoliday)).not.toBe(coverageBasis(base));
  });
  it("does not stamp unversioned or v1 saved estimates with the v2 algorithm identity", () => {
    const source = fixture(); delete source.visibleMonth; delete source.policy.calendarMode;
    source.demands = [{ id: "legacy-estimate", date: "2026-11-03", sector: "Loja", role: "Repositor", start: 480, end: 720, minimum: 1, estimated: true }];
    source.assignments = dateRange(source.startDate, source.endDate).map((date, index) => ({ employeeId: "e0", date,
      kind: [2, 6].includes(index) ? "OFF" as const : "WORK" as const, ...([2, 6].includes(index) ? {} : { shiftId: "day" }),
    }));
    const historical = structuredClone(source); delete historical.coverageBasis;
    const old = structuredClone(historical), retained = retainCoverageReference(historical, historical, true);
    expect(validateEscala(historical).valid).toBe(true);
    expect(retained?.demands).toBe(historical.demands);
    expect(retained?.coverageBasis).toMatch(/^coverage-v1:[a-f0-9]{16}$/);
    if (!retained) throw new Error("Expected the unchanged legacy ruler");
    expect(retainCoverageReference(retained, retained)?.demands).toBe(retained.demands);
    expect(retainCoverageReference({ ...retained, coverageBasis: "coverage-v1:0000000000000000" }, retained)).toBeUndefined();
    expect(coverageBasis(retained)).toMatch(/^coverage-v2:[a-f0-9]{16}$/);
    expect(coverageBasis(retained)).not.toBe(retained.coverageBasis);
    expect(proposeAutomaticCoverage({ ...retained, needsRegeneration: true }).coverageBasis).toMatch(/^coverage-v2:[a-f0-9]{16}$/);
    expect(proposeAutomaticCoverage(historical).coverageBasis).toMatch(/^coverage-v2:[a-f0-9]{16}$/);
    expect(historical).toEqual(old);
  });
});

describe("automatic provisional coverage", () => {
  it("keeps rounding dates stable when only the sector or role label changes", () => {
    const input = fixture(2); input.endDate = "2026-11-29";
    const baseline = proposeAutomaticCoverage(input).demands.map(({ sector: _sector, role: _role, ...demand }) => demand);
    for (const role of ["Repositor A", "Repositor B"]) {
      const renamed = structuredClone(input);
      renamed.employees.forEach(person => { person.sector = "Novo nome do setor"; person.role = role; });
      expect(proposeAutomaticCoverage(renamed).demands.map(({ sector: _sector, role: _role, ...demand }) => demand)).toEqual(baseline);
    }
    expect(proposeAutomaticCoverage({ ...input, employees: [...input.employees].reverse() }).demands).toEqual(proposeAutomaticCoverage(input).demands);
  });
  it("does not move the demand reference when another allowed shift is added after the canonical one", () => {
    const input = fixture();
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "001", description: "Referência", weekday: "09:00-13:00 / 14:00-18:00", saturday: "" };
    const baseline = proposeAutomaticCoverage(input).demands;
    input.shifts.push({ id: "closer-to-source", name: "Alternativa", segments: [
      { start: 540, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" }, { start: 840, end: 1080, kind: "WORK" },
    ] });
    input.employees[0].shiftIds.push("closer-to-source");
    expect(proposeAutomaticCoverage(input).demands).toEqual(baseline);
    input.employees[0].shiftIds.push("closer-to-source");
    expect(proposeAutomaticCoverage(input).demands).toEqual(baseline);
  });
  it("splits overnight staffing onto the actual civil dates without inventing a previous journey", () => {
    const input = fixture(); input.endDate = "2026-11-15";
    input.shifts[0].segments = [{ start: 1320, end: 1560, kind: "WORK" }, { start: 1560, end: 1620, kind: "BREAK" }, { start: 1620, end: 1860, kind: "WORK" }];
    const result = proposeAutomaticCoverage(input);
    expect(result.demands.some(item => item.date === "2026-11-03" && item.start === 0 && item.end === 120)).toBe(true);
    expect(result.demands.some(item => item.date === "2026-11-09" && item.start === 0 && item.end === 120)).toBe(true);
    expect(result.demands.some(item => item.date === input.startDate && item.start < 1320 && item.minimum > 0)).toBe(false);
    expect(result.demands.every(item => item.start >= 0 && item.end <= 1440)).toBe(true);
    expect(result.demands.reduce((sum, item) => sum + item.minimum * (item.end - item.start), 0)).toBeLessThanOrEqual(4800);
  });
  it("does not treat unused fixed-day metadata as a restriction in VARIABLE mode", () => {
    const input = fixture(); input.employees[0].fixedOffDays = [0];
    const result = proposeAutomaticCoverage(input);
    expect(result.demands).toEqual(proposeAutomaticCoverage(fixture()).demands);
  });
  it("allocates only five days of one-person capacity rather than claiming one person on all seven days", () => {
    const input = fixture();
    const result = proposeAutomaticCoverage(input);
    const morning = result.demands.filter(item => item.start <= 480 && item.end > 480);
    expect(morning).toHaveLength(7);
    expect(morning.reduce((sum, item) => sum + item.minimum, 0)).toBe(5);
    expect(morning.filter(item => item.minimum === 0)).toHaveLength(2);
    expect(result.demands.every(item => item.estimated === true)).toBe(true);
    expect(input.demands).toEqual([]);
  });

  it("uses one coherent shift reference, not simultaneous coverage of mutually exclusive alternatives", () => {
    const input = fixture();
    input.shifts.push({ id: "late", name: "Tarde", segments: [{ start: 840, end: 1320, kind: "WORK" }] });
    input.employees[0].shiftIds = ["day", "late"];
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "001", description: "Referência", weekday: "08:00-12:00 / 13:00-17:00", saturday: "" };
    const result = proposeAutomaticCoverage(input);
    expect(result.demands.some(item => item.start >= 1020 && item.minimum > 0)).toBe(false);
    expect(result.demands.some(item => item.start < 720 && item.end > 720)).toBe(false);
  });

  it("refreshes stale estimates after 44h becomes 42h even when the global legacy review says CONFIRMED", () => {
    const input = fixture();
    input.defaultWeeklyHours = 42;
    input.employees[0].weeklyHours = 42;
    input.shifts[0].segments[2].end = 1044;
    input.demands = [{ id: "stale", date: input.startDate, sector: "Loja", start: 480, end: 1056, minimum: 99, estimated: true }];
    input.policy.coverageReview = "CONFIRMED";
    const result = proposeAutomaticCoverage(input);
    expect(result.demands.some(item => item.id === "stale")).toBe(false);
    expect(result.demands.some(item => item.end === 1044)).toBe(true);
    expect(result.demands.some(item => item.end === 1056)).toBe(false);
    expect(result.policy.coverageReview).toBe("SUGGESTED");
    expect(result.policy.compensationAuthorized).toBe(input.policy.compensationAuthorized);
  });

  it("preserves explicit minimums, including zero, and estimates only the uncovered parts", () => {
    const input = fixture();
    input.demands = [{ id: "manual", date: input.startDate, sector: "Loja", start: 480, end: 600, minimum: 0 }];
    const result = proposeAutomaticCoverage(input);
    expect(result.demands.find(item => item.id === "manual")).toEqual(input.demands[0]);
    expect(result.demands.some(item => item.estimated && item.date === input.startDate && item.start < 600 && item.end > 480)).toBe(false);
    expect(result.demands.some(item => item.estimated && item.date === input.startDate && item.start === 600)).toBe(true);
    expect(proposeAutomaticCoverage(result)).toEqual(result);
  });

  it("keeps a short imported clock reference as real coverage without inventing a full target shift", () => {
    const input = fixture();
    input.simulation = true;
    input.defaultWeeklyHours = 42;
    input.employees[0].weeklyHours = 42;
    input.employees[0].simulationDailyMinutes = 240;
    input.shifts[0].segments = [{ start: 480, end: 720, kind: "WORK" }];
    const result = proposeAutomaticCoverage(input);
    expect(result.demands.filter(item => item.minimum > 0)).toHaveLength(5);
    expect(result.demands.every(item => item.start === 480 && item.end === 720)).toBe(true);
    expect(result.employees[0].simulationDailyMinutes).toBe(240);
  });

  it("keeps different roles separate and excludes missing clocks, closed days, absences and fixed days off", () => {
    const input = fixture(3);
    input.employees[1].role = "Motorista";
    input.employees[2].scheduleMode = "MISSING";
    input.employees[0].fixedOffDays = [0];
    input.employees[0].offMode = "MIXED";
    input.policy.closedDates = ["2026-11-03"];
    input.assignments = [{ employeeId: "e1", date: "2026-11-04", kind: "ABSENCE" }];
    const result = proposeAutomaticCoverage(input);
    expect(new Set(result.demands.map(item => item.role))).toEqual(new Set(["Repositor", "Motorista"]));
    expect(result.demands.some(item => item.date === "2026-11-03")).toBe(false);
    expect(result.demands.some(item => item.date === "2026-11-02" && item.role === "Repositor" && item.minimum > 0)).toBe(false);
    expect(result.demands.some(item => item.date === "2026-11-04" && item.role === "Motorista" && item.minimum > 0)).toBe(false);
    expect(Math.max(...result.demands.map(item => item.minimum))).toBe(1);
  });

  it("rotates rounding opportunities across weeks without making every weekend the default time off", () => {
    const input = fixture();
    input.endDate = "2026-11-29";
    const result = proposeAutomaticCoverage(input);
    const sunday = result.demands.filter(item => ["2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"].includes(item.date) && item.start === 480);
    expect(sunday.some(item => item.minimum > 0)).toBe(true);
    expect(sunday.some(item => item.minimum === 0)).toBe(true);
  });
});


describe("Sunday-aware estimated staffing budgets", () => {
  it("does not suggest five-sevenths of staff on every Sunday when alternating rest permits one-half", () => {
    const input = fixture(14); input.endDate = "2026-11-15";
    const proposal = proposeAutomaticCoverage(input);
    for (const sunday of ["2026-11-08", "2026-11-15"]) {
      const morning = proposal.demands.find(row => row.date === sunday && row.start === 480);
      expect(morning?.minimum).toBe(7);
    }
    for (const week of [["2026-11-02", "2026-11-08"], ["2026-11-09", "2026-11-15"]]) expect(proposal.demands.filter(row => row.date >= week[0] && row.date <= week[1]).reduce((sum, row) => sum + (row.end - row.start) * row.minimum, 0)).toBe(14 * 5 * 480);
    expect(proposal.employees).toEqual(input.employees); expect(proposal.assignments).toEqual(input.assignments);
  });
  it("alternates rounding for a single comparable worker instead of suggesting every Sunday or none", () => {
    const input = fixture(1); input.endDate = "2026-11-29";
    const proposal = proposeAutomaticCoverage(input);
    const sundays = ["2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"];
    const targets = sundays.map(date => proposal.demands.find(row => row.date === date && row.start === 480)?.minimum);
    expect(targets.filter(value => value === 1)).toHaveLength(2); expect(targets.filter(value => value === 0)).toHaveLength(2);
    expect(targets[0]).not.toBe(targets[1]); expect(targets[1]).not.toBe(targets[2]);
  });
  it("retains explicit operational minima and known locked work rather than reducing them to an estimate", () => {
    const input = fixture(1); const sunday = "2026-11-08";
    input.assignments = [{ employeeId: "e0", date: sunday, kind: "WORK", shiftId: "day", locked: true }];
    input.demands = [{ id: "real", date: sunday, sector: "Loja", role: "Repositor", start: 480, end: 720, minimum: 1, estimated: false }];
    const proposal = proposeAutomaticCoverage(input);
    expect(proposal.demands).toContainEqual(input.demands[0]); expect(proposal.assignments).toEqual(input.assignments);
    expect(proposal.demands.find(row => row.date === sunday && row.start === 780)?.minimum).toBe(1);
  });
  it("does not suggest work on a Sunday already incompatible with declared previous Sunday work", () => {
    const input = fixture(2); input.employees.forEach(person => { person.historyKnown = true; person.history = [{ employeeId: person.id, date: "2026-11-01", kind: "WORK", shiftId: "day" }]; });
    const proposal = proposeAutomaticCoverage(input);
    expect(proposal.demands.filter(row => row.date === "2026-11-08").every(row => row.minimum === 0)).toBe(true);
  });
});


describe("Sunday reference provenance", () => {
  it("uses an explicit two-Sunday rotation only where that individual rule was informed", () => {
    const input = fixture(3); input.employees.forEach(person => { person.sundayRestRule = "COMMERCE"; person.maxConsecutiveSundays = 2; });
    const estimated = proposeAutomaticCoverage(input);
    expect(estimated.demands.find(row => row.date === "2026-11-08" && row.start === 480)?.minimum).toBe(2);
    expect(estimated.employees).toEqual(input.employees);
  });
  it("never turns an old unlocked draft assignment into mandatory history for new estimates", () => {
    const input = fixture(4); input.endDate = "2026-11-15";
    const baseline = proposeAutomaticCoverage(input);
    const withDraft = proposeAutomaticCoverage({ ...input, assignments: input.employees.map(person => ({ employeeId: person.id, date: "2026-11-08", kind: "WORK", shiftId: "day", locked: false })) });
    expect(withDraft.demands).toEqual(baseline.demands);
  });
  it("lets actual history override planning context and reuses locked work across weeks", () => {
    const input = fixture(2); input.endDate = "2026-11-15";
    for (const person of input.employees) {
      person.historyKnown = true;
      person.planningHistory = [{ employeeId: person.id, date: "2026-11-01", kind: "WORK", shiftId: "day" }];
      person.history = [{ employeeId: person.id, date: "2026-11-01", kind: "OFF" }];
    }
    expect(proposeAutomaticCoverage(input).demands.find(row => row.date === "2026-11-08" && row.start === 480)?.minimum).toBe(1);
    input.assignments = input.employees.map(person => ({
      employeeId: person.id, date: "2026-11-08", kind: "WORK", shiftId: "day", locked: true,
    }));
    const secondSunday = proposeAutomaticCoverage(input).demands.filter(row => row.date === "2026-11-15");
    expect(secondSunday.length).toBeGreaterThan(0);
    expect(secondSunday.every(row => row.minimum === 0)).toBe(true);
  });
});
