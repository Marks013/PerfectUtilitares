import { describe, expect, it } from "vitest";
import type { EscalaInput } from "../types";
import { escalaInputSchema } from "../schema";
import { prepareGeneration } from "../generation";
import { prepareRoster } from "../preparation";
import { generationScenarioBasis } from "../hours-reference";
import { manualAssignmentIssues, manualShiftIssues, materializeManualShiftOverrides, withManualShiftOverride } from "./manual-override";

function fixture(hours: 42 | 44 = 42): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "01", branchName: "Synthetic", startDate: "2026-11-02", endDate: "2026-11-08",
    generationMode: "HOURS_ONLY", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo", storeClosingMinutes: 1080,
    policy: { source: "", reviewed: false, reviewedBy: "", validFrom: "2026-01-01", validUntil: "2027-12-31", weeklyLimit: 44,
      dailyLimitMinutes: 528, compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100,
      minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
    employees: [{ id: "e", registration: "001", name: "Synthetic", sector: "A", role: "Repositor", weeklyHours: hours, weeklyHoursMode: "BRANCH", planningEnabled: true,
      scheduleMode: "TIMED", activeFrom: "", shiftIds: ["source"], offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1,
      preferredOffDays: [], historyKnown: false, history: [], sourceSchedule: { report: "FPRE136", code: "X", description: "Original CSV", weekday: hours === 44 ? "07:00-11:00 / 13:00-17:48" : "07:00-11:00 / 13:00-17:24", saturday: "07:00-11:00" } }],
    shifts: [{ id: "source", name: "Original", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: hours === 44 ? 1068 : 1044, kind: "WORK" }] }],
    demands: [], assignments: [],
  };
}
const choice = { catalogCode: 1500, shiftId: "catalog-1500", markings: ["08:00", "12:00", "13:00", "17:24"] as const, effectiveFrom: "2026-11-03", effectiveUntil: "2026-11-05" };
function selected(hours: 42 | 44 = 42) {
  const value = fixture(hours);
  value.employees[0] = withManualShiftOverride(value.employees[0], choice);
  return materializeManualShiftOverrides(value);
}
describe("dated catalog selection on real-shaped CSV references", () => {
  it.each(["ABSENCE", "HOLIDAY", "OFF"] as const)("does not reject preserved %s for an inadmissible conditional clock", kind => {
    const value = fixture();
    value.employees[0] = withManualShiftOverride(value.employees[0], { ...choice, shiftId: "late-conditional", markings: ["14:00", "18:00", "19:00", "23:00"] });
    value.assignments = ["2026-11-03", "2026-11-04", "2026-11-05"].map(date => ({ employeeId: "e", date, kind, ...(kind === "OFF" ? { locked: true } : {}) }));
    const prepared = materializeManualShiftOverrides(value), original = structuredClone(prepared);
    expect(prepared.employees[0].shiftIds).toEqual(["source"]);
    expect(manualShiftIssues(prepared)).toEqual([]);
    expect(manualAssignmentIssues(prepared)).toEqual([]);
    expect(prepareGeneration(prepared).input.assignments).toEqual(prepared.assignments);
    expect(prepared).toEqual(original);
    const missing = structuredClone(prepared); missing.shifts = missing.shifts.filter(s => s.id !== "late-conditional");
    expect(manualShiftIssues(missing).some(issue => issue.code === "MANUAL_SHIFT_MISSING")).toBe(true);
  });
  it.each([42, 44] as const)("keeps explicit selection through preparation and serialization of a %ih import", hours => {
    const value = selected(hours), original = structuredClone(value);
    const prepared = prepareGeneration(value).input;
    expect(prepared.employees[0].manualShiftByDate).toEqual({ "2026-11-03": "catalog-1500", "2026-11-04": "catalog-1500", "2026-11-05": "catalog-1500" });
    expect(prepared.employees[0].shiftIds).not.toContain("catalog-1500");
    if (hours === 44) expect(prepared.employees[0].fixedImportedShiftId).toBeUndefined();
    expect(prepared.employees[0].sourceSchedule).toEqual(value.employees[0].sourceSchedule);
    expect(prepared.shifts.find(s => s.id === "source")).toEqual(value.shifts.find(s => s.id === "source"));
    expect(prepared.shifts.find(s => s.id === "catalog-1500")).toEqual(value.shifts.find(s => s.id === "catalog-1500"));
    expect(prepared.assignments).toEqual([]);
    const roundtrip = escalaInputSchema.parse(JSON.parse(JSON.stringify(prepared)));
    expect(prepareGeneration(roundtrip).input.employees[0].manualShiftByDate).toEqual(prepared.employees[0].manualShiftByDate);
    expect(prepareRoster(value, 42).employees[0].manualShiftByDate).toEqual(prepared.employees[0].manualShiftByDate);
    expect(value).toEqual(original);
  });
  it("normalizes overlapping updates without extending their dates", () => {
    const person = withManualShiftOverride(selected().employees[0], { ...choice, catalogCode: 1501, shiftId: "catalog-1501", effectiveFrom: "2026-11-04", effectiveUntil: "2026-11-04" });
    expect(person.manualShiftOverrides?.map(c => [c.catalogCode, c.effectiveFrom, c.effectiveUntil])).toEqual([
      [1500, "2026-11-03", "2026-11-03"], [1501, "2026-11-04", "2026-11-04"], [1500, "2026-11-05", "2026-11-05"],
    ]);
  });
  it("invalidates the scenario when only effective dates change", () => {
    const first = selected(), next = structuredClone(first);
    (next.employees[0].manualShiftOverrides as NonNullable<typeof next.employees[0]['manualShiftOverrides']>)[0].effectiveUntil = "2026-11-06";
    expect(generationScenarioBasis(next)).not.toBe(generationScenarioBasis(first));
  });
  it("does not rewrite absence, holiday, off or locked records, or invent attendance", () => {
    const value = selected();
    value.assignments = [
      { employeeId: "e", date: "2026-11-02", kind: "WORK", shiftId: "source", locked: false },
      { employeeId: "e", date: "2026-11-03", kind: "ABSENCE" },
      { employeeId: "e", date: "2026-11-04", kind: "OFF" },
      { employeeId: "e", date: "2026-11-05", kind: "HOLIDAY" },
      { employeeId: "e", date: "2026-11-06", kind: "WORK", shiftId: "source", locked: true },
    ];
    expect(prepareGeneration(value).input.assignments).toEqual(value.assignments);
    expect(manualAssignmentIssues(value)).toEqual([]);
    value.assignments[1] = { employeeId: "e", date: "2026-11-03", kind: "WORK", shiftId: "source", locked: true };
    expect(manualShiftIssues(value).some(i => i.code === "MANUAL_SHIFT_LOCK_CONFLICT")).toBe(true);
  });
  it("rejects wrong work clocks inside and manual-only clocks outside the selected interval", () => {
    const value = selected();
    value.assignments = [{ employeeId: "e", date: "2026-11-03", kind: "WORK", shiftId: "source" }];
    expect(manualAssignmentIssues(value).some(i => i.code === "MANUAL_SHIFT_MISMATCH")).toBe(true);
    value.assignments[0] = { employeeId: "e", date: "2026-11-02", kind: "WORK", shiftId: "catalog-1500" };
    expect(manualAssignmentIssues(value).some(i => i.code === "MANUAL_SHIFT_OUTSIDE_RANGE")).toBe(true);
  });
  it("blocks incompatible hours, meal and closing without editing selected marks", () => {
    const value = selected();
    value.storeClosingMinutes = 1000;
    expect(manualShiftIssues(value).some(i => i.code === "STORE_CLOSING_EXCEEDED")).toBe(true);
    value.storeClosingMinutes = 1080; value.defaultWeeklyHours = 40;
    expect(manualShiftIssues(value).some(i => i.code === "MANUAL_SHIFT_WEEKLY_HOURS")).toBe(true);
    const meal = selected(); meal.policy.minMealMinutes = 90;
    expect(manualShiftIssues(meal).some(i => i.code === "MEAL_INTERVAL")).toBe(true);
  });
  it("rejects malformed, overlapping, out-of-employment and forged derived selections at the boundary", () => {
    const value = selected();
    expect(escalaInputSchema.safeParse(value).success).toBe(true);
    for (const change of [
      (v: EscalaInput) => { (v.employees[0].manualShiftOverrides as NonNullable<typeof v.employees[0]['manualShiftOverrides']>)[0].effectiveFrom = "2026-02-30"; },
      (v: EscalaInput) => { (v.employees[0].manualShiftOverrides as NonNullable<typeof v.employees[0]['manualShiftOverrides']>).push(choice); },
      (v: EscalaInput) => { v.employees[0].activeFrom = "2026-11-04"; },
      (v: EscalaInput) => { (v.employees[0].manualShiftByDate as NonNullable<typeof v.employees[0]['manualShiftByDate']>)["2026-11-02"] = "source"; },
    ]) { const changed = structuredClone(value); change(changed); expect(escalaInputSchema.safeParse(changed).success).toBe(false); }
  });
});
