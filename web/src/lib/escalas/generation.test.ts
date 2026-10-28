import { describe, expect, it } from "vitest";
import { EscalaError } from "./access";
import { dateRange } from "./dates";
import { prepareGeneration } from "./generation";
import { prepareRoster } from "./preparation";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";

function input(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "08", branchName: "Filial de teste", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "", validFrom: "2026-01-01", validUntil: "2028-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44,
      dailyLimitMinutes: 600, compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60,
      maxConsecutiveWorkDays: 6, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
    employees: [{ id: "p1", registration: "0001", name: "Pessoa de teste", sector: "Setor", role: "Cargo", weeklyHours: 42, shiftIds: ["source"], activeFrom: "",
      planningEnabled: true, scheduleMode: "TIMED", sourceSchedule: { report: "FPRE136", code: "0026", description: "Referência", weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00" },
      offMode: "MIXED", fixedOffDays: [2], offPattern: "PREFER_CONSECUTIVE", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [3], historyKnown: false, history: [] }],
    shifts: [{ id: "source", name: "Referência original", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 980, kind: "WORK" }] }],
    demands: [], assignments: [],
  };
}

const minutes = (value: EscalaInput, id: string) => value.shifts.find((shift) => shift.id === id)?.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);

describe("whole-branch generation preparation", () => {
  it("adapts an imported 6x1 reference and supplies provisional coverage without approving any rule", () => {
    const value = input(); const original = structuredClone(value);
    const prepared = prepareGeneration(value);
    expect(prepared.preparation).toMatchObject({ adjustedEmployeeIds: ["p1"], excludedEmployeeIds: [], includedEmployees: 1, untimedEmployees: 0 });
    expect(prepared.preparation.generatedCoverageSlots).toBeGreaterThan(0);
    expect(prepared.input.employees[0].shiftIds.map((id) => minutes(prepared.input, id))).toEqual([504]);
    expect(prepared.input.shifts[0].segments[0].start).toBe(420);
    expect(prepared.input.policy).toEqual({ ...value.policy, coverageReview: "SUGGESTED" });
    expect(prepared.input.employees[0]).toMatchObject({ offMode: "MIXED", fixedOffDays: [2], offPattern: "PREFER_CONSECUTIVE", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [3], historyKnown: false });
    expect(escalaInputSchema.safeParse(prepared.input).success).toBe(true);
    expect(value).toEqual(original);
  });

  it("honors an explicitly selected shorter branch target without increasing a shorter contract", () => {
    const value = input(); value.defaultWeeklyHours = 40; value.employees[0].weeklyHoursMode = "BRANCH";
    const prepared = prepareGeneration(value).input;
    expect(prepared.employees[0].weeklyHours).toBe(40);
    expect(prepared.employees[0].shiftIds.every((id) => minutes(prepared, id) === 480)).toBe(true);
    prepared.defaultWeeklyHours = 44;
    prepared.employees[0].weeklyHoursMode = "INDIVIDUAL";
    expect(prepareGeneration(prepared).input.employees[0].weeklyHours).toBe(40);
  });
  it("preserves the selected start-preserving shift proposal instead of restoring every alternative", () => {
    const selected = prepareRoster(input(), 42, "EXCLUDE", "PRESERVE_START");
    expect(selected.employees[0].shiftIds).toHaveLength(1);
    const prepared = prepareGeneration(selected);
    expect(prepared.preparation.adjustedEmployeeIds).toEqual([]);
    expect(prepared.input.employees[0].shiftIds).toEqual(selected.employees[0].shiftIds);
    expect(prepared.input.shifts).toEqual(selected.shifts);
  });

  it("keeps a late reference included by preserving departure when extending it would enter the night period", () => {
    const value = input();
    const original = value.employees[0].sourceSchedule;
    if (!original) throw new Error("Missing fixture reference");
    value.employees[0].sourceSchedule = { ...original, weekday: "12:10-16:10 / 18:10-21:30" };
    value.shifts[0].segments = [{ start: 730, end: 970, kind: "WORK" }, { start: 970, end: 1090, kind: "BREAK" }, { start: 1090, end: 1290, kind: "WORK" }];
    const prepared = prepareGeneration(value);
    const selected = prepared.input.shifts.find((shift) => shift.id === prepared.input.employees[0].shiftIds[0]);
    expect(prepared.preparation.excludedEmployeeIds).toEqual([]);
    expect(selected?.segments[0].start).toBe(666);
    expect(selected?.segments.at(-1)?.end).toBe(1290);
    expect(minutes(prepared.input, selected?.id ?? "")).toBe(504);
  });

  it("respects the dated ceiling without rewriting the contract reference or approving transition terms", () => {
    const value = input(); value.startDate = "2028-01-03"; value.endDate = "2028-01-09";
    const prepared = prepareGeneration(value).input;
    expect(prepared.employees[0].weeklyHours).toBe(42);
    expect(prepared.employees[0].shiftIds.every((id) => minutes(prepared, id) === 480)).toBe(true);
    expect(prepared.policy.compensationAuthorized).toBe(false);
    expect(prepared.policy.transitionWeekAccepted).toBeUndefined();
  });

  it("does not reinclude excluded people, invent manager hours or alter custom distributions", () => {
    const value = input();
    value.employees[0].planningEnabled = false;
    value.employees.push({ ...structuredClone(value.employees[0]), id: "manager", registration: "0002", planningEnabled: true, scheduleMode: "UNTIMED", shiftIds: [] });
    value.employees.push({ ...structuredClone(value.employees[0]), id: "custom", registration: "0003", planningEnabled: true, sourceSchedule: undefined });
    const prepared = prepareGeneration(value);
    expect(prepared.input.employees).toEqual(value.employees);
    expect(prepared.preparation).toMatchObject({ adjustedEmployeeIds: [], excludedEmployeeIds: [], includedEmployees: 2, untimedEmployees: 1 });
    expect(prepared.input.employees[1].shiftIds).toEqual([]);
  });

  it("lists an unsafe short imported journey as an exception instead of expanding its hours", () => {
    const value = input(); const source = value.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência de teste ausente");
    value.employees[0].sourceSchedule = { ...source, weekday: "07:00-11:00" };
    value.shifts[0].segments = [{ start: 420, end: 660, kind: "WORK" }];
    const prepared = prepareGeneration(value);
    expect(prepared.preparation.excludedEmployeeIds).toEqual(["p1"]);
    expect(prepared.input.employees[0]).toMatchObject({ planningEnabled: false, planningExclusionReason: "Jornada curta: não ampliada automaticamente", weeklyHours: 42 });
    expect(prepared.preparation.includedEmployees).toBe(0);
    expect(prepared.input.employees).toHaveLength(1);
  });

  it("preserves locked work, its exact shift definition, absences and actual history during adaptation", () => {
    const value = input();
    value.assignments = [{ employeeId: "p1", date: value.startDate, kind: "WORK", shiftId: "source", locked: true },
      { employeeId: "p1", date: "2026-10-27", kind: "ABSENCE" }, { employeeId: "p1", date: "2026-10-28", kind: "WORK", shiftId: "source" }];
    value.employees[0].history = [{ employeeId: "p1", date: "2026-10-25", kind: "WORK", shiftId: "source" }];
    const prepared = prepareGeneration(value).input;
    expect(prepared.assignments).toEqual(value.assignments.slice(0, 2));
    expect(prepared.employees[0].shiftIds).toContain("source");
    expect(prepared.shifts.find((shift) => shift.id === "source")).toEqual(value.shifts[0]);
    expect(prepared.employees[0].history).toEqual(value.employees[0].history);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
  });

  it.each(["ABSENCE", "OFF"] as const)("does not exclude an incompatible person who has a preserved %s commitment", (kind) => {
    const value = input(); const source = value.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência de teste ausente");
    value.employees[0].sourceSchedule = { ...source, weekday: "07:00-11:00" };
    value.assignments = [{ employeeId: "p1", date: value.startDate, kind, locked: kind === "OFF" }];
    expect(() => prepareGeneration(value)).toThrow(EscalaError);
    expect(() => prepareGeneration(value)).toThrow(/registros foram preservados/);
    expect(value.employees[0].planningEnabled).toBe(true);
  });

  it("keeps confirmed explicit demands unchanged and invalidates coverage review only when adding missing days", () => {
    const value = prepareGeneration(input()).input;
    value.policy.coverageReview = "CONFIRMED";
    const repeated = prepareGeneration(value);
    expect(repeated.preparation.adjustedEmployeeIds).toEqual([]);
    expect(repeated.preparation.generatedCoverageSlots).toBe(0);
    expect(repeated.input.demands).toEqual(value.demands);
    expect(repeated.input.policy.coverageReview).toBe("CONFIRMED");
    value.demands = value.demands.filter((demand) => demand.date === value.startDate);
    const completed = prepareGeneration(value);
    expect(completed.preparation.generatedCoverageSlots).toBeGreaterThan(0);
    expect(completed.input.demands.filter((demand) => demand.date === value.startDate)).toEqual(value.demands.map((demand) => ({ ...demand, estimated: false })));
    expect(completed.input.policy.coverageReview).toBe("SUGGESTED");
  });

  it("keeps a complete custom coverage declaration, including zero minimums, byte-for-byte", () => {
    const value = input(); value.employees[0].sourceSchedule = undefined;
    value.demands = dateRange(value.startDate, value.endDate).map((date) => ({ id: `manual-${date}`, date, sector: "Setor", start: 420, end: 980, minimum: 0 }));
    value.policy.coverageReview = "CONFIRMED";
    expect(prepareGeneration(value).input).toEqual(value);
  });
});
