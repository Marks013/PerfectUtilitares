import { describe, expect, it } from "vitest";
import { inferLeadership } from "./leadership";
import { escalaInputSchema } from "./schema";
import { newEmployee, newInput, scenarioDefinitionChanged } from "@/components/escalas/workspace-model";

describe("operational leadership and explicit movement", () => {
  it("infers sector responsibility but does not make managers substitutes", () => {
    expect(inferLeadership({ role: "ENC. DE AÇOUGUE", sector: "Açougue" })).toEqual({ role: "SECTOR", source: "INFERRED", sectors: ["Açougue"] });
    expect(inferLeadership({ role: "Encarregada de caixa", sector: "Caixa" })?.sectors).toEqual(["Caixa"]);
    expect(inferLeadership({ role: "GERENTE", sector: "Administrativo" })).toEqual({ role: "BRANCH", source: "INFERRED", sectors: [] });
    expect(inferLeadership({ role: "Operador", sector: "Caixa" })).toBeUndefined();
  });
  it("preserves legacy records without requiring new metadata", () => {
    const input = newInput("02", "Filial sintética", "2026-11", 42);
    const parsed = escalaInputSchema.parse(input);
    expect(parsed.movementPriorities).toBeUndefined();
    expect(parsed.employees).toEqual([]);
  });
  it("accepts optional responsibility and movement and invalidates an existing scenario", () => {
    const input = newInput("02", "Filial sintética", "2026-11", 42);
    input.employees = [{ ...newEmployee(42), id: "person", registration: "001", name: "Pessoa", sector: "Caixa", role: "Encarregado", scheduleMode: "UNTIMED",
      leadership: { role: "SECTOR", source: "MANUAL", sectors: ["Caixa"] } }];
    const next = { ...input, movementPriorities: [{ startDate: "2026-11-10", endDate: "2026-11-11", sector: "Caixa", level: "HIGH" as const }] };
    expect(escalaInputSchema.safeParse(next).success).toBe(true);
    expect(scenarioDefinitionChanged(input, next)).toBe(true);
    expect(input.movementPriorities).toBeUndefined();
    expect(escalaInputSchema.safeParse({ ...next, movementPriorities: [{ ...next.movementPriorities[0], startDate: "2027-01-01", endDate: "2027-01-02" }] }).success).toBe(false);
  });
  it("rejects duplicated responsibilities and invented leadership classifications", () => {
    const input = newInput("02", "Filial sintética", "2026-11", 42);
    input.employees = [{ ...newEmployee(42), id: "person", registration: "001", name: "Pessoa", sector: "Caixa", role: "Encarregado", leadership: { role: "SECTOR", source: "MANUAL", sectors: ["Caixa", "Caixa"] } }];
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
    expect(escalaInputSchema.safeParse({ ...input, employees: [{ ...input.employees[0], leadership: { role: "LEGAL", source: "AUTO", sectors: [] } }] }).success).toBe(false);
  });
});
