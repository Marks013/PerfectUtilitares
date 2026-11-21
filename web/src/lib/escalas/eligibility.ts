import type { EscalaEmployee, EscalaInput } from "./types";
import { fpre136WeekdayMinutes } from "./fpre136-schedule";

/** A sector classification, not a deduction from a name, role, clock or absence. */
export function isAdministrativeEscalaSector(sector: string): boolean {
  return sector.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase() === "AFASTADOS";
}

export function isEscalaPlanningParticipant(person: Pick<EscalaEmployee, "sector" | "planningEnabled">): boolean {
  return person.planningEnabled !== false && !isAdministrativeEscalaSector(person.sector);
}

/** Strip administrative inputs only in an operational view; never persist this projection. */
export function operationalEscalaInput(input: EscalaInput): EscalaInput {
  const employees = input.employees.filter(person => !isAdministrativeEscalaSector(person.sector));
  const demands = input.demands.filter(demand => !isAdministrativeEscalaSector(demand.sector));
  const mixed42Sectors = input.mixed42Sectors?.filter(sector => !isAdministrativeEscalaSector(sector));
  const movementPriorities = input.movementPriorities?.filter(priority => priority.sector === undefined || !isAdministrativeEscalaSector(priority.sector));
  if (employees.length === input.employees.length && demands.length === input.demands.length
    && mixed42Sectors?.length === input.mixed42Sectors?.length && movementPriorities?.length === input.movementPriorities?.length) return input;
  const administrativeIds = new Set(input.employees.filter(person => isAdministrativeEscalaSector(person.sector)).map(person => person.id));
  return { ...input, employees, demands,
    ...(mixed42Sectors ? { mixed42Sectors } : {}), ...(movementPriorities ? { movementPriorities } : {}),
    assignments: input.assignments.filter(day => !administrativeIds.has(day.employeeId)) };
}

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
    planningExclusionReason: "Jornada principal importada de até 6h, inclusive: fora da geração, sem ampliar horários. Cadastro e registros protegidos permanecem guardados." } : person;
}

/** Confirmed business exclusion through six paid weekday hours, not an inferred employment contract. */
export function isShortFpre136Schedule(person: EscalaEmployee): boolean {
  if (person.sourceSchedule?.report !== "FPRE136" || person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING") return false;
  const minutes = fpre136WeekdayMinutes(person.sourceSchedule.weekday);
  return minutes !== null && minutes > 0 && minutes <= 360;
}
