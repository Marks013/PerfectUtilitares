import { describe, expect, it } from "vitest";
import { prepareGeneration } from "./generation";
import { prepareRoster } from "./preparation";
import { escalaInputSchema } from "./schema";
import { storeClosingLabel, storeClosingMinutes } from "./store-hours";
import type { EscalaInput } from "./types";

function fixture(branchCode = "08"): EscalaInput {
  return {
    schemaVersion: 1, branchCode, branchName: "Loja de teste", startDate: "2026-11-02", endDate: "2026-11-08", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo", simulation: true, generationMode: "DAYS_AND_HOURS",
    policy: { source: "", reviewed: false, reviewedBy: "", validFrom: "2026-01-01", validUntil: "2028-12-31", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, limitContinuousWorkBlocks: true, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
    employees: [{ id: "p", registration: "1", name: "Teste", sector: "Caixa", role: "Operador", weeklyHours: 42, weeklyHoursMode: "BRANCH", shiftIds: ["original"], scheduleMode: "TIMED", planningEnabled: true, activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [], historyKnown: false, history: [], sourceSchedule: { report: "FPRE136", code: "1", description: "Original", weekday: "12:50-16:50 / 18:50-22:10", saturday: "12:50-16:50" } }],
    shifts: [{ id: "original", name: "Original", segments: [{ start: 770, end: 1010, kind: "WORK" }, { start: 1010, end: 1130, kind: "BREAK" }, { start: 1130, end: 1330, kind: "WORK" }] }], assignments: [], demands: [],
  };
}
const options = (input: EscalaInput) => input.shifts.filter(shift => input.employees[0].shiftIds.includes(shift.id));
const paid = (shift: EscalaInput["shifts"][number]) => shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);

describe("store closing for automatic proposals", () => {
  it.each(["02", "06", "07", "08", "11", "16"])("defaults branch %s to 20:00", branch => {
    expect(storeClosingMinutes(fixture(branch))).toBe(1200);
    expect(storeClosingLabel(fixture(branch))).toBe("20:00");
  });
  it.each(["18", "018", "0018"])("defaults branch %s to 22:00", branch => expect(storeClosingMinutes(fixture(branch))).toBe(1320));
  it("accepts a saved override and validates its minute precision and range", () => {
    const input = { ...fixture(), storeClosingMinutes: 1230 };
    expect(storeClosingLabel(input)).toBe("20:30");
    expect(escalaInputSchema.parse(input).storeClosingMinutes).toBe(1230);
    for (const value of [0, -1, 1441, 1200.5]) expect(escalaInputSchema.safeParse({ ...input, storeClosingMinutes: value }).success).toBe(false);
    expect(storeClosingLabel({ ...input, storeClosingMinutes: 1440 })).toBe("00:00");
  });
  it.each([["08", 1200], ["18", 1320]] as const)("fits ordinary and flex proposals in branch %s without losing work or meals", (branch, closing) => {
    const input = fixture(branch), before = structuredClone(input);
    const prepared = prepareGeneration(input).input;
    expect(options(prepared).length).toBeGreaterThan(0);
    for (const shift of options(prepared)) {
      expect(shift.segments.at(-1)?.end).toBeLessThanOrEqual(closing);
      expect(paid(shift)).toBe(504);
      const meal = shift.segments.find(segment => segment.kind === "BREAK");
      expect(meal ? meal.end - meal.start : 0).toBe(120);
    }
    expect(prepared.employees[0].sourceSchedule).toEqual(input.employees[0].sourceSchedule);
    expect(input).toEqual(before);
    expect(prepareGeneration(prepared).input).toEqual(prepared);
  });
  it("fits mixed 8h/9h proposals and preserves the fixed three-hour meal", () => {
    const input = fixture(); input.mixed42Sectors = ["Caixa"];
    const result = prepareGeneration(input).input;
    expect(new Set(options(result).map(paid))).toEqual(new Set([480, 540]));
    expect(options(result).every(shift => (shift.segments.at(-1)?.end ?? Infinity) <= 1200)).toBe(true);
    expect(options(result).filter(shift => paid(shift) === 540).every(shift => shift.segments[1].end - shift.segments[1].start === 180)).toBe(true);
  });
  it("readapts saved proposals when closing changes, preserving absences and original history", () => {
    const original = fixture("18"), saved = prepareGeneration(original).input;
    saved.assignments = [{ employeeId: "p", date: saved.startDate, kind: "ABSENCE", locked: true }];
    const changed = prepareGeneration({ ...saved, storeClosingMinutes: 1200 }).input;
    expect(options(changed).every(shift => (shift.segments.at(-1)?.end ?? Infinity) <= 1200)).toBe(true);
    expect(changed.assignments).toEqual(saved.assignments);
    expect(changed.employees[0].sourceSchedule).toEqual(original.employees[0].sourceSchedule);
    expect(changed.coverageBasis).not.toBe(saved.coverageBasis);
  });
  it("explains a locked closing conflict without changing or reusing the locked clock", () => {
    const input = fixture();
    input.assignments = [{ employeeId: "p", date: input.startDate, kind: "WORK", shiftId: "original", locked: true }];
    const before = structuredClone(input);
    expect(() => prepareGeneration(input)).toThrow("Há um dia bloqueado com saída após 20:00");
    expect(input).toEqual(before);
  });
  it("invalidates coverage when an explicit closing changes without moving a compatible clock", () => {
    const saved = prepareGeneration(fixture()).input;
    const changed = prepareGeneration({ ...saved, storeClosingMinutes: 1260 }).input;
    expect(changed.coverageBasis).not.toBe(saved.coverageBasis);
  });
  it("supports explicit schedule adaptation with the same closing limit", () => {
    const result = prepareRoster(fixture(), 42, "EXCLUDE", "PRESERVE_END");
    expect(options(result).every(shift => (shift.segments.at(-1)?.end ?? Infinity) <= 1200)).toBe(true);
  });
});
