import { buildCoveragePresence } from "./coverage-presence";
import { dayOfWeek } from "./dates";
import { storeClosingMinutes } from "./store-hours";
import { manualShiftAt } from "./shift-catalog/manual-override";
import type { EscalaAssignment, EscalaInput, EscalaShift } from "./types";

export type MonthlyClockChoice = { employeeId: string; baseline: EscalaShift[]; candidates: EscalaShift[] };
export const MONTHLY_CLOCK_WORK_LIMIT = 2_000_000;
const MAX_SLOTS = 30_000;
const MAX_BOUNDARY_DISPLACEMENT = 90;
const paid = (shift: EscalaShift) => shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
const workAt = (shift: EscalaShift, start: number) => shift.segments.some(segment => segment.kind === "WORK" && segment.start <= start && start < segment.end);
const key = (date: string, sector: string) => JSON.stringify([date, sector]);
type Requirements = { general: number; roles: Map<string, number> };
type Slot = { date: string; start: number; end: number; total: number; roles: Map<string, number>; requirements: Requirements[] };

/** A single deterministic coordinate pass, never a roster search or a substitute for independent validation.
 * The ruler is the supplied demand snapshot. Only known WORK dates can contribute; there is no inferred attendance.
 * Every accepted change is non-worsening for both confirmed and estimated gaps, month, Sundays, closing and peak.
 * Named-role deficits and peaks also stay protected on common civil bands, aggregated across dates in each scope.
 * At the explicit work/size limits the entire pass falls back to the nearest stable references, not a partial winner.
 */
export function selectMonthlyClockReferences(input: EscalaInput, choices: readonly MonthlyClockChoice[]) {
  const fallback = new Map(choices.map(choice => [choice.employeeId, choice.baseline]));
  let workUnits = 0;
  const result = (references = fallback, changes = 0, limited = false) => ({ references, changes, workUnits, limited });
  if (!choices.length || !input.demands.length || !input.assignments.some(record => record.kind === "WORK")) return result();
  if (choices.length > 400 || input.employees.length > 400 || input.assignments.length > 20_000 || input.demands.length > 12_000) return result(fallback, 0, true);
  if (!choices.some(choice => choice.candidates.some(candidate => !choice.baseline.some(reference => reference.id === candidate.id)))) return result();
  const limit = Symbol("monthly clock work limit");
  const tick = () => { if (workUnits >= MONTHLY_CLOCK_WORK_LIMIT) throw limit; workUnits++; };
  try {
    const registeredClocks = new Set(input.shifts.map(shift => shift.id));
    if (input.assignments.some(record => record.kind === "WORK" && !registeredClocks.has(record.shiftId ?? ""))) return result();
    const seen = new Set<string>();
    for (const record of input.assignments) {
      const identity = key(record.date, record.employeeId);
      if (seen.has(identity)) return result();
      seen.add(identity);
    }
    const people = new Map(input.employees.map(person => [person.id, person]));
    const references = new Map(choices.map(choice => [choice.employeeId, [...choice.baseline]]));
    const byPerson = new Map(choices.map(choice => [choice.employeeId, choice]));
    const recordsByGroup = new Map<string, EscalaAssignment[]>();
    const recordsByPerson = new Map<string, EscalaAssignment[]>();
    for (const record of input.assignments) {
      const group = key(record.date, people.get(record.employeeId)?.sector ?? "");
      const grouped = recordsByGroup.get(group) ?? []; grouped.push(record); recordsByGroup.set(group, grouped);
      const personal = recordsByPerson.get(record.employeeId) ?? []; personal.push(record); recordsByPerson.set(record.employeeId, personal);
    }
    const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
    for (const choice of choices) for (const shift of [...choice.baseline, ...choice.candidates]) shifts.set(shift.id, shift);
    const variable = (record: EscalaAssignment) => {
      const person = people.get(record.employeeId);
      return record.kind === "WORK" && !record.locked && person && person.planningEnabled !== false
        && person.scheduleMode !== "MISSING" && person.scheduleMode !== "UNTIMED"
        && record.date >= input.startDate && record.date <= input.endDate && record.date >= person.activeFrom
        && (!person.activeUntil || record.date <= person.activeUntil) && !manualShiftAt(person, record.date);
    };
    const referenceFor = (record: EscalaAssignment) => {
      const current = shifts.get(record.shiftId ?? "");
      const baseline = byPerson.get(record.employeeId)?.baseline;
      return baseline?.find(shift => current && paid(shift) === paid(current)) ?? (baseline?.length === 1 ? baseline[0] : undefined);
    };
    const records = input.assignments.map(record => {
      const shift = variable(record) ? referenceFor(record) : undefined;
      return shift ? { ...record, shiftId: shift.id } : record;
    });
    const closed = new Set(input.policy.closedDates);
    const presence = buildCoveragePresence({ ...input, shifts: [...shifts.values()], assignments: records });
    const groups = new Map<string, EscalaInput["demands"]>();
    for (const demand of input.demands) {
      if (demand.date < input.startDate || demand.date > input.endDate || closed.has(demand.date)
        || demand.minimum <= 0 || demand.start < 0 || demand.end > 1440 || demand.start >= demand.end) continue;
      const id = key(demand.date, demand.sector), group = groups.get(id) ?? [];
      group.push({ ...demand }); groups.set(id, group);
    }
    const slots = new Map<string, Slot[]>(); let slotCount = 0;
    const closing = storeClosingMinutes(input);
    for (const [id, demands] of groups) {
      const { date, sector } = demands[0];
      const intervals = presence.get(date + "\0" + sector) ?? [];
      const points = new Set([...demands.flatMap(demand => [demand.start, demand.end]), ...intervals.flatMap(interval => [interval.start, interval.end]), Math.max(0, closing - 60), closing]);
      for (const record of recordsByGroup.get(id) ?? []) {
        tick();
        if (record.date !== date || people.get(record.employeeId)?.sector !== sector || !variable(record)) continue;
        for (const candidate of byPerson.get(record.employeeId)?.candidates ?? []) {
          for (const segment of candidate.segments) { points.add(segment.start); points.add(segment.end); }
        }
      }
      const boundaries = [...points].filter(point => point >= 0 && point <= 1440).sort((a, b) => a - b);
      const cells: Slot[] = [];
      for (let index = 0; index < boundaries.length - 1; index++) {
        tick(); if (++slotCount > MAX_SLOTS) throw limit;
        const start = boundaries[index], end = boundaries[index + 1];
        const requirements: Requirements[] = [0, 1].map(() => ({ general: 0, roles: new Map() }));
        for (const demand of demands) {
          tick(); if (demand.start > start || demand.end < end) continue;
          const required = requirements[Number(demand.estimated === true)];
          if (demand.role) required.roles.set(demand.role, Math.max(required.roles.get(demand.role) ?? 0, demand.minimum));
          else required.general = Math.max(required.general, demand.minimum);
        }
        if (requirements.every(required => !required.general && !required.roles.size)) continue;
        const members = new Map<string, string>();
        for (const interval of intervals) {
          tick(); if (interval.start <= start && interval.end >= end) members.set(interval.employee.id, interval.employee.role);
        }
        const roles = new Map<string, number>();
        for (const role of members.values()) roles.set(role, (roles.get(role) ?? 0) + 1);
        cells.push({ date, start, end, total: members.size, roles, requirements });
      }
      slots.set(id, cells);
    }
    // Share exact civil boundaries across dates without rebuilding the grid for each candidate.
    const commonPoints = new Map<string, Set<number>>();
    for (const [id, cells] of slots) {
      const sector = groups.get(id)?.[0]?.sector;
      if (sector === undefined) continue;
      const points = commonPoints.get(sector) ?? new Set<number>();
      for (const slot of cells) { tick(); points.add(slot.start); points.add(slot.end); }
      commonPoints.set(sector, points);
    }
    const commonBands = new Map([...commonPoints].map(([sector, points]) => {
      const boundaries = [...points].sort((a, b) => a - b);
      return [sector, { boundaries, indices: new Map(boundaries.map((point, index) => [point, index])) }] as const;
    }));
    const increases = (values: Map<string, number>, reference: Map<string, number>) => {
      for (const [id, value] of values) { tick(); if (value > (reference.get(id) ?? 0)) return true; }
      return false;
    }
    const gap = (slot: Slot, required: Requirements, delta: number, role: string) => {
      let functions = 0;
      for (const [name, minimum] of required.roles) { tick(); functions += Math.max(0, minimum - (slot.roles.get(name) ?? 0) - (name === role ? delta : 0)); }
      return Math.max(0, required.general - slot.total - delta, functions);
    };
    let changes = 0;
    for (const choice of [...choices].sort((a, b) => a.employeeId.localeCompare(b.employeeId))) {
      const person = people.get(choice.employeeId);
      if (!person || person.planningEnabled === false) continue;
      for (const baseline of choice.baseline) {
        const dates = new Set((recordsByPerson.get(choice.employeeId) ?? []).filter(record => variable(record)
          && referenceFor(record)?.id === baseline.id).map(record => record.date));
        if (!dates.size) continue;
        const cells = [...dates].flatMap(date => slots.get(key(date, person.sector)) ?? []);
        const metrics = (candidate: EscalaShift) => {
          const totals = Array<number>(10).fill(0);
          const roleDeficit = new Map<string, number>(), rolePeak = new Map<string, number>();
          const bands = commonBands.get(person.sector);
          for (const slot of cells) {
            tick(); const delta = Number(workAt(candidate, slot.start)) - Number(workAt(baseline, slot.start));
            const inMonth = !input.visibleMonth || slot.date.startsWith(input.visibleMonth), sunday = dayOfWeek(slot.date) === 6;
            const scopes = ["HORIZON", ...(inMonth ? ["MONTH"] : []), ...(sunday ? ["SUNDAYS", ...(inMonth ? ["MONTH_SUNDAYS"] : [])] : [])];
            for (const [basis, required] of slot.requirements.entries()) {
              const missing = gap(slot, required, delta, person.role), length = slot.end - slot.start, offset = basis * 5;
              totals[offset] += missing * length;
              if (inMonth) totals[offset + 1] += missing * length;
              if (sunday) totals[offset + 2] += missing * length;
              if (slot.start >= closing - 60 && slot.end <= closing) totals[offset + 3] += missing * length;
              totals[offset + 4] = Math.max(totals[offset + 4], missing);
              // General staffing gains cannot pay for a deficit in a distinct required role/time band.
              // Only this person's role changes. Dates are deliberately absent from the aggregation key.
              const minimum = required.roles.get(person.role);
              if (minimum === undefined) continue;
              const roleMissing = Math.max(0, minimum - (slot.roles.get(person.role) ?? 0) - delta);
              if (!roleMissing) continue;
              const first = bands?.indices.get(slot.start), last = bands?.indices.get(slot.end);
              if (!bands || first === undefined || last === undefined) throw limit;
              for (let index = first; index < last; index++) for (const scope of scopes) {
                tick();
                const start = bands.boundaries[index], end = bands.boundaries[index + 1];
                const id = JSON.stringify([basis, scope, person.sector, person.role, start, end]);
                roleDeficit.set(id, (roleDeficit.get(id) ?? 0) + roleMissing * (end - start));
                rolePeak.set(id, Math.max(rolePeak.get(id) ?? 0, roleMissing));
              }
            }
          }
          return { totals, roleDeficit, rolePeak };
        };
        let best = baseline, bestMetrics = metrics(baseline);
        const initialMetrics = bestMetrics;
        const alternatives = [...choice.candidates].sort((a, b) => a.id.localeCompare(b.id)).filter(candidate => paid(candidate) === paid(baseline)
          && candidate.segments.length === baseline.segments.length
          && candidate.segments.every((segment, index) => segment.kind === baseline.segments[index].kind
            && Math.abs(segment.start - baseline.segments[index].start) <= MAX_BOUNDARY_DISPLACEMENT
            && Math.abs(segment.end - baseline.segments[index].end) <= MAX_BOUNDARY_DISPLACEMENT
            && segment.start >= 300 && segment.end <= 1320
            && (segment.kind !== "BREAK" || segment.end - segment.start <= 120))).slice(0, 4);
        for (const candidate of alternatives) {
          const score = metrics(candidate);
          if (score.totals.some((value, index) => value > initialMetrics.totals[index]) || !score.totals.some((value, index) => value < initialMetrics.totals[index])) continue;
          if (increases(score.roleDeficit, initialMetrics.roleDeficit) || increases(score.rolePeak, initialMetrics.rolePeak)) continue;
          const firstDifference = score.totals.findIndex((value, index) => value !== bestMetrics.totals[index]);
          if (firstDifference >= 0 && score.totals[firstDifference] < bestMetrics.totals[firstDifference]) { best = candidate; bestMetrics = score; }
        }
        if (best.id === baseline.id) continue;
        changes++;
        references.set(choice.employeeId, (references.get(choice.employeeId) ?? []).map(shift => shift.id === baseline.id ? best : shift));
        for (const slot of cells) {
          tick(); const delta = Number(workAt(best, slot.start)) - Number(workAt(baseline, slot.start));
          slot.total += delta; slot.roles.set(person.role, (slot.roles.get(person.role) ?? 0) + delta);
        }
      }
    }
    return result(references, changes);
  } catch (error) {
    if (error !== limit) throw error;
    return result(fallback, 0, true);
  }
}
