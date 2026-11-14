import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { buildCoveragePresence, coverageAt, sectorPresenceGaps } from "./coverage-presence";
import { prepareGeneration } from "./generation";
import { assignmentPresentation } from "./presentation";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";

function fixture(): EscalaInput {
  const input = newInput("01", "Filial sintética", "2026-11", 42);
  input.startDate = "2026-11-02";
  input.endDate = "2026-11-08";
  input.visibleMonth = undefined;
  input.generationMode = "REST_ONLY";
  input.employees = [{ id: "legacy", registration: "legacy", name: "Legado sintético", role: "Gerente", sector: "Loja", weeklyHours: 42,
    shiftIds: ["manual"], activeFrom: "2020-01-01", planningEnabled: true,
    sourceSchedule: { report: "FPRE136", code: "zero", description: "Referência antiga", weekday: "00:00-00:00 / 00:00-00:00", saturday: "00:00-00:00 / 00:00-00:00" },
    offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] }];
  input.shifts = [{ id: "manual", name: "Turno antigo", segments: [
    { start: 480, end: 744, kind: "WORK" }, { start: 744, end: 804, kind: "BREAK" }, { start: 804, end: 1044, kind: "WORK" },
  ] }];
  input.assignments = [{ employeeId: "legacy", date: "2026-11-03", kind: "WORK", shiftId: "manual" }];
  input.demands = [{ id: "known", date: "2026-11-03", sector: "Loja", start: 480, end: 540, minimum: 1 }];
  return input;
}

function attendance(input: EscalaInput) {
  return coverageAt(buildCoveragePresence(input), "2026-11-03", "Loja", 500).map(person => person.id);
}

describe("legacy untimed consumption", () => {
  it.each(["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const)("keeps legacy zero-clock ENC out of timed coverage and normalizes only the prepared copy in %s", generationMode => {
    const input = fixture(); input.generationMode = generationMode;
    const before = structuredClone(input);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(assignmentPresentation(input.employees[0], "2026-11-03", input.assignments[0], new Map([["manual", "T1"]])).code).toBe("ENC");
    expect(attendance(input)).toEqual([]);
    const prepared = prepareGeneration(input);
    expect(escalaInputSchema.safeParse(prepared.input).success).toBe(true);
    expect(prepared.input.employees[0]).toMatchObject({ scheduleMode: "UNTIMED", planningEnabled: true, sourceSchedule: before.employees[0].sourceSchedule });
    expect(prepared.preparation.untimedEmployees).toBe(1);
    expect(prepared.input.assignments).toEqual(before.assignments);
    expect(prepared.input.shifts).toEqual(before.shifts);
    expect(attendance(prepared.input)).toEqual([]);
    expect(input).toEqual(before);
    expect(Object.hasOwn(input.employees[0], "scheduleMode")).toBe(false);
  });

  it("preserves an explicit TIMED choice despite zero-clock import provenance", () => {
    const input = fixture(); input.employees[0].scheduleMode = "TIMED";
    const before = structuredClone(input), prepared = prepareGeneration(input);
    expect(assignmentPresentation(input.employees[0], "2026-11-03", input.assignments[0], new Map([["manual", "T1"]])).code).toBe("T1");
    expect(attendance(input)).toEqual(["legacy"]);
    expect(attendance(prepared.input)).toEqual(["legacy"]);
    expect(prepared.input.employees[0].scheduleMode).toBe("TIMED");
    expect(prepared.input.assignments).toEqual(before.assignments);
    expect(prepared.input.shifts).toEqual(before.shifts);
    expect(input).toEqual(before);
  });

  it.each(["UNTIMED", "MISSING"] as const)("preserves explicit %s without fabricating clock attendance", scheduleMode => {
    const input = fixture(); input.employees[0].scheduleMode = scheduleMode;
    if (scheduleMode === "MISSING") input.employees[0].sourceSchedule = undefined;
    const before = structuredClone(input), prepared = prepareGeneration(input);
    expect(attendance(input)).toEqual([]);
    expect(attendance(prepared.input)).toEqual([]);
    expect(prepared.input.employees[0].scheduleMode).toBe(scheduleMode);
    expect(prepared.input.assignments).toEqual(before.assignments);
    expect(prepared.input.shifts).toEqual(before.shifts);
    expect(input).toEqual(before);
  });

  it("does not classify a legacy ENC-only sector as a team missing timed coverage", () => {
    const input = fixture(); input.assignments[0] = { employeeId: "legacy", date: "2026-11-03", kind: "OFF" };
    expect(sectorPresenceGaps(input)).toEqual([]);
  });

  it("preserves locked work and historical clocks without counting them as ENC coverage", () => {
    const input = fixture(); input.assignments[0].locked = true;
    input.employees[0].history = [{ employeeId: "legacy", date: "2026-11-02", kind: "WORK", shiftId: "manual", locked: true }];
    const before = structuredClone(input), prepared = prepareGeneration(input).input;
    expect(prepared.employees[0].scheduleMode).toBe("UNTIMED");
    expect(prepared.assignments).toEqual(before.assignments);
    expect(prepared.employees[0].history).toEqual(before.employees[0].history);
    expect(prepared.shifts).toEqual(before.shifts);
    expect(attendance(prepared)).toEqual([]);
    expect(input).toEqual(before);
  });

  it("preserves OFF, ABSENCE and HOLIDAY locks without inventing WORK or shifts", () => {
    const input = fixture(); input.policy.closedDates = ["2026-11-05"];
    input.assignments = [
      { employeeId: "legacy", date: "2026-11-03", kind: "OFF", locked: true },
      { employeeId: "legacy", date: "2026-11-04", kind: "ABSENCE", locked: true },
      { employeeId: "legacy", date: "2026-11-05", kind: "HOLIDAY", locked: true },
    ];
    const before = structuredClone(input), prepared = prepareGeneration(input).input;
    expect(prepared.assignments).toEqual(before.assignments);
    expect(prepared.shifts).toEqual(before.shifts);
    expect(attendance(prepared)).toEqual([]);
    expect(input).toEqual(before);
  });

  it("retains an explicit exclusion and its reason", () => {
    const input = fixture(); input.employees[0].planningEnabled = false;
    input.employees[0].planningExclusionReason = "Decisão manual";
    const before = structuredClone(input), prepared = prepareGeneration(input).input;
    expect(prepared.employees[0]).toMatchObject({ planningEnabled: false, planningExclusionReason: "Decisão manual" });
    expect(attendance(prepared)).toEqual([]);
    expect(input).toEqual(before);
  });
});
