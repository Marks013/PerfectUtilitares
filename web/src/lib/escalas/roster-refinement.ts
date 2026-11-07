import { absoluteMinute, dateRange, dayOfWeek, visibleDates, weekStart } from "./dates";
import { buildCoveragePresence } from "./coverage-presence";
import { validateEscala } from "./validation";
import { validateEmployee } from "./validation-employee";
import { workJourney } from "./validation-time";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift } from "./types";

type Slice = { start: number; end: number; present: number; general: number; roleMinimum: Map<string, number>; rolePresent: Map<string, number>; roleMissing: number; deficit: number };
type Candidate = { person: EscalaEmployee; work: EscalaAssignment; off: EscalaAssignment; gain: number };
const key = (date: string, sector: string) => `${date}\0${sector}`;

/** One deterministic local improvement, never a substitute for the solver or its verifier. */
export function refineRoster(input: EscalaInput, budgetMs = 1500): EscalaInput {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return input;
  const deadline = performance.now() + Math.min(budgetMs, 1500);
  const expired = () => performance.now() >= deadline;
  if (!input.assignments.length || !input.demands.some(demand => demand.minimum > 0)) return input;
  const baseline = validateEscala(input);
  if (!baseline.valid || expired()) return input;
  const presence = buildCoveragePresence(input);
  const visible = new Set(visibleDates(input));
  const days = dateRange(input.startDate, input.endDate);
  const weekByDate = new Map(days.map(date => [date, weekStart(date)]));
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const closed = new Set(input.policy.closedDates);
  const assignments = new Map<string, EscalaAssignment[]>();
  for (const assignment of input.assignments) {
    const records = assignments.get(assignment.employeeId) ?? [];
    records.push(assignment);
    assignments.set(assignment.employeeId, records);
  }
  const demands = new Map<string, EscalaInput["demands"]>();
  for (const demand of input.demands) {
    if (demand.minimum <= 0) continue;
    const id = key(demand.date, demand.sector);
    const group = demands.get(id) ?? [];
    group.push(demand);
    demands.set(id, group);
  }
  const timelines = new Map<string, Slice[]>();
  const timeline = (date: string, sector: string): Slice[] => {
    const id = key(date, sector);
    const cached = timelines.get(id);
    if (cached) return cached;
    const references = demands.get(id) ?? [];
    const intervals = presence.get(id) ?? [];
    const points = [...new Set([...references.flatMap(demand => [demand.start, demand.end]), ...intervals.flatMap(interval => [interval.start, interval.end])])].sort((a, b) => a - b);
    const slices = points.slice(0, -1).map((start, index): Slice => {
      const end = points[index + 1];
      const people = new Map(intervals.filter(interval => interval.start <= start && interval.end >= end).map(interval => [interval.employee.id, interval.employee]));
      const rolePresent = new Map<string, number>();
      for (const person of people.values()) rolePresent.set(person.role, (rolePresent.get(person.role) ?? 0) + 1);
      let general = 0;
      const roleMinimum = new Map<string, number>();
      for (const demand of references) if (demand.start <= start && demand.end >= end) {
        if (demand.role) roleMinimum.set(demand.role, Math.max(roleMinimum.get(demand.role) ?? 0, demand.minimum));
        else general = Math.max(general, demand.minimum);
      }
      const roleMissing = [...roleMinimum].reduce((sum, [role, minimum]) => sum + Math.max(0, minimum - (rolePresent.get(role) ?? 0)), 0);
      return { start, end, present: people.size, general, roleMinimum, rolePresent, roleMissing, deficit: Math.max(0, general - people.size, roleMissing) };
    });
    timelines.set(id, slices);
    return slices;
  };
  const changes = new Map<string, number>();
  const change = (person: EscalaEmployee, date: string, shift: EscalaShift, delta: 1 | -1): number => {
    const id = JSON.stringify([person.id, date, shift.id, delta]);
    const cached = changes.get(id);
    if (cached !== undefined) return cached;
    const work = shift.segments.filter(segment => segment.kind === "WORK");
    let value = 0;
    for (const slice of timeline(date, person.sector)) {
      const minutes = work.reduce((sum, segment) => sum + Math.max(0, Math.min(slice.end, segment.end) - Math.max(slice.start, segment.start)), 0);
      if (!minutes) continue;
      const minimum = slice.roleMinimum.get(person.role) ?? 0;
      const present = slice.rolePresent.get(person.role) ?? 0;
      const roleMissing = slice.roleMissing - Math.max(0, minimum - present) + Math.max(0, minimum - present - delta);
      value += (Math.max(0, slice.general - slice.present - delta, roleMissing) - slice.deficit) * minutes;
    }
    changes.set(id, value);
    return value;
  };
  const candidates: Candidate[] = [];
  for (const person of input.employees) {
    if (expired()) return input;
    if (person.planningEnabled === false || person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED" || person.offMode === "FIXED") continue;
    const records = assignments.get(person.id) ?? [];
    const available = records.filter(record => !record.locked && visible.has(record.date) && dayOfWeek(record.date) !== 6
      && person.activeFrom <= record.date && (!person.activeUntil || person.activeUntil >= record.date));
    const offs = available.filter(record => record.kind === "OFF" && !closed.has(record.date) && !person.fixedOffDays.includes(dayOfWeek(record.date)));
    for (const work of available.filter(record => record.kind === "WORK")) {
      if (expired()) return input;
      const shift = shifts.get(work.shiftId ?? "");
      // This bounded neighborhood changes no adjoining civil date, Sunday or weekly duration.
      if (!shift || shift.segments.some(segment => segment.start < 0 || segment.end > 1440)) continue;
      const sectorDay = presence.get(key(work.date, person.sector)) ?? [];
      if (!sectorDay.some(interval => interval.employee.id !== person.id)) continue;
      if (change(person, work.date, shift, -1) > 0) continue;
      for (const off of offs) {
        if (weekByDate.get(work.date) !== weekByDate.get(off.date)) continue;
        const gain = -change(person, off.date, shift, 1);
        if (gain > 0) candidates.push({ person, work, off, gain });
      }
    }
  }
  candidates.sort((a, b) => b.gain - a.gain || a.person.id.localeCompare(b.person.id)
    || a.work.date.localeCompare(b.work.date) || a.off.date.localeCompare(b.off.date));
  const civilMinutes = new Map<string, number>();
  const toAbsoluteMinute: typeof absoluteMinute = (date, minute) => {
    const id = `${date}:${minute}`;
    const cached = civilMinutes.get(id);
    if (cached !== undefined) return cached;
    const value = absoluteMinute(date, minute);
    civilMinutes.set(id, value);
    return value;
  };
  for (const { person, work, off } of candidates.slice(0, 32)) {
    if (expired()) return input;
    const { shiftId: _shiftId, ...oldWork } = work;
    const newOff: EscalaAssignment = { ...oldWork, kind: "OFF" };
    const newWork: EscalaAssignment = { ...off, kind: "WORK", shiftId: work.shiftId };
    const replace = (record: EscalaAssignment) => record === work ? newOff : record === off ? newWork : record;
    const current = (assignments.get(person.id) ?? []).map(replace);
    const prior = new Map([...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])].map(record => [record.date, record]));
    const journeys = [...prior.values(), ...current].filter(record => record.kind === "WORK")
      .map(record => workJourney(record, shifts.get(record.shiftId ?? "") as EscalaShift, toAbsoluteMinute));
    const check = validateEmployee(input, person, { current, journeys,
      reservations: (baseline.boundaryReservations ?? []).filter(record => record.employeeId === person.id), days, visible, weekByDate });
    if (check.issues.some(issue => issue.severity === "ERROR")) continue;
    const proposal: EscalaInput = { ...input, assignments: input.assignments.map(replace) };
    if (validateEscala(proposal).valid && !expired()) return proposal;
  }
  return input;
}
