import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { weeklyCapacityCaveat, weeklyCapacityText, weeklySectorCapacity } from "./weekly-capacity";
import type { WeeklyHours } from "./types";

function fixture(hours: WeeklyHours = 42, month = "2026-11") {
  const input = newInput("08", "Loja", month, hours);
  input.employees = Array.from({ length: 10 }, (_, index) => ({ ...newEmployee(hours, input.shifts[0].id), id: `p${index}`,
    registration: String(index), name: `Pessoa ${index}`, sector: "Caixa", role: "Operador", scheduleMode: "TIMED" as const, weeklyHoursMode: "BRANCH" as const }));
  return input;
}

describe("nominal weekly sector capacity", () => {
  it.each([[44, 440, 0, 10], [42, 420, 20, 440 / 42], [40, 400, 40, 11]] as const)("compares ten colleagues at %ih without inventing operating demand", (hours, currentHours, missingHours, equivalentPeople) => {
    const input = fixture(hours), before = structuredClone(input), [row] = weeklySectorCapacity(input);
    expect(row).toMatchObject({ people: 10, referenceHours: 440, hours42: 420, hours40: 400, currentHours, currentHoursMax: currentHours, missingHours });
    expect(row.equivalentPeople).toBeCloseTo(equivalentPeople);
    expect(row.additionalEquivalentPeople).toBeCloseTo(missingHours / hours);
    expect(input).toEqual(before);
    expect(weeklyCapacityCaveat).toContain("Não comprova cobertura nem indica contratação");
  });
  it("preserves individual contracts below the scenario instead of raising them to a hypothetical 44h", () => {
    const input = fixture(); input.employees = input.employees.slice(0, 2);
    input.employees[0].weeklyHoursMode = "INDIVIDUAL";
    input.employees[0].weeklyHours = 40;
    const [row] = weeklySectorCapacity(input);
    expect(row).toMatchObject({ people: 2, referenceHours: 84, hours42: 82, hours40: 80, currentHours: 82, missingHours: 2 });
    expect(row.equivalentPeople).toBe(2);
    expect(row.additionalEquivalentPeople).toBeCloseTo(2 / 42);
  });
  it("excludes apprentices, disabled and inactive people and keeps untimed and short references outside the hours total", () => {
    const input = fixture();
    input.employees[0].role = "AUX. DE SERVIÇOS EM SUPER";
    input.employees[1].planningEnabled = false;
    input.employees[2].activeFrom = "2027-01-01";
    input.employees[3].activeUntil = "2026-09-30";
    input.employees[4].scheduleMode = "UNTIMED";
    input.employees[5].scheduleMode = "MISSING";
    input.employees[6].simulationDailyMinutes = 350;
    input.employees[7].shiftIds = [];
    expect(weeklySectorCapacity(input)[0]).toMatchObject({ people: 2, untimedPeople: 3, shortReferencePeople: 1, referenceHours: 88, currentHours: 84 });
    expect(weeklyCapacityText(weeklySectorCapacity(input)[0])).toContain("Fora desta conta");
  });
  it("labels the result as nominal even when all active colleagues are absent for the visible period", () => {
    const input = fixture(); input.assignments = input.employees.map(person => ({ employeeId: person.id, date: "2026-11-02", kind: "ABSENCE" }));
    expect(weeklySectorCapacity(input)[0]).toMatchObject({ people: 10, currentHours: 420 });
    expect(weeklyCapacityCaveat).toContain("antes de afastamentos, feriados e disponibilidade no mês");
  });
  it("uses actual effective current hours across a transition without representing the reference as legally permitted work", () => {
    const [row] = weeklySectorCapacity(fixture(44, "2026-12"));
    expect(row).toMatchObject({ referenceHours: 440, currentHours: 420, currentHoursMax: 440, scenarioWeeklyHours: 42 });
    expect(weeklyCapacityText(row)).toContain("Atual: 420–440h/semana");
  });
  it("orders sectors alphabetically with numeric and accented names without mutating the roster", () => {
    const input = fixture(); input.employees = input.employees.slice(0, 4);
    ["Zeladoria", "Loja 10", "Açougue", "Loja 2"].forEach((sector, index) => { input.employees[index].sector = sector; });
    expect(weeklySectorCapacity(input).map(row => row.sector)).toEqual(["Açougue", "Loja 2", "Loja 10", "Zeladoria"]);
  });
  it("handles empty workforces and missing timed references without fractional infinities or fake full-time capacity", () => {
    const input = fixture(); input.employees = [];
    expect(weeklySectorCapacity(input)).toEqual([]);
    input.employees = [{ ...newEmployee(42, "missing"), id: "p", sector: "Caixa", role: "Operador", scheduleMode: "MISSING" }];
    const [row] = weeklySectorCapacity(input);
    expect(row).toMatchObject({ people: 0, untimedPeople: 1, referenceHours: 0, equivalentPeople: 0, additionalEquivalentPeople: 0 });
    expect(weeklyCapacityText(row)).toContain("não apurada");
    expect(weeklyCapacityText(row)).not.toMatch(/NaN|Infinity/);
  });
  it("formats 10.48 as people equivalents rather than hours", () => {
    const text = weeklyCapacityText(weeklySectorCapacity(fixture())[0]);
    expect(text).toContain("10,48 pessoas (+0,48 equivalente)");
    expect(text).not.toContain("10,48h");
  });
});
