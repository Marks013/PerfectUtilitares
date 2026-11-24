import { buildCoveragePresence, coverageAt, sectorCoverageGaps, type SectorCoverageGap } from "./coverage-presence";
import { coverageServiceScopes, type CoverageServiceScope } from "./coverage-protection";
import { dateRange, dayOfWeek, visibleDates } from "./dates";
import { preparedShiftSignature } from "./preparation";
import { isAdministrativeEscalaSector, operationalEscalaInput } from "./eligibility";
import { currentLeadership } from "./leadership";
import { movementLevel } from "./movement";
import { preservesRestDistribution } from "./rest-quality";
import { regularRestQuality } from "./rest-spacing";
import { storeClosingMinutes } from "./store-hours";
import type { EscalaInput, EscalaValidation } from "./types";
import { validateEscala } from "./validation";
import { weekendBalance } from "./weekend-balance";
import { effectiveWeeklyMinutes, effectiveWorkDayLimit } from "./labor-rules";
import { isDecember2026Cutover, planningWeekStartsOn } from "./planning-calendar";

function missing(gap: SectorCoverageGap): number {
  const roles = new Map<string, number>();
  for (const role of gap.roles) roles.set(role.role, Math.max(roles.get(role.role) ?? 0, role.minimum - role.present, 0));
  return Math.max(0, gap.minimum - gap.present, [...roles.values()].reduce((sum, count) => sum + count, 0));
}

/** Exact report semantics, but across the complete technical horizon. */
export function coverageQuality(input: EscalaInput, dates = dateRange(input.startDate, input.endDate)) {
  const presence = buildCoveragePresence(input), daily = new Map<string, number>(), closing = new Map<string, number>();
  const peaks = new Map<string, number>();
  const end = storeClosingMinutes(input), scope = new Set(dates);
  for (const gap of sectorCoverageGaps(input, presence, dates)) {
    const key = `${gap.sector}\0${gap.date}`, count = missing(gap);
    peaks.set(gap.sector, Math.max(peaks.get(gap.sector) ?? 0, count));
    daily.set(key, (daily.get(key) ?? 0) + count * (gap.end - gap.start));
    closing.set(key, (closing.get(key) ?? 0) + count * Math.max(0, Math.min(end, gap.end) - Math.max(end - 60, gap.start)));
  }
  return { daily, closing, peaks, present: new Set([...presence.keys()].filter(key => {
    return scope.has(key.slice(0, key.indexOf("\0")));
  })) };
}
/** Dates may rotate inside each protected scope; role and clock dimensions remain distinct. */
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

/** Compare the same cohort and workload; different contracts are not a quality gain. */
export function sameCoverageScenario(reference: EscalaInput, proposal: EscalaInput): boolean {
  const dates = dateRange(reference.startDate, reference.endDate);
  const cohort = (input: EscalaInput) => input.employees.filter(person => person.planningEnabled !== false).map(person =>
    JSON.stringify([person.id, person.sector, person.role, person.scheduleMode ?? "TIMED", person.activeFrom, person.activeUntil,
      person.weeklyHours, person.weeklyHoursMode, person.simulationDailyMinutes,
      dates.map(date => effectiveWeeklyMinutes(person, date, input))])).sort();
  return reference.branchCode === proposal.branchCode && reference.timeZone === proposal.timeZone
    && planningWeekStartsOn(reference) === planningWeekStartsOn(proposal)
    && reference.startDate === proposal.startDate && reference.endDate === proposal.endDate
    && reference.defaultWeeklyHours === proposal.defaultWeeklyHours
    && storeClosingMinutes(reference) === storeClosingMinutes(proposal)
    && JSON.stringify(visibleDates(reference)) === JSON.stringify(visibleDates(proposal))
    && JSON.stringify([...reference.policy.closedDates].sort()) === JSON.stringify([...proposal.policy.closedDates].sort())
    && JSON.stringify(cohort(reference)) === JSON.stringify(cohort(proposal));
}

export function completeRoster(input: EscalaInput, requireKnownClocks = true): boolean {
  const assigned = new Set(input.assignments.map(day => `${day.employeeId}\0${day.date}`));
  if (requireKnownClocks && input.employees.some(person => person.planningEnabled !== false && person.scheduleMode === "MISSING")) return false;
  const knownShifts = new Set(input.shifts.map(shift => shift.id));
  if (requireKnownClocks && input.assignments.some(day => day.kind === "WORK" && !knownShifts.has(day.shiftId ?? ""))) return false;
  const dates = dateRange(input.startDate, input.endDate);
  return input.employees.filter(person => person.planningEnabled !== false).every(person => dates.every(date =>
    date < person.activeFrom || Boolean(person.activeUntil && date > person.activeUntil) || assigned.has(`${person.id}\0${date}`)));
}

function comparableRoster(reference: EscalaInput, proposal: EscalaInput, requireKnownClocks = true): boolean {
  return sameCoverageScenario(reference, proposal) && completeRoster(reference, requireKnownClocks) && completeRoster(proposal, requireKnownClocks);
}

/** Frozen optimization is allowed only for the exact persisted scenario, not a client comparison proposal. */
export function alignPersistedCoverageTarget(persisted: EscalaInput, prepared: EscalaInput): EscalaInput {
  const before = operationalEscalaInput(persisted), after = operationalEscalaInput(prepared);
  if (persisted.needsRegeneration || prepared.needsRegeneration || !before.demands.some(demand => demand.estimated)
    || !before.assignments.length || !sameCoverageScenario(before, after) || !completeRoster(before)) return prepared;
  const sorted = (values: unknown[]) => values.map(value => JSON.stringify(value)).sort();
  const required = (input: EscalaInput) => sorted(input.demands.filter(demand => !demand.estimated)
    .map(demand => [demand.id, demand.date, demand.sector, demand.role ?? null, demand.start, demand.end, demand.minimum]));
  const scenario = (input: EscalaInput) => {
    const policy = input.policy, shifts = new Map(input.shifts.map(shift => [shift.id, preparedShiftSignature(shift)]));
    const clock = (day: EscalaInput["assignments"][number]) => [day.date, day.kind, day.locked ?? false, shifts.get(day.shiftId ?? "") ?? null];
    const people = input.employees.filter(person => person.planningEnabled !== false).map(person => [
      person.id, person.offMode, [...person.fixedOffDays].sort(), person.offPattern, person.maxConsecutiveSundays, person.sundayRestRule ?? null,
      [...person.preferredOffDays].sort(), person.historyKnown,
      person.sourceSchedule?.weekday ?? null, person.sourceSchedule?.saturday ?? null,
      sorted((person.manualShiftOverrides ?? []).map(choice => [choice.effectiveFrom, choice.effectiveUntil, choice.markings])),
      sorted(person.history.map(clock)), sorted((person.planningHistory ?? []).map(clock)), sorted((person.planningFuture ?? []).map(clock)),
    ]);
    return [input.generationMode ?? "DAYS_AND_HOURS", Boolean(input.simulation), [...(input.mixed42Sectors ?? [])].sort(),
      sorted((input.movementPriorities ?? []).map(priority => [priority.startDate, priority.endDate, priority.sector ?? null, priority.level])),
      policy.normativeProfile ?? "CUSTOM", policy.weeklyLimit, policy.dailyLimitMinutes, policy.minInterShiftMinutes, policy.minWeeklyRestMinutes,
      policy.minMealMinutes, Boolean(policy.allowShortMealSimulation), Boolean(policy.limitContinuousWorkBlocks),
      policy.mealIntervalAgreement?.maximumMinutes ?? null, effectiveWorkDayLimit(policy), policy.holidayRestAllowed,
      [...policy.holidayDates].sort(), [...policy.authorizedHolidayDates].sort(), [...(policy.paidHolidayDates ?? [])].sort(),
      sorted(people), sorted(input.assignments.filter(day => day.locked || day.kind === "ABSENCE" || day.kind === "HOLIDAY")
        .map(day => [day.employeeId, ...clock(day)]))];
  };
  if (JSON.stringify(required(before)) !== JSON.stringify(required(after))
    || JSON.stringify(scenario(before)) !== JSON.stringify(scenario(after))) return prepared;
  // A historical estimate is not a fresh estimate: keep its original fingerprint, including STALE/MISSING status.
  return { ...prepared, demands: before.demands, coverageBasis: persisted.coverageBasis };
}

/** Exact civil boundaries shared by both candidates. Dates rotate inside each scope, not across roles or clocks. */
function roleTimeQuality(reference: EscalaInput, proposal: EscalaInput, coverageReference: EscalaInput, includeService = true,
  dates = dateRange(coverageReference.startDate, coverageReference.endDate)) {
  const visible = new Set(visibleDates(coverageReference));
  const byDate = new Map(dates.map(date => [date, coverageServiceScopes(date, visible)]));
  const inputs = (includeService ? [reference, proposal] : [reference]).map(input => ({ ...input, demands: coverageReference.demands }));
  const presences = inputs.map(input => buildCoveragePresence(input));
  const gaps = inputs.map((input, index) => sectorCoverageGaps(input, presences[index], dates));
  const boundaries = new Map<string, Set<number>>();
  const add = (sector: string, start: number, end: number) => {
    const points = boundaries.get(sector) ?? new Set<number>();
    points.add(start); points.add(end); boundaries.set(sector, points);
  };
  for (const demand of coverageReference.demands) if (byDate.has(demand.date)) add(demand.sector, demand.start, demand.end);
  for (const presence of presences) for (const [key, intervals] of presence) {
    const date = key.slice(0, key.indexOf("\0"));
    if (!byDate.has(date)) continue;
    for (const interval of intervals) add(interval.employee.sector, interval.start, interval.end);
  }
  const closing = storeClosingMinutes(coverageReference);
  const bands = new Map([...boundaries].map(([sector, points]) => {
    points.add(Math.max(0, closing - 60)); points.add(closing);
    return [sector, [...points].sort((a, b) => a - b)] as const;
  }));
  return inputs.map((_, index) => {
    const deficit = new Map<string, number>(), peak = new Map<string, number>(), service = new Map<string, number>();
    const sum = (values: Map<string, number>, key: string, value: number) => values.set(key, (values.get(key) ?? 0) + value);
    for (const gap of gaps[index]) {
      const points = bands.get(gap.sector) ?? [];
      const roles = new Map<string | null, number>([[null, missing(gap)]]);
      for (const role of gap.roles) roles.set(role.role, Math.max(roles.get(role.role) ?? 0, role.minimum - role.present, 0));
      for (let point = 0; point < points.length - 1; point++) {
        const start = points[point], end = points[point + 1];
        if (start < gap.start || end > gap.end) continue;
        for (const scope of byDate.get(gap.date) ?? []) for (const [role, count] of roles) {
          const key = JSON.stringify([scope, gap.sector, role, start, end]);
          sum(deficit, key, count * (end - start)); peak.set(key, Math.max(peak.get(key) ?? 0, count));
        }
      }
    }
    // Actual service is a fact even when a reference is absent or explicitly zero; it is not a fabricated minimum.
    if (!includeService) return { deficit, peak, service };
    for (const [key] of presences[index]) {
      const split = key.indexOf("\0"), date = key.slice(0, split), sector = key.slice(split + 1);
      if (!byDate.has(date)) continue;
      const points = bands.get(sector) ?? [];
      for (let point = 0; point < points.length - 1; point++) {
        const start = points[point], end = points[point + 1];
        const roles = new Map<string, number>();
        for (const person of coverageAt(presences[index], date, sector, start)) roles.set(person.role, (roles.get(person.role) ?? 0) + 1);
        for (const scope of byDate.get(date) ?? []) for (const [role, count] of roles)
          sum(service, JSON.stringify([scope, sector, role, start, end]), count * (end - start));
      }
    }
    return { deficit, peak, service };
  });
}

type ComparisonScope = CoverageServiceScope;

type CoverageComparisonSector = {
  sector: string; horizon: number; month: number; sundays: number; monthSundays: number;
  closing: number; peak: number;
};
type CoverageComparisonBand = {
  scope: ComparisonScope; sector: string; role: string | null; start: number; end: number; maximum: number; peak: number;
};
type DatedDeficitBand = Omit<CoverageComparisonBand, "scope" | "peak"> & { date: string };
export type CoverageComparisonBounds = {
  sectors: CoverageComparisonSector[];
  bands: CoverageComparisonBand[];
  dailyBands?: DatedDeficitBand[];
  advisoryEstimateDates?: string[];
};

const DECEMBER_ADVISORY_DATES = dateRange("2026-12-01", "2026-12-05");

/** Soft concentration metric for the first partial December week, not a coverage minimum. */
function decemberOpeningRestExcess(input: EscalaInput, dates: readonly string[]): number {
  if (dates.length < 2) return 0;
  const days = new Set(dates);
  const current = new Map(input.assignments.filter(day => days.has(day.date))
    .map(day => [`${day.employeeId}\0${day.date}`, day.kind]));
  const groups = new Map<string, string[]>();
  for (const person of input.employees) {
    if (person.planningEnabled === false || !dates.some(date => date >= person.activeFrom
      && (!person.activeUntil || date <= person.activeUntil))) continue;
    for (const group of ["all", JSON.stringify([person.sector]), JSON.stringify([person.sector, person.role])]) {
      const ids = groups.get(group);
      if (ids) ids.push(person.id);
      else groups.set(group, [person.id]);
    }
  }
  const seen = new Set<string>();
  let excess = 0;
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const signature = JSON.stringify(ids.sort());
    if (seen.has(signature)) continue;
    seen.add(signature);
    for (const date of dates) {
      let eligible = 0, off = 0;
      for (const id of ids) {
        const kind = current.get(`${id}\0${date}`);
        if (kind === "OFF" || kind === "WORK" || kind === "DUTY") eligible++;
        if (kind === "OFF") off++;
      }
      excess += Math.max(0, off - Math.ceil(2 * eligible / dates.length));
    }
  }
  return excess;
}
function protectedDates(input: EscalaInput, advisoryDates: readonly string[]) {
  return dateRange(input.startDate, input.endDate).filter(date => !advisoryDates.includes(date));
}

/** Store positive headcount gaps; absence of a band means zero allowable deficit. */
function datedDeficitBands(input: EscalaInput, ruler: EscalaInput, estimated: boolean, dates = dateRange(ruler.startDate, ruler.endDate)) {
  const demands = ruler.demands.filter(demand => (demand.estimated === true) === estimated);
  const groups = new Map<string, DatedDeficitBand[]>();
  if (!demands.length) return groups;
  for (const gap of sectorCoverageGaps({ ...input, demands }, undefined, dates)) {
    const counts = new Map<string | null, number>([[null, missing(gap)]]);
    for (const role of gap.roles) counts.set(role.role, Math.max(counts.get(role.role) ?? 0, role.minimum - role.present));
    for (const [role, maximum] of counts) {
      if (maximum <= 0) continue;
      const key = JSON.stringify([gap.date, gap.sector, role]);
      const group = groups.get(key) ?? [];
      const last = group.at(-1);
      if (last?.end === gap.start && last.maximum === maximum) last.end = gap.end;
      else group.push({ date: gap.date, sector: gap.sector, role, start: gap.start, end: gap.end, maximum });
      groups.set(key, group);
    }
  }
  return groups;
}

function datedDeficitRegression(reference: EscalaInput, proposal: EscalaInput, ruler: EscalaInput,
  estimateDates: string[], protectEstimates: boolean): RosterCoverageRegression | undefined {
  for (const estimated of protectEstimates ? [false, true] : [false]) {
    const dates = estimated ? estimateDates : undefined;
    const increase = datedDeficitIncreases(datedDeficitBands(reference, ruler, estimated, dates),
      datedDeficitBands(proposal, ruler, estimated, dates)).next().value;
    if (!increase) continue;
    const { date, sector, role, start, end, before, after } = increase;
    const duration = end - start;
    return { date, sector, ...(role ? { role } : {}), scope: "MONTH", start, end, before: before * duration,
      after: after * duration, delta: (after - before) * duration, metric: "DEFICIT_PERSON_MINUTES" };
  }
  return undefined;
}

function* datedDeficitIncreases(before: Map<string, DatedDeficitBand[]>, after: Map<string, DatedDeficitBand[]>) {
  for (const [key, proposalBands] of after) {
    const referenceBands = before.get(key) ?? [];
    // Reports prioritize empty bands. The comparison cursor needs chronological order.
    referenceBands.sort((a, b) => a.start - b.start);
    proposalBands.sort((a, b) => a.start - b.start);
    let position = 0;
    for (const band of proposalBands) {
      let start = band.start;
      while (start < band.end) {
        while (position < referenceBands.length && referenceBands[position].end <= start) position++;
        const old = referenceBands[position];
        const matched = old && old.start <= start;
        const maximum = matched ? old.maximum : 0;
        const end = Math.min(band.end, matched ? old.end : old?.start ?? band.end);
        if (band.maximum > maximum) yield { date: band.date, sector: band.sector, role: band.role, start, end, before: maximum, after: band.maximum };
        start = end;
      }
    }
  }
}

/** This explicit notice does not change the estimate source, findings, or publication gates. */
export function decemberEstimatedCoverageNotice(reference: EscalaInput, proposal: EscalaInput): string | undefined {
  if (!isDecember2026Cutover(reference) || !isDecember2026Cutover(proposal) || !comparableRoster(reference, proposal)) return undefined;
  const label = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const examples: string[] = [];
  for (const { date, sector, role, start, end, before, after } of datedDeficitIncreases(
    datedDeficitBands(reference, reference, true), datedDeficitBands(proposal, reference, true))) {
    const delta = after - before;
    examples.push(`${date.slice(8, 10)}/${date.slice(5, 7)} ${label(start)}–${label(end)}, ${sector}${role ? ` / ${role}` : ""} (+${delta} ${delta === 1 ? "pessoa" : "pessoas"} de desfalque estimado)`);
    if (examples.length === 3) break;
  }
  return examples.length ? `Aviso de cobertura estimada (não é mínimo obrigatório): ${examples.join("; ")}.` : undefined;
}

function comparisonDates(input: EscalaInput) {
  const month = new Set(visibleDates(input));
  const sundays = new Set(dateRange(input.startDate, input.endDate).filter(day => dayOfWeek(day) === 6));
  const monthSundays = new Set([...sundays].filter(day => month.has(day)));
  return { month, sundays, monthSundays };
}

/** Saved deficit ceilings share the verifier's scope and band semantics. Omitted ceilings are zero. */
export function frozenCoverageComparison(rawReference: EscalaInput, mode?: RosterCoverageMode): CoverageComparisonBounds | null {
  const operational = operationalEscalaInput(rawReference);
  const softEstimates = mode === "DECEMBER_PRESENCE_PRIORITY" && isDecember2026Cutover(operational);
  const reference = softEstimates ? { ...operational, demands: operational.demands.filter(demand => demand.estimated !== true) } : operational;
  // Only a server-admitted origin supplies bounds to the worker with this exception.
  const advisoryEstimateDates = (mode === "DECEMBER_DEMAND" || softEstimates) && isDecember2026Cutover(reference) ? [...DECEMBER_ADVISORY_DATES] : undefined;
  const dates = protectedDates(reference, advisoryEstimateDates ?? []);
  const { month, sundays, monthSundays } = comparisonDates(reference);
  const saved = coverageQuality(reference, dates);
  const coverage = sectorTotals(saved.daily), visible = sectorTotals(saved.daily, month);
  const sunday = sectorTotals(saved.daily, sundays), visibleSunday = sectorTotals(saved.daily, monthSundays);
  const closing = sectorTotals(saved.closing);
  const sectors = [...coverage].map(([sector, horizon]) => ({ sector, horizon, month: visible.get(sector) ?? 0,
    sundays: sunday.get(sector) ?? 0, monthSundays: visibleSunday.get(sector) ?? 0,
    closing: closing.get(sector) ?? 0, peak: saved.peaks.get(sector) ?? 0 }));
  const [{ deficit, peak }] = roleTimeQuality(reference, reference, reference, false, dates);
  const bands: CoverageComparisonBand[] = [];
  for (const [key, value] of deficit) {
    if (!value) continue;
    const [scope, sector, role, start, end] = JSON.parse(key) as [ComparisonScope, string, string | null, number, number];
    bands.push({ scope, sector, role, start, end, maximum: value / (end - start), peak: peak.get(key) ?? 0 });
    if (bands.length > 12_000) return null;
  }
  const dailyBands = advisoryEstimateDates ? [...datedDeficitBands(reference, reference, true, dates).values()].flat() : undefined;
  return sectors.length <= 250 && (dailyBands?.length ?? 0) <= 12_000
    ? { sectors, bands, ...(advisoryEstimateDates ? { advisoryEstimateDates, dailyBands } : {}) } : null;
}
export type RosterCoverageRegression = {
  sector: string; scope: ComparisonScope; before: number; after: number; delta: number;
  metric: "DEFICIT_PERSON_MINUTES" | "CLOSING_DEFICIT_PERSON_MINUTES" | "PEAK_MISSING" | "DAILY_PRESENCE" | "SERVICE_PERSON_MINUTES";
  date?: string; start?: number; end?: number; role?: string;
};

function largestIncrease(before: Map<string, number>, after: Map<string, number>) {
  let worst: { key: string; before: number; after: number; delta: number } | undefined;
  for (const [key, value] of after) {
    const previous = before.get(key) ?? 0, delta = value - previous;
    if (delta > 0 && (!worst || delta > worst.delta || delta === worst.delta && key < worst.key))
      worst = { key, before: previous, after: value, delta };
  }
  return worst;
}

function roleTimeRegression(worst: NonNullable<ReturnType<typeof largestIncrease>>, metric: RosterCoverageRegression["metric"]): RosterCoverageRegression {
  const [scope, sector, role, start, end] = JSON.parse(worst.key) as [ComparisonScope, string, string | null, number, number];
  const [before, after] = metric === "SERVICE_PERSON_MINUTES" ? [worst.after, worst.before] : [worst.before, worst.after];
  return { scope, sector, ...(role ? { role } : {}), start, end, before, after, delta: after - before, metric };
}

/** Merit can be measured on an invalid old roster without ever returning it as a usable solution. */
export type RosterCoverageMode = "DECEMBER_DEMAND" | "DECEMBER_PRESENCE_PRIORITY";

export function compareRosterCoverage(rawReference: EscalaInput, rawProposal: EscalaInput, rawCoverageReference = rawReference, mode?: RosterCoverageMode): {
  comparable: boolean; regressed: boolean; improved: boolean; reason: RosterSelectionReason;
  regression?: RosterCoverageRegression;
} {
  const reference = operationalEscalaInput(rawReference), proposal = operationalEscalaInput(rawProposal);
  const operationalRuler = rawCoverageReference === rawReference ? reference : operationalEscalaInput(rawCoverageReference);
  const result = (reason: RosterSelectionReason, regressed = false, improved = false, comparable = true) => ({ comparable, regressed, improved, reason });
  const reject = (reason: RosterSelectionReason, regression: RosterCoverageRegression) => ({ ...result(reason, true), regression });
  if (!comparableRoster(reference, proposal) || !comparableRoster(operationalRuler, proposal)) return result("REFERENCE_NOT_COMPARABLE", false, false, false);
  // Also applies to already saved cutovers and direct drafts: no estimate-only
  // veto for the first partial block when selecting or reusing a proposal.
  const december = [reference, proposal, operationalRuler].every(isDecember2026Cutover);
  const softEstimates = december && mode === "DECEMBER_PRESENCE_PRIORITY";
  const protectDecemberDemand = december && (mode === "DECEMBER_DEMAND" || softEstimates);
  const coverageReference = softEstimates ? { ...operationalRuler, demands: operationalRuler.demands.filter(demand => demand.estimated !== true) } : operationalRuler;
  const dates = protectedDates(coverageReference, december ? DECEMBER_ADVISORY_DATES : []);
  const before = coverageQuality({ ...reference, demands: coverageReference.demands }, dates);
  const after = coverageQuality({ ...proposal, demands: coverageReference.demands }, dates);
  const { month, sundays, monthSundays } = comparisonDates(coverageReference);
  let improved = false;
  const scopes: [ComparisonScope, Set<string> | undefined][] = [["HORIZON", undefined], ["MONTH", month], ["SUNDAYS", sundays], ["MONTH_SUNDAYS", monthSundays]];
  for (const [scope, dates] of scopes) {
    const oldTotals = sectorTotals(before.daily, dates), newTotals = sectorTotals(after.daily, dates);
    const loss = largestIncrease(oldTotals, newTotals);
    if (loss) return reject("SECTOR_COVERAGE", { sector: loss.key, scope, metric: "DEFICIT_PERSON_MINUTES", before: loss.before, after: loss.after, delta: loss.delta });
    improved ||= improves(oldTotals, newTotals);
  }
  const oldClosing = sectorTotals(before.closing), newClosing = sectorTotals(after.closing);
  const closingLoss = largestIncrease(oldClosing, newClosing);
  if (closingLoss) {
    const end = storeClosingMinutes(coverageReference);
    return reject("CLOSING_COVERAGE", { sector: closingLoss.key, scope: "HORIZON", start: Math.max(0, end - 60), end,
      metric: "CLOSING_DEFICIT_PERSON_MINUTES", before: closingLoss.before, after: closingLoss.after, delta: closingLoss.delta });
  }
  const peakLoss = largestIncrease(before.peaks, after.peaks);
  if (peakLoss) return reject("SECTOR_PEAK", { sector: peakLoss.key, scope: "HORIZON", metric: "PEAK_MISSING", before: peakLoss.before, after: peakLoss.after, delta: peakLoss.delta });
  const emptyDay = [...before.present].find(key => !after.present.has(key));
  if (emptyDay) {
    const [date, sector] = emptyDay.split("\0");
    return reject("DAILY_PRESENCE", { date, sector, scope: "HORIZON", metric: "DAILY_PRESENCE", before: 1, after: 0, delta: -1 });
  }
  const [oldRoles, newRoles] = roleTimeQuality(reference, proposal, coverageReference, true, dates);
  const missedRole = largestIncrease(oldRoles.deficit, newRoles.deficit);
  if (missedRole) return reject("ROLE_TIME_COVERAGE", roleTimeRegression(missedRole, "DEFICIT_PERSON_MINUTES"));
  const peakRole = largestIncrease(oldRoles.peak, newRoles.peak);
  if (peakRole) return reject("ROLE_TIME_COVERAGE", roleTimeRegression(peakRole, "PEAK_MISSING"));
  if (december) {
    const datedLoss = datedDeficitRegression(reference, proposal, coverageReference, dates, protectDecemberDemand && !softEstimates);
    if (datedLoss) return reject(datedLoss.role ? "ROLE_TIME_COVERAGE" : "SECTOR_COVERAGE", datedLoss);
  }
  if (protectDecemberDemand) {
    const dayLoss = largestIncrease(before.daily, after.daily);
    if (dayLoss) {
      const [sector, date] = dayLoss.key.split("\0");
      return reject("SECTOR_COVERAGE", { sector, date, scope: "MONTH", metric: "DEFICIT_PERSON_MINUTES", before: dayLoss.before, after: dayLoss.after, delta: dayLoss.delta });
    }
  }
  const serviceLoss = largestIncrease(newRoles.service, oldRoles.service);
  if (serviceLoss) return reject("ROLE_TIME_PRESENCE", roleTimeRegression(serviceLoss, "SERVICE_PERSON_MINUTES"));
  improved ||= improves(oldClosing, newClosing) || improves(oldRoles.deficit, newRoles.deficit);
  return result(improved ? "OPERATIONAL_IMPROVEMENT" : "ACCEPTED", false, improved);
}

/** An admitted December ruler is a prerequisite to ranking, not a tradeoff. */
export function preservesAdmittedDecemberCoverage(merit: ReturnType<typeof compareRosterCoverage>): boolean {
  return merit.comparable && !merit.regressed;
}

/** Publication pendings are not all operationally interchangeable: an unresolved meal cannot seed or replace a calculated roster. */
export function isOperationallyReusable(validation: EscalaValidation): boolean {
  return validation.valid && !validation.issues.some(issue => issue.code === "DAY_PENDING" || issue.code === "MEAL_INTERVAL_EXCESSIVE");
}
export function isReusableRoster(input: EscalaInput): boolean {
  return operationalEscalaInput(input).assignments.length > 0 && isOperationallyReusable(validateEscala(input));
}

/** Reject an inferior complete candidate; never assemble unverified sector fragments. */
export type RosterSelectionReason = "REFERENCE_NOT_COMPARABLE" | "ROLE_TIME_COVERAGE" | "ROLE_TIME_PRESENCE" | "REFERENCE_UNVERIFIED" | "PROPOSAL_INVALID" | "PROTECTED_ASSIGNMENT"
  | "SECTOR_COVERAGE" | "SECTOR_PEAK" | "CLOSING_COVERAGE" | "DAILY_PRESENCE" | "PRIORITY_LEADERSHIP"
  | "OPERATIONAL_IMPROVEMENT" | "REST_DISTRIBUTION" | "REST_WINDOW" | "SATURDAY_BALANCE" | "SUNDAY_BALANCE" | "ACCEPTED";
export function selectVerifiedRoster(rawReference: EscalaInput, rawProposal: EscalaInput,
  onDecision?: (reason: RosterSelectionReason, regression?: RosterCoverageRegression) => void, coverageReference = rawReference, mode?: RosterCoverageMode,
  presenceRepair = false): { input: EscalaInput; retainedReference: boolean } {
  const decision = (retainedReference: boolean, reason: RosterSelectionReason, regression?: RosterCoverageRegression) => {
    onDecision?.(reason, regression);
    return { input: retainedReference ? rawReference : rawProposal, retainedReference };
  };
  const reference = operationalEscalaInput(rawReference), proposal = operationalEscalaInput(rawProposal);
  // First-time generation or an invalid old draft has no verified comparison incumbent.
  if (!isReusableRoster(reference)) return decision(false, "REFERENCE_UNVERIFIED");
  if (!isReusableRoster(proposal)) return decision(true, "PROPOSAL_INVALID");
  const assignments = new Map(rawProposal.assignments.map(record => [`${record.employeeId}\0${record.date}`, record]));
  const administrativeIds = new Set(rawReference.employees.filter(person => isAdministrativeEscalaSector(person.sector)).map(person => person.id));
  for (const old of rawReference.assignments) {
    const next = assignments.get(`${old.employeeId}\0${old.date}`);
    if (administrativeIds.has(old.employeeId) && (old.kind !== next?.kind || old.shiftId !== next.shiftId || old.locked !== next.locked))
      return decision(true, "PROTECTED_ASSIGNMENT");
    if ((old.locked || old.kind === "ABSENCE" || old.kind === "HOLIDAY")
      && (old.kind !== next?.kind || old.locked && (old.shiftId !== next.shiftId || !next.locked))) return decision(true, "PROTECTED_ASSIGNMENT");
  }
  // A genuinely different current contract cannot restore the previous workload. Unknown historical clocks do not bypass current guards.
  if (!comparableRoster(reference, proposal, false)) return decision(false, "REFERENCE_NOT_COMPARABLE");
  const historicalComparison = compareRosterCoverage(reference, proposal, coverageReference, mode);
  // This fallback selects between current candidates only; it never makes the historical ruler comparable.
  const comparison = historicalComparison.comparable ? historicalComparison : compareRosterCoverage(reference, proposal);
  if (comparison.regressed) return decision(true, comparison.reason, comparison.regression);
  const afterLeaders = leaders(proposal);
  if ([...leaders(reference)].some(key => !afterLeaders.has(key))) return decision(true, "PRIORITY_LEADERSHIP");
  // Long regular-rest windows remain protected even during coverage recovery.
  const beforePeople = new Map(reference.employees.map(person => [person.id, regularRestQuality(reference, person)]));
  if (proposal.employees.some(person => regularRestQuality(proposal, person).longWindows.length > (beforePeople.get(person.id)?.longWindows.length ?? 0))) return decision(true, "REST_WINDOW");
  // Mandatory rules (including manual minima, rest, hours and Saturday v2)
  // were independently validated above. Preserve actual daily service and
  // declared peak leadership, but do not turn an estimated zero-gap date or
  // seed fairness into a hard ban on operational recovery in the same sector.
  if (comparison.improved) return decision(false, historicalComparison.comparable ? "OPERATIONAL_IMPROVEMENT" : "REFERENCE_NOT_COMPARABLE");
  // When operational coverage ties, retain the established quality policy.
  if (!(presenceRepair && mode === "DECEMBER_PRESENCE_PRIORITY" && isDecember2026Cutover(reference) && isDecember2026Cutover(proposal))
    && !preservesRestDistribution(reference, proposal)) return decision(true, "REST_DISTRIBUTION");
  for (const weekday of [5, 6] as const) {
    if (!noIncrease(weekendBalance(reference, weekday), weekendBalance(reference, weekday, proposal.assignments)))
      return decision(true, weekday === 5 ? "SATURDAY_BALANCE" : "SUNDAY_BALANCE");
  }
  if (proposal.generationMode !== "HOURS_ONLY" && isDecember2026Cutover(proposal)) {
    const openDays = DECEMBER_ADVISORY_DATES.filter(date => !proposal.policy.closedDates.includes(date)
      && ((proposal.restRulesVersion ?? 0) < 2 || dayOfWeek(date) !== 5));
    if (decemberOpeningRestExcess(proposal, openDays) > decemberOpeningRestExcess(reference, openDays))
      return decision(true, "REST_DISTRIBUTION");
  }
  return decision(false, historicalComparison.comparable ? "ACCEPTED" : "REFERENCE_NOT_COMPARABLE");
}
