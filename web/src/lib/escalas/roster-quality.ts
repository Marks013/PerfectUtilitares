import { buildCoveragePresence, coverageAt, sectorCoverageGaps, type SectorCoverageGap } from "./coverage-presence";
import { dateRange, dayOfWeek, visibleDates } from "./dates";
import { currentLeadership } from "./leadership";
import { movementLevel } from "./movement";
import { preservesRestDistribution } from "./rest-quality";
import { regularRestQuality } from "./rest-spacing";
import { storeClosingMinutes } from "./store-hours";
import type { EscalaInput, EscalaValidation } from "./types";
import { validateEscala } from "./validation";
import { weekendBalance } from "./weekend-balance";
import { effectiveWeeklyMinutes } from "./labor-rules";

function missing(gap: SectorCoverageGap): number {
  const roles = new Map<string, number>();
  for (const role of gap.roles) roles.set(role.role, Math.max(roles.get(role.role) ?? 0, role.minimum - role.present, 0));
  return Math.max(0, gap.minimum - gap.present, [...roles.values()].reduce((sum, count) => sum + count, 0));
}

/** Exact report semantics, but across the complete technical horizon. */
export function coverageQuality(input: EscalaInput) {
  const presence = buildCoveragePresence(input), daily = new Map<string, number>(), closing = new Map<string, number>();
  const peaks = new Map<string, number>();
  const end = storeClosingMinutes(input), dates = dateRange(input.startDate, input.endDate);
  for (const gap of sectorCoverageGaps(input, presence, dates)) {
    const key = `${gap.sector}\0${gap.date}`, count = missing(gap);
    peaks.set(gap.sector, Math.max(peaks.get(gap.sector) ?? 0, count));
    daily.set(key, (daily.get(key) ?? 0) + count * (gap.end - gap.start));
    closing.set(key, (closing.get(key) ?? 0) + count * Math.max(0, Math.min(end, gap.end) - Math.max(end - 60, gap.start)));
  }
  return { daily, closing, peaks, present: new Set([...presence.keys()].filter(key => {
    const day = key.slice(0, key.indexOf("\0")); return day >= input.startDate && day <= input.endDate;
  })) };
}
/** Dates may rotate inside each protected scope; role and clock dimensions remain distinct. */
function sectorTotals(values: Map<string, number>, dates?: Set<string>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [key, value] of values) {
    if (dates && !dates.has(key.slice(key.lastIndexOf("\0") + 1))) continue;
    const sector = key.slice(0, key.lastIndexOf("\0"));
    totals.set(sector, (totals.get(sector) ?? 0) + value);
  }
  return totals;
}
function improves(before: Map<string, number>, after: Map<string, number>): boolean {
  return [...before].some(([key, value]) => (after.get(key) ?? 0) < value);
}
function noIncrease(before: Map<string, number>, after: Map<string, number>): boolean {
  return [...after].every(([key, value]) => value <= (before.get(key) ?? 0));
}
function leaders(input: EscalaInput) {
  const people = new Map(input.employees.filter(person => person.planningEnabled !== false).map(person => [person.id, person]));
  const present = new Set<string>();
  for (const day of input.assignments) {
    const person = people.get(day.employeeId);
    if (!person || day.kind !== "WORK" && day.kind !== "DUTY" || day.date < person.activeFrom || person.activeUntil && day.date > person.activeUntil) continue;
    const role = currentLeadership(person);
    if (!role || role.role === "NONE") continue;
    for (const sector of role.sectors) if (movementLevel(input, sector, day.date) === "HIGH") present.add(`${sector}\0${day.date}`);
  }
  return present;
}

/** Compare the same cohort and workload; different contracts are not a quality gain. */
function comparableRoster(reference: EscalaInput, proposal: EscalaInput, requireKnownClocks = true): boolean {
  const dates = dateRange(reference.startDate, reference.endDate);
  const cohort = (input: EscalaInput) => input.employees.filter(person => person.planningEnabled !== false).map(person =>
    JSON.stringify([person.id, person.sector, person.role, person.scheduleMode ?? "TIMED", person.activeFrom, person.activeUntil,
      person.weeklyHours, person.weeklyHoursMode, person.simulationDailyMinutes,
      dates.map(date => effectiveWeeklyMinutes(person, date))])).sort();
  const complete = (input: EscalaInput) => {
    const assigned = new Set(input.assignments.map(day => `${day.employeeId}\0${day.date}`));
    if (requireKnownClocks && input.employees.some(person => person.planningEnabled !== false && person.scheduleMode === "MISSING")) return false;
    const knownShifts = new Set(input.shifts.map(shift => shift.id));
    if (requireKnownClocks && input.assignments.some(day => day.kind === "WORK" && !knownShifts.has(day.shiftId ?? ""))) return false;
    return input.employees.filter(person => person.planningEnabled !== false).every(person => dates.every(date =>
      date < person.activeFrom || Boolean(person.activeUntil && date > person.activeUntil) || assigned.has(`${person.id}\0${date}`)));
  };
  return reference.branchCode === proposal.branchCode && reference.timeZone === proposal.timeZone
    && reference.startDate === proposal.startDate && reference.endDate === proposal.endDate
    && reference.defaultWeeklyHours === proposal.defaultWeeklyHours
    && storeClosingMinutes(reference) === storeClosingMinutes(proposal)
    && JSON.stringify(visibleDates(reference)) === JSON.stringify(visibleDates(proposal))
    && JSON.stringify([...reference.policy.closedDates].sort()) === JSON.stringify([...proposal.policy.closedDates].sort())
    && JSON.stringify(cohort(reference)) === JSON.stringify(cohort(proposal)) && complete(reference) && complete(proposal);
}

/** Exact civil boundaries shared by both candidates. Dates rotate inside each scope, not across roles or clocks. */
function roleTimeQuality(reference: EscalaInput, proposal: EscalaInput, coverageReference: EscalaInput) {
  const dates = dateRange(coverageReference.startDate, coverageReference.endDate);
  const visible = new Set(visibleDates(coverageReference));
  const scopes = (date: string) => ["HORIZON", ...(visible.has(date) ? ["MONTH"] : []),
    ...(dayOfWeek(date) === 6 ? ["SUNDAYS", ...(visible.has(date) ? ["MONTH_SUNDAYS"] : [])] : [])];
  const inputs = [reference, proposal].map(input => ({ ...input, demands: coverageReference.demands }));
  const presences = inputs.map(input => buildCoveragePresence(input));
  const gaps = inputs.map((input, index) => sectorCoverageGaps(input, presences[index], dates));
  const boundaries = new Map<string, Set<number>>();
  const add = (sector: string, start: number, end: number) => {
    const points = boundaries.get(sector) ?? new Set<number>();
    points.add(start); points.add(end); boundaries.set(sector, points);
  };
  for (const demand of coverageReference.demands) add(demand.sector, demand.start, demand.end);
  for (const presence of presences) for (const [key, intervals] of presence) {
    const date = key.slice(0, key.indexOf("\0"));
    if (date < coverageReference.startDate || date > coverageReference.endDate) continue;
    for (const interval of intervals) add(interval.employee.sector, interval.start, interval.end);
  }
  const closing = storeClosingMinutes(coverageReference);
  const bands = new Map([...boundaries].map(([sector, points]) => {
    points.add(Math.max(0, closing - 60)); points.add(closing);
    return [sector, [...points].sort((a, b) => a - b)] as const;
  }));
  return inputs.map((_, index) => {
    const deficit = new Map<string, number>(), peak = new Map<string, number>(), service = new Map<string, number>();
    const sum = (values: Map<string, number>, key: string, value: number) => values.set(key, (values.get(key) ?? 0) + value);
    for (const gap of gaps[index]) {
      const points = bands.get(gap.sector) ?? [];
      const roles = new Map<string | null, number>([[null, missing(gap)]]);
      for (const role of gap.roles) roles.set(role.role, Math.max(roles.get(role.role) ?? 0, role.minimum - role.present, 0));
      for (let point = 0; point < points.length - 1; point++) {
        const start = points[point], end = points[point + 1];
        if (start < gap.start || end > gap.end) continue;
        for (const scope of scopes(gap.date)) for (const [role, count] of roles) {
          const key = JSON.stringify([scope, gap.sector, role, start, end]);
          sum(deficit, key, count * (end - start)); peak.set(key, Math.max(peak.get(key) ?? 0, count));
        }
      }
    }
    // Actual service is a fact even when a reference is absent or explicitly zero; it is not a fabricated minimum.
    for (const [key] of presences[index]) {
      const split = key.indexOf("\0"), date = key.slice(0, split), sector = key.slice(split + 1);
      if (date < coverageReference.startDate || date > coverageReference.endDate) continue;
      const points = bands.get(sector) ?? [];
      for (let point = 0; point < points.length - 1; point++) {
        const start = points[point], end = points[point + 1];
        const roles = new Map<string, number>();
        for (const person of coverageAt(presences[index], date, sector, start)) roles.set(person.role, (roles.get(person.role) ?? 0) + 1);
        for (const scope of scopes(date)) for (const [role, count] of roles)
          sum(service, JSON.stringify([scope, sector, role, start, end]), count * (end - start));
      }
    }
    return { deficit, peak, service };
  });
}

/** Merit can be measured on an invalid old roster without ever returning it as a usable solution. */
export function compareRosterCoverage(reference: EscalaInput, proposal: EscalaInput, coverageReference = reference): {
  comparable: boolean; regressed: boolean; improved: boolean; reason: RosterSelectionReason;
} {
  const result = (reason: RosterSelectionReason, regressed = false, improved = false, comparable = true) => ({ comparable, regressed, improved, reason });
  if (!comparableRoster(reference, proposal) || !comparableRoster(coverageReference, proposal)) return result("REFERENCE_NOT_COMPARABLE", false, false, false);
  const before = coverageQuality({ ...reference, demands: coverageReference.demands });
  const after = coverageQuality({ ...proposal, demands: coverageReference.demands });
  const visible = new Set(visibleDates(coverageReference));
  const sundays = new Set(dateRange(coverageReference.startDate, coverageReference.endDate).filter(day => dayOfWeek(day) === 6));
  let improved = false;
  for (const dates of [undefined, visible, sundays, new Set([...sundays].filter(day => visible.has(day)))]) {
    const oldTotals = sectorTotals(before.daily, dates), newTotals = sectorTotals(after.daily, dates);
    if (!noIncrease(oldTotals, newTotals)) return result("SECTOR_COVERAGE", true);
    improved ||= improves(oldTotals, newTotals);
  }
  const oldClosing = sectorTotals(before.closing), newClosing = sectorTotals(after.closing);
  if (!noIncrease(oldClosing, newClosing)) return result("CLOSING_COVERAGE", true);
  if (!noIncrease(before.peaks, after.peaks)) return result("SECTOR_PEAK", true);
  if ([...before.present].some(key => !after.present.has(key))) return result("DAILY_PRESENCE", true);
  const [oldRoles, newRoles] = roleTimeQuality(reference, proposal, coverageReference);
  if (!noIncrease(oldRoles.deficit, newRoles.deficit) || !noIncrease(oldRoles.peak, newRoles.peak)) return result("ROLE_TIME_COVERAGE", true);
  if (!noIncrease(newRoles.service, oldRoles.service)) return result("ROLE_TIME_PRESENCE", true);
  improved ||= improves(oldClosing, newClosing) || improves(oldRoles.deficit, newRoles.deficit);
  return result(improved ? "OPERATIONAL_IMPROVEMENT" : "ACCEPTED", false, improved);
}

/** Publication pendings are not all operationally interchangeable: an unresolved meal cannot seed or replace a calculated roster. */
export function isOperationallyReusable(validation: EscalaValidation): boolean {
  return validation.valid && !validation.issues.some(issue => issue.code === "DAY_PENDING" || issue.code === "MEAL_INTERVAL_EXCESSIVE");
}
export function isReusableRoster(input: EscalaInput): boolean {
  return input.assignments.length > 0 && isOperationallyReusable(validateEscala(input));
}

/** Reject an inferior complete candidate; never assemble unverified sector fragments. */
export type RosterSelectionReason = "REFERENCE_NOT_COMPARABLE" | "ROLE_TIME_COVERAGE" | "ROLE_TIME_PRESENCE" | "REFERENCE_UNVERIFIED" | "PROPOSAL_INVALID" | "PROTECTED_ASSIGNMENT"
  | "SECTOR_COVERAGE" | "SECTOR_PEAK" | "CLOSING_COVERAGE" | "DAILY_PRESENCE" | "PRIORITY_LEADERSHIP"
  | "OPERATIONAL_IMPROVEMENT" | "REST_DISTRIBUTION" | "REST_WINDOW" | "SATURDAY_BALANCE" | "SUNDAY_BALANCE" | "ACCEPTED";
export function selectVerifiedRoster(reference: EscalaInput, proposal: EscalaInput,
  onDecision?: (reason: RosterSelectionReason) => void, coverageReference = reference): { input: EscalaInput; retainedReference: boolean } {
  const decision = (retainedReference: boolean, reason: RosterSelectionReason) => {
    onDecision?.(reason);
    return { input: retainedReference ? reference : proposal, retainedReference };
  };
  // First-time generation or an invalid old draft has no verified comparison incumbent.
  if (!isReusableRoster(reference)) return decision(false, "REFERENCE_UNVERIFIED");
  if (!isReusableRoster(proposal)) return decision(true, "PROPOSAL_INVALID");
  const assignments = new Map(proposal.assignments.map(record => [`${record.employeeId}\0${record.date}`, record]));
  for (const old of reference.assignments) {
    const next = assignments.get(`${old.employeeId}\0${old.date}`);
    if ((old.locked || old.kind === "ABSENCE" || old.kind === "HOLIDAY")
      && (old.kind !== next?.kind || old.locked && (old.shiftId !== next.shiftId || !next.locked))) return decision(true, "PROTECTED_ASSIGNMENT");
  }
  // A genuinely different current contract cannot restore the previous workload. Unknown historical clocks do not bypass current guards.
  if (!comparableRoster(reference, proposal, false)) return decision(false, "REFERENCE_NOT_COMPARABLE");
  const historicalComparison = compareRosterCoverage(reference, proposal, coverageReference);
  // This fallback selects between current candidates only; it never makes the historical ruler comparable.
  const comparison = historicalComparison.comparable ? historicalComparison : compareRosterCoverage(reference, proposal);
  if (comparison.regressed) return decision(true, comparison.reason);
  const afterLeaders = leaders(proposal);
  if ([...leaders(reference)].some(key => !afterLeaders.has(key))) return decision(true, "PRIORITY_LEADERSHIP");
  // Long regular-rest windows remain protected even during coverage recovery.
  const beforePeople = new Map(reference.employees.map(person => [person.id, regularRestQuality(reference, person)]));
  if (proposal.employees.some(person => regularRestQuality(proposal, person).longWindows.length > (beforePeople.get(person.id)?.longWindows.length ?? 0))) return decision(true, "REST_WINDOW");
  // Mandatory rules (including manual minima, rest, hours and Saturday v2)
  // were independently validated above. Preserve actual daily service and
  // declared peak leadership, but do not turn an estimated zero-gap date or
  // seed fairness into a hard ban on operational recovery in the same sector.
  if (comparison.improved) return decision(false, historicalComparison.comparable ? "OPERATIONAL_IMPROVEMENT" : "REFERENCE_NOT_COMPARABLE");
  // When operational coverage ties, retain the established quality policy.
  if (!preservesRestDistribution(reference, proposal)) return decision(true, "REST_DISTRIBUTION");
  for (const weekday of [5, 6] as const) {
    if (!noIncrease(weekendBalance(reference, weekday), weekendBalance(reference, weekday, proposal.assignments)))
      return decision(true, weekday === 5 ? "SATURDAY_BALANCE" : "SUNDAY_BALANCE");
  }
  return decision(false, historicalComparison.comparable ? "ACCEPTED" : "REFERENCE_NOT_COMPARABLE");
}
