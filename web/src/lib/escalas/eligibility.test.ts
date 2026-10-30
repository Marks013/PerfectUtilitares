import { describe, it, expect } from "vitest";
import { isRestPlanningExcludedRole, applyRestEligibility } from "./eligibility";
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
