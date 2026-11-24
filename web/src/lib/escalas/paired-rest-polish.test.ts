import { describe, expect, it } from "vitest";
import { newEmployee } from "../../components/escalas/workspace-model";
import { newLegacyInput } from "./legacy-calendar-test-fixture";
import { polishEqualClockRestPairs } from "./paired-rest-polish";
import { restPairSummary } from "./rest-quality";
import { refineRoster } from "./roster-refinement";
import { validateEscala } from "./validation";
import type { EscalaInput } from "./types";

function fixture(untimed = false): EscalaInput {
  const input = newLegacyInput("06", "Teste", "2026-12", 42);
  Object.assign(input, {
    startDate: "2026-12-01", endDate: "2026-12-31", planningWeekStartsOn: "SUNDAY",
    visibleMonth: "2026-12", generationMode: "DAYS_AND_HOURS", restRulesVersion: 3, simulation: true,
  });
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" },
    { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.employees = ["a", "b", "c", "d"].map((id, index) => ({
    ...newEmployee(42, untimed ? undefined : "day"), id, registration: id, name: id,
    activeFrom: "2026-12-01", activeUntil: "2026-12-05", sector: "Loja", role: index < 2 ? "Caixa" : "Repositor",
    scheduleMode: untimed ? "UNTIMED" : "TIMED",
  }));
  input.assignments = input.employees.flatMap((employee, index) => [1, 2, 3, 4, 5].map(day => {
    const off = (index % 2 ? [1, 4] : [2, 3]).includes(day);
    return { employeeId: employee.id, date: `2026-12-0${day}`,
      kind: off ? "OFF" as const : untimed ? "DUTY" as const : "WORK" as const,
      locked: ![1, 2].includes(day), ...(!off && !untimed ? { shiftId: "day" } : {}) };
  }));
  return input;
}

function presence(input: EscalaInput) {
  const roles = new Map(input.employees.map(person => [person.id, person.role]));
  return input.assignments.filter(day => day.kind === "WORK" || day.kind === "DUTY")
    .map(day => [day.date, roles.get(day.employeeId), day.kind, day.shiftId].join("|")).sort();
}

describe("December equal-coverage folga spacing", () => {
  it.each([false, true])("removes two independent pairs, keeping exact presence for untimed=%s", untimed => {
    const input = fixture(untimed), original = structuredClone(input);
    expect(validateEscala(input).valid).toBe(true);
    const result = refineRoster(input);
    expect(restPairSummary(input).adjustablePairs).toBe(2);
    expect(restPairSummary(result).adjustablePairs).toBe(0);
    expect(presence(result)).toEqual(presence(input));
    expect(result.assignments.filter(day => day.locked)).toEqual(input.assignments.filter(day => day.locked));
    expect(validateEscala(result).valid).toBe(true);
    expect(input).toEqual(original);
  });
  it("does not exchange employees with incompatible real clock geometry", () => {
    const input = fixture();
    input.shifts.push({ ...input.shifts[0], id: "late", segments: input.shifts[0].segments
      .map(segment => ({ ...segment, start: segment.start + 30, end: segment.end + 30 })) });
    input.employees.filter((_, index) => index % 2).forEach(person => { person.shiftIds = ["late"]; });
    input.assignments.filter(day => day.kind === "WORK" && ["b", "d"].includes(day.employeeId))
      .forEach(day => { day.shiftId = "late"; });
    expect(polishEqualClockRestPairs(input, validateEscala(input), performance.now() + 1000)).toBe(input);
  });
  it("does not modify clock-only drafts, or exchange locked colleagues", () => {
    const input = fixture();
    const locked = structuredClone(input);
    locked.assignments.filter(day => ["b", "d"].includes(day.employeeId)).forEach(day => { day.locked = true; });
    expect(polishEqualClockRestPairs(locked, validateEscala(locked), performance.now() + 1000)).toBe(locked);
    input.generationMode = "HOURS_ONLY";
    expect(polishEqualClockRestPairs(input, validateEscala(input), performance.now() + 1000)).toBe(input);
  });
});
