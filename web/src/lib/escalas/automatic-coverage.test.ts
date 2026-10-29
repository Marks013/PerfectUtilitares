import { describe, expect, it } from "vitest";
import { newInput } from "../../components/escalas/workspace-model";
import { proposeAutomaticCoverage } from "./automatic-coverage";
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

describe("automatic provisional coverage", () => {
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
});
