import { describe, expect, it } from "vitest";
import { addDays, dateRange, dayOfWeek, visibleDates } from "./dates";
import { escalaInputSchema } from "./schema";
import { validateEscala } from "./validation";
import { planningWeeklyHours } from "./preparation";
import { prepareGeneration } from "./generation";
import type { EscalaInput } from "./types";

function input(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "08", branchName: "Filial sintética", visibleMonth: "2026-11",
    startDate: "2026-10-26", endDate: "2026-12-06", defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
    policy: { source: "", reviewed: false, reviewedBy: "", validFrom: "2026-01-01", validUntil: "2027-12-31",
      weeklyLimit: 44, dailyLimitMinutes: 528, compensationAuthorized: false, minInterShiftMinutes: 660,
      minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [],
      holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
    employees: [{ id: "e", registration: "001", name: "Pessoa sintética", sector: "Loja", role: "Encarregado",
      weeklyHours: 40, shiftIds: [], scheduleMode: "MISSING", activeFrom: "", offMode: "VARIABLE", fixedOffDays: [],
      offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] }],
    shifts: [], demands: [], assignments: [],
  };
}

describe("civil month and honest missing schedules", () => {
  it("preserves explicit individual exceptions when a branch target changes", () => {
    const person = { ...input().employees[0], weeklyHours: 44 as const, weeklyHoursMode: "INDIVIDUAL" as const };
    expect(planningWeeklyHours(person, 44, 40)).toEqual({ weeklyHours: 44, weeklyHoursMode: "INDIVIDUAL" });
    expect(planningWeeklyHours({ ...person, weeklyHours: 40 }, 40, 42)).toEqual({ weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL" });
  });
  it.each([["2027-02", 28], ["2028-02", 29], ["2026-11", 30], ["2026-12", 31]] as const)("shows only %s with %i days", (month, count) => {
    const first = month + "-01";
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    const value = { ...input(), visibleMonth: month, startDate: addDays(first, -dayOfWeek(first)), endDate: addDays(last, 6 - dayOfWeek(last)) };
    expect(escalaInputSchema.safeParse(value).success).toBe(true);
    expect(visibleDates(value)).toEqual(dateRange(first, last));
    expect(visibleDates(value)).toHaveLength(count);
  });
  it("keeps outer-month coverage failures out of the monthly margin without hiding errors", () => {
    const value = input();
    value.demands = [{ id: "outside", sector: "Loja", date: "2026-10-26", start: 480, end: 720, minimum: 2 },
      { id: "inside", sector: "Loja", date: "2026-11-01", start: 480, end: 720, minimum: 0 }];
    const validation = validateEscala(value);
    expect(validation.minimumCoverageMargin).toBe(0);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_DEFICIT", date: "2026-10-26" }));
  });
  it("rejects a visible month not completely contained in its technical weeks", () => {
    expect(escalaInputSchema.safeParse({ ...input(), visibleMonth: "2026-12" }).success).toBe(false);
    expect(escalaInputSchema.safeParse({ ...input(), visibleMonth: "2026-13" }).success).toBe(false);
  });
  it("preserves legacy weekly inputs without pretending they are monthly", () => {
    const value = { startDate: "2026-10-26", endDate: "2026-11-01" };
    expect(visibleDates(value)).toEqual(dateRange(value.startDate, value.endDate));
  });
  it("keeps missing clocks in presence planning without inventing a shift or verifying hours", () => {
    const value = input();
    const prepared = prepareGeneration(value);
    expect(prepared.input.employees[0]).toMatchObject({ scheduleMode: "MISSING", shiftIds: [] });
    expect(prepared.preparation.includedEmployees).toBe(1);
    expect(prepared.input.shifts).toEqual([]);
    expect(prepared.input.demands).toEqual([]);
    value.assignments = dateRange(value.startDate, value.endDate).map(date => ({ employeeId: "e", date, kind: dayOfWeek(date) < 5 ? "DUTY" : "OFF" }));
    const validation = validateEscala(value);
    expect(validation.valid).toBe(true);
    expect(validation.readyToPublish).toBe(false);
    expect(validation.issues.some(issue => issue.code === "MISSING_SCHEDULE")).toBe(true);
    expect(validation.issues.some(issue => issue.code === "SCHEDULE_MODE" || issue.code === "EMPLOYEE_SHIFT_PENDING")).toBe(false);
    expect(validation.summaries[0]).toMatchObject({ workedMinutes: 0, workDays: 21, offDays: 9, sundaysWorked: 0 });
  });
  it("validates technical continuity even when the error lies outside the visible month", () => {
    const value = input();
    value.assignments = dateRange(value.startDate, value.endDate).map(date => ({ employeeId: "e", date, kind: date <= "2026-11-02" ? "DUTY" : "OFF" }));
    const validation = validateEscala(value);
    expect(validation.issues.some(issue => issue.code === "WORK_STREAK" && issue.date === "2026-11-01")).toBe(true);
    expect(validation.valid).toBe(false);
  });
});
