import { analyzeCoverage } from "./coverage-analysis";
import { applyRestEligibility } from "./eligibility";
import { analyzeOperational } from "./operational-analysis";
import { storeClosingMinutes } from "./store-hours";
import type { CoverageReport, CoverageReportOptions } from "./coverage-report-contracts";
import type { EscalaInput } from "./types";

type ReportPeak = NonNullable<CoverageReport["rows"][number]["peak"]>;

/** An optimistic bound at one civil instant, not an optimizer or a proof of whole-roster feasibility. */
function supplyAt(reference: EscalaInput, candidate: EscalaInput, sector: string, peak: ReportPeak,
  roles: { role: string; required: number }[]): ReportPeak["supply"] {
  const shifts = new Map(reference.shifts.map(shift => [shift.id, shift]));
  const dayRecords = new Map([...reference.assignments, ...candidate.assignments].filter(record => record.date === peak.date).map(record => [record.employeeId, record]));
  const protectedAbsences = new Set(reference.assignments.filter(record => record.date === peak.date && (record.kind === "ABSENCE" || record.kind === "OFF" && record.locked)).map(record => record.employeeId));
  const possible = new Map<string, number>(); let total = 0, unknown = false;
  for (const raw of reference.employees) {
    const person = applyRestEligibility(raw);
    if (person.sector !== sector || person.planningEnabled === false || person.activeFrom > peak.date || person.activeUntil && person.activeUntil < peak.date
      || person.scheduleMode === "UNTIMED") continue;
    if (person.scheduleMode === "MISSING") { unknown = true; continue; }
    const record = dayRecords.get(person.id);
    if (reference.policy.closedDates.includes(peak.date) || protectedAbsences.has(person.id) || record?.kind === "ABSENCE" || record?.kind === "OFF" && record.locked) continue;
    const allowed = person.shiftIds.map(id => shifts.get(id));
    if (!allowed.length || allowed.some(shift => !shift || shift.segments.some(segment => !Number.isInteger(segment.start) || !Number.isInteger(segment.end) || segment.end <= segment.start))) {
      unknown = true; continue;
    }
    // Counting any permitted current/prior-day clock is deliberately optimistic; weekly/rest restrictions can only reduce this bound.
    const canCover = allowed.some(shift => shift?.segments.some(segment => segment.kind === "WORK"
      && [peak.start, peak.start + 1440].some(minute => segment.start <= minute && segment.end > minute)));
    if (canCover) { total++; possible.set(person.role, (possible.get(person.role) ?? 0) + 1); }
  }
  if (unknown) return { status: "UNKNOWN", instant: peak.start, potentialTimedPeople: null, limitingRoles: [] };
  const limitingRoles = roles.filter(role => role.required > (possible.get(role.role) ?? 0))
    .map(role => ({ ...role, potentialPeople: possible.get(role.role) ?? 0 }));
  return { status: peak.required > total || limitingRoles.length ? "REFERENCE_EXCEEDS_LOCAL_UPPER_BOUND" : "WITHIN_LOCAL_UPPER_BOUND",
    instant: peak.start, potentialTimedPeople: total, limitingRoles };
}

/** Shared UI/PDF/XLSX projection. Its only coverage ruler is analyzeCoverage(reference, candidate). */
export function buildCoverageReport(reference: EscalaInput, candidate: EscalaInput, options: CoverageReportOptions = {}): CoverageReport {
  const { context, ...analysisOptions } = options;
  const analysis = analyzeCoverage(reference, candidate, { ...analysisOptions, details: true });
  const peakDates = [...new Set(analysis.sectors.flatMap(sector => [sector.confirmed?.peakWindow?.date, sector.estimated?.peakWindow?.date].filter((date): date is string => !!date)))];
  const operations = peakDates.length ? analyzeOperational(candidate, { dates: peakDates, details: true }) : null;
  const report: CoverageReport = { status: analysis.status,
    context: { branchCode: candidate.branchCode, visibleMonth: candidate.visibleMonth ?? null, revision: context?.revision ?? null,
      runtime: context?.runtime ?? null, kind: context?.kind ?? "UNKNOWN", restRulesVersion: candidate.restRulesVersion ?? 1,
      dates: analysis.dates, technicalPeriod: { startDate: candidate.startDate, endDate: candidate.endDate }, basis: analysis.basis },
    limitations: [...analysis.limitations], nominal: analysis.nominal,
    nominalBySector: analysis.sectors.map(sector => ({ sector: sector.sector, nominal: sector.nominal })), rows: [] };
  for (const sector of analysis.sectors) for (const key of ["confirmed", "estimated"] as const) {
    const metrics = sector[key];
    if (!metrics) continue;
    const slices = (sector.details ?? []).filter(slice => slice[key] !== null);
    const unknownDates = [...new Set(slices.filter(slice => slice[key]?.missing === null).map(slice => slice.date))].sort();
    const positive = slices.filter(slice => (slice[key]?.required ?? 0) > 0);
    const gaps = positive.filter(slice => (slice[key]?.missing ?? 0) > 0);
    const unknown = metrics.deficitPersonMinutes === null;
    let peak: ReportPeak | null = null;
    if (!unknown && metrics.peakWindow && metrics.peakMissing && metrics.peakMissing > 0) {
      const source = metrics.peakWindow;
      const slice = slices.find(item => item.date === source.date && item.start <= source.start && item.end >= source.end);
      const roles = slice?.[key]?.roles ?? [];
      const day = operations?.days.find(item => item.date === source.date && item.sector === sector.sector);
      const observed = day?.windows?.find(item => item.start <= source.start && item.end > source.start)?.counts ?? null;
      peak = { date: source.date, start: source.start, end: source.end, durationMinutes: source.end - source.start,
        required: source.required, presentTimed: source.present, missing: source.missing, sectorMissing: source.sectorMissing, roleMissing: source.roleMissing,
        limitingRoles: roles.filter(role => (role.missing ?? 0) > 0).map(role => ({ role: role.role, required: role.required, present: role.present, missing: (role.missing as number) })),
        observed, afterConfiguredClosing: source.end > storeClosingMinutes(reference),
        supply: { status: "UNKNOWN", instant: source.start, potentialTimedPeople: null, limitingRoles: [] } };
      peak.supply = supplyAt(reference, candidate, sector.sector, peak, roles.map(role => ({ role: role.role, required: role.required })));
    }
    report.rows.push({ sector: sector.sector, ruler: key === "confirmed" ? "CONFIRMED" : "ESTIMATED",
      label: key === "confirmed" ? "Mínimo informado" : "Referência estimada de cobertura",
      status: unknown ? "UNKNOWN" : metrics.requiredPersonMinutes <= 0 ? "NO_REFERENCE" : (metrics.deficitPersonMinutes as number) > 0 ? "GAP" : "COVERED",
      requiredPersonMinutes: metrics.requiredPersonMinutes, coveredPersonMinutes: metrics.coveredPersonMinutes, deficitPersonMinutes: metrics.deficitPersonMinutes,
      deficitHours: unknown ? null : (metrics.deficitPersonMinutes as number) / 60,
      deficitRate: unknown || metrics.requiredPersonMinutes <= 0 ? null : (metrics.deficitPersonMinutes as number) / metrics.requiredPersonMinutes,
      minutesWithGap: unknown ? null : gaps.reduce((sum, slice) => sum + slice.end - slice.start, 0),
      daysWithGap: unknown ? null : new Set(gaps.map(slice => slice.date)).size,
      daysWithoutTimedWork: unknown ? null : new Set(positive.filter(slice => slice[key]?.missing !== null && slice.unknownPeople === 0 && slice.presentKnown === 0).map(slice => slice.date)).size,
      unknownDates, peak });
  }
  return report;
}
