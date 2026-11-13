import { buildCoverageReport } from "./coverage-report";
import type { CoverageReport, OperationalAnalysis } from "./coverage-report-contracts";
import { analyzeOperational } from "./operational-analysis";
import { buildCoveragePresence } from "./coverage-presence";
import { monthBounds, visibleDates } from "./dates";
import { applyRestEligibility } from "./eligibility";
import { EscalaError } from "./errors";
import { isHoursReferenceOnly } from "./hours-reference";
import { compareSectors, sortScheduleEntries } from "./order";
import { buildEscalaPresentation } from "./presentation";
import { operationalReportOptionsSchema, validateOperationalReportSelection, type OperationalReportContext, type OperationalReportOptions } from "./operational-report-contracts";
import type { EscalaShift, EscalaWorkspace } from "./types";

export function operationalReportContext(workspace: EscalaWorkspace): OperationalReportContext {
  const input = workspace.input, months = [...new Set(visibleDates(input).map(date => date.slice(0, 7)))];
  const visible = new Set(visibleDates(input));
  const inferred = months.length === 1 ? months[0] : null, bounds = inferred ? monthBounds(inferred) : null;
  const month = input.visibleMonth ?? (bounds && visible.has(bounds.startDate) && visible.has(bounds.endDate) ? inferred : null);
  if (!month) throw new EscalaError(409, "ESCALA_REPORT_MONTH_REQUIRED", "Selecione uma grade com mês visível definido");
  return { workspaceId: workspace.id, revision: workspace.revision, visibleMonth: month,
    generationMode: input.generationMode ?? "DAYS_AND_HOURS",
    hasRoster: !isHoursReferenceOnly(input) && input.assignments.some(day => visible.has(day.date) && (day.kind === "WORK" || day.kind === "OFF" || day.kind === "DUTY")),
    sectors: [...new Set([...input.employees.map(person => person.sector), ...input.demands.map(demand => demand.sector)])].sort(compareSectors) };
}

/** Zero targets are not gaps. Keep one informative row only when no positive ruler exists. */
export function coverageReportRows(report: CoverageReport | null): CoverageReport["rows"] {
  if (!report) return [];
  return report.rows.filter(row => {
    const siblings = report.rows.filter(other => other.sector === row.sector);
    if (siblings.some(other => other.requiredPersonMinutes === null || other.requiredPersonMinutes > 0)) {
      return row.requiredPersonMinutes === null || row.requiredPersonMinutes > 0;
    }
    return row === (siblings.find(other => other.status === "UNKNOWN") ?? siblings[0]);
  });
}

/** Describes observations at the peak; deliberately does not infer cause or propose moving people. */
export function coverageObservation(row: CoverageReport["rows"][number]): string {
  if (row.requiredPersonMinutes === 0) return row.status === "UNKNOWN" ? "Sem referência positiva; dados incompletos" : "Sem referência positiva";
  if (!row.peak) return row.status === "UNKNOWN" ? "Dados incompletos" : row.status === "NO_REFERENCE" ? "Sem referência positiva" : "Referência atendida";
  const peak = row.peak, facts: string[] = [];
  if (peak.roleMissing > peak.sectorMissing) {
    const role = peak.limitingRoles.length === 1 ? peak.limitingRoles[0] : null;
    facts.push(role ? `Função limitante: ${role.role} (referência ${role.required}; previstas ${role.present})` : `Limite por função (${peak.limitingRoles.length})`);
  }
  if (peak.observed) {
    facts.push(`Pausa: ${peak.observed.pause}`, `OFF: ${peak.observed.off}`, `Afastados: ${peak.observed.absence}`, `Sem relógio: ${peak.observed.workWithoutClock + peak.observed.duty}`);
  } else facts.push("Observação não apurada");
  if (peak.afterConfiguredClosing) facts.push("Após fechamento configurado");
  return facts.join("; ");
}

export type OperationalPresenceRow = {
  employeeId: string; sector: string; label: string; role: string; state: string;
  segments: { start: number; end: number; kind: EscalaShift["segments"][number]["kind"] }[];
};

export function buildOperationalReport(workspace: EscalaWorkspace, rawOptions: OperationalReportOptions) {
  const options = operationalReportOptionsSchema.parse(rawOptions), context = operationalReportContext(workspace);
  const issues = validateOperationalReportSelection(options, context);
  if (issues.length) throw new EscalaError(issues.some(issue => issue.field === "revision") ? 409 : 400,
    "ESCALA_INVALID_OPERATIONAL_SELECTION", issues.map(issue => issue.message).join(". "));
  const input = { ...workspace.input, employees: workspace.input.employees.map(person => applyRestEligibility(person)) };
  const referencesOnly = !context.hasRoster, selected = new Set(options.sectors.length ? options.sectors : context.sectors);
  // A reference-only view never turns configured clocks into attendance, in any generation mode.
  const presentation = buildEscalaPresentation({ ...workspace, input: referencesOnly ? { ...input, generationMode: "HOURS_ONLY",
    assignments: input.assignments.filter(day => day.kind === "ABSENCE" || day.kind === "HOLIDAY") } : input });
  const reportPeople = options.sections.some(section => section === "journeys" || section === "variants")
    ? [...new Map([...presentation.people, ...presentation.hoursPeople].map(person => [person.employee.id, person])).values()]
    : presentation.people;
  const people = sortScheduleEntries(reportPeople.filter(person => selected.has(person.employee.sector))
    .map(person => ({ person, employee: person.employee, schedule: person.proposedSchedule }))).map(row => row.person);
  const empty: OperationalAnalysis = { status: "UNAVAILABLE", branchCode: input.branchCode, visibleMonth: context.visibleMonth, dates: [], omittedDates: [],
    technicalPeriod: { startDate: input.startDate, endDate: input.endDate }, limitations: ["NO_ROSTER_OR_SECTION_NOT_SELECTED"], days: [] };
  const operations = !referencesOnly && options.sections.some(section => section === "summary" || section === "presence")
    ? analyzeOperational(input, { details: options.sections.includes("presence") }) : empty;
  const coverage = !referencesOnly && options.sections.includes("coverage")
    ? buildCoverageReport(input, input, { referenceOrigin: "PERSISTED", ...(options.date ? { dates: [options.date] } : {}), context: { revision: workspace.revision, kind: "SAVED" } }) : null;
  const coverageDates = new Set(coverage?.context.dates ?? []);
  const targeted = new Set(input.demands.filter(demand => coverageDates.has(demand.date)).map(demand => demand.sector));
  const presence: OperationalPresenceRow[] = [];
  if (!referencesOnly && options.sections.includes("presence") && options.date) {
    const eligible = { ...input, employees: input.employees.map(person => applyRestEligibility(person)) };
    const records = new Map<string, typeof input.assignments[number]>();
    for (const person of eligible.employees) for (const record of [...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])]) records.set(record.date + "\0" + record.employeeId, record);
    for (const record of input.assignments) records.set(record.date + "\0" + record.employeeId, record);
    const kinds = ["WORK", "BREAK", "PAID_BREAK"] as const;
    const indexes = kinds.map(kind => buildCoveragePresence({ ...eligible,
      shifts: input.shifts.filter(shift => shift.segments.length && shift.segments.every(segment => Number.isInteger(segment.start) && Number.isInteger(segment.end) && segment.start >= 0 && segment.end <= 2880 && segment.end > segment.start))
        .map(shift => ({ ...shift, segments: shift.segments.map(segment => ({ ...segment, kind: segment.kind === kind ? "WORK" as const : "BREAK" as const })) })) }));
    for (const person of people) {
      const employee = eligible.employees.find(item => item.id === person.employee.id);
      if (!employee || employee.planningEnabled === false) continue;
      const cell = person.cells.find(cell => cell.date === options.date);
      const duty = records.get(options.date + "\0" + employee.id)?.kind === "DUTY";
      const segments = duty || employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING" ? [] : indexes.flatMap((index, i) =>
        (index.get(options.date + "\0" + employee.sector) ?? []).filter(interval => interval.employee.id === employee.id)
          .map(interval => ({ start: interval.start, end: interval.end, kind: kinds[i] })));
      presence.push({ employeeId: employee.id, sector: employee.sector, label: employee.registration + " - " + employee.name, role: employee.role,
        state: cell?.description ?? "Sem atribuição", segments: segments.sort((a, b) => a.start - b.start || a.end - b.end) });
    }
  }
  return { options, referencesOnly, branch: presentation.branch, revision: workspace.revision, status: presentation.state,
    dates: referencesOnly ? [] : presentation.dates, sectors: context.sectors.filter(sector => selected.has(sector)), people,
    excluded: presentation.excluded.filter(row => selected.has(row.employee.sector)),
    operations: { ...operations, days: operations.days.filter(day => selected.has(day.sector)) },
    coverage: coverage ? { ...coverage, rows: coverage.rows.filter(row => selected.has(row.sector) && targeted.has(row.sector)) } : null, presence };
}
export type OperationalReportModel = ReturnType<typeof buildOperationalReport>;
