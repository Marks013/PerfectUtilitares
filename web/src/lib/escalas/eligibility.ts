import type { EscalaEmployee } from "./types";
import { fpre136WeekdayMinutes } from "./fpre136-schedule";

/** Explicit business mapping confirmed by the company, not a classification inferred from clock times. */
export function isRestPlanningExcludedRole(role: string): boolean {
  const normalized = role.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return ["AUX DE SERVICOS EM SUPER", "JOVEM APRENDIZ", "APRENDIZ"].includes(normalized);
}

export function applyRestEligibility(person: EscalaEmployee): EscalaEmployee {
  if (person.planningEnabled === false) return person;
  if (isRestPlanningExcludedRole(person.role)) return { ...person, planningEnabled: false,
    planningExclusionReason: "Jovem aprendiz: não participa da escala de folgas. Cadastro e registros protegidos permanecem guardados." };
  return isShortFpre136Schedule(person) ? { ...person, planningEnabled: false,
    planningExclusionReason: "Jornada principal importada inferior a 6h: fora da geração, sem ampliar horários. Cadastro e registros protegidos permanecem guardados." } : person;
}

/** Confirmed business exclusion, not an inferred employment contract. */
export function isShortFpre136Schedule(person: EscalaEmployee): boolean {
  if (person.sourceSchedule?.report !== "FPRE136" || person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING") return false;
  const minutes = fpre136WeekdayMinutes(person.sourceSchedule.weekday);
  return minutes !== null && minutes > 0 && minutes < 360;
}
