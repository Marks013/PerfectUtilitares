import { describe, it, expect } from "vitest";
import { isRestPlanningExcludedRole, applyRestEligibility, isShortFpre136Schedule } from "./eligibility";
import type { EscalaEmployee } from "./types";

describe("company-confirmed learner exclusion", () => {
  it.each(["AUX. DE SERVIÇOS EM SUPER", "aux de servicos em super", "JOVEM APRENDIZ", "APRENDIZ"])("excludes only the explicit role %s", role => {
    expect(isRestPlanningExcludedRole(role)).toBe(true);
  });
  it.each(["AUX. DE SERVIÇOS GERAIS", "ENC. DE SERVIÇOS", "GERENTE", "AUX DE SERVICOS EM SUPERMERCADO II"])("does not infer exclusion for %s", role => {
    expect(isRestPlanningExcludedRole(role)).toBe(false);
  });
  it("retains source clocks and personal data while explaining the exclusion", () => {
    const person = { id: "test", name: "Test", role: "AUX. DE SERVIÇOS EM SUPER", planningEnabled: true, sourceSchedule: { weekday: "08:00-12:00" } } as EscalaEmployee;
    const before = JSON.stringify(person);
    expect(applyRestEligibility(person)).toEqual(expect.objectContaining({ id: "test", planningEnabled: false, sourceSchedule: person.sourceSchedule }));
    expect(JSON.stringify(person)).toBe(before);
  });
});

describe("principal imported journey exclusion through six hours", () => {
  function person(weekday: string): EscalaEmployee {
    return { id: "test", registration: "test", name: "Pessoa sintética", role: "Operador", sector: "Loja", weeklyHours: 42,
      shiftIds: ["manual"], activeFrom: "2020-01-01", planningEnabled: true, scheduleMode: "TIMED",
      sourceSchedule: { report: "FPRE136", code: "test", description: "Referência", weekday, saturday: "08:00-12:00 / 00:00-00:00" },
      offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] };
  }
  it.each(["07:00-11:00 / 00:00-00:00", "07:00-10:00 / 12:00-14:50", "07:00-10:00 / 11:00-14:00", "07:00-13:00 / 00:00-00:00"])("excludes principal %s without changing the source or options", weekday => {
    const input = person(weekday), before = structuredClone(input);
    expect(isShortFpre136Schedule(input)).toBe(true);
    expect(applyRestEligibility(input)).toEqual({ ...before, planningEnabled: false,
      planningExclusionReason: "Jornada principal importada de até 6h, inclusive: fora da geração, sem ampliar horários. Cadastro e registros protegidos permanecem guardados." });
    expect(input).toEqual(before);
  });
  it.each(["07:00-10:00 / 11:00-14:01", "08:00-12:00 / 13:00-17:00"])("does not exclude principal %s because its Saturday is shorter", weekday => {
    const input = person(weekday);
    expect(isShortFpre136Schedule(input)).toBe(false);
    expect(applyRestEligibility(input)).toBe(input);
  });
  it.each([undefined, "UNTIMED", "MISSING"] as const)("does not measure zero clocks as a short principal journey with mode %s", scheduleMode => {
    const input = { ...person("00:00-00:00 / 00:00-00:00"), scheduleMode };
    expect(isShortFpre136Schedule(input)).toBe(false);
    expect(applyRestEligibility(input)).toBe(input);
  });
  it("does not infer this import exclusion from a manual clock", () => {
    const input = person("07:00-13:00 / 00:00-00:00"); input.sourceSchedule = undefined;
    expect(isShortFpre136Schedule(input)).toBe(false);
    expect(applyRestEligibility(input)).toBe(input);
  });
});
