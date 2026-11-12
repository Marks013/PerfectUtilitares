import { absoluteMinute, addDays as importDate, dateRange, dayOfWeek, visibleDates, weekStart } from "./dates";
import { keepsPriorityLeader } from "./movement";
import { keepsSaturdayBalance } from "./saturday-balance";
import { regularRestQuality } from "./rest-spacing";
import { exchangeRestImprovement, exchangeRestRepair } from "./rest-exchange";
import { repairUntimedRests } from "./untimed-rest-repair";
import { buildCoveragePresence } from "./coverage-presence";
import { validateEscala } from "./validation";
import { validateEmployee } from "./validation-employee";
import { workJourney } from "./validation-time";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift, EscalaValidation } from "./types";

type Slice = { start: number; end: number; present: number; general: number; roleMinimum: Map<string, number>; rolePresent: Map<string, number>; roleMissing: number; deficit: number };
type Candidate = { person: EscalaEmployee; work: EscalaAssignment; off: EscalaAssignment; gain: number; longGain: number; pairGain: number };
const key = (date: string, sector: string) => `${date}\0${sector}`;

/** A bounded batch of independent sector improvements, never a substitute for the solver or its verifier. */
export function refineRoster(input: EscalaInput, budgetMs?: number): EscalaInput {
  // Existing drafts may need several local exchanges before any complete seed is valid.
  // This bounded preparation is separate from CP-SAT's unchanged 12-second search.
  const repairRequired = input.employees.some(person => regularRestQuality(input, person).longWindows.length > 0);
  const allotted = budgetMs ?? (repairRequired ? 2500 : 1500);
  if (!Number.isFinite(allotted) || allotted <= 0) return input;
  const deadline = performance.now() + Math.min(allotted, 2500);
  const state = { checked: 0 };
  let proposal = input;
  let best = input;
  let validation = validateEscala(input);
  const repairing = validation.issues.some(issue => issue.code === "CONSECUTIVE_REST_LIMIT");
  for (let pass = 0; pass < 32 && state.checked < 32 && performance.now() < deadline - 160; pass++) {
    // Offer a safe joint exchange before independent improvements consume every check.
    let next = validation.valid ? exchangeRestImprovement(proposal, validation, deadline - 120, state) : proposal;
    if (next === proposal) next = refinePass(proposal, deadline - 120, state, validation);
    if (next === proposal && validation.issues.some(issue => issue.code === "CONSECUTIVE_REST_LIMIT")) next = exchangeRestRepair(proposal, validation, deadline - 120);
    if (next === proposal && validation.issues.some(issue => issue.code === "CONSECUTIVE_REST_LIMIT")) next = repairUntimedRests(proposal, validation, deadline - 120);
    if (next === proposal) break;
    proposal = next;
    validation = validateEscala(proposal);
    if (validation.valid) {
      best = proposal;
      if (repairing) break;
    }
  }
  return best;
}

function refinePass(input: EscalaInput, deadline: number, state: { checked: number }, baseline: EscalaValidation): EscalaInput {
  const expired = () => performance.now() >= deadline;
  if (!input.assignments.length || !input.demands.some(demand => demand.minimum > 0)) return input;
  if (baseline.issues.some(issue => issue.severity === "ERROR" && issue.code !== "CONSECUTIVE_REST_LIMIT") || expired()) return input;
  const repairs = new Set(baseline.issues.filter(issue => issue.code === "CONSECUTIVE_REST_LIMIT").map(issue => issue.employeeId));
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
    if (repairs.size && !repairs.has(person.id)) continue;
    if (expired()) return input;
    if (person.planningEnabled === false || person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED" || person.offMode === "FIXED") continue;
    const records = assignments.get(person.id) ?? [];
    const previousQuality = regularRestQuality(input, person, records);
    const repairDays = new Set(previousQuality.longWindows.flatMap(day => [day, importDate(day, 1), importDate(day, 2)]));
    const available = records.filter(record => !record.locked && (repairs.size > 0 || visible.has(record.date)) && dayOfWeek(record.date) !== 6
      && person.activeFrom <= record.date && (!person.activeUntil || person.activeUntil >= record.date));
    const offs = available.filter(record => record.kind === "OFF" && (!repairs.size || repairDays.has(record.date))
      && !closed.has(record.date) && !person.fixedOffDays.includes(dayOfWeek(record.date)));
    for (const work of available.filter(record => record.kind === "WORK")) {
      if (expired()) return input;
      const shift = shifts.get(work.shiftId ?? "");
      // This bounded neighborhood changes no adjoining civil date, Sunday or weekly duration.
      if (!shift || shift.segments.some(segment => segment.start < 0 || segment.end > 1440)) continue;
      const sectorDay = presence.get(key(work.date, person.sector)) ?? [];
      if (!sectorDay.some(interval => interval.employee.id !== person.id)) continue;
      if (!keepsPriorityLeader(input, person, work.date)) continue;
      const loss = change(person, work.date, shift, -1);
      // A monthly gain cannot silently move a shortage to another sector/day.
      if (loss > 0) continue;
      for (const off of offs) {
        if (weekByDate.get(work.date) !== weekByDate.get(off.date)) continue;
        const gain = -change(person, off.date, shift, 1) - loss;
        if (gain < 0) continue;
        const current = records.map(record => record === work ? { ...record, kind: "OFF" as const, shiftId: undefined }
          : record === off ? { ...record, kind: "WORK" as const, shiftId: work.shiftId } : record);
        const quality = regularRestQuality(input, person, current);
        const longGain = previousQuality.longWindows.length - quality.longWindows.length;
        const pairGain = previousQuality.adjacentPairs - quality.adjacentPairs;
        if (longGain < 0 || pairGain < 0 || gain === 0 && longGain === 0 && pairGain === 0) continue;
        candidates.push({ person, work, off, gain, longGain, pairGain });
      }
    }
  }
  candidates.sort((a, b) => b.longGain - a.longGain || b.pairGain - a.pairGain || b.gain - a.gain || a.person.id.localeCompare(b.person.id)
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
  const replacements = new Map<EscalaAssignment, EscalaAssignment>();
  const improvedPeople = new Set<string>(), usedSectorDates = new Set<string>();
  for (const { person, work, off, longGain } of candidates) {
    if (expired()) break;
    // Distinct sector/dates keep coverage deltas independent; one exchange per person keeps checks composable.
    const sourceDay = key(work.date, person.sector), targetDay = key(off.date, person.sector);
    if (improvedPeople.has(person.id) || usedSectorDates.has(sourceDay) || usedSectorDates.has(targetDay)) continue;
    if (state.checked++ >= 32) break;
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
    if (check.issues.some(issue => issue.severity === "ERROR" && !(longGain > 0 && issue.code === "CONSECUTIVE_REST_LIMIT"))) continue;
    if (regularRestQuality(input, person, current).adjacentPairs > regularRestQuality(input, person, assignments.get(person.id) ?? []).adjacentPairs) continue;
    // Earlier independent-sector exchanges may share an explicitly responsible leader.
    if (input.movementPriorities?.length && !keepsPriorityLeader({ ...input,
      assignments: input.assignments.map(record => replace(replacements.get(record) ?? record)),
    }, person, work.date)) continue;
    replacements.set(work, newOff);
    replacements.set(off, newWork);
    const candidate = input.assignments.map(record => replacements.get(record) ?? record);
    if (!keepsSaturdayBalance(input, candidate)) { replacements.delete(work); replacements.delete(off); continue; }
    improvedPeople.add(person.id); usedSectorDates.add(sourceDay); usedSectorDates.add(targetDay);
  }
  if (!replacements.size || expired()) return input;
  // The caller verifies the full batch after every required repair has been considered.
  const proposal: EscalaInput = { ...input, assignments: input.assignments.map(record => replacements.get(record) ?? record) };
  return proposal;
}
