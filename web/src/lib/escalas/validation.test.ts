import { describe, expect, it } from "vitest";
import { addDays, dateRange, dayOfWeek } from "./dates";
import { escalaInputSchema } from "./schema";
import type { EscalaAssignment, EscalaInput, WeeklyHours } from "./types";
import { validateEscala } from "./validation";

function fixture(hours: WeeklyHours = 42, weeks = 1): EscalaInput {
  const startDate = "2026-10-26";
  const endDate = addDays(startDate, weeks * 7 - 1);
  const id = "person-1";
  const make = (date: string): EscalaAssignment => ({ employeeId: id, date, kind: dayOfWeek(date) < 5 ? "WORK" : "OFF", ...(dayOfWeek(date) < 5 ? { shiftId: "day" } : {}) });
  return {
    schemaVersion: 1, branchCode: "02", branchName: "Filial 02", startDate, endDate,
    defaultWeeklyHours: hours, timeZone: "America/Sao_Paulo",
    policy: {
      source: "Instrumento de referência confirmado para o cenário de teste", validFrom: "2026-01-01", validUntil: "2027-12-31",
      reviewed: true, reviewedBy: "Responsável de teste", weeklyLimit: 44, dailyLimitMinutes: 600,
      compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60,
      maxConsecutiveWorkDays: 6, closedDates: [], holidayDates: [], authorizedHolidayDates: [],
      holidayRestAllowed: true, nightWorkReviewed: false,
    },
    employees: [{
      id, registration: "0001", name: "Ana Silva", sector: "Reposição", role: "Repositor",
      weeklyHours: hours, shiftIds: ["day"], activeFrom: "2020-01-01", offMode: "VARIABLE", fixedOffDays: [],
      offPattern: "ANY", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [], historyKnown: true,
      history: dateRange(addDays(startDate, -21), addDays(startDate, -1)).map(make),
    }],
    shifts: [{ id: "day", name: "Diurno", segments: [
      { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" },
      { start: 780, end: 780 + hours * 12 - 240, kind: "WORK" },
    ] }],
    demands: dateRange(startDate, endDate).map((day) => ({ id: `d-${day}`, date: day, sector: "Reposição", start: 480, end: 720, minimum: dayOfWeek(day) < 5 ? 1 : 0 })),
    assignments: dateRange(startDate, endDate).map(make),
  };
}

function codes(input: EscalaInput) { return validateEscala(input).issues.map((issue) => issue.code); }

describe("independent Escalas validation", () => {
  it("keeps an unconfirmed estimated coverage gap visible without claiming the draft is ready", () => {
    const input = fixture(40);
    input.policy.coverageReview = "SUGGESTED";
    input.demands[0].minimum = 2;
    input.demands[0].estimated = true;
    const result = validateEscala(input);
    expect(result.valid).toBe(true);
    expect(result.readyToPublish).toBe(false);
    expect(result.minimumCoverageMargin).toBe(-1);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ESTIMATED_COVERAGE_GAP", severity: "PENDING", date: input.startDate }));
    input.policy.coverageReview = "CONFIRMED";
    expect(validateEscala(input).valid).toBe(true);
    expect(codes(input)).toContain("ESTIMATED_COVERAGE_GAP");
    input.demands[0].estimated = false;
    expect(validateEscala(input).valid).toBe(false);
    expect(codes(input)).toContain("COVERAGE_DEFICIT");
  });

  it("never relaxes a manual staffing minimum when other estimates await review", () => {
    const input = fixture(40);
    input.policy.coverageReview = "SUGGESTED";
    input.demands[0].minimum = 2;
    expect(validateEscala(input).valid).toBe(false);
    expect(codes(input)).toContain("COVERAGE_DEFICIT");
    expect(codes(input)).not.toContain("ESTIMATED_COVERAGE_GAP");
  });

  it.each([40, 42, 44] as const)("reconciles %s hours with exact integer minutes", (hours) => {
    const result = validateEscala(fixture(hours));
    expect(result.issues).toEqual([]);
    expect(result.readyToPublish).toBe(true);
    expect(result.summaries[0].workedMinutes).toBe(hours * 60);
    expect(result.minimumCoverageMargin).toBe(0);
  });

  it("rejects wrong paid duration instead of inventing overtime", () => {
    const input = fixture(44);
    input.shifts[0].segments[2].end -= 48;
    expect(codes(input)).toContain("WEEKLY_MINUTES");
    expect(validateEscala(input).summaries[0].workedMinutes).toBe(2400);
  });

  it("blocks ten consecutive days across two formally valid 5x2 weeks", () => {
    const input = fixture(40, 2);
    input.demands = [];
    input.assignments = dateRange(input.startDate, input.endDate).map((date, index) => ({
      employeeId: "person-1", date, kind: index < 2 || index >= 12 ? "OFF" : "WORK", ...(index >= 2 && index < 12 ? { shiftId: "day" } : {}),
    }));
    expect(codes(input)).toContain("WORK_STREAK");
    expect(codes(input)).not.toContain("FIVE_BY_TWO");
  });

  it("uses previous-month history for the seventh consecutive workday", () => {
    const input = fixture(40);
    input.employees[0].history = dateRange(addDays(input.startDate, -21), addDays(input.startDate, -1)).map((date) => ({
      employeeId: "person-1", date, kind: date >= addDays(input.startDate, -6) ? "WORK" : "OFF", ...(date >= addDays(input.startDate, -6) ? { shiftId: "day" } : {}),
    }));
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "WORK_STREAK", date: input.startDate }));
  });

  it("does not treat a historical gap as known rest", () => {
    const input = fixture();
    input.employees[0].history.splice(5, 1);
    expect(codes(input)).toContain("HISTORY_UNVERIFIED");
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "HISTORY_UNVERIFIED", severity: "WARNING" }));
    expect(validateEscala(input).readyToPublish).toBe(true);
  });

  it("does not request history before an actual admission", () => {
    const input = fixture();
    input.employees[0].activeFrom = input.startDate;
    input.employees[0].historyKnown = false;
    input.employees[0].history = [];
    expect(codes(input)).not.toContain("HISTORY_UNVERIFIED");
    expect(validateEscala(input).readyToPublish).toBe(true);
  });

  it("does not convert absences to off days or fictitious compensation hours", () => {
    const input = fixture();
    input.assignments[0] = { employeeId: "person-1", date: input.startDate, kind: "ABSENCE" };
    const result = validateEscala(input);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "PARTIAL_WEEK_PENDING", severity: "PENDING" }));
    expect(codes(input)).not.toContain("WEEKLY_MINUTES");
    expect(result.summaries[0].offDays).toBe(2);
    expect(result.summaries[0].workedMinutes).toBe(2016);
  });

  it("measures real rest instead of accepting a blank day: 33h is less than 35h", () => {
    const input = fixture(40, 2);
    input.demands = [];
    input.shifts.push({ id: "late", name: "Tarde", segments: [{ start: 900, end: 1140, kind: "WORK" }, { start: 1140, end: 1200, kind: "BREAK" }, { start: 1200, end: 1380, kind: "WORK" }] });
    input.employees[0].shiftIds.push("late");
    input.assignments[4].shiftId = "late"; // Friday ends 23h.
    input.assignments[6] = { employeeId: "person-1", date: addDays(input.startDate, 6), kind: "WORK", shiftId: "day" }; // Sunday starts 08h.
    expect(codes(input)).toContain("WEEKLY_REST");
    expect(validateEscala(input).issues.find((issue) => issue.code === "WEEKLY_REST")?.message).toContain("1980");
  });

  it("does not use horizon midnight as a fictitious next return", () => {
    const input = fixture(40);
    input.demands = [];
    input.assignments[0] = { employeeId: "person-1", date: input.startDate, kind: "OFF" };
    input.assignments[5] = { employeeId: "person-1", date: addDays(input.startDate, 5), kind: "WORK", shiftId: "day" };
    expect(codes(input)).not.toContain("WEEKLY_REST");
  });

  it("excludes lunch and paid pauses from operational coverage", () => {
    const input = fixture();
    input.demands.push({ id: "lunch", date: input.startDate, sector: "Reposição", start: 719, end: 781, minimum: 1 });
    expect(codes(input)).toContain("COVERAGE_DEFICIT");
    input.shifts[0].segments[1].kind = "PAID_BREAK";
    expect(codes(input)).toContain("COVERAGE_DEFICIT");
  });

  it("requires coverage declarations on every active date, accepting an explicit zero", () => {
    const input = fixture();
    input.demands.pop();
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_PENDING", date: input.endDate }));
    input.demands.push({ id: "zero", date: input.endDate, sector: "Reposição", start: 480, end: 720, minimum: 0 });
    expect(codes(input)).not.toContain("COVERAGE_PENDING");
    input.demands.pop();
    input.policy.closedDates = [input.endDate];
    expect(codes(input)).not.toContain("COVERAGE_PENDING");
  });

  it("checks exact end boundaries without rounding 8h24", () => {
    const input = fixture();
    input.demands.push({ id: "edge", date: input.startDate, sector: "Reposição", start: 1043, end: 1044, minimum: 1 });
    expect(codes(input)).not.toContain("COVERAGE_DEFICIT");
    input.demands[input.demands.length - 1].end = 1045;
    expect(codes(input)).toContain("COVERAGE_DEFICIT");
  });

  it("does not double-count an employee across overlapping coverage constraints", () => {
    const input = fixture();
    input.demands.push({ id: "role", date: input.startDate, sector: "Reposição", role: "Outro cargo", start: 480, end: 720, minimum: 1 });
    expect(codes(input)).toContain("COVERAGE_DEFICIT");
    input.demands[input.demands.length - 1].role = "Repositor";
    expect(codes(input)).not.toContain("COVERAGE_DEFICIT");
    input.demands[0].minimum = 2;
    expect(codes(input)).toContain("COVERAGE_DEFICIT");
  });

  it("blocks a fixed-off conflict and the specific Sunday limit", () => {
    const input = fixture();
    input.employees[0].offMode = "MIXED";
    input.employees[0].fixedOffDays = [0];
    expect(codes(input)).toContain("FIXED_OFF");
    input.employees[0].offMode = "VARIABLE";
    input.employees[0].fixedOffDays = [];
    input.employees[0].maxConsecutiveSundays = 1;
    input.employees[0].history[input.employees[0].history.length - 1].kind = "WORK";
    input.employees[0].history[input.employees[0].history.length - 1].shiftId = "day";
    input.assignments[6] = { employeeId: "person-1", date: addDays(input.startDate, 6), kind: "WORK", shiftId: "day" };
    expect(codes(input)).toContain("SUNDAY_ROTATION");
  });

  it("requires compensation authorization and an unexpired reviewed instrument", () => {
    const input = fixture();
    input.policy.compensationAuthorized = false;
    input.policy.reviewed = false;
    input.policy.validUntil = addDays(input.endDate, -1);
    expect(codes(input)).toEqual(expect.arrayContaining(["COMPENSATION_REQUIRED", "POLICY_PENDING", "POLICY_VALIDITY"]));
  });

  it("keeps missing drafts editable while preventing publication", () => {
    const input = fixture();
    input.employees = [];
    input.shifts = [];
    input.assignments = [];
    input.demands = [];
    input.policy.source = "";
    input.policy.reviewedBy = "";
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(validateEscala(input).valid).toBe(true);
    expect(validateEscala(input).readyToPublish).toBe(false);
  });

  it("distinguishes missing assignments from an approved roster", () => {
    const input = fixture();
    input.assignments.pop();
    expect(codes(input)).toContain("DAY_PENDING");
    expect(validateEscala(input).readyToPublish).toBe(false);
  });

  it("checks closed dates, authorized holiday work, and holiday rest separately", () => {
    const input = fixture();
    input.policy.holidayDates = [input.startDate];
    expect(codes(input)).toContain("HOLIDAY_WORK");
    input.policy.authorizedHolidayDates = [input.startDate];
    expect(codes(input)).not.toContain("HOLIDAY_WORK");
    input.policy.closedDates = [input.startDate];
    expect(codes(input)).toContain("CLOSED_DATE");
    input.policy.holidayDates = [input.endDate];
    input.policy.authorizedHolidayDates = [];
    input.policy.holidayRestAllowed = false;
    expect(codes(input)).toContain("HOLIDAY_REST");
  });

  it("accepts overnight offsets structurally but blocks unreviewed night rules and occupied off days", () => {
    const input = fixture(40);
    input.demands = [];
    input.shifts[0].segments = [{ start: 1320, end: 1560, kind: "WORK" }, { start: 1560, end: 1620, kind: "BREAK" }, { start: 1620, end: 1860, kind: "WORK" }];
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(codes(input)).toEqual(expect.arrayContaining(["NIGHT_RULE_PENDING", "OFF_OCCUPIED"]));
    input.policy.nightWorkReviewed = true;
    expect(codes(input)).not.toContain("NIGHT_RULE_PENDING");
    expect(codes(input)).toContain("NIGHT_CREDIT_PENDING");
    expect(validateEscala(input).readyToPublish).toBe(false);
  });

  it("checks Sunday-night history that still occupies a closed Monday", () => {
    const input = fixture(40);
    input.shifts.push({ id: "night", name: "Noturno", segments: [{ start: 1320, end: 1560, kind: "WORK" }, { start: 1560, end: 1620, kind: "BREAK" }, { start: 1620, end: 1860, kind: "WORK" }] });
    input.employees[0].history[input.employees[0].history.length - 1] = { employeeId: "person-1", date: addDays(input.startDate, -1), kind: "WORK", shiftId: "night" };
    input.policy.closedDates = [input.startDate];
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "CLOSED_DATE", date: input.startDate }));
  });

  it("does not certify an empty active workforce or require history before a long-ended contract", () => {
    const input = fixture();
    input.employees[0].activeUntil = "2025-12-31";
    input.employees[0].historyKnown = false;
    input.employees[0].history = [];
    input.assignments = [];
    input.demands = [];
    const result = validateEscala(input);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ACTIVE_EMPLOYEES_PENDING" }));
    expect(result.issues.map((issue) => issue.code)).not.toContain("HISTORY_UNVERIFIED");
    expect(result.readyToPublish).toBe(false);
  });

  it("checks Sunday work by occupied civil dates, not only reference dates", () => {
    const input = fixture(40);
    input.demands = [];
    input.employees[0].maxConsecutiveSundays = 1;
    input.shifts.push({ id: "night", name: "Noturno", segments: [{ start: 1320, end: 1560, kind: "WORK" }, { start: 1560, end: 1620, kind: "BREAK" }, { start: 1620, end: 1860, kind: "WORK" }] });
    input.employees[0].shiftIds.push("night");
    input.employees[0].history[input.employees[0].history.length - 2] = { employeeId: "person-1", date: addDays(input.startDate, -2), kind: "WORK", shiftId: "night" };
    input.assignments[5] = { employeeId: "person-1", date: addDays(input.startDate, 5), kind: "WORK", shiftId: "night" };
    expect(codes(input)).toContain("SUNDAY_ROTATION");
  });

  it("detects insufficient intershift rest after an authorized shift change", () => {
    const input = fixture(40);
    input.shifts.push({ id: "late", name: "Tarde", segments: [{ start: 900, end: 1140, kind: "WORK" }, { start: 1140, end: 1200, kind: "BREAK" }, { start: 1200, end: 1440, kind: "WORK" }] });
    input.employees[0].shiftIds.push("late");
    input.assignments[0].shiftId = "late";
    expect(codes(input)).toContain("INTER_SHIFT_REST");
  });

  it("requires actual adjacency for consecutive off days", () => {
    const input = fixture(40);
    input.employees[0].offPattern = "CONSECUTIVE";
    input.demands = [];
    input.assignments[5] = { employeeId: "person-1", date: addDays(input.startDate, 5), kind: "WORK", shiftId: "day" };
    input.assignments[2] = { employeeId: "person-1", date: addDays(input.startDate, 2), kind: "OFF" };
    expect(codes(input)).toContain("CONSECUTIVE_OFF");
    expect(codes(input)).toContain("CONSECUTIVE_PENDING");
  });
  it("keeps a stale scenario technically inspectable but pending regeneration before approval", () => {
    const input = { ...fixture(), needsRegeneration: true };
    const result = validateEscala(input);
    expect(result.valid).toBe(true);
    expect(result.readyToPublish).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "SCENARIO_OUTDATED", severity: "PENDING" }));
    expect(validateEscala({ ...input, needsRegeneration: false }).issues.some(issue => issue.code === "SCENARIO_OUTDATED")).toBe(false);
  });

});
