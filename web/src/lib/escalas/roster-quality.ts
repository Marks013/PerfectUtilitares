import { buildCoveragePresence, sectorCoverageGaps, type SectorCoverageGap } from "./coverage-presence";
import { dateRange, dayOfWeek, visibleDates } from "./dates";
import { currentLeadership } from "./leadership";
import { movementLevel } from "./movement";
import { preservesRestDistribution } from "./rest-quality";
import { regularRestQuality } from "./rest-spacing";
import { storeClosingMinutes } from "./store-hours";
import type { EscalaInput } from "./types";
import { validateEscala } from "./validation";
import { weekendBalance } from "./weekend-balance";

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
/** Estimated references are protected by sector, not frozen separately on each date. */
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

/** Reject an inferior complete candidate; never assemble unverified sector fragments. */
export type RosterSelectionReason = "REFERENCE_UNVERIFIED" | "PROPOSAL_INVALID" | "PROTECTED_ASSIGNMENT"
  | "SECTOR_COVERAGE" | "SECTOR_PEAK" | "CLOSING_COVERAGE" | "DAILY_PRESENCE" | "PRIORITY_LEADERSHIP"
  | "OPERATIONAL_IMPROVEMENT" | "REST_DISTRIBUTION" | "REST_WINDOW" | "SATURDAY_BALANCE" | "SUNDAY_BALANCE" | "ACCEPTED";
export function selectVerifiedRoster(reference: EscalaInput, proposal: EscalaInput,
  onDecision?: (reason: RosterSelectionReason) => void): { input: EscalaInput; retainedReference: boolean } {
  const decision = (retainedReference: boolean, reason: RosterSelectionReason) => {
    onDecision?.(reason);
    return { input: retainedReference ? reference : proposal, retainedReference };
  };
  // First-time generation or an invalid old draft has no verified comparison incumbent.
  if (!reference.assignments.length || !validateEscala(reference).valid) return decision(false, "REFERENCE_UNVERIFIED");
  if (!validateEscala(proposal).valid) return decision(true, "PROPOSAL_INVALID");
  const assignments = new Map(proposal.assignments.map(record => [`${record.employeeId}\0${record.date}`, record]));
  for (const old of reference.assignments) {
    const next = assignments.get(`${old.employeeId}\0${old.date}`);
    if ((old.locked || old.kind === "ABSENCE" || old.kind === "HOLIDAY")
      && (old.kind !== next?.kind || old.locked && (old.shiftId !== next.shiftId || !next.locked))) return decision(true, "PROTECTED_ASSIGNMENT");
  }
  const before = coverageQuality(reference), after = coverageQuality(proposal);
  // Match the Python sector/horizon, visible-month and Sunday protections.
  const visible = new Set(visibleDates(reference));
  const sundays = new Set(dateRange(reference.startDate, reference.endDate).filter(day => dayOfWeek(day) === 6));
  const visibleSundays = new Set([...sundays].filter(day => visible.has(day)));
  let operationalImprovement = false;
  for (const dates of [undefined, visible, sundays, visibleSundays]) {
    const oldTotals = sectorTotals(before.daily, dates), newTotals = sectorTotals(after.daily, dates);
    if (!noIncrease(oldTotals, newTotals)) return decision(true, "SECTOR_COVERAGE");
    operationalImprovement ||= improves(oldTotals, newTotals);
  }
  const beforeClosing = sectorTotals(before.closing), afterClosing = sectorTotals(after.closing);
  if (!noIncrease(beforeClosing, afterClosing)) return decision(true, "CLOSING_COVERAGE");
  if (!noIncrease(before.peaks, after.peaks)) return decision(true, "SECTOR_PEAK");
  if ([...before.present].some(key => !after.present.has(key))) return decision(true, "DAILY_PRESENCE");
  const afterLeaders = leaders(proposal);
  if ([...leaders(reference)].some(key => !afterLeaders.has(key))) return decision(true, "PRIORITY_LEADERSHIP");
  // Long regular-rest windows remain protected even during coverage recovery.
  const beforePeople = new Map(reference.employees.map(person => [person.id, regularRestQuality(reference, person)]));
  if (proposal.employees.some(person => regularRestQuality(proposal, person).longWindows.length > (beforePeople.get(person.id)?.longWindows.length ?? 0))) return decision(true, "REST_WINDOW");
  // Mandatory rules (including manual minima, rest, hours and Saturday v2)
  // were independently validated above. Preserve actual daily service and
  // declared peak leadership, but do not turn an estimated zero-gap date or
  // seed fairness into a hard ban on operational recovery in the same sector.
  if (operationalImprovement || improves(beforeClosing, afterClosing)) return decision(false, "OPERATIONAL_IMPROVEMENT");
  // When operational coverage ties, retain the established quality policy.
  if (!preservesRestDistribution(reference, proposal)) return decision(true, "REST_DISTRIBUTION");
  for (const weekday of [5, 6] as const) {
    if (!noIncrease(weekendBalance(reference, weekday), weekendBalance(reference, weekday, proposal.assignments)))
      return decision(true, weekday === 5 ? "SATURDAY_BALANCE" : "SUNDAY_BALANCE");
  }
  return decision(false, "ACCEPTED");
}
