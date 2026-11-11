import { addDays, isDate, weekStart } from "./dates";
import type { EscalaEmployee, EscalaInput, EscalaPolicy, EscalaShift, WeeklyHours } from "./types";
import reference from "../../../ops/escalas/policy-reference.json" with { type: "json" };

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

/** An unrelated collective agreement never authorizes a longer meal interval implicitly. */
export function maximumMealMinutes(policy: Pick<EscalaPolicy, "mealIntervalAgreement">, day: string): number {
  const agreement = policy.mealIntervalAgreement;
  // The configured operational maximum is independent of documentary completeness.
  // Preserve the date argument for callers and the separate evidence checks.
  void day;
  return agreement && Number.isInteger(agreement.maximumMinutes)
    && agreement.maximumMinutes > reference.mealMinutes.standardMaximum && agreement.maximumMinutes <= reference.mealMinutes.extendedMaximum
    ? agreement.maximumMinutes : reference.mealMinutes.standardMaximum;
}

// EC 141/2026, arts. 6 and 7. Saved policies cannot raise these ceilings.
export const TRANSITION_42_DATE = reference.transition42Date;
export const TRANSITION_40_DATE = reference.transition40Date;
export const SUPERMARKET_CCT = reference.cctProfile as NonNullable<EscalaPolicy["normativeProfile"]>;
export const CCT_FROM = reference.cctFrom;
export const CCT_UNTIL = reference.cctUntil;

export function legalWeeklyHours(day: string): WeeklyHours {
  return (day < TRANSITION_42_DATE ? reference.weeklyHours.before : day < TRANSITION_40_DATE ? reference.weeklyHours.first : reference.weeklyHours.second) as WeeklyHours;
}

/** Conservative whole-week proposal; transition weeks require explicit acceptance. */
export function effectiveWeeklyHours(person: Pick<EscalaEmployee, "weeklyHours">, start: string): WeeklyHours {
  return Math.min(person.weeklyHours, legalWeeklyHours(addDays(weekStart(start), 6))) as WeeklyHours;
}

/** The optional distribution is scoped to timed 42h references; no saved authorization is inferred. */
export function usesMixed42(input: EscalaInput, person: EscalaEmployee): boolean {
  return input.defaultWeeklyHours === 42
    && person.weeklyHours === 42 && person.simulationDailyMinutes === undefined
    && person.planningEnabled !== false && person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING"
    && input.mixed42Sectors?.includes(person.sector) === true;
}

export function usesMixed42Week(input: EscalaInput, person: EscalaEmployee, day: string): boolean {
  return usesMixed42(input, person) && effectiveWeeklyHours(person, day) === 42;
}

/** Exactly 9h of work, with one uninterrupted, unpaid 3h interval. */
export function isMixed42LongShift(shift: EscalaShift): boolean {
  if (shift.segments.length !== 3) return false;
  const [first, interval, last] = shift.segments;
  return first.kind === "WORK" && first.end - first.start === 270
    && interval.kind === "BREAK" && interval.end - interval.start === 180
    && last.kind === "WORK" && last.end - last.start === 270
    && first.end === interval.start && interval.end === last.start;
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
  return day < TRANSITION_42_DATE ? reference.dailyMinutes.before : day < TRANSITION_40_DATE ? reference.dailyMinutes.first : reference.dailyMinutes.second;
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
