import { describe, expect, it } from "vitest";
import { addDays, dateRange, dayOfWeek } from "./dates";
import type { EscalaAssignment, EscalaInput } from "./types";
import { validateEscala } from "./validation";

function proposedWeek(): EscalaInput {
  const startDate = "2026-10-26";
  const endDate = "2026-11-01";
  const assignment = (date: string): EscalaAssignment => ({ employeeId: "person-1", date,
    kind: dayOfWeek(date) < 5 ? "WORK" : "OFF", ...(dayOfWeek(date) < 5 ? { shiftId: "day" } : {}) });
  return {
    schemaVersion: 1, branchCode: "02", branchName: "Filial de teste", startDate, endDate,
    defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
    policy: {
      source: "Referência de teste", reviewed: true, reviewedBy: "Responsável de teste",
      validFrom: "2026-01-01", validUntil: "2027-12-31", coverageReview: "SUGGESTED",
      weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true,
      minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60,
      maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [],
      holidayRestAllowed: true, nightWorkReviewed: false,
    },
    employees: [{ id: "person-1", registration: "0001", name: "Pessoa de teste", sector: "Reposição", role: "Repositor",
      weeklyHours: 40, shiftIds: ["day"], activeFrom: "2020-01-01", offMode: "VARIABLE", fixedOffDays: [],
      offPattern: "ANY", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [], historyKnown: true,
      history: dateRange(addDays(startDate, -21), addDays(startDate, -1)).map(assignment) }],
    shifts: [{ id: "day", name: "Diurno", segments: [
      { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" },
      { start: 780, end: 1020, kind: "WORK" },
    ] }],
    demands: dateRange(startDate, endDate).map(date => ({ id: `d-${date}`, date, sector: "Reposição",
      start: 480, end: 720, minimum: dayOfWeek(date) < 5 ? 2 : 0, estimated: true })),
    assignments: dateRange(startDate, endDate).map(assignment),
  };
}

describe("estimated coverage and internal publication", () => {
  it("allows a valid proposal with suggested estimates while preserving all data and margins", () => {
    const input = proposedWeek();
    const before = structuredClone(input);
    const result = validateEscala(input);
    expect(result.valid).toBe(true);
    expect(result.readyToPublish).toBe(true);
    expect(result.minimumCoverageMargin).toBe(-1);
    expect(result.summaries[0].workedMinutes).toBe(2400);
    expect(result.issues.every(issue => issue.severity === "WARNING")).toBe(true);
    expect(result.issues.filter(issue => issue.code === "ESTIMATED_COVERAGE_GAP")).toHaveLength(5);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_REVIEW_PENDING", severity: "WARNING" }));
    expect(input).toEqual(before);
  });

  it("keeps each estimated gap's date and range visible without merging its evidence", () => {
    const input = proposedWeek();
    input.demands.push({ ...input.demands[0], id: "afternoon", start: 780, end: 900 });
    const gaps = validateEscala(input).issues.filter(issue => issue.code === "ESTIMATED_COVERAGE_GAP" && issue.date === input.startDate);
    expect(gaps).toHaveLength(2);
    expect(gaps.map(issue => issue.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("08:00"), expect.stringContaining("13:00"),
    ]));
  });

  it.each([false, undefined])("blocks a mandatory deficit with estimated=%s even alongside suggested estimates", estimated => {
    const input = proposedWeek();
    input.demands[0].estimated = estimated;
    const result = validateEscala(input);
    expect(result.valid).toBe(false);
    expect(result.readyToPublish).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_DEFICIT", severity: "ERROR" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ESTIMATED_COVERAGE_GAP", severity: "WARNING" }));
  });

  it("keeps missing coverage pending rather than treating it as a known zero", () => {
    const input = proposedWeek();
    input.demands = [];
    const result = validateEscala(input);
    expect(result.minimumCoverageMargin).toBeNull();
    expect(result.readyToPublish).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_PENDING", severity: "PENDING" }));
    input.demands = dateRange(input.startDate, input.endDate).map(date => ({ id: date, date, sector: "Reposição", start: 480, end: 720, minimum: 0 }));
    expect(validateEscala(input).minimumCoverageMargin).toBe(0);
    expect(validateEscala(input).readyToPublish).toBe(true);
  });

  it.each([
    { code: "WEEKLY_MINUTES", change: (input: EscalaInput) => { input.shifts[0].segments[2].end -= 30; } },
    { code: "DAILY_LIMIT", change: (input: EscalaInput) => { input.policy.dailyLimitMinutes = 420; } },
    { code: "MEAL_INTERVAL", change: (input: EscalaInput) => { input.shifts[0].segments[1].end = 750; input.shifts[0].segments[2].start = 750; } },
    { code: "MEAL_INTERVAL_EXCESSIVE", change: (input: EscalaInput) => { input.shifts[0].segments[1].end = 900; input.shifts[0].segments[2].start = 900; input.shifts[0].segments[2].end = 1140; } },
    { code: "INTER_SHIFT_REST", change: (input: EscalaInput) => { input.policy.minInterShiftMinutes = 1000; } },
  ])("preserves the operational $code blocker alongside estimated warnings", ({ code, change }) => {
    const input = proposedWeek();
    change(input);
    const result = validateEscala(input);
    expect(result.valid).toBe(false);
    expect(result.readyToPublish).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code, severity: "ERROR" }));
  });

  it("preserves absences and rejects overnight work overlapping them", () => {
    const input = proposedWeek();
    input.simulation = true;
    input.shifts.push({ id: "overnight", name: "Noturno de teste", segments: [
      { start: 1200, end: 1440, kind: "WORK" }, { start: 1440, end: 1500, kind: "BREAK" },
      { start: 1500, end: 1740, kind: "WORK" },
    ] });
    input.employees[0].shiftIds.push("overnight");
    input.assignments[0] = { ...input.assignments[0], shiftId: "overnight", locked: true };
    input.assignments[1] = { employeeId: "person-1", date: addDays(input.startDate, 1), kind: "ABSENCE", locked: true };
    const before = structuredClone(input);
    const result = validateEscala(input);
    expect(result.valid).toBe(false);
    expect(result.readyToPublish).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ABSENCE_OCCUPIED", severity: "ERROR" }));
    expect(input).toEqual(before);
  });
});
