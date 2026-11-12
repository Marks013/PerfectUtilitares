import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { movementLevel, keepsPriorityLeader } from "./movement";
import { escalaInputSchema } from "./schema";

describe("explicit movement priority", () => {
  it("uses sector overrides without assuming weekend or other peaks", () => {
    const input = newInput("06", "Teste", "2026-11", 42);
    expect(movementLevel(input, "Caixa", "2026-11-07")).toBeUndefined();
    input.movementPriorities = [
      { startDate: "2026-11-01", endDate: "2026-11-30", level: "HIGH" },
      { startDate: "2026-11-07", endDate: "2026-11-07", sector: "Caixa", level: "LOW" },
    ];
    expect(movementLevel(input, "Caixa", "2026-11-07")).toBe("LOW");
    expect(movementLevel(input, "Padaria", "2026-11-07")).toBe("HIGH");
    input.movementPriorities.push({ startDate: "2026-11-07", endDate: "2026-11-07", sector: "Caixa", level: "NORMAL" });
    expect(movementLevel(input, "Caixa", "2026-11-07")).toBe("NORMAL");
  });
  it("rejects nonexistent sectors instead of silently ignoring a spelling error", () => {
    const input = newInput("06", "Teste", "2026-11", 42);
    input.employees = [{ ...newEmployee(42), id: "person", registration: "1", name: "Pessoa", sector: "Caixa", role: "Caixa" }];
    input.movementPriorities = [{ startDate: "2026-11-07", endDate: "2026-11-07", sector: "Caixaa", level: "HIGH" }];
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
    input.movementPriorities[0].sector = "Caixa";
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
  });
  it("keeps the only sector leader on an explicitly important day, not an untimed hourly substitute", () => {
    const input = newInput("06", "Teste", "2026-11", 42);
    const person = { ...newEmployee(42), id: "leader", sector: "Caixa", role: "Encarregado", scheduleMode: "UNTIMED" as const };
    input.employees = [person];
    input.movementPriorities = [{ startDate: "2026-11-07", endDate: "2026-11-07", sector: "Caixa", level: "HIGH" }];
    expect(keepsPriorityLeader(input, person, "2026-11-07")).toBe(false);
    expect(keepsPriorityLeader(input, person, "2026-11-06")).toBe(true);
    input.employees.push({ ...person, id: "peer" });
    input.assignments.push({ employeeId: "peer", date: "2026-11-07", kind: "DUTY" });
    expect(keepsPriorityLeader(input, person, "2026-11-07")).toBe(true);
  });
});
