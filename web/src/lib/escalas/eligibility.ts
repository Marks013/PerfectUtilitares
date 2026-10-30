import type { EscalaEmployee } from "./types";

/** Explicit business mapping confirmed by the company, not a classification inferred from clock times. */
export function isRestPlanningExcludedRole(role: string): boolean {
  const normalized = role.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return ["AUX DE SERVICOS EM SUPER", "JOVEM APRENDIZ", "APRENDIZ"].includes(normalized);
}

export function applyRestEligibility(person: EscalaEmployee): EscalaEmployee {
  return isRestPlanningExcludedRole(person.role) ? { ...person, planningEnabled: false,
    planningExclusionReason: "Jovem aprendiz: não participa da escala de folgas. Cadastro e registros protegidos permanecem guardados." } : person;
}
