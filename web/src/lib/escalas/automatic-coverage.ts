import { addDays, dateRange, dayOfWeek } from "./dates";
import { effectiveWeeklyMinutes } from "./labor-rules";
import type { EscalaEmployee, EscalaInput, EscalaShift } from "./types";

type Demand = EscalaInput["demands"][number];
type Contribution = { date: string; shift: EscalaShift; weight: number };
type Group = { sector: string; role: string; contributions: Contribution[] };

function paidMinutes(shift: EscalaShift) {
  return shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

function referenceShift(person: EscalaEmployee, shifts: Map<string, EscalaShift>, target: number) {
  const source = [...(person.sourceSchedule?.weekday ?? "").matchAll(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/g)];
  const arrival = source.length ? Number(source[0][1]) * 60 + Number(source[0][2]) : null;
  const lastSource = source.at(-1);
  const departure = lastSource ? Number(lastSource[3]) * 60 + Number(lastSource[4]) : null;
  const candidates = person.shiftIds.flatMap((id) => {
    const shift = shifts.get(id);
    return shift && paidMinutes(shift) === target ? [shift] : [];
  });
  // Alternatives belong to the same person. Selecting one reference avoids claiming that
  // both opening and closing are staffed simultaneously by that person's alternative shifts.
  return candidates.sort((a, b) => {
    const arrivalA = a.segments.find((segment) => segment.kind !== "BREAK")?.start ?? 0;
    const arrivalB = b.segments.find((segment) => segment.kind !== "BREAK")?.start ?? 0;
    const departureA = a.segments.filter((segment) => segment.kind !== "BREAK").at(-1)?.end ?? 0;
    const departureB = b.segments.filter((segment) => segment.kind !== "BREAK").at(-1)?.end ?? 0;
    return (arrival === null ? 0 : Math.abs(arrivalA - arrival) - Math.abs(arrivalB - arrival))
      || (departure === null ? 0 : Math.abs(departureA - departure) - Math.abs(departureB - departure))
      || person.shiftIds.indexOf(a.id) - person.shiftIds.indexOf(b.id);
  })[0];
}

function key(sector: string, role: string) { return JSON.stringify([sector, role]); }

function tieOrder(group: Group, monday: string) {
  let hash = 0;
  for (const character of key(group.sector, group.role)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
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
  const remainder = Math.max(0, Math.floor(expected.reduce((sum, value) => sum + value, 0) + 1e-9) - targets.reduce((sum, value) => sum + value, 0));
  const order = tieOrder(group, monday);
  const ranked = expected.map((value, index) => ({ index, fraction: value - targets[index] }))
    .sort((a, b) => Math.abs(a.fraction - b.fraction) > 1e-9 ? b.fraction - a.fraction
      : order.indexOf(dayOfWeek(days[a.index])) - order.indexOf(dayOfWeek(days[b.index])));
  for (const item of ranked.slice(0, remainder)) targets[item.index]++;
  return targets;
}

/** Recalculate soft staffing objectives. Explicit operational minima remain unchanged. */
export function proposeAutomaticCoverage(input: EscalaInput): EscalaInput {
  const explicit = input.demands.filter((demand) => demand.estimated !== true).map((demand) => ({ ...demand }));
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const assignments = new Map(input.assignments.map((item) => [JSON.stringify([item.employeeId, item.date]), item]));
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
      const shift = referenceShift(person, shifts, effectiveWeeklyMinutes(person, addDays(monday, 6)) / 5);
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
      const freeDays = available.length - forced.length;
      const weight = freeDays ? Math.min(1, Math.max(0, 5 - forced.length) / freeDays) : 0;
      const groupKey = key(person.sector, person.role);
      const group = groups.get(groupKey) ?? { sector: person.sector, role: person.role, contributions: [] };
      for (const day of available) {
        const item = assignments.get(JSON.stringify([person.id, day]));
        const locked = item?.locked && item.kind === "WORK";
        group.contributions.push({ date: day, shift: locked && item.shiftId ? shifts.get(item.shiftId) ?? shift : shift, weight: locked ? 1 : weight });
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
  return { ...input, demands, policy: { ...input.policy, ...(estimates.length ? { coverageReview: "SUGGESTED" as const } : {}) } };
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
