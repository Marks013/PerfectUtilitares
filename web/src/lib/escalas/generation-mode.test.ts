import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { matchesRestOnlyReferences, prepareGeneration } from "./generation";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";
import { preservePublishedDays, publishedPlanningContext } from "./continuity";
import { usesMixed42Week } from "./labor-rules";

function fixture(): EscalaInput {
  const input = newInput("08", "Loja", "2026-11", 42);
  input.employees = [{ ...newEmployee(42, "late"), id: "p1", registration: "01", name: "Pessoa", sector: "Caixa",
    role: "Operador", scheduleMode: "TIMED", shiftIds: ["late", "early"] }];
  input.shifts = [
    { id: "late", name: "Manual tarde", segments: [{ start: 540, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }] },
    { id: "early", name: "Manual manhã", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] },
  ];
  input.assignments = [];
  input.demands = [];
  return input;
}

describe("REST_ONLY generation references", () => {
  it("keeps ordinary search as the default and accepts exactly the three supported modes", () => {
    const input = fixture(), before = structuredClone(input);
    expect(prepareGeneration(input).input.employees[0].shiftIds).toEqual(["late", "early"]);
    expect(escalaInputSchema.safeParse({ ...input, generationMode: "HOURS_ONLY" }).success).toBe(true);
    expect(escalaInputSchema.safeParse({ ...input, generationMode: "REST_ONLY" }).success).toBe(true);
    expect(escalaInputSchema.safeParse({ ...input, generationMode: "DAYS_AND_HOURS" }).success).toBe(true);
    expect(escalaInputSchema.safeParse({ ...input, generationMode: "UNKNOWN_MODE" }).success).toBe(false);
    expect(input).toEqual(before);
  });

  it("prioritizes imported clock references without deleting manual options when the mode changes", () => {
    const input = fixture();
    input.generationMode = "REST_ONLY";
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "1", description: "Referência",
      weekday: "08:00-12:00 / 13:00-17:24", saturday: "08:00-12:00" };
    const before = structuredClone(input);
    const rest = prepareGeneration(input).input;
    expect(rest.employees[0].shiftIds).toEqual(["early", "late"]);
    expect(rest.shifts).toEqual(input.shifts);
    const saved = escalaInputSchema.parse(JSON.parse(JSON.stringify(rest)));
    const complete = prepareGeneration({ ...saved, generationMode: "DAYS_AND_HOURS" }).input;
    expect(new Set(complete.employees[0].shiftIds)).toEqual(new Set(input.employees[0].shiftIds));
    expect(complete.shifts).toEqual(input.shifts);
    expect(input).toEqual(before);
  });

  it("uses explicit option order without an imported reference, allowing other clocks only on their locked dates", () => {
    const input = fixture(); input.generationMode = "REST_ONLY";
    input.assignments = [
      { employeeId: "p1", date: "2026-11-02", kind: "WORK", shiftId: "early", locked: true },
      { employeeId: "p1", date: "2026-11-03", kind: "WORK", shiftId: "late", locked: true },
      { employeeId: "p1", date: "2026-11-04", kind: "ABSENCE", locked: true },
    ];
    const prepared = prepareGeneration(input).input;
    expect(prepared.assignments).toEqual(input.assignments);
    expect(prepared.employees[0].shiftIds).toEqual(["late", "early"]);
    expect(matchesRestOnlyReferences(prepared, [...prepared.assignments,
      { employeeId: "p1", date: "2026-11-05", kind: "WORK", shiftId: "late" }])).toBe(true);
    expect(matchesRestOnlyReferences(prepared, [...prepared.assignments,
      { employeeId: "p1", date: "2026-11-05", kind: "WORK", shiftId: "early" }])).toBe(false);
    expect(matchesRestOnlyReferences({ ...prepared, generationMode: "DAYS_AND_HOURS" },
      [{ employeeId: "p1", date: "2026-11-05", kind: "WORK", shiftId: "early" }])).toBe(true);
  });

  it("retains separate 8h and 9h references for the 42h mixed weekly distribution", () => {
    const input = fixture(); input.generationMode = "REST_ONLY"; input.mixed42Sectors = ["Caixa"];
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "1", description: "Referência",
      weekday: "08:00-12:00 / 13:00-17:24", saturday: "08:00-12:00" };
    const prepared = prepareGeneration(input).input;
    const minutes = (id: string) => prepared.shifts.find(shift => shift.id === id)?.segments
      .reduce((total, part) => total + (part.kind === "BREAK" ? 0 : part.end - part.start), 0);
    expect(prepared.defaultWeeklyHours).toBe(42);
    expect(prepared.employees[0].weeklyHours).toBe(42);
    expect(prepared.employees[0].shiftIds.slice(0, 2).map(minutes).sort()).toEqual([480, 540]);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
  });

  it("keeps adjacent published clocks out of free-day references and shared published days as locked exceptions", () => {
    const input = fixture(); input.generationMode = "REST_ONLY";
    const prepared = prepareGeneration(input).input;
    const peer = structuredClone(prepared);
    peer.shifts = [{ ...peer.shifts[0], id: "published",
      segments: peer.shifts[0].segments.map(part => ({ ...part, start: part.start + 15, end: part.end + 15 })) }];
    peer.employees[0].shiftIds = ["published"];
    peer.assignments = [{ employeeId: "p1", date: "2026-10-25", kind: "WORK", shiftId: "published" }];
    const adjacent = publishedPlanningContext(prepared, [peer]);
    expect(adjacent.employees[0].shiftIds).toEqual(prepared.employees[0].shiftIds);
    expect(adjacent.employees[0].planningHistory?.[0].shiftId).toMatch(/^plan-/);
    peer.assignments[0].date = prepared.startDate;
    const shared = preservePublishedDays(prepared, [peer]);
    const lock = shared.assignments[0];
    expect(lock.locked).toBe(true);
    expect(shared.employees[0].shiftIds.slice(0, 2)).toEqual(prepared.employees[0].shiftIds);
    expect(matchesRestOnlyReferences(shared, [lock])).toBe(true);
    expect(matchesRestOnlyReferences(shared, [{ ...lock, date: "2026-11-02", locked: false }])).toBe(false);
  });

  it("keeps 480/540 references across the 42h to 40h transition without extending mixed eligibility", () => {
    const input = fixture();
    input.generationMode = "REST_ONLY"; input.mixed42Sectors = ["Caixa"];
    input.startDate = "2027-12-06"; input.endDate = "2027-12-19";
    delete input.visibleMonth;
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "1", description: "Referência",
      weekday: "08:00-12:00 / 13:00-17:24", saturday: "08:00-12:00" };
    const prepared = prepareGeneration(input).input;
    expect(usesMixed42Week(prepared, prepared.employees[0], "2027-12-06")).toBe(true);
    expect(usesMixed42Week(prepared, prepared.employees[0], "2027-12-13")).toBe(false);
    const durations = prepared.employees[0].shiftIds.slice(0, 2).map(id => prepared.shifts.find(s => s.id === id)?.segments
      .reduce((sum, part) => sum + (part.kind === "BREAK" ? 0 : part.end - part.start), 0));
    expect(durations.sort()).toEqual([480, 540]);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
  });

});
