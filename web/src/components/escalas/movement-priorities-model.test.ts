import { describe, expect, it } from "vitest";
import { escalaInputSchema } from "@/lib/escalas/schema";
import { addMovementSelection, movementRows } from "./movement-priorities-model";
import { newEmployee, newInput } from "./workspace-model";

describe("explicit supermarket movement indications", () => {
  const selection = { startDate: "2026-11-01", endDate: "2026-11-30", sector: "Frente de Caixa", level: "HIGH" as const };
  it("expands selected weekly days without presuming weekends and keeps the production schema", () => {
    const input = newInput("11", "Teste", "2026-11", 42);
    input.employees = [{ ...newEmployee(42), id: "person", registration: "1", name: "Pessoa",
      sector: "Frente de Caixa", role: "Caixa" }];
    const result = addMovementSelection(input, { ...selection, weekdays: [4] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.priorities.map(item => item.startDate)).toEqual(["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
    expect(result.dates).toBe(4);
    expect(result.priorities.every(item => item.startDate === item.endDate && item.sector === "Frente de Caixa")).toBe(true);
    expect(escalaInputSchema.safeParse({ ...input, movementPriorities: result.priorities }).success).toBe(true);
    expect(input.movementPriorities).toBeUndefined();
  });
  it("keeps a known date or continuous period as a single indication", () => {
    const result = addMovementSelection(newInput("11", "Teste", "2026-11", 42), selection);
    expect(result).toEqual({ ok: true, priorities: [selection], dates: 30 });
  });
  it("rejects an empty weekly selection or no matching dates without adding data", () => {
    const input = newInput("11", "Teste", "2026-11", 42);
    expect(addMovementSelection(input, { ...selection, weekdays: [] })).toMatchObject({ ok: false });
    expect(addMovementSelection(input, { ...selection, endDate: "2026-11-01", weekdays: [0] })).toMatchObject({ ok: false });
  });
  it("rejects overlaps atomically but allows an explicit sector override of branch information", () => {
    const input = newInput("11", "Teste", "2026-11", 42);
    input.movementPriorities = [{ startDate: "2026-11-06", endDate: "2026-11-06", level: "LOW" }];
    const scoped = addMovementSelection(input, { ...selection, weekdays: [4] });
    expect(scoped.ok).toBe(true);
    input.movementPriorities.push({ ...selection, startDate: "2026-11-13", endDate: "2026-11-13" });
    const before = structuredClone(input);
    expect(addMovementSelection(input, { ...selection, weekdays: [4] })).toMatchObject({ ok: false });
    expect(input).toEqual(before);
  });
  it("validates dates, weekdays and the maximum after expansion", () => {
    const input = newInput("11", "Teste", "2026-11", 42);
    expect(addMovementSelection(input, { ...selection, startDate: "2026-11-31" })).toMatchObject({ ok: false });
    expect(addMovementSelection(input, { ...selection, endDate: "2026-10-01" })).toMatchObject({ ok: false });
    expect(addMovementSelection(input, { ...selection, endDate: "2027-01-01" })).toMatchObject({ ok: false });
    expect(addMovementSelection(input, { ...selection, weekdays: [7] })).toMatchObject({ ok: false });
    input.movementPriorities = Array.from({ length: 247 }, (_, index) => ({ ...selection, sector: `Setor ${index}` }));
    expect(addMovementSelection(input, { ...selection, weekdays: [4] })).toMatchObject({ ok: false });
  });
  it("sorts sectors A–Z, then dates, preserving exact removal indexes and stored order", () => {
    const priorities = [selection, { ...selection, sector: "Açougue" }, { ...selection, sector: "Açougue", startDate: "2026-11-06" }];
    const before = structuredClone(priorities);
    expect(movementRows(priorities).map(row => row.index)).toEqual([1, 2, 0]);
    expect(priorities).toEqual(before);
  });
});
