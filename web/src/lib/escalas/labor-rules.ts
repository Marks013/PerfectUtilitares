import { addDays, isDate, weekStart } from "./dates";
import type { EscalaEmployee, EscalaInput, EscalaPolicy, WeeklyHours } from "./types";

/** Operational invariant of this project's 5x2 planning model, not a general legal conclusion. */
const MAX_CONSECUTIVE_WORK_DAYS = 5;

export function effectiveWorkDayLimit(policy: Pick<EscalaPolicy, "maxConsecutiveWorkDays">): number {
  return Math.min(MAX_CONSECUTIVE_WORK_DAYS, policy.maxConsecutiveWorkDays);
}

/** The four-hour threshold concerns a short-journey pause, never a daily or continuous-work cap. */
export function minimumMealMinutes(policy: Pick<EscalaPolicy, "minMealMinutes" | "allowShortMealSimulation">, paidMinutes: number, simulation = false): number {
  if (paidMinutes > 360) return policy.minMealMinutes;
  if (paidMinutes <= 240) return 0;
  return simulation && policy.allowShortMealSimulation === true ? 0 : 15;
}

// EC 141/2026, arts. 6 and 7. Saved policies cannot raise these ceilings.
export const TRANSITION_42_DATE = "2026-12-16";
export const TRANSITION_40_DATE = "2027-12-16";
export const SUPERMARKET_CCT = "SINDECOMU_SUPERMARKETS_2026_2027";
export const CCT_FROM = "2026-06-01";
export const CCT_UNTIL = "2027-05-31";

export function legalWeeklyHours(day: string): WeeklyHours {
  return day < TRANSITION_42_DATE ? 44 : day < TRANSITION_40_DATE ? 42 : 40;
}

/** Conservative whole-week proposal; transition weeks require explicit acceptance. */
export function effectiveWeeklyHours(person: Pick<EscalaEmployee, "weeklyHours">, start: string): WeeklyHours {
  return Math.min(person.weeklyHours, legalWeeklyHours(addDays(weekStart(start), 6))) as WeeklyHours;
}

/** Civil-minute target for a support scenario; a short reference is not a verified contract. */
export function effectiveWeeklyMinutes(person: Pick<EscalaEmployee, "weeklyHours" | "simulationDailyMinutes">, start: string): number {
  return Math.min(effectiveWeeklyHours(person, start) * 60, person.simulationDailyMinutes === undefined ? Infinity : person.simulationDailyMinutes * 5);
}

export function transitionWeeks(input: Pick<EscalaInput, "startDate" | "endDate">): string[] {
  return [TRANSITION_42_DATE, TRANSITION_40_DATE]
    .filter((day) => day >= input.startDate && day <= input.endDate && weekStart(day) !== day)
    .map(weekStart);
}

export function effectiveSundayLimit(person: EscalaEmployee): 1 | 2 {
  return Math.min(person.maxConsecutiveSundays, person.sundayRestRule === "COMMERCE" ? 2 : 1) as 1 | 2;
}

/** Operational daily distribution in this five-day regime; overtime is not modeled. */
export function dailyMinuteCeiling(day: string): number {
  return day < TRANSITION_42_DATE ? 600 : day < TRANSITION_40_DATE ? 504 : 480;
}

export function collectiveExtensionAuthorized(policy: EscalaPolicy, day: string): boolean {
  if (!policy.compensationAuthorized) return false;
  if (day < TRANSITION_42_DATE) return true;
  if (day >= TRANSITION_40_DATE) return false;
  const agreement = policy.collectiveAgreement;
  return Boolean(agreement?.reviewed && agreement.source.trim() && agreement.reviewedBy.trim()
    && isDate(agreement.validFrom) && isDate(agreement.validUntil) && agreement.validFrom <= day && agreement.validUntil >= day);
}

export function certificateAuthorizes(policy: EscalaPolicy, day: string, scope: "sundays" | "holidays" | "after20"): boolean {
  if (policy.normativeProfile !== SUPERMARKET_CCT) return true;
  const certificate = policy.operationalCertificate;
  return Boolean(day >= CCT_FROM && day <= CCT_UNTIL && certificate?.reviewed
    && certificate.identifier.trim() && certificate.reviewedBy.trim() && certificate[scope]
    && isDate(certificate.validFrom) && isDate(certificate.validUntil) && certificate.validFrom <= day && certificate.validUntil >= day);
}
