import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { proposeAutomaticCoverage } from "./automatic-coverage";
import { prepareGeneration } from "./generation";
import { escalaInputSchema } from "./schema";
import { validateEscala } from "./validation";
import type { EscalaInput } from "./types";

function fixture(): EscalaInput {
  const input = newInput("08", "Referência salva", "2026-11", 40);
  // Legacy snapshots predate the optional automatic calendar; changing clocks must not migrate their staffing basis.
  delete input.policy.calendarMode;
  delete input.visibleMonth;
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; input.simulation = true;
  input.policy.closedDates = [];
  input.employees = ["p1", "p2"].map(id => ({ id, registration: id, name: "Pessoa de teste", sector: "Loja", role: "Repositor", weeklyHours: 40, shiftIds: ["day"], activeFrom: "2020-01-01",
    offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] }));
  input.shifts = [{ id: "day", name: "Base", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] }];
  input.assignments = input.employees.flatMap(person => Array.from({ length: 7 }, (_, index) => ({ employeeId: person.id, date: `2026-11-${String(index + 2).padStart(2, "0")}`,
    kind: index < 5 ? "WORK" as const : "OFF" as const, ...(index < 5 ? { shiftId: "day" } : {}) })));
  input.demands = [{ id: "saved-estimate", date: "2026-11-03", sector: "Loja", role: "Repositor", start: 480, end: 720, minimum: 9, estimated: true }];
  return input;
}

describe("persisted staffing comparison basis", () => {
  it("bootstraps complete valid legacy rosters without silently migrating their saved targets", () => {
    const input = fixture(), before = structuredClone(input);
    expect(validateEscala(input).valid).toBe(true);
    const first = prepareGeneration(input).input;
    expect(first.demands).toBe(input.demands);
    expect(first.coverageBasis).toMatch(/^coverage-v1:[a-f0-9]{16}$/);
    const second = prepareGeneration(first).input;
    expect(second.demands).toBe(first.demands); expect(second.coverageBasis).toBe(first.coverageBasis);
    expect(validateEscala(second).issues).toContainEqual(expect.objectContaining({ code: "SATURDAY_REST_FORBIDDEN", severity: "ERROR" }));
    expect(validateEscala(second).valid).toBe(false); // Retaining a target never approves an incompatible Saturday roster.
    expect(escalaInputSchema.safeParse(second).success).toBe(true);
    expect(input).toEqual(before);
  });
  it("preserves the same ruler after weekday swaps, extra allowed shifts and JSONB property ordering", () => {
    const raw = fixture();
    raw.assignments = raw.assignments.map(day => day.date === "2026-11-05" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" as const }
      : day.date === "2026-11-07" ? { ...day, kind: "WORK" as const, shiftId: "day" } : day);
    const input = prepareGeneration(raw).input, changed = structuredClone(input);
    changed.shifts.push({ id: "alternative", name: "Alternativa", segments: [{ start: 540, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" }, { start: 840, end: 1080, kind: "WORK" }] });
    changed.employees[0].shiftIds.push("alternative");
    changed.shifts[0].segments = changed.shifts[0].segments.map(({ start, end, kind }) => ({ end, kind, start }));
    changed.assignments = changed.assignments.map(assignment => assignment.employeeId === "p1" && assignment.date === "2026-11-02" ? { employeeId: "p1", date: assignment.date, kind: "OFF" }
      : assignment.employeeId === "p1" && assignment.date === "2026-11-05" ? { employeeId: "p1", date: assignment.date, kind: "WORK", shiftId: "day" } : assignment);
    expect(validateEscala(changed).valid).toBe(true);
    const regenerated = prepareGeneration(changed).input;
    expect(regenerated.coverageBasis).toBe(input.coverageBasis);
    expect(regenerated.demands).toEqual(input.demands);
    expect(proposeAutomaticCoverage(changed).demands).toEqual(input.demands);
  });
  it.each(["hours", "team", "absence", "clock", "fixed-off", "closed", "manual"])("refreshes estimates when a real input changes: %s", reason => {
    const input = prepareGeneration(fixture()).input, changed = structuredClone(input);
    if (reason === "hours") { changed.defaultWeeklyHours = 42; changed.employees.forEach(person => { person.weeklyHours = 42; }); changed.shifts[0].segments[2].end = 1044; }
    if (reason === "team") changed.employees.push({ ...changed.employees[0], id: "p3", registration: "p3" });
    if (reason === "absence") changed.assignments = changed.assignments.map(assignment => assignment.employeeId === "p1" && assignment.date === "2026-11-03" ? { employeeId: "p1", date: assignment.date, kind: "ABSENCE" } : assignment);
    if (reason === "clock") changed.shifts[0].segments = changed.shifts[0].segments.map(segment => ({ ...segment, start: segment.start + 30, end: segment.end + 30 }));
    if (reason === "fixed-off") { changed.employees[0].offMode = "MIXED"; changed.employees[0].fixedOffDays = [6]; }
    if (reason === "closed") changed.policy.closedDates = ["2026-11-08"];
    if (reason === "manual") changed.demands.push({ id: "explicit", date: "2026-11-03", sector: "Loja", start: 480, end: 600, minimum: 0, estimated: false });
    const regenerated = prepareGeneration(changed).input;
    expect(regenerated.coverageBasis).not.toBe(input.coverageBasis);
    expect(regenerated.demands.some(demand => demand.id === "saved-estimate")).toBe(false);
    if (reason === "manual") expect(regenerated.demands.find(demand => demand.id === "explicit")).toEqual(changed.demands.at(-1));
  });
  it("refreshes explicitly stale, incomplete or invalid legacy rosters instead of blessing their old estimates", () => {
    for (const reason of ["stale", "incomplete", "invalid"] as const) {
      const input = fixture();
      if (reason === "stale") input.needsRegeneration = true;
      if (reason === "incomplete") input.assignments = input.assignments.slice(1);
      if (reason === "invalid") input.employees[0].weeklyHours = 42;
      expect(prepareGeneration(input).input.demands.some(demand => demand.id === "saved-estimate")).toBe(false);
    }
    const saved = prepareGeneration(fixture()).input;
    const refreshed = prepareGeneration({ ...saved, needsRegeneration: true }).input;
    expect(refreshed.demands.some(demand => demand.id === "saved-estimate")).toBe(false);
  });
  it("marks newly calculated estimates and preserves them through the next complete generation", () => {
    const input = fixture(); input.demands = [];
    const calculated = proposeAutomaticCoverage(input);
    expect(calculated.coverageBasis).toMatch(/^coverage-v1:[a-f0-9]{16}$/);
    expect(prepareGeneration(calculated).input.demands).toBe(calculated.demands);
  });
});
