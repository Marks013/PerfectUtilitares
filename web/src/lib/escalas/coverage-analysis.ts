import { coverageBasis } from "./automatic-coverage";
import { canonicalBranchCode } from "./branch-code";
import { buildCoveragePresence, coverageTimeline, type CoveragePresence } from "./coverage-presence";
import { dateRange, visibleDates, weekStart } from "./dates";
import { applyRestEligibility } from "./eligibility";
import { fpre136WeekdayMinutes } from "./fpre136-schedule";
import { isHoursReferenceOnly } from "./hours-reference";
import { effectiveWeeklyMinutes } from "./labor-rules";
import { compareSectors } from "./order";
import { planningWeeklyHours } from "./preparation";
import { storeClosingMinutes } from "./store-hours";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, WeeklyHours } from "./types";

type CoverageAnalysisStatus = "READY" | "PARTIAL" | "UNAVAILABLE";
export type CoverageAnalysisOptions = {
  /** Defaults to the intersection of the two visible periods. Explicit dates may include technical context. */
  dates?: readonly string[];
  details?: boolean;
  /** Restricts the nominal comparison only; it never scales targets or hides actual timed presence. */
  comparableEmployeeIds?: readonly string[];
  referenceOrigin?: "PREPARED" | "PERSISTED";
  /** Optional explicit scenario. Without it, known imported or individual references are used; 44h is never assumed. */
  nominalReferenceWeeklyHours?: WeeklyHours;
  nominalReferenceOrigin?: "HYPOTHETICAL" | "REGISTERED" | "INFERRED";
  /** Known original assignments/clocks, supplied separately from the prepared coverage target. */
  originalInput?: EscalaInput;
  /** An earlier roster, never the source of a replacement target. */
  previousInput?: EscalaInput;
};
type CoveragePeakWindow = {
  date: string; start: number; end: number; missing: number;
  required: number; present: number; sectorMissing: number; roleMissing: number;
};
export type CoverageDemandMetrics = {
  requiredPersonMinutes: number;
  coveredPersonMinutes: number | null;
  deficitPersonMinutes: number | null;
  /** Maximum simultaneous shortage including distinct function deficits; never a sum of peaks. */
  peakMissing: number | null;
  /** Headcount shortage only; this does not detect a wrong distribution of functions. */
  peakSectorMissing: number | null;
  /** Occurrence of peakMissing. Ties use earliest civil date, then start, then end; unknown or no shortage yields null. */
  peakWindow: CoveragePeakWindow | null;
};
type CoverageSliceReference = {
  required: number;
  missing: number | null;
  sectorMissing: number | null;
  roles: { role: string; required: number; present: number; missing: number | null }[];
};
export type CoverageAnalysisSlice = {
  date: string; start: number; end: number; presentKnown: number; unknownPeople: number; withoutClockPeople: number;
  confirmed: CoverageSliceReference | null;
  estimated: CoverageSliceReference | null;
};
type CoverageAvailability = {
  sector: string;
  /** All minute totals describe this cohort only. Untimed people are informational, not zero-hour workers. */
  scope: "TIMED_WORK";
  status: CoverageAnalysisStatus;
  unknownPersonDays: number;
  withoutClockPeople: number;
  withoutClockPersonDays: number;
  /** Known WORK only, including partial intervals; no credit is inferred for unknown clocks. */
  knownWorkPersonMinutes: number;
  availablePersonMinutes: number | null;
  /** WORK plus PAID_BREAK, deduplicated per person; never operational presence during a pause. */
  creditedPersonMinutes: number | null;
};
export type CoverageSectorAnalysis = CoverageAvailability & {
  /** Same nominal helper as the global comparison, restricted to this sector's comparable cohort. */
  nominal: CoverageNominalComparison;
  /** Independent rulers. Never add confirmed and estimated deficits together. */
  confirmed: CoverageDemandMetrics | null;
  estimated: CoverageDemandMetrics | null;
  details?: CoverageAnalysisSlice[];
};
type CoverageSectorMetrics = Omit<CoverageSectorAnalysis, "nominal">;
type CoverageNominalOrigin = "HYPOTHETICAL" | "REGISTERED" | "INFERRED" | "FPRE136_INFERRED" | "CONFIGURED_INDIVIDUAL" | "MIXED" | "UNAVAILABLE";
type CoverageNominalComparison = {
  origin: CoverageNominalOrigin;
  /** Null for heterogeneous or absent references. Inferred imported hours are not a contract. */
  referenceWeeklyHours: number | null;
  referencePeople: number;
  withoutReferencePeople: number;
  sourceGroups: { origin: CoverageNominalOrigin; weeklyHours: number; people: number }[];
  referenceCapacityHours: number | null;
  preparedWeeklyHoursMin: number | null;
  preparedWeeklyHoursMax: number | null;
  candidateWeeklyHoursMin: number | null;
  candidateWeeklyHoursMax: number | null;
  scenarios: { weeklyHours: 40 | 42; capacityHours: number | null; lostHours: number | null;
    equivalentPeople: number | null; additionalEquivalentPeople: number | null }[];
};
export type CoverageAnalysis = {
  status: CoverageAnalysisStatus;
  dates: string[];
  omittedDates: string[];
  limitations: string[];
  basis: { origin: "PREPARED" | "PERSISTED"; status: "VALID" | "MISSING" | "STALE" | "NOT_REQUIRED";
    fingerprint: string | null; needsRegeneration: boolean };
  cohort: { comparablePeople: number; scope: "COMMON_ELIGIBLE" | "EXPLICIT_IDS";
    excludedByReason: Record<string, number>; weeklyHoursSources: Record<string, number> };
  nominal: CoverageNominalComparison;
  sectors: CoverageSectorAnalysis[];
  originalAvailability: CoverageAvailability[] | null;
  previous: { status: "NOT_PROVIDED" | "NOT_COMPARABLE" | "COMPARABLE"; reason: string | null;
    sectors: CoverageSectorAnalysis[] | null };
};

const key = (date: string, id: string) => date + "\0" + id;
const active = (person: EscalaEmployee, date: string) => date >= person.activeFrom && (!person.activeUntil || date <= person.activeUntil);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const eligibleInput = (input: EscalaInput): EscalaInput => ({ ...input,
  employees: [...new Map(input.employees.map(person => [person.id, applyRestEligibility(person)])).values()] });
const timed = (person: EscalaEmployee) => person.scheduleMode !== "MISSING" && person.scheduleMode !== "UNTIMED";

function records(input: EscalaInput) {
  const result = new Map<string, EscalaAssignment>();
  for (const person of input.employees) for (const record of [...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])])
    result.set(key(record.date, record.employeeId), record);
  for (const record of input.assignments) result.set(key(record.date, record.employeeId), record);
  return result;
}

/** Integrate unions per person, not raw segment lengths or duplicate assignments. */
function personMinutes(index: CoveragePresence, date: string, sector: string) {
  const people = new Map<string, { start: number; end: number }[]>();
  for (const interval of index.get(key(date, sector)) ?? []) {
    const list = people.get(interval.employee.id) ?? [];
    list.push(interval); people.set(interval.employee.id, list);
  }
  let total = 0;
  for (const list of people.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
    let start = 0, end = 0;
    for (const interval of sorted) {
      if (interval.start > end) { total += end - start; start = interval.start; end = interval.end; }
      else end = Math.max(end, interval.end);
    }
    total += end - start;
  }
  return total;
}

function ruler(demands: EscalaInput["demands"], people: EscalaEmployee[], complete: boolean): CoverageSliceReference | null {
  if (!demands.length) return null;
  const roles = new Map<string, number>(); let general = 0;
  for (const demand of demands) {
    if (demand.role) roles.set(demand.role, Math.max(roles.get(demand.role) ?? 0, demand.minimum));
    else general = Math.max(general, demand.minimum);
  }
  const roleRows = [...roles].sort(([a], [b]) => compareSectors(a, b)).map(([role, required]) => {
    const present = people.filter(person => person.role === role).length;
    return { role, required, present, missing: complete ? Math.max(0, required - present) : null };
  });
  const required = Math.max(general, [...roles.values()].reduce((sum, count) => sum + count, 0));
  const sectorMissing = Math.max(0, required - people.length);
  return { required, sectorMissing: complete ? sectorMissing : null,
    missing: complete ? Math.max(sectorMissing, roleRows.reduce((sum, row) => sum + (row.missing ?? 0), 0)) : null, roles: roleRows };
}

function accumulate(current: CoverageDemandMetrics | null, slice: CoverageSliceReference | null,
  window: { date: string; start: number; end: number; present: number }): CoverageDemandMetrics | null {
  if (!slice) return current;
  const duration = window.end - window.start;
  const result = current ?? { requiredPersonMinutes: 0, coveredPersonMinutes: 0, deficitPersonMinutes: 0,
    peakMissing: 0, peakSectorMissing: 0, peakWindow: null };
  result.requiredPersonMinutes += slice.required * duration;
  if (slice.missing === null || result.deficitPersonMinutes === null) {
    result.coveredPersonMinutes = result.deficitPersonMinutes = result.peakMissing = result.peakSectorMissing = null;
    result.peakWindow = null;
  } else {
    result.deficitPersonMinutes += slice.missing * duration;
    result.coveredPersonMinutes = result.requiredPersonMinutes - result.deficitPersonMinutes;
    const previous = result.peakWindow;
    const earlier = !previous || compare(window.date, previous.date) < 0 || window.date === previous.date
      && (window.start < previous.start || window.start === previous.start && window.end < previous.end);
    if (slice.missing > 0 && (slice.missing > (result.peakMissing ?? 0) || slice.missing === result.peakMissing && earlier)) {
      result.peakWindow = { ...window, missing: slice.missing, required: slice.required,
        sectorMissing: slice.sectorMissing ?? 0, roleMissing: slice.roles.reduce((sum, role) => sum + (role.missing ?? 0), 0) };
    }
    result.peakMissing = Math.max(result.peakMissing ?? 0, slice.missing);
    result.peakSectorMissing = Math.max(result.peakSectorMissing ?? 0, slice.sectorMissing ?? 0);
  }
  return result;
}

function analyzeSectors(reference: EscalaInput, candidate: EscalaInput, dates: string[], estimatesValid: boolean, details: boolean): CoverageSectorMetrics[] {
  const input = eligibleInput(candidate), ref = eligibleInput(reference), index = buildCoveragePresence(input);
  const credited = buildCoveragePresence({ ...input, shifts: input.shifts.map(shift => ({ ...shift,
    segments: shift.segments.map(segment => ({ ...segment, kind: segment.kind === "BREAK" ? "BREAK" as const : "WORK" as const })) })) });
  const assigned = records(input), refAssigned = records(ref), shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const members = new Map<string, EscalaEmployee[]>(), referenceMembers = new Map<string, EscalaEmployee[]>();
  for (const [source, groups] of [[input, members], [ref, referenceMembers]] as const) for (const person of source.employees) {
    if (person.planningEnabled === false) continue;
    const list = groups.get(person.sector) ?? []; list.push(person); groups.set(person.sector, list);
  }
  const dateSet = new Set(dates), demands = new Map<string, EscalaInput["demands"]>();
  for (const demand of reference.demands) if (dateSet.has(demand.date)) {
    const id = key(demand.date, demand.sector), list = demands.get(id) ?? []; list.push(demand); demands.set(id, list);
  }
  const sectors = new Set([...input.employees.map(person => person.sector), ...reference.demands.filter(d => dateSet.has(d.date)).map(d => d.sector)]);
  return [...sectors].sort(compareSectors).map(sector => {
    const withoutClockIds = new Set<string>();
    const row: CoverageSectorMetrics = { sector, scope: "TIMED_WORK", status: "READY", unknownPersonDays: 0,
      withoutClockPeople: 0, withoutClockPersonDays: 0, knownWorkPersonMinutes: 0,
      availablePersonMinutes: 0, creditedPersonMinutes: 0, confirmed: null, estimated: null, ...(details ? { details: [] } : {}) };
    for (const date of dates) {
      const current = (members.get(sector) ?? []).filter(person => active(person, date));
      const currentIds = new Set(current.map(person => person.id));
      const withoutClock = current.filter(person => !timed(person) || assigned.get(key(date, person.id))?.kind === "DUTY");
      for (const person of withoutClock) withoutClockIds.add(person.id);
      row.withoutClockPersonDays += withoutClock.length;
      const withoutClockToday = new Set(withoutClock.map(person => person.id));
      const timedCurrent = current.filter(person => !withoutClockToday.has(person.id));
      if (withoutClockToday.size) {
        const sectorDay = key(date, sector);
        for (const clockIndex of [index, credited]) clockIndex.set(sectorDay,
          (clockIndex.get(sectorDay) ?? []).filter(interval => !withoutClockToday.has(interval.employee.id)));
      }
      const unknown = new Set((referenceMembers.get(sector) ?? []).filter(person => active(person, date) && timed(person)
        && refAssigned.get(key(date, person.id))?.kind !== "DUTY" && !currentIds.has(person.id)).map(person => person.id));
      for (const person of timedCurrent) {
        const record = assigned.get(key(date, person.id));
        if (record?.kind === "OFF" || record?.kind === "ABSENCE" || record?.kind === "HOLIDAY") continue;
        const shift = shifts.get(record?.shiftId ?? "");
        if ((!record && !input.policy.closedDates.includes(date))
          || record?.kind === "WORK" && (!shift || shift.segments.some(segment => !Number.isInteger(segment.start)
            || !Number.isInteger(segment.end) || segment.end <= segment.start))) unknown.add(person.id);
      }
      const group = demands.get(key(date, sector)) ?? [];
      const malformed = group.some(d => !Number.isFinite(d.minimum) || d.minimum < 0 || d.minimum > 0
        && (!Number.isInteger(d.start) || !Number.isInteger(d.end) || d.start < 0 || d.end > 1440 || d.end <= d.start));
      const complete = unknown.size === 0 && !malformed && (timedCurrent.length > 0 || !group.some(d => d.minimum > 0));
      row.unknownPersonDays += unknown.size;
      const knownWork = personMinutes(index, date, sector);
      row.knownWorkPersonMinutes += knownWork;
      if (!complete) { row.status = "PARTIAL"; row.availablePersonMinutes = row.creditedPersonMinutes = null; }
      else if (row.availablePersonMinutes !== null) {
        row.availablePersonMinutes += knownWork;
        row.creditedPersonMinutes = (row.creditedPersonMinutes ?? 0) + personMinutes(credited, date, sector);
      }
      // The existing timeline splits at actual WORK and reference-demand endpoints, never one-minute slots.
      const local = { ...input, demands: group };
      for (const slice of coverageTimeline(local, date, sector, index)) {
        const references = group.filter(d => d.start <= slice.start && d.end >= slice.end);
        const confirmed = ruler(references.filter(d => d.estimated !== true), slice.people, complete);
        const estimated = ruler(references.filter(d => d.estimated === true), slice.people, complete && estimatesValid);
        const window = { date, start: slice.start, end: slice.end, present: slice.present };
        row.confirmed = accumulate(row.confirmed, confirmed, window);
        row.estimated = accumulate(row.estimated, estimated, window);
        if (estimated && !estimatesValid) row.status = "PARTIAL";
        row.details?.push({ date, start: slice.start, end: slice.end, presentKnown: slice.present, unknownPeople: unknown.size,
          withoutClockPeople: withoutClock.length, confirmed, estimated });
      }
    }
    row.withoutClockPeople = withoutClockIds.size;
    return row;
  });
}

function comparableCohort(reference: EscalaInput, candidate: EscalaInput, dates: string[], ids?: readonly string[]) {
  const ref = eligibleInput(reference), next = eligibleInput(candidate), candidates = new Map(next.employees.map(person => [person.id, person]));
  const requested = ids ? new Set(ids) : null, excluded: Record<string, number> = {}, sources: Record<string, number> = {}, refRecords = records(ref), nextRecords = records(next);
  const people: { reference: EscalaEmployee; candidate: EscalaEmployee }[] = [];
  const validClock = (input: EscalaInput, person: EscalaEmployee) => person.shiftIds.some(id => input.shifts.some(shift => shift.id === id && shift.segments.some(segment => segment.kind === "WORK")));
  for (const person of ref.employees) {
    if (requested && !requested.has(person.id)) continue;
    const other = candidates.get(person.id);
    const reason = !other || person.sector !== other.sector || person.role !== other.role ? "COHORT_CHANGED"
      : person.planningEnabled === false || other.planningEnabled === false ? "PLANNING_EXCLUDED"
      : !timed(person) || !timed(other) || !validClock(ref, person) || !validClock(next, other)
        || dates.some(date => refRecords.get(key(date, person.id))?.kind === "DUTY" || nextRecords.get(key(date, person.id))?.kind === "DUTY") ? "UNKNOWN_CLOCK"
      : person.simulationDailyMinutes !== undefined || other.simulationDailyMinutes !== undefined ? "SHORT_REFERENCE"
      : !dates.length || dates.some(date => !active(person, date) || !active(other, date)) ? "PARTIAL_EMPLOYMENT" : null;
    if (reason) { excluded[reason] = (excluded[reason] ?? 0) + 1; continue; }
    if (other) { people.push({ reference: person, candidate: other }); const source = person.weeklyHoursMode ?? "UNSPECIFIED"; sources[source] = (sources[source] ?? 0) + 1; }
  }
  if (requested) for (const id of requested) if (!ref.employees.some(person => person.id === id)) excluded.UNKNOWN_ID = (excluded.UNKNOWN_ID ?? 0) + 1;
  return { people, excluded, sources };
}

function nominalComparison(reference: EscalaInput, candidate: EscalaInput, dates: string[], cohort: ReturnType<typeof comparableCohort>, options: CoverageAnalysisOptions): CoverageNominalComparison {
  const known: { person: typeof cohort.people[number]; hours: number; origin: CoverageNominalOrigin }[] = [];
  for (const person of cohort.people) {
    if (options.nominalReferenceWeeklyHours !== undefined) {
      known.push({ person, hours: options.nominalReferenceWeeklyHours, origin: options.nominalReferenceOrigin ?? "HYPOTHETICAL" });
      continue;
    }
    const imported = person.reference.sourceSchedule;
    if (imported?.report === "FPRE136") {
      const weekday = fpre136WeekdayMinutes(imported.weekday), saturday = fpre136WeekdayMinutes(imported.saturday);
      // An explicitly supplied zero Saturday is known rest. Blank or malformed Saturday is unknown, not zero.
      const parts = imported.saturday.trim().split(/\s*\/\s*/);
      const zeroSaturday = parts.length <= 2 && parts.every(part => /^00:00\s*-\s*00:00$/.test(part));
      const saturdayMinutes = saturday ?? (zeroSaturday ? 0 : null);
      if (weekday !== null && saturdayMinutes !== null) known.push({ person, hours: (5 * weekday + saturdayMinutes) / 60, origin: "FPRE136_INFERRED" });
      continue;
    }
    const configured = planningWeeklyHours(person.reference, reference.defaultWeeklyHours, reference.defaultWeeklyHours);
    if (configured.weeklyHoursMode === "INDIVIDUAL") known.push({ person, hours: configured.weeklyHours, origin: "CONFIGURED_INDIVIDUAL" });
  }
  const groups = new Map<string, CoverageNominalComparison["sourceGroups"][number]>();
  for (const entry of known) {
    const id = JSON.stringify([entry.origin, entry.hours]), group = groups.get(id) ?? { origin: entry.origin, weeklyHours: entry.hours, people: 0 };
    group.people++; groups.set(id, group);
  }
  const sourceGroups = [...groups.values()].sort((a, b) => compare(a.origin, b.origin) || a.weeklyHours - b.weeklyHours);
  const knownCohort = { ...cohort, people: known.map(entry => entry.person) };
  const baseline = known.length && dates.length ? known.reduce((sum, entry) => sum + entry.hours, 0) : null;
  const capacity = (weeklyHours: WeeklyHours) => known.reduce((sum, entry) => {
    const planned = planningWeeklyHours(entry.person.reference, reference.defaultWeeklyHours, weeklyHours);
    // An individual setting is an explicit constraint. A branch scenario cannot enlarge a shorter imported reference.
    return sum + (planned.weeklyHoursMode === "INDIVIDUAL" ? planned.weeklyHours : Math.min(entry.hours, planned.weeklyHours));
  }, 0);
  const totals = (input: EscalaInput, side: "reference" | "candidate") => [...new Set(dates.map(weekStart))].map(week =>
    knownCohort.people.reduce((sum, person) => sum + effectiveWeeklyMinutes(planningWeeklyHours(person[side], input.defaultWeeklyHours, input.defaultWeeklyHours), week) / 60, 0));
  const prepared = totals(reference, "reference"), proposed = totals(candidate, "candidate");
  const weekly = new Set(known.map(entry => entry.hours));
  return { origin: !sourceGroups.length ? "UNAVAILABLE" : sourceGroups.length > 1 ? "MIXED" : sourceGroups[0].origin,
    referenceWeeklyHours: weekly.size === 1 ? known[0].hours : null, referencePeople: known.length,
    withoutReferencePeople: cohort.people.length - known.length, sourceGroups, referenceCapacityHours: baseline,
    preparedWeeklyHoursMin: baseline === null ? null : Math.min(...prepared), preparedWeeklyHoursMax: baseline === null ? null : Math.max(...prepared),
    candidateWeeklyHoursMin: baseline === null ? null : Math.min(...proposed), candidateWeeklyHoursMax: baseline === null ? null : Math.max(...proposed),
    scenarios: ([42, 40] as const).map(weeklyHours => ({ weeklyHours, capacityHours: baseline === null ? null : capacity(weeklyHours),
      lostHours: baseline === null ? null : Math.max(0, baseline - capacity(weeklyHours)), equivalentPeople: baseline === null ? null : baseline / weeklyHours,
      additionalEquivalentPeople: baseline === null ? null : Math.max(0, baseline - capacity(weeklyHours)) / weeklyHours })) };
}

function attachSectorNominal(rows: CoverageSectorMetrics[], reference: EscalaInput, candidate: EscalaInput, dates: string[],
  cohort: ReturnType<typeof comparableCohort>, options: CoverageAnalysisOptions): CoverageSectorAnalysis[] {
  const people = new Map<string, typeof cohort.people>();
  for (const person of cohort.people) {
    const sector = person.reference.sector, group = people.get(sector) ?? [];
    group.push(person); people.set(sector, group);
  }
  return rows.map(row => ({ ...row, nominal: nominalComparison(reference, candidate, dates,
    { ...cohort, people: people.get(row.sector) ?? [] }, options) }));
}

const targetSignature = (input: EscalaInput) => JSON.stringify(input.demands.map(d => JSON.stringify([d.date, d.sector, d.role ?? "", d.start, d.end, d.minimum, d.estimated === true])).sort(compare));

/** Analyze a prepared, fixed target against known assignments. This function never prepares targets, generates rosters, or mutates an input. */
export function analyzeCoverage(reference: EscalaInput, candidate: EscalaInput, options: CoverageAnalysisOptions = {}): CoverageAnalysis {
  const commonStart = reference.startDate > candidate.startDate ? reference.startDate : candidate.startDate;
  const commonEnd = reference.endDate < candidate.endDate ? reference.endDate : candidate.endDate;
  const candidateVisible = new Set(visibleDates(candidate));
  const requested = [...new Set(options.dates ?? visibleDates(reference).filter(date => candidateVisible.has(date)))].sort(compare);
  const inRange = new Set(commonStart <= commonEnd ? dateRange(commonStart, commonEnd) : []);
  const dates = requested.filter(date => inRange.has(date)), omittedDates = requested.filter(date => !inRange.has(date));
  const cohort = comparableCohort(reference, candidate, dates, options.comparableEmployeeIds);
  const hasEstimates = reference.demands.some(d => d.estimated === true);
  const fingerprint = hasEstimates ? coverageBasis(reference) : null;
  const basis: CoverageAnalysis["basis"] = { origin: options.referenceOrigin ?? "PREPARED",
    status: !hasEstimates ? "NOT_REQUIRED" : !reference.coverageBasis ? "MISSING" : reference.coverageBasis === fingerprint ? "VALID" : "STALE",
    fingerprint: reference.coverageBasis ?? null, needsRegeneration: reference.needsRegeneration === true };
  const estimatesValid = basis.status === "VALID" || basis.status === "NOT_REQUIRED";
  const limitations: string[] = [];
  if (omittedDates.length) limitations.push("DATES_OUTSIDE_COMMON_HORIZON");
  if (!estimatesValid) limitations.push("ESTIMATE_BASIS_" + basis.status);
  if (!cohort.people.length) limitations.push("NO_COMPARABLE_NOMINAL_COHORT");
  if (hasEstimates) limitations.push("ESTIMATED_DEMAND_IS_NOT_CONFIRMED_NEED");
  if (reference.demands.some(d => dates.includes(d.date) && d.minimum > 0 && d.end > storeClosingMinutes(reference))) limitations.push("REFERENCE_AFTER_STORE_CLOSING");
  const sameBranch = canonicalBranchCode(reference.branchCode) === canonicalBranchCode(candidate.branchCode);
  const hoursReferenceOnly = isHoursReferenceOnly(candidate);
  const unavailable = !sameBranch || !dates.length || hoursReferenceOnly;
  if (!sameBranch) limitations.push("BRANCH_MISMATCH");
  if (!dates.length) limitations.push("NO_COMMON_DATES");
  if (hoursReferenceOnly) limitations.push("HOURS_ONLY_WITHOUT_ROSTER");
  const sectors = unavailable ? [] : attachSectorNominal(analyzeSectors(reference, candidate, dates, estimatesValid, options.details === true),
    reference, candidate, dates, cohort, options);
  if (sectors.some(row => row.withoutClockPeople > 0)) limitations.push("UNTIMED_PEOPLE_REPORTED_SEPARATELY");
  const original = options.originalInput;
  const originalComparable = original && sameBranch && canonicalBranchCode(original.branchCode) === canonicalBranchCode(reference.branchCode)
    && dates.length > 0 && dates.every(date => date >= original.startDate && date <= original.endDate);
  const originalAvailability = originalComparable ? analyzeSectors({ ...reference, demands: [] }, original, dates, true, false)
    .map(({ sector, scope, status, unknownPersonDays, withoutClockPeople, withoutClockPersonDays, knownWorkPersonMinutes, availablePersonMinutes, creditedPersonMinutes }) =>
      ({ sector, scope, status, unknownPersonDays, withoutClockPeople, withoutClockPersonDays, knownWorkPersonMinutes, availablePersonMinutes, creditedPersonMinutes })) : null;
  let previous: CoverageAnalysis["previous"] = { status: "NOT_PROVIDED", reason: null, sectors: null };
  if (options.previousInput) {
    const before = options.previousInput;
    const compatible = !unavailable && estimatesValid && before.assignments.length > 0 && sectors.every(row => row.status === "READY")
      && canonicalBranchCode(before.branchCode) === canonicalBranchCode(reference.branchCode)
      && before.startDate === reference.startDate && before.endDate === reference.endDate
      && coverageBasis(before) === coverageBasis(reference) && coverageBasis(candidate) === coverageBasis(reference)
      && targetSignature(before) === targetSignature(reference)
      && (!hasEstimates || before.coverageBasis === reference.coverageBasis);
    const previousSectors = compatible ? attachSectorNominal(analyzeSectors(reference, before, dates, estimatesValid, false),
      reference, before, dates, comparableCohort(reference, before, dates, options.comparableEmployeeIds), options) : null;
    previous = previousSectors?.every(row => row.status === "READY") ? { status: "COMPARABLE", reason: null, sectors: previousSectors }
      : { status: "NOT_COMPARABLE", reason: "COHORT_RULES_TARGET_OR_KNOWN_ROSTER_CHANGED", sectors: null };
  }
  const nominal = nominalComparison(reference, candidate, dates, cohort, options);
  if (nominal.withoutReferencePeople > 0) limitations.push("NOMINAL_ORIGIN_MISSING");
  return { status: unavailable ? "UNAVAILABLE" : !estimatesValid || omittedDates.length || sectors.some(row => row.status !== "READY") ? "PARTIAL" : "READY",
    dates, omittedDates, limitations, basis, cohort: { comparablePeople: cohort.people.length, scope: options.comparableEmployeeIds ? "EXPLICIT_IDS" : "COMMON_ELIGIBLE",
      excludedByReason: cohort.excluded, weeklyHoursSources: cohort.sources }, nominal,
    sectors, originalAvailability, previous };
}
