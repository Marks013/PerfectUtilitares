import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { prepareGeneration } from "./generation";
import { prepareRoster } from "./preparation";
import { generationScenarioBasis } from "./hours-reference";
import { validateEscala } from "./validation";
import { referenceNotices } from "./reference-notices";
import { validateJourney, workJourney } from "./validation-time";
import { escalaInputSchema } from "./schema";
import type { EscalaInput, WeeklyHours } from "./types";

function fixture(branch: string, hours: WeeklyHours, mode: EscalaInput["generationMode"]): EscalaInput {
  const input = newInput(branch, "Synthetic reference", "2026-11", hours);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
  input.generationMode = mode; input.mixed42Sectors = []; input.storeClosingMinutes = 1200;
  input.policy = { ...input.policy, normativeProfile: "CUSTOM", compensationAuthorized: false,
    minMealMinutes: 60, dailyLimitMinutes: 600, limitContinuousWorkBlocks: false,
    calendarMode: "MANUAL", closedDates: [], holidayDates: [], authorizedHolidayDates: [] };
  input.shifts = [
    { id: "six", name: "Original 6h", segments: [{ start: 480, end: 840, kind: "WORK" }] },
    { id: "eight", name: "Original 8h", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] },
  ];
  input.employees = ["six", "eight"].map(id => ({ ...newEmployee(hours, id), id, name: "Synthetic person", registration: id,
    sector: "Loja", role: "Operador", activeFrom: "2020-01-01", weeklyHoursMode: "BRANCH", scheduleMode: "TIMED",
    sourceSchedule: { report: "FPRE136", code: id, description: "Synthetic imported reference",
      weekday: id === "six" ? "08:00-14:00 / 00:00-00:00" : "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00 / 00:00-00:00" } }));
  return input;
}
describe("synthetic 01/10 preparation contracts", () => {
  for (const branch of ["01", "10"]) for (const hours of [42, 44] as const) for (const mode of ["DAYS_AND_HOURS", "HOURS_ONLY"] as const) {
    it(`prepares ${branch}/${hours}/${mode} without fabricating compensation or extending a contiguous block`, () => {
      const input = fixture(branch, hours, mode), original = structuredClone(input);
      const prepared = prepareGeneration(input).input;
      expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
      expect(prepared.policy.compensationAuthorized).toBe(false);
      for (const person of prepared.employees) {
        expect(person.planningEnabled).not.toBe(false);
        expect(person.sourceSchedule).toEqual(input.employees.find(old => old.id === person.id)?.sourceSchedule);
        expect(person.shiftIds.length).toBeGreaterThan(0);
        for (const id of person.shiftIds) {
          const shift = prepared.shifts.find(candidate => candidate.id === id);
          if (!shift) throw new Error("Missing synthetic prepared shift");
          const paid = shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
          expect(paid).toBe(hours * 12);
          const meal = Math.max(0, ...shift.segments.filter(segment => segment.kind === "BREAK").map(segment => segment.end - segment.start));
          expect(meal).toBeGreaterThanOrEqual(60); expect(meal).toBeLessThanOrEqual(120);
          expect(shift.segments.every(segment => segment.end > segment.start && segment.start >= 0 && segment.end <= 1200)).toBe(true);
          const issues = referenceNotices(validateJourney(prepared, workJourney({ employeeId: person.id, date: prepared.startDate, kind: "WORK", shiftId: id }, shift)));
          expect(issues.filter(issue => issue.severity === "ERROR")).toEqual([]);
          expect(issues).toContainEqual(expect.objectContaining({ code: "COMPENSATION_REQUIRED", severity: "WARNING" }));
        }
      }
      if (mode === "HOURS_ONLY") {
        const ready = { ...prepared, needsRegeneration: false, generationBasis: generationScenarioBasis(prepared) };
        expect(validateEscala(ready).valid).toBe(true);
        expect(ready.assignments).toEqual([]);
      }
      expect(input).toEqual(original);
    });
  }
  it("uses the configured meal minimum and does not overwrite locked originals", () => {
    const input = fixture("01", 42, "HOURS_ONLY"); input.policy.minMealMinutes = 90;
    const prepared = prepareGeneration(input).input;
    for (const id of prepared.employees[0].shiftIds) {
      const shift = prepared.shifts.find(candidate => candidate.id === id);
      expect(shift?.segments.some(segment => segment.kind === "BREAK" && segment.end - segment.start === 90)).toBe(true);
    }
    input.assignments = [{ employeeId: "six", date: input.startDate, kind: "WORK", shiftId: "six", locked: true }];
    const original = structuredClone(input);
    expect(() => prepareRoster(input, 42)).toThrow(/bloqueados/);
    expect(input).toEqual(original);
  });
});
