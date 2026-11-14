import { absoluteMinute, addDays, visibleDates } from "./dates";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift } from "./types";
import { compareSectors } from "./order";
import { effectiveScheduleMode } from "./fpre136-schedule";

type PresenceInterval = { start: number; end: number; employee: EscalaEmployee };
export type CoveragePresence = Map<string, PresenceInterval[]>;
type CoverageRoleGap = { role: string; present: number; minimum: number; estimated: boolean };
export type SectorCoverageGap = {
  date: string; sector: string; start: number; end: number; present: number; minimum: number;
  estimated: boolean; kind: "no-service" | "minimum" | "estimate"; roles: CoverageRoleGap[]; suggestion: string;
};
function key(date: string, sector: string) { return date + "\0" + sector; }
function active(person: EscalaEmployee, date: string) { return date >= person.activeFrom && (!person.activeUntil || date <= person.activeUntil); }

function shiftCoverage(date: string, shift: EscalaShift) {
  const work = shift.segments.filter(segment => segment.kind === "WORK");
  const intervals = work.map(segment => ({
    start: absoluteMinute(date, segment.start), end: absoluteMinute(date, segment.end),
  }));
  const occupiedDates = new Set<string>();
  for (const segment of work) {
    for (let offset = Math.floor(segment.start / 1440); offset <= Math.floor((segment.end - 1) / 1440); offset++) occupiedDates.add(addDays(date, offset));
  }
  return { intervals, occupiedDates };
}

/** Civil-minute attendance only. Neither paid pauses nor administrative presence guarantee service. */
export function buildCoveragePresence(input: EscalaInput): CoveragePresence {
  const people = new Map(input.employees.map(person => [person.id, person]));
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const records = new Map<string, EscalaAssignment>();
  for (const person of input.employees) for (const record of [...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])]) records.set(key(record.date, record.employeeId), record);
  for (const record of input.assignments) records.set(key(record.date, record.employeeId), record);
  const index: CoveragePresence = new Map();
  const coverageByShiftDate = new Map<string, ReturnType<typeof shiftCoverage>>();
  const midnights = new Map<string, number>();
  for (const record of records.values()) {
    const person = people.get(record.employeeId), shift = shifts.get(record.shiftId ?? "");
    const mode = person ? effectiveScheduleMode(person) : undefined;
    if (!person || !shift || record.kind !== "WORK" || person.planningEnabled === false || mode === "MISSING" || mode === "UNTIMED" || !active(person, record.date)) continue;
    try {
      const shiftDate = key(record.date, shift.id);
      let coverage = coverageByShiftDate.get(shiftDate);
      if (!coverage) {
        coverage = shiftCoverage(record.date, shift);
        coverageByShiftDate.set(shiftDate, coverage);
      }
      for (const day of coverage.occupiedDates) {
        if (!active(person, day)) continue;
        const civilRecord = records.get(key(day, person.id));
        if (civilRecord?.kind === "ABSENCE" || civilRecord?.kind === "OFF") continue;
        const midnight = midnights.get(day) ?? absoluteMinute(day, 0);
        midnights.set(day, midnight);
        const sectorDay = key(day, person.sector);
        const intervals = index.get(sectorDay) ?? [];
        for (const interval of coverage.intervals) {
          const start = Math.max(0, interval.start - midnight), end = Math.min(1440, interval.end - midnight);
          if (start < end) intervals.push({ start, end, employee: person });
        }
        if (intervals.length) index.set(sectorDay, intervals);
      }
    } catch {
      // The independent verifier explains invalid clocks; this view never invents their attendance.
    }
  }
  return index;
}

export function coverageAt(index: CoveragePresence, date: string, sector: string, minute: number, role?: string): EscalaEmployee[] {
  return [...new Map((index.get(key(date, sector)) ?? []).filter(interval => interval.start <= minute && interval.end > minute && (!role || interval.employee.role === role))
    .map(interval => [interval.employee.id, interval.employee])).values()];
}

/** Whole-day presence facts, separate from staffing estimates and operational requirements. */
export function sectorPresenceGaps(input: EscalaInput, index = buildCoveragePresence(input)) {
  const closed = new Set(input.policy.closedDates);
  const assigned = new Set(input.assignments.map(record => key(record.date, record.employeeId)));
  const positiveReferences = new Set(input.demands.filter(demand => demand.minimum > 0 && demand.end > demand.start)
    .map(demand => key(demand.date, demand.sector)));
  const groups = new Map<string, EscalaEmployee[]>();
  for (const person of input.employees) {
    const mode = effectiveScheduleMode(person);
    if (person.planningEnabled === false || mode === "MISSING" || mode === "UNTIMED" || !person.sector) continue;
    const members = groups.get(person.sector) ?? [];
    members.push(person);
    groups.set(person.sector, members);
  }
  const dates = visibleDates(input).filter(date => !closed.has(date));
  return [...groups].sort(([a], [b]) => compareSectors(a, b)).flatMap(([sector, members]) => {
    const emptyDates = dates.filter(date => {
      const current = members.filter(person => active(person, date));
      return current.length > 0 && current.every(person => assigned.has(key(date, person.id)))
        && !(index.get(key(date, sector)) ?? []).some(interval => interval.end > interval.start);
    });
    return emptyDates.length ? [{ sector, dates: emptyDates,
      withoutPositiveReferenceDates: emptyDates.filter(date => !positiveReferences.has(key(date, sector))) }] : [];
  });
}

/** Max of overlapping references for one function; functions are disjoint, never substitutes. */
function referenceTotal(demands: EscalaInput["demands"]) {
  const roles = new Map<string, number>(); let general = 0;
  for (const demand of demands) {
    if (demand.role) roles.set(demand.role, Math.max(roles.get(demand.role) ?? 0, demand.minimum));
    else general = Math.max(general, demand.minimum);
  }
  return Math.max(general, [...roles.values()].reduce((sum, count) => sum + count, 0));
}

function timelineForDemands(
  date: string,
  sector: string,
  index: CoveragePresence,
  demands: EscalaInput["demands"],
) {
  const intervals = index.get(key(date, sector)) ?? [];
  const points = [...new Set([...intervals.flatMap(interval => [interval.start, interval.end]), ...demands.flatMap(demand => [demand.start, demand.end])])].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, position) => {
    const end = points[position + 1], people = coverageAt(index, date, sector, start);
    const references = demands.filter(demand => demand.start <= start && demand.end >= end);
    return { start, end, people, present: people.length, minimum: referenceTotal(references.filter(demand => demand.estimated !== true)),
      estimate: referenceTotal(references.filter(demand => demand.estimated === true)), hasReference: references.length > 0 };
  });
}

export function coverageTimeline(input: EscalaInput, date: string, sector: string, index = buildCoveragePresence(input)) {
  return timelineForDemands(
    date,
    sector,
    index,
    input.demands.filter(demand => demand.date === date && demand.sector === sector),
  );
}

function suggestion(estimated: boolean, roles: CoverageRoleGap[]) {
  const detail = roles.length ? " da função " + roles.map(role => role.role).join(", ") : " do setor";
  return (estimated ? "Compare a estimativa com a necessidade real. " : "O mínimo informado não foi atendido. ")
    + "Reveja as entradas, saídas e intervalos" + detail + "; distribuir esses horários pode ampliar a presença nesta faixa. Se precisar mudar folgas, gere novamente para conferir cinco dias consecutivos, afastamentos e bloqueios. Funções diferentes não foram consideradas substitutas.";
}

/** One operational occurrence per sector/date/exact slice, with deficient functions as context. */
export function sectorCoverageGaps(input: EscalaInput, index = buildCoveragePresence(input), scope: readonly string[] = visibleDates(input)): SectorCoverageGap[] {
  const dates = new Set(scope);
  const groups = new Map<string, EscalaInput["demands"]>();
  const groupsWithMinimum = new Set<EscalaInput["demands"]>();
  for (const demand of input.demands) {
    if (!dates.has(demand.date)) continue;
    const groupKey = key(demand.date, demand.sector);
    const group = groups.get(groupKey) ?? [];
    group.push(demand);
    groups.set(groupKey, group);
    if (demand.minimum > 0) groupsWithMinimum.add(group);
  }

  const result: SectorCoverageGap[] = [];
  for (const group of groupsWithMinimum) {
    const { date, sector } = group[0];
    let previous: SectorCoverageGap | undefined;
    const demands = group.filter(demand => demand.minimum > 0);
    for (const slice of timelineForDemands(date, sector, index, group)) {
      const references = demands.filter(demand => demand.start <= slice.start && demand.end >= slice.end);
      const roleGroups = new Map<string, CoverageRoleGap>();
      for (const demand of references) if (demand.role) {
        const id = JSON.stringify([demand.role, demand.estimated === true]);
        const present = slice.people.filter(person => person.role === demand.role).length;
        const prior = roleGroups.get(id);
        if (present < demand.minimum && (!prior || prior.minimum < demand.minimum)) roleGroups.set(id, { role: demand.role, present, minimum: demand.minimum, estimated: demand.estimated === true });
      }
      const roles = [...roleGroups.values()].sort((a, b) => Number(a.estimated) - Number(b.estimated) || a.role.localeCompare(b.role, "pt-BR"));
      const hard = slice.present < slice.minimum || roles.some(role => !role.estimated);
      const soft = slice.present < slice.estimate || roles.some(role => role.estimated);
      if (!hard && !soft) { previous = undefined; continue; }
      const estimated = !hard, minimum = hard ? slice.minimum : slice.estimate;
      const kind = slice.present === 0 ? "no-service" as const : hard ? "minimum" as const : "estimate" as const;
      if (previous && previous.end === slice.start && previous.present === slice.present && previous.minimum === minimum && previous.estimated === estimated && previous.kind === kind && JSON.stringify(previous.roles) === JSON.stringify(roles)) previous.end = slice.end;
      else {
        previous = { date, sector, start: slice.start, end: slice.end, present: slice.present, minimum, estimated, kind, roles, suggestion: suggestion(estimated, roles) };
        result.push(previous);
      }
    }
  }
  return result.sort((a, b) => Number(a.estimated) - Number(b.estimated) || Number(b.present === 0) - Number(a.present === 0) || a.sector.localeCompare(b.sector, "pt-BR") || a.date.localeCompare(b.date) || a.start - b.start);
}
