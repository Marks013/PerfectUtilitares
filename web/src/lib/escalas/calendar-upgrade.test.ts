import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { preserveCalendarSourceContext, sundayCalendarDraft } from "./calendar-upgrade";
import { dateRange, visibleDates, weekStart } from "./dates";
import { generationScenarioBasis } from "./hours-reference";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";

function legacy(): EscalaInput {
  const input = newInput("06", "Filial sintética", "2026-12", 42);
  const person = { ...newEmployee(42, input.shifts[0].id), id: "e1", registration: "1", name: "Pessoa sintética", activeFrom: "2020-01-01" };
  return { ...input, planningWeekStartsOn: "MONDAY", startDate: "2026-11-30", endDate: "2027-01-03", employees: [person],
    assignments: dateRange("2026-11-30", "2027-01-03").map(date => ({ employeeId: "e1", date, kind: "OFF" as const })) };
}
const origin = { workspaceId: "source", revision: 7 };

describe("explicit Sunday calendar upgrade", () => {
  it("creates a Sunday draft without moving any shared date or changing the source", () => {
    const source = legacy(), before = structuredClone(source);
    const draft = sundayCalendarDraft(source, origin);
    expect(source).toEqual(before);
    expect(draft).toMatchObject({ planningWeekStartsOn: "SUNDAY", startDate: "2026-11-29", endDate: "2027-01-02", visibleMonth: "2026-12", planningCalendarSource: origin, needsRegeneration: true });
    expect(draft.assignments).toEqual(source.assignments.filter(day => day.date <= "2027-01-02"));
    expect(visibleDates(draft)).toEqual(dateRange("2026-12-01", "2026-12-31"));
    expect(escalaInputSchema.safeParse(draft).success).toBe(true);
    expect(weekStart("2026-12-13", draft)).toBe("2026-12-13");
    expect(weekStart("2026-12-12", draft)).toBe("2026-12-06");
  });

  it.each(["OFF", "ABSENCE", "HOLIDAY"] as const)("preserves an outer protected %s as dated continuity, not the previous week's rest", kind => {
    const source = legacy();
    source.assignments[source.assignments.length - 1] = { employeeId: "e1", date: "2027-01-03", kind, ...(kind === "OFF" ? { locked: true } : {}) };
    const draft = sundayCalendarDraft(source, origin);
    expect(draft.assignments.some(day => day.date === "2027-01-03")).toBe(false);
    expect(draft.employees[0].planningFuture).toEqual([{ employeeId: "e1", date: "2027-01-03", kind, locked: true }]);
    expect(escalaInputSchema.safeParse(draft).success).toBe(true);
    const untrusted = { ...draft, employees: draft.employees.map(person => ({ ...person, planningFuture: [] })) };
    const restored = preserveCalendarSourceContext(draft, untrusted);
    expect(restored.employees[0].planningFuture).toEqual(draft.employees[0].planningFuture);
    expect(() => preserveCalendarSourceContext(draft, { ...untrusted, employees: [] })).toThrow(/pessoa removida/);
  });

  it("moves a known boundary date into the new horizon without inventing attendance", () => {
    const source = legacy();
    source.employees[0].history = [{ employeeId: "e1", date: "2026-11-29", kind: "DUTY" }];
    const draft = sundayCalendarDraft(source, origin);
    expect(draft.assignments.find(day => day.date === "2026-11-29")).toEqual({ employeeId: "e1", date: "2026-11-29", kind: "DUTY", locked: true });
    expect(draft.employees[0].history).toEqual([]);
    expect(source.employees[0].history).toHaveLength(1);
  });

  it("reports conflicting actual and planning decisions instead of picking one", () => {
    const source = legacy();
    source.employees[0].history = [{ employeeId: "e1", date: "2026-11-29", kind: "DUTY" }];
    source.employees[0].planningHistory = [{ employeeId: "e1", date: "2026-11-29", kind: "OFF" }];
    expect(() => sundayCalendarDraft(source, origin)).toThrow(/continuidade diverge/);
  });

  it("preserves absence metadata as Monday and rejects malformed or misaligned metadata", () => {
    const source = legacy(); delete source.planningWeekStartsOn;
    const parsed = escalaInputSchema.parse(source);
    expect(parsed.planningWeekStartsOn).toBeUndefined();
    expect(weekStart("2026-12-13", parsed)).toBe("2026-12-07");
    expect(escalaInputSchema.safeParse({ ...source, planningWeekStartsOn: "SUNDAY" }).success).toBe(false);
    expect(escalaInputSchema.safeParse({ ...source, planningWeekStartsOn: null }).success).toBe(false);
    expect(escalaInputSchema.safeParse({ ...source, planningCalendarSource: origin }).success).toBe(false);
    expect(() => sundayCalendarDraft({ ...source, planningWeekStartsOn: "SUNDAY" }, origin)).toThrow(/já usa/);
  });

  it("keeps legacy scenario hashes and separates the explicit new convention", () => {
    const source = legacy(); delete source.planningWeekStartsOn;
    expect(generationScenarioBasis({ ...source, planningWeekStartsOn: "MONDAY" })).toBe(generationScenarioBasis(source));
    expect(generationScenarioBasis({ ...source, planningWeekStartsOn: "SUNDAY" })).not.toBe(generationScenarioBasis(source));
  });

  it("intersects movement priorities with the new horizon and keeps the original intact", () => {
    const source = legacy();
    source.employees[0].sector = "Caixa";
    source.movementPriorities = [
      { startDate: "2026-12-31", endDate: "2027-01-03", sector: "Caixa", level: "HIGH" },
      { startDate: "2027-01-03", endDate: "2027-01-03", level: "LOW" },
    ];
    expect(escalaInputSchema.safeParse(source).success).toBe(true);
    const before = structuredClone(source);
    const draft = sundayCalendarDraft(source, origin);
    expect(draft.movementPriorities).toEqual([
      { startDate: "2026-12-31", endDate: "2027-01-02", sector: "Caixa", level: "HIGH" },
    ]);
    expect(escalaInputSchema.safeParse(draft).success).toBe(true);
    expect(source).toEqual(before);
  });
});
