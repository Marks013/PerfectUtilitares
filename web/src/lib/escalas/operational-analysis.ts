import { buildCoveragePresence, coverageAt, type CoveragePresence } from "./coverage-presence";
import { addDays, visibleDates } from "./dates";
import { applyRestEligibility } from "./eligibility";
import { isHoursReferenceOnly } from "./hours-reference";
import { compareSectors } from "./order";
import type { OperationalAnalysis, OperationalAnalysisOptions, OperationalCounts, OperationalDay, OperationalWindow } from "./coverage-report-contracts";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift } from "./types";

const key = (date: string, id: string) => date + "\0" + id;
const active = (person: EscalaEmployee, date: string) => person.activeFrom <= date && (!person.activeUntil || person.activeUntil >= date);
const timed = (person: EscalaEmployee) => person.scheduleMode !== "MISSING" && person.scheduleMode !== "UNTIMED";
const validShift = (shift?: EscalaShift) => !!shift?.segments.length && shift.segments.every(segment => Number.isInteger(segment.start)
  && Number.isInteger(segment.end) && segment.start >= 0 && segment.end <= 2880 && segment.end > segment.start);
const emptyCounts = (): OperationalCounts => ({ workTimed: 0, workWithoutClock: 0, duty: 0, off: 0, absence: 0,
  holiday: 0, excluded: 0, unassigned: 0, unknownClock: 0, presentTimed: 0, pause: 0, workOutsideWindow: 0 });

/** A view of existing assignments and canonical attendance indexes, never a generator or demand model. */
export function analyzeOperational(raw: EscalaInput, options: OperationalAnalysisOptions = {}): OperationalAnalysis {
  const visible = new Set(visibleDates(raw)), requested = [...new Set(options.dates ?? [...visible])].sort();
  const dates = requested.filter(date => visible.has(date)), omittedDates = requested.filter(date => !visible.has(date));
  const people = [...new Map(raw.employees.map(person => [person.id, applyRestEligibility(person)])).values()];
  const input = { ...raw, employees: people }, limitations: string[] = [];
  const result: OperationalAnalysis = { status: "READY", branchCode: raw.branchCode, visibleMonth: raw.visibleMonth ?? null,
    dates, omittedDates, technicalPeriod: { startDate: raw.startDate, endDate: raw.endDate }, limitations, days: [] };
  if (isHoursReferenceOnly(input) || !dates.length) {
    result.status = "UNAVAILABLE"; limitations.push(isHoursReferenceOnly(input) ? "HOURS_ONLY_WITHOUT_ROSTER" : "NO_VISIBLE_DATES"); return result;
  }
  if (omittedDates.length) limitations.push("DATES_OUTSIDE_VISIBLE_PERIOD");
  const records = new Map<string, EscalaAssignment>();
  for (const person of people) for (const record of [...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])]) records.set(key(record.date, record.employeeId), record);
  for (const record of raw.assignments) records.set(key(record.date, record.employeeId), record);
  const shifts = new Map(raw.shifts.map(shift => [shift.id, shift]));
  const eligible = { ...input, shifts: raw.shifts.filter(validShift) };
  const createIndexes = (source: EscalaInput) => ({ work: buildCoveragePresence(source),
    credit: buildCoveragePresence({ ...source, shifts: source.shifts.map(shift => ({ ...shift, segments: shift.segments.map(segment =>
      ({ ...segment, kind: segment.kind === "BREAK" ? "BREAK" as const : "WORK" as const })) })) }),
    pause: buildCoveragePresence({ ...source, shifts: source.shifts.map(shift => ({ ...shift, segments: shift.segments.map(segment =>
      ({ ...segment, kind: segment.kind === "WORK" ? "BREAK" as const : "WORK" as const })) })) }) });
  const indexes = createIndexes(eligible);
  const perShift = new Map<string, ReturnType<typeof createIndexes>>();
  const sectorPeople = new Map<string, EscalaEmployee[]>();
  for (const person of people) { const list = sectorPeople.get(person.sector) ?? []; list.push(person); sectorPeople.set(person.sector, list); }
  const sectors = [...new Set([...sectorPeople.keys(), ...raw.demands.filter(demand => dates.includes(demand.date)).map(demand => demand.sector)])].sort(compareSectors);
  const clean = (source: ReturnType<typeof createIndexes>, date: string, sector: string, members: EscalaEmployee[]) => {
    const excluded = new Set(members.filter(person => !timed(person) || records.get(key(date, person.id))?.kind === "DUTY").map(person => person.id));
    for (const index of Object.values(source)) {
      const id = key(date, sector); index.set(id, (index.get(id) ?? []).filter(interval => !excluded.has(interval.employee.id)));
    }
  };
  const shape = (date: string, sector: string, members: EscalaEmployee[], start: number): OperationalCounts => {
    const counts = emptyCounts(), present = new Set(coverageAt(indexes.work, date, sector, start).map(person => person.id));
    const pause = new Set(coverageAt(indexes.pause, date, sector, start).map(person => person.id));
    counts.presentTimed = present.size;
    for (const person of members) {
      if (person.planningEnabled === false) { counts.excluded++; continue; }
      const record = records.get(key(date, person.id));
      if (!record) { counts.unassigned++; continue; }
      if (record.kind === "DUTY") counts.duty++;
      else if (record.kind === "OFF") counts.off++;
      else if (record.kind === "ABSENCE") counts.absence++;
      else if (record.kind === "HOLIDAY") counts.holiday++;
      else if (!timed(person) || !validShift(shifts.get(record.shiftId ?? ""))) {
        counts.workWithoutClock++; if (person.scheduleMode !== "UNTIMED") counts.unknownClock++;
      } else {
        counts.workTimed++;
        if (!present.has(person.id)) { if (pause.has(person.id)) counts.pause++; else counts.workOutsideWindow++; }
      }
    }
    return counts;
  };
  const bounds = (source: ReturnType<typeof createIndexes>, date: string, sector: string) => [...new Set([0, 1440,
    ...Object.values(source).flatMap(index => (index.get(key(date, sector)) ?? []).flatMap(interval => [interval.start, interval.end])),
    ...raw.demands.filter(demand => demand.date === date && demand.sector === sector).flatMap(demand => [demand.start, demand.end])])]
    .filter(point => Number.isFinite(point) && point >= 0 && point <= 1440).sort((a, b) => a - b);
  const integrate = (index: CoveragePresence, date: string, sector: string, points: number[]) => points.slice(0, -1)
    .reduce((sum, start, i) => sum + coverageAt(index, date, sector, start).length * (points[i + 1] - start), 0);
  for (const date of dates) for (const sector of sectors) {
    const members = (sectorPeople.get(sector) ?? []).filter(person => active(person, date));
    clean(indexes, date, sector, members);
    const counts = shape(date, sector, members, 0);
    const incomplete = counts.unknownClock > 0 || members.some(person => person.planningEnabled !== false && timed(person)
      && !records.has(key(date, person.id)) && !raw.policy.closedDates.includes(date))
      || !members.length && raw.demands.some(demand => demand.date === date && demand.sector === sector && demand.minimum > 0);
    const points = bounds(indexes, date, sector), work = integrate(indexes.work, date, sector, points), credit = integrate(indexes.credit, date, sector, points);
    const workPeople = new Set((indexes.work.get(key(date, sector)) ?? []).map(interval => interval.employee.id));
    const pausePeople = new Set((indexes.pause.get(key(date, sector)) ?? []).map(interval => interval.employee.id));
    counts.presentTimed = workPeople.size; counts.pause = pausePeople.size;
    counts.workOutsideWindow = members.filter(person => person.planningEnabled !== false && timed(person)
      && records.get(key(date, person.id))?.kind === "WORK" && validShift(shifts.get(records.get(key(date, person.id))?.shiftId ?? "")) && !workPeople.has(person.id)).length;
    const row: OperationalDay = { date, sector, status: incomplete ? "PARTIAL" : "KNOWN", counts, knownWorkPersonMinutes: work,
      workPersonMinutes: incomplete ? null : work, creditedPersonMinutes: incomplete ? null : credit, shiftGroups: [] };
    if (options.details) row.windows = points.slice(0, -1).map((start, i): OperationalWindow => {
      const end = points[i + 1], roles = new Map<string, number>();
      for (const person of coverageAt(indexes.work, date, sector, start)) roles.set(person.role, (roles.get(person.role) ?? 0) + 1);
      return { date, sector, start, end, durationMinutes: end - start, counts: shape(date, sector, members, start),
        knownWorkPersonMinutes: coverageAt(indexes.work, date, sector, start).length * (end - start),
        knownCreditedPersonMinutes: coverageAt(indexes.credit, date, sector, start).length * (end - start),
        roles: [...roles].sort(([a], [b]) => compareSectors(a, b)).map(([role, presentTimed]) => ({ role, presentTimed })) };
    });
    const assignedShifts = new Set<string>();
    for (const person of members.filter(person => person.planningEnabled !== false && timed(person))) for (const day of [addDays(date, -1), date]) {
      const record = records.get(key(day, person.id));
      if (record?.kind === "WORK" && validShift(shifts.get(record.shiftId ?? ""))) assignedShifts.add((record.shiftId as string));
    }
    for (const shiftId of [...assignedShifts].sort()) {
      let source = perShift.get(shiftId);
      if (!source) {
        // Preserve non-WORK overrides while isolating a canonical shift. Cache once per assigned shift, not per minute/day.
        const keep = (record: EscalaAssignment) => record.kind !== "WORK" || record.shiftId === shiftId;
        source = createIndexes({ ...eligible, employees: people.map(person => ({ ...person, history: person.history.filter(keep),
          planningHistory: person.planningHistory?.filter(keep), planningFuture: person.planningFuture?.filter(keep) })), assignments: raw.assignments.filter(keep) });
        perShift.set(shiftId, source);
      }
      clean(source, date, sector, members);
      const groupPoints = bounds(source, date, sector), intervals = source.credit.get(key(date, sector)) ?? [];
      if (!intervals.length) continue;
      row.shiftGroups.push({ shiftId, label: (shifts.get(shiftId) as NonNullable<ReturnType<typeof shifts.get>>).name, people: new Set(intervals.map(interval => interval.employee.id)).size,
        knownWorkPersonMinutes: integrate(source.work, date, sector, groupPoints), knownCreditedPersonMinutes: integrate(source.credit, date, sector, groupPoints) });
    }
    row.shiftGroups.sort((a, b) => compareSectors(a.label, b.label) || (a.shiftId < b.shiftId ? -1 : a.shiftId > b.shiftId ? 1 : 0));
    if (incomplete) result.status = "PARTIAL";
    result.days.push(row);
  }
  if (result.status === "PARTIAL") limitations.push("INCOMPLETE_TIMED_ASSIGNMENTS");
  return result;
}
