import { buildCoveragePresence, sectorCoverageGaps, type SectorCoverageGap } from "./coverage-presence";
import { dateRange } from "./dates";
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
  const end = storeClosingMinutes(input), dates = dateRange(input.startDate, input.endDate);
  for (const gap of sectorCoverageGaps(input, presence, dates)) {
    const key = `${gap.sector}\0${gap.date}`, count = missing(gap);
    daily.set(key, (daily.get(key) ?? 0) + count * (gap.end - gap.start));
    closing.set(key, (closing.get(key) ?? 0) + count * Math.max(0, Math.min(end, gap.end) - Math.max(end - 60, gap.start)));
  }
  return { daily, closing, present: new Set([...presence.keys()].filter(key => {
    const day = key.slice(0, key.indexOf("\0")); return day >= input.startDate && day <= input.endDate;
  })) };
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
export function selectVerifiedRoster(reference: EscalaInput, proposal: EscalaInput): { input: EscalaInput; retainedReference: boolean } {
  const accepted = { input: proposal, retainedReference: false }, retained = { input: reference, retainedReference: true };
  // First-time generation or an invalid old draft has no verified comparison incumbent.
  if (!reference.assignments.length || !validateEscala(reference).valid) return accepted;
  if (!validateEscala(proposal).valid) return retained;
  const assignments = new Map(proposal.assignments.map(record => [`${record.employeeId}\0${record.date}`, record]));
  for (const old of reference.assignments) {
    const next = assignments.get(`${old.employeeId}\0${old.date}`);
    if ((old.locked || old.kind === "ABSENCE") && (old.kind !== next?.kind || old.locked && (old.shiftId !== next.shiftId || !next.locked))) return retained;
  }
  if (!preservesRestDistribution(reference, proposal)) return retained;
  const beforePeople = new Map(reference.employees.map(person => [person.id, regularRestQuality(reference, person)]));
  if (proposal.employees.some(person => regularRestQuality(proposal, person).longWindows.length > (beforePeople.get(person.id)?.longWindows.length ?? 0))) return retained;
  const before = coverageQuality(reference), after = coverageQuality(proposal);
  if (!noIncrease(before.daily, after.daily) || !noIncrease(before.closing, after.closing)
    || [...before.present].some(key => !after.present.has(key))) return retained;
  for (const weekday of [5, 6] as const) if (!noIncrease(weekendBalance(reference, weekday), weekendBalance(reference, weekday, proposal.assignments))) return retained;
  const afterLeaders = leaders(proposal);
  if ([...leaders(reference)].some(key => !afterLeaders.has(key))) return retained;
  return accepted;
}
