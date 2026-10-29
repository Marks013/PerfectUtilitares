import { describe, expect, it } from "vitest";
import { dateRange, dayOfWeek } from "./dates";
import { prepareGeneration } from "./generation";
import { effectiveWeeklyMinutes } from "./labor-rules";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";
import { validateEscala } from "./validation";

function reference(weekday = "07:00-11:00 / 13:00-16:20"): EscalaInput {
  return { schemaVersion: 1, branchCode: "02", branchName: "Filial teste", startDate: "2026-11-02", endDate: "2026-11-08", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "", validFrom: "2026-01-01", validUntil: "2028-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false,
      minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 6, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
    employees: [{ id: "p1", registration: "0001", name: "Pessoa teste", sector: "Setor", role: "Cargo", weeklyHours: 42, weeklyHoursMode: "BRANCH", shiftIds: ["source"], activeFrom: "", scheduleMode: "TIMED",
      sourceSchedule: { report: "FPRE136", code: "test", description: "Original", weekday, saturday: "07:00-11:00" }, offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [], historyKnown: false, history: [] }],
    shifts: [{ id: "source", name: "Original", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 980, kind: "WORK" }] }], demands: [], assignments: [] };
}
function complete(value: EscalaInput): EscalaInput {
  const person = value.employees[0];
  return { ...value, assignments: dateRange(value.startDate, value.endDate).map(date => ({ employeeId: person.id, date, kind: dayOfWeek(date) < 5 ? "WORK" as const : "OFF" as const, ...(dayOfWeek(date) < 5 ? { shiftId: person.shiftIds[0] } : {}) })) };
}
describe("support simulation without administrative prerequisites", () => {
  it("prepares exact 42h/8h24 and keeps absent authorizations as publication pending, not a broken draft", () => {
    const original = reference(); const snapshot = structuredClone(original);
    const proposal = prepareGeneration(original).input;
    expect(proposal.simulation).toBe(true);
    expect(proposal.policy).toMatchObject({ compensationAuthorized: false, reviewed: false, reviewedBy: "", source: "" });
    expect(proposal.policy.collectiveAgreement).toBeUndefined();
    expect(effectiveWeeklyMinutes(proposal.employees[0], proposal.startDate)).toBe(2520);
    expect(original).toEqual(snapshot);
    const validation = validateEscala(complete(proposal));
    expect(validation.valid).toBe(true);
    expect(validation.readyToPublish).toBe(false);
    expect(validation.issues.some(issue => issue.code === "COMPENSATION_REQUIRED" && issue.severity === "PENDING")).toBe(true);
  });
  it("preserves short imported clocks and participation without inventing a full-time contract", () => {
    const original = reference("07:00-11:00");
    const proposal = prepareGeneration(original);
    expect(proposal.preparation.excludedEmployeeIds).toEqual([]);
    expect(proposal.input.employees[0]).toMatchObject({ planningEnabled: true, weeklyHours: 42, simulationDailyMinutes: 240 });
    expect(effectiveWeeklyMinutes(proposal.input.employees[0], proposal.input.startDate)).toBe(1200);
    const validation = validateEscala(complete(proposal.input));
    expect(validation.valid).toBe(true);
    expect(validation.issues.some(issue => issue.code === "SHORT_REFERENCE_PRESERVED" && issue.severity === "PENDING")).toBe(true);
    expect(proposal.input.employees[0].sourceSchedule).toEqual(original.employees[0].sourceSchedule);
    expect(escalaInputSchema.safeParse(proposal.input).success).toBe(true);
  });
  it("adapts evening and overnight references instead of excluding essential staff", () => {
    for (const source of ["14:00-18:00 / 20:00-23:20", "22:00-02:00 / 03:00-06:20"]) {
      const proposal = prepareGeneration(reference(source));
      expect(proposal.preparation.excludedEmployeeIds, source).toEqual([]);
      expect(proposal.input.employees[0].planningEnabled, source).toBe(true);
      const person = proposal.input.employees[0];
      const shift = proposal.input.shifts.find(item => item.id === person.shiftIds[0]);
      if (!shift) throw new Error("Expected proposed shift is missing");
      expect(shift.segments.filter(item => item.kind !== "BREAK").reduce((sum, item) => sum + item.end - item.start, 0)).toBe(504);
      expect(escalaInputSchema.safeParse(proposal.input).success, source).toBe(true);
    }
  });
  it("keeps malformed data and actual rest violations invalid even for simulation", () => {
    const proposal = complete(prepareGeneration(reference()).input);
    proposal.assignments = dateRange(proposal.startDate, proposal.endDate).map(date => ({ employeeId: "p1", date, kind: "WORK", shiftId: proposal.employees[0].shiftIds[0] }));
    expect(validateEscala(proposal).valid).toBe(false);
    expect(validateEscala({ ...proposal, defaultWeeklyHours: 41 as 42 }).valid).toBe(false);
  });
});
