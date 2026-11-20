import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { matchesRestOnlyReferences as publicMatchesRestOnlyReferences } from "./generation";
import { matchesRestOnlyReferences, mealMinutes, nightWorkMinutes, paidMinutes, restOnlyReferences } from "./generation-references";
import type { EscalaShift } from "./types";

const early: EscalaShift = { id: "early", name: "Entrada 08:00", segments: [
  { start: 480, end: 720, kind: "WORK" },
  { start: 720, end: 780, kind: "BREAK" },
  { start: 780, end: 1044, kind: "WORK" },
] };
const late: EscalaShift = { id: "late", name: "Entrada 09:00", segments: [
  { start: 540, end: 780, kind: "WORK" },
  { start: 780, end: 840, kind: "BREAK" },
  { start: 840, end: 1104, kind: "WORK" },
] };

function scenario() {
  const input = newInput("08", "Unidade sintética", "2026-11", 42);
  input.generationMode = "REST_ONLY";
  input.shifts = [early, late];
  input.employees = [{ ...newEmployee(42, ["early", "late"]), id: "p", name: "Pessoa sintética",
    registration: "0001", sector: "Frente", role: "Caixa", activeFrom: "2025-01-01",
    scheduleMode: "TIMED", planningEnabled: true }];
  input.assignments = [];
  return input;
}

const work = (shiftId: string, date = "2026-11-04") => ({
  employeeId: "p", date, kind: "WORK" as const, shiftId,
});

describe("generation reference helpers: extracted without behavior changes", () => {
  it("preserves civil paid minutes and one uninterrupted unpaid meal", () => {
    expect(paidMinutes(early)).toBe(504);
    expect(mealMinutes(early)).toBe(60);
    expect(paidMinutes(late)).toBe(504);
    expect(mealMinutes(late)).toBe(60);
  });

  it("keeps the prior public REST_ONLY validator export identical to its implementation", () => {
    expect(publicMatchesRestOnlyReferences).toBe(matchesRestOnlyReferences);
  });

  it("rejects an unapproved same-duration clock substitution without mutating a roster", () => {
    const input = scenario();
    const original = structuredClone(input);
    expect(matchesRestOnlyReferences(input, [work("early")])).toBe(true);
    expect(matchesRestOnlyReferences(input, [work("late")])).toBe(false);
    expect(matchesRestOnlyReferences(input, [{ employeeId: "p", date: "2026-11-04", kind: "OFF" }])).toBe(true);
    expect(input).toEqual(original);
  });

  it("keeps the exact preexisting locked clock without granting a substitution on another day", () => {
    const input = scenario();
    input.assignments = [{ ...work("late"), locked: true }];
    expect(matchesRestOnlyReferences(input, [{ ...work("late"), locked: true }])).toBe(true);
    expect(matchesRestOnlyReferences(input, [work("late", "2026-11-05")])).toBe(false);
  });

  it("ranks the source-nearest clock first, preserving manual alternatives and exclusions", () => {
    const input = scenario();
    const person = { ...input.employees[0], shiftIds: ["late", "early"],
      sourceSchedule: { report: "FPRE136" as const, code: "0026", description: "Importação sintética",
        weekday: "08:00-12:00 / 13:00-17:24", saturday: "08:00-12:00" } };
    const original = structuredClone(person);
    const reordered = restOnlyReferences(person, new Map(input.shifts.map(shift => [shift.id, shift])));
    expect(reordered.shiftIds).toEqual(["early", "late"]);
    expect(person).toEqual(original);
    const excluded = { ...person, planningEnabled: false };
    expect(restOnlyReferences(excluded, new Map(input.shifts.map(shift => [shift.id, shift])))).toBe(excluded);
  });

  it("treats missing or incompatible schedules as unavailable instead of inventing night work", () => {
    const input = scenario();
    expect(nightWorkMinutes(input, new Set([504]))).toBe(0);
    expect(nightWorkMinutes(input, new Set([480]))).toBe(Infinity);
    expect(nightWorkMinutes({ ...input, employees: [] }, new Set([504]))).toBe(Infinity);
  });
});
