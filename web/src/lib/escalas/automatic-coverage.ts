import { addDays, dateRange, dayOfWeek, weekStart } from "./dates";
import { effectiveSundayLimit, effectiveWeeklyMinutes, isMixed42LongShift, usesMixed42Week } from "./labor-rules";
import { storeClosingMinutes } from "./store-hours";
import { validateEscala } from "./validation";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift } from "./types";

type Demand = EscalaInput["demands"][number];
type Contribution = { date: string; shift: EscalaShift; weight: number };
type Group = { sector: string; role: string; employeeIds: Set<string>; contributions: Contribution[] };

function paidMinutes(shift: EscalaShift) {
  return shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

function referenceShift(person: EscalaEmployee, shifts: Map<string, EscalaShift>, target: number, allowed = (_shift: EscalaShift) => true) {
  // Alternatives belong to the same person. Selecting one reference avoids claiming that
  // both opening and closing are staffed simultaneously by that person's alternative shifts.
  // Preparation keeps the canonical clock first. Adding solver alternatives must not
  // silently move the staffing target, including when the imported clock was adapted.
  for (const id of person.shiftIds) {
    const shift = shifts.get(id);
    if (shift && paidMinutes(shift) === target && allowed(shift)) return shift;
  }
  return undefined;
}

function key(sector: string, role: string) { return JSON.stringify([sector, role]); }

function groupHash(group: Group) {
  let hash = 0;
  // Stable membership, not a display label, determines fractional rounding ties.
  // Names, registration numbers and identifiers are never emitted as diagnostics.
  for (const character of JSON.stringify([...group.employeeIds].sort())) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

function tieOrder(group: Group, monday: string) {
  const hash = groupHash(group);
  const week = Math.floor(Date.parse(`${monday}T00:00:00Z`) / 604800000);
  const rotation = (hash + week) % 7;
  // Spread rounding opportunities rather than permanently assigning the same weekend off.
  const rotating = [0, 2, 4, 6, 1, 3, 5].map((offset) => (offset + rotation) % 7).filter((day) => day !== 6);
  // A soft rounding tie must not systematically prefer work on every Sunday. The
  // independent solver still applies each person's actual Sunday-rest constraints.
  return (hash + week) % 3 === 0 ? [...rotating, 6] : [6, ...rotating];
}

function roundedTargets(expected: number[], group: Group, monday: string, days: string[]) {
  const targets = expected.map((value) => Math.floor(value + 1e-9));
  const total = Math.floor(expected.reduce((sum, value) => sum + value, 0) + 1e-9);
  const sunday = days.findIndex(day => dayOfWeek(day) === 6);
  if (sunday >= 0) {
    const fraction = Math.max(0, expected[sunday] - Math.floor(expected[sunday] + 1e-9));
    const phase = Math.floor(Date.parse(`${monday}T00:00:00Z`) / 604800000) + groupHash(group) % 97;
    const extra = Math.floor((phase + 1) * fraction + 1e-9) - Math.floor(phase * fraction + 1e-9);
    const otherTargets = targets.reduce((sum, value, index) => sum + (index === sunday ? 0 : value), 0);
    targets[sunday] = Math.min(Math.max(0, total - otherTargets), targets[sunday] + extra);
  }
  const remainder = Math.max(0, total - targets.reduce((sum, value) => sum + value, 0));
  const order = tieOrder(group, monday);
  const ranked = expected.map((value, index) => ({ index, fraction: value - targets[index] })).filter(item => item.index !== sunday)
    .sort((a, b) => Math.abs(a.fraction - b.fraction) > 1e-9 ? b.fraction - a.fraction
      : order.indexOf(dayOfWeek(days[a.index])) - order.indexOf(dayOfWeek(days[b.index])));
  for (const item of ranked.slice(0, remainder)) targets[item.index]++;
  return targets;
}

/** Browser-safe invalidation only: this fingerprint does not certify or authenticate demand. */
export function coverageBasis(input: EscalaInput): string {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const clock = (shift?: EscalaShift) => shift?.segments.map(segment => [segment.kind, segment.start, segment.end]) ?? null;
  const sorted = <T>(items: T[]) => items.sort((a, b) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const weeks = [...new Set(dateRange(input.startDate, input.endDate).map(weekStart))];
  const context = (records: EscalaAssignment[]) => sorted(records.map(record => [record.date, record.kind,
    record.kind === "WORK" ? clock(shifts.get(record.shiftId ?? "")) : null]));
  const people = input.employees.map(person => {
    const references = new Map<string, unknown>();
    for (const week of weeks) {
      const mixed = usesMixed42Week(input, person, week);
      const target = mixed ? 480 : effectiveWeeklyMinutes(person, week) / 5;
      references.set(`${target}:${mixed}`, [target, mixed,
        clock(referenceShift(person, shifts, target)), mixed ? clock(referenceShift(person, shifts, 540, isMixed42LongShift)) : null]);
    }
    return [person.id, person.sector, person.role, person.weeklyHours, person.weeklyHoursMode ?? "INDIVIDUAL", person.simulationDailyMinutes ?? null,
      person.planningEnabled !== false, person.scheduleMode ?? "TIMED", person.activeFrom, person.activeUntil ?? "", person.offMode,
      [...person.fixedOffDays].sort(), person.offPattern, effectiveSundayLimit(person), [...person.preferredOffDays].sort(),
      sorted([...references.values()]), context(person.history), context(person.planningHistory ?? []), context(person.planningFuture ?? [])];
  });
  const policy = input.policy;
  const data = [input.startDate, input.endDate, input.defaultWeeklyHours, input.timeZone, storeClosingMinutes(input), [...(input.mixed42Sectors ?? [])].sort(),
    [policy.weeklyLimit, policy.dailyLimitMinutes, policy.minInterShiftMinutes, policy.minWeeklyRestMinutes, policy.minMealMinutes,
      policy.maxConsecutiveWorkDays, policy.allowShortMealSimulation === true, policy.limitContinuousWorkBlocks === true,
      [...policy.closedDates].sort(), [...policy.holidayDates].sort(), [...policy.authorizedHolidayDates].sort(), policy.holidayRestAllowed,
      policy.normativeProfile ?? "CUSTOM"], sorted(people),
    sorted(input.assignments.filter(record => record.kind === "ABSENCE" || record.locked).map(record => [record.employeeId, record.date, record.kind,
      record.kind === "WORK" ? clock(shifts.get(record.shiftId ?? "")) : null])),
    sorted(input.demands.filter(demand => demand.estimated !== true).map(demand => [demand.date, demand.sector, demand.role ?? "", demand.start, demand.end, demand.minimum]))];
  let first = 2166136261, second = 2246822519;
  for (const character of JSON.stringify(data)) {
    const point = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ point, 16777619) >>> 0;
    second = Math.imul(second ^ point, 3266489917) >>> 0;
  }
  return `coverage-v1:${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function completeRoster(input: EscalaInput): boolean {
  if (!input.assignments.length) return false;
  const days = dateRange(input.startDate, input.endDate);
  const records = new Set(input.assignments.map(record => JSON.stringify([record.employeeId, record.date])));
  let activeDays = 0;
  for (const person of input.employees) if (person.planningEnabled !== false) for (const day of days) {
    if (person.activeFrom > day || person.activeUntil && person.activeUntil < day) continue;
    activeDays++;
    if (!records.has(JSON.stringify([person.id, day]))) return false;
  }
  return activeDays > 0;
}

/**
 * Keep the ruler fixed while optimizing an unchanged, complete, independently valid roster.
 * Legacy bootstrap is explicit and generation-only: it stamps the existing saved estimates
 * when their inputs remain compatible, rather than migrating targets during a solver upgrade.
 * A real input change or needsRegeneration recalculates estimates; all manual minima survive.
 */
export function retainCoverageReference(previous: EscalaInput, prepared: EscalaInput, allowLegacy = false): EscalaInput | undefined {
  if (previous.needsRegeneration || prepared.needsRegeneration || !previous.demands.some(demand => demand.estimated === true)
    || !completeRoster(previous) || !completeRoster(prepared)) return undefined;
  const basis = coverageBasis(prepared);
  if (previous.coverageBasis ? previous.coverageBasis !== basis : !allowLegacy || coverageBasis(previous) !== basis) return undefined;
  // Repairing rest placement, including the v2 Saturday upgrade, must not move the coverage ruler.
  // These scheduling conflicts remain errors in the independent result validator.
  const validation = validateEscala(previous);
  if (validation.issues.some(issue => issue.severity === "ERROR"
    && issue.code !== "CONSECUTIVE_REST_LIMIT" && issue.code !== "SATURDAY_REST_FORBIDDEN")) return undefined;
  return { ...prepared, demands: previous.demands, coverageBasis: basis };
}

/** Recalculate soft staffing objectives. Explicit operational minima remain unchanged. */
export function proposeAutomaticCoverage(input: EscalaInput): EscalaInput {
  const retained = retainCoverageReference(input, input);
  if (retained) return retained;
  const basis = coverageBasis(input);
  const explicit = input.demands.filter((demand) => demand.estimated !== true).map((demand) => ({ ...demand }));
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const assignments = new Map<string, EscalaAssignment>();
  const lockedByEmployee = new Map<string, EscalaAssignment[]>();
  for (const item of input.assignments) {
    assignments.set(JSON.stringify([item.employeeId, item.date]), item);
    if (item.locked) {
      const locked = lockedByEmployee.get(item.employeeId);
      if (locked) locked.push(item);
      else lockedByEmployee.set(item.employeeId, [item]);
    }
  }
  const historyByEmployee = new Map<string, Map<string, EscalaAssignment>>();
  const closed = new Set(input.policy.closedDates);
  const weeks = new Map<string, string[]>();
  for (const day of dateRange(input.startDate, input.endDate)) {
    const monday = addDays(day, -dayOfWeek(day));
    const group = weeks.get(monday) ?? [];
    group.push(day);
    weeks.set(monday, group);
  }
  const allGroups = new Map<string, Group>();
  const estimates: Demand[] = [];
  const identifiers = new Set(explicit.map((demand) => demand.id));
  for (const [monday, days] of weeks) {
    const groups = allGroups;
    for (const person of input.employees) {
      if (person.planningEnabled === false || person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED" || !person.sector) continue;
      const mixed = usesMixed42Week(input, person, monday);
      const shift = referenceShift(person, shifts, mixed ? 480 : effectiveWeeklyMinutes(person, monday) / 5);
      const longShift = mixed ? referenceShift(person, shifts, 540, isMixed42LongShift) : undefined;
      if (!shift) continue;
      const available = days.filter((day) => {
        if (person.activeFrom > day || (person.activeUntil && person.activeUntil < day)
          || closed.has(day) || (person.offMode !== "VARIABLE" && person.fixedOffDays.includes(dayOfWeek(day)))) return false;
        const assignment = assignments.get(JSON.stringify([person.id, day]));
        return assignment?.kind !== "ABSENCE" && !(assignment?.kind === "OFF" && assignment.locked);
      });
      const forced = available.filter((day) => {
        const item = assignments.get(JSON.stringify([person.id, day]));
        return item?.locked && item.kind === "WORK";
      });
      const free = available.filter(day => !forced.includes(day));
      const freeWeekdays = free.filter(day => dayOfWeek(day) !== 6);
      const sunday = free.find(day => dayOfWeek(day) === 6);
      const remaining = Math.max(0, 5 - forced.length);
      const forcedLong = longShift ? forced.filter(day => {
        const lockedShift = shifts.get(assignments.get(JSON.stringify([person.id, day]))?.shiftId ?? "");
        return lockedShift && isMixed42LongShift(lockedShift);
      }).length : 0;
      const longShare = longShift && remaining ? Math.min(1, Math.max(0, 2 - forcedLong) / remaining) : 0;
      let history = historyByEmployee.get(person.id);
      if (!history) {
        history = new Map([...(person.planningHistory ?? []), ...person.history,
          ...(lockedByEmployee.get(person.id) ?? []), ...(person.planningFuture ?? [])].map(day => [day.date, day]));
        historyByEmployee.set(person.id, history);
      }
      const limit = effectiveSundayLimit(person);
      const worked = (date: string) => ["WORK", "DUTY"].includes(history?.get(date)?.kind ?? "");
      const unavailableSunday = sunday && [1, -1].some(direction => Array.from({ length: limit }, (_, index) => addDays(sunday, direction * 7 * (index + 1))).every(worked));
      // A 5/7 reference ignores alternating Sunday rest. Keep the weekly budget,
      // but reserve at most the explicit Sunday rotation's share for a free Sunday.
      const sundayWeight = sunday && !unavailableSunday ? Math.min(remaining, limit / (limit + 1)) : 0;
      const weekdayWeight = freeWeekdays.length ? Math.min(1, Math.max(0, remaining - sundayWeight) / freeWeekdays.length) : 0;
      const groupKey = key(person.sector, person.role);
      const group = groups.get(groupKey) ?? { sector: person.sector, role: person.role, employeeIds: new Set<string>(), contributions: [] };
      group.employeeIds.add(person.id);
      for (const day of available) {
        const item = assignments.get(JSON.stringify([person.id, day]));
        const locked = item?.locked && item.kind === "WORK";
        const weight = locked ? 1 : dayOfWeek(day) === 6 ? sundayWeight : weekdayWeight;
        const shortShare = locked ? 1 : 1 - longShare;
        group.contributions.push({ date: day, shift: locked && item.shiftId ? shifts.get(item.shiftId) ?? shift : shift, weight: weight * shortShare });
        // Mix alternatives within one person's presence share, never count two people.
        if (!locked && longShift && longShare > 0) group.contributions.push({ date: day, shift: longShift, weight: weight * longShare });
      }
      groups.set(groupKey, group);
    }
  }
  const civilGroups = [...allGroups.values()].sort((a, b) => key(a.sector, a.role).localeCompare(key(b.sector, b.role), "pt-BR")).map(group => ({
    group, contributions: group.contributions.flatMap(item => item.shift.segments.filter(segment => segment.kind === "WORK").flatMap(segment => {
      const parts: { date: string; start: number; end: number; weight: number }[] = [];
      for (let offset = Math.floor(segment.start / 1440); offset <= Math.floor((segment.end - 1) / 1440); offset++) {
        const date = addDays(item.date, offset);
        if (date < input.startDate || date > input.endDate) continue;
        parts.push({ date, start: Math.max(segment.start, offset * 1440) - offset * 1440,
          end: Math.min(segment.end, (offset + 1) * 1440) - offset * 1440, weight: item.weight });
      }
      return parts;
    })),
  }));
  for (const [, days] of weeks) {
    for (const [groupIndex, { group, contributions: allContributions }] of civilGroups.entries()) {
      const contributions = allContributions.filter(item => days.includes(item.date));
      const manual = explicit.filter((demand) => demand.sector === group.sector && (!demand.role || demand.role === group.role) && days.includes(demand.date));
      const points = [...new Set([
        ...contributions.flatMap(item => [item.start, item.end]),
        ...manual.flatMap((item) => [item.start, item.end]),
      ])].filter((point) => point >= 0 && point <= 1440).sort((a, b) => a - b);
      const previous = new Map<string, Demand>();
      for (let index = 0; index < points.length - 1; index++) {
        const start = points[index], end = points[index + 1];
        const expected = days.map((day) => contributions.filter((item) => item.date === day
          && item.start <= start && item.end >= end)
          .reduce((sum, item) => sum + item.weight, 0));
        if (!expected.some((value) => value > 0)) continue;
        const targets = roundedTargets(expected, group, days[0], days);
        for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
          const day = days[dayIndex];
          if (closed.has(day) || manual.some((item) => item.date === day && item.start <= start && item.end >= end)) continue;
          const last = previous.get(day);
          if (last && last.end === start && last.minimum === targets[dayIndex]) { last.end = end; continue; }
          let id = `auto-${day}-${groupIndex}-${start}`;
          let suffix = 0;
          while (identifiers.has(id)) id = `auto-${day}-${groupIndex}-${start}-${++suffix}`;
          identifiers.add(id);
          const demand: Demand = { id, date: day, sector: group.sector, ...(group.role ? { role: group.role } : {}), start, end, minimum: targets[dayIndex], estimated: true };
          estimates.push(demand);
          previous.set(day, demand);
        }
      }
    }
  }
  const demands = [...explicit, ...estimates];
  if (demands.length > 12000) throw new Error("A equipe gerou mais de 12.000 faixas de cobertura. Reduza as alternativas de horários para recalcular a proposta.");
  const { coverageBasis: _previousBasis, ...base } = input;
  return { ...base, demands, ...(estimates.length ? { coverageBasis: basis } : {}),
    policy: { ...input.policy, ...(estimates.length ? { coverageReview: "SUGGESTED" as const } : {}) } };
}

/** Small view model; it never creates or confirms staffing requirements. */
export function summarizeAutomaticCoverage(input: EscalaInput) {
  const groups = new Map<string, { sector: string; role: string; timed: number; missing: number; minimum: number | null; maximum: number | null }>();
  for (const person of input.employees) {
    if (person.planningEnabled === false || person.activeFrom > input.endDate || (person.activeUntil && person.activeUntil < input.startDate)) continue;
    const groupKey = key(person.sector, person.role);
    const group = groups.get(groupKey) ?? { sector: person.sector, role: person.role, timed: 0, missing: 0, minimum: null, maximum: null };
    if (person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED") group.missing++;
    else group.timed++;
    groups.set(groupKey, group);
  }
  for (const demand of input.demands) {
    if (!demand.estimated) continue;
    const group = groups.get(key(demand.sector, demand.role ?? ""));
    if (!group) continue;
    group.minimum = group.minimum === null ? demand.minimum : Math.min(group.minimum, demand.minimum);
    group.maximum = group.maximum === null ? demand.minimum : Math.max(group.maximum, demand.minimum);
  }
  return [...groups.values()].sort((a, b) => a.sector.localeCompare(b.sector, "pt-BR") || a.role.localeCompare(b.role, "pt-BR"));
}
