import { buildCoverageReport } from "./coverage-report";
import type { CoverageReport, OperationalAnalysis } from "./coverage-report-contracts";
import { analyzeOperational } from "./operational-analysis";
import { buildCoveragePresence } from "./coverage-presence";
import { dayOfWeek, monthBounds, visibleDates, weekStart } from "./dates";
import { applyRestEligibility, operationalEscalaInput } from "./eligibility";
import { EscalaError } from "./errors";
import { isHoursReferenceOnly } from "./hours-reference";
import { compareSectors, sortScheduleEntries } from "./order";
import { buildEscalaPresentation, escalaDuration } from "./presentation";
import { operationalReportOptionsSchema, validateOperationalReportSelection, type OperationalReportContext, type OperationalReportOptions } from "./operational-report-contracts";
import type { EscalaShift, EscalaWorkspace } from "./types";
import { planningWeekStartsOn } from "./planning-calendar";

export function operationalReportContext(workspace: EscalaWorkspace): OperationalReportContext {
  const input = operationalEscalaInput(workspace.input), months = [...new Set(visibleDates(input).map(date => date.slice(0, 7)))];
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
  const operational = operationalEscalaInput(workspace.input);
  const input = { ...operational, employees: operational.employees.map(applyRestEligibility) };
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
        state: duty ? "Plantão (PL), sem horário informado" : cell?.description ?? "Sem atribuição", segments: segments.sort((a, b) => a.start - b.start || a.end - b.end) });
    }
  }
  const assignments = new Map(input.assignments.map(day => [day.employeeId + "\0" + day.date, day]));
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const calendarPeople = referencesOnly ? [] : people.filter(person => person.employee.planningEnabled !== false).map(person => {
    const cells = person.cells.map(cell => {
      const assignment = assignments.get(person.employee.id + "\0" + cell.date);
      const included = cell.code !== "FV" && cell.code !== "X";
      const kind = included ? assignment?.kind ?? null : null;
      const shift = kind === "WORK" && cell.shiftId ? shifts.get(cell.shiftId) : undefined;
      const validClock = !!shift?.segments.length && shift.segments.every(segment => Number.isInteger(segment.start)
        && Number.isInteger(segment.end) && segment.start >= 0 && segment.end <= 2880 && segment.end > segment.start);
      const code = kind === "OFF" ? person.employee.offMode !== "VARIABLE" && person.employee.fixedOffDays.includes(dayOfWeek(cell.date)) ? "FF" : "FM"
        : kind === "DUTY" ? "PL" : kind === "WORK" && !validClock ? person.employee.scheduleMode === "UNTIMED" ? "ENC" : "SH" : cell.code;
      return { date: cell.date, code, kind, timedWorkMinutes: validClock ? shift.segments.reduce((sum, segment) => sum + (segment.kind === "WORK" ? segment.end - segment.start : 0), 0) : 0 };
    });
    const count = (predicate: (cell: typeof cells[number]) => boolean) => cells.filter(predicate).length;
    return { employeeId: person.employee.id, fixedOffDays: person.employee.offMode === "VARIABLE" ? [] : [...person.employee.fixedOffDays], cells,
      totals: { sundayOff: count(cell => cell.kind === "OFF" && dayOfWeek(cell.date) === 6),
        saturdayOff: count(cell => cell.kind === "OFF" && dayOfWeek(cell.date) === 5),
        worked: count(cell => cell.kind === "WORK" || cell.kind === "DUTY"), duty: count(cell => cell.kind === "DUTY"),
        unassigned: count(cell => cell.code === "NP"), unknownSundays: count(cell => cell.code === "NP" && dayOfWeek(cell.date) === 6),
        unknownSaturdays: count(cell => cell.code === "NP" && dayOfWeek(cell.date) === 5),
        absence: count(cell => cell.kind === "ABSENCE"), holiday: count(cell => cell.kind === "HOLIDAY"),
        timedWorkMinutes: cells.reduce((sum, cell) => sum + cell.timedWorkMinutes, 0) } };
  });
  const dates = referencesOnly ? [] : presentation.dates;
  const calendar = { people: calendarPeople, weeks: [...new Set(dates.map(date => weekStart(date, input)))].map(start => ({ start, dates: dates.filter(date => weekStart(date, input) === start) })),
    days: dates.map(date => {
      const cells = calendarPeople.flatMap(person => person.cells.filter(cell => cell.date === date));
      const count = (kind: typeof cells[number]["kind"]) => cells.filter(cell => cell.kind === kind).length;
      const unassigned = cells.filter(cell => cell.code === "NP").length;
      return { date, working: unassigned ? null : count("WORK") + count("DUTY"), knownWorking: count("WORK") + count("DUTY"),
        duty: count("DUTY"), off: unassigned ? null : count("OFF"), knownOff: count("OFF"), absence: count("ABSENCE"), holiday: count("HOLIDAY"),
        withoutClock: cells.filter(cell => cell.code === "ENC" || cell.code === "SH").length,
        unassigned,
        // Demands are simultaneous interval constraints, never distinct people per civil day.
        minimum: null, balance: null };
    }) };
  const points = [...new Set([0, 1440, ...presence.flatMap(row => row.segments.flatMap(segment => [segment.start, segment.end]))])].sort((a, b) => a - b);
  const presenceWindows = presence.length ? points.slice(0, -1).map((start, index) => ({ start, end: points[index + 1],
    present: presence.filter(row => row.segments.some(segment => segment.kind === "WORK" && segment.start <= start && segment.end > start)).length,
    pause: presence.filter(row => row.segments.some(segment => segment.kind !== "WORK" && segment.start <= start && segment.end > start)
      && !row.segments.some(segment => segment.kind === "WORK" && segment.start <= start && segment.end > start)).length })) : [];
  const presenceByEmployee = new Map(presence.map(row => [row.employeeId, row]));
  const orderedPresence = sortScheduleEntries(people.flatMap(person => {
    const row = presenceByEmployee.get(person.employee.id);
    return row ? [{ employee: person.employee, row, schedule: row.segments.filter(segment => segment.kind === "WORK")
      .map(segment => escalaDuration(segment.start) + "-" + escalaDuration(segment.end)).join(" / ") }] : [];
  })).map(entry => entry.row);
  return { options, referencesOnly, branch: presentation.branch, revision: workspace.revision, status: presentation.state,
    planningWeekStartsOn: planningWeekStartsOn(input),
    workspaceId: workspace.id, updatedAt: workspace.updatedAt, period: presentation.period, calendar, presenceWindows,
    dates: referencesOnly ? [] : presentation.dates, sectors: context.sectors.filter(sector => selected.has(sector)), people,
    excluded: presentation.excluded.filter(row => selected.has(row.employee.sector)),
    operations: { ...operations, days: operations.days.filter(day => selected.has(day.sector)) },
    coverage: coverage ? { ...coverage, rows: coverage.rows.filter(row => selected.has(row.sector) && targeted.has(row.sector)) } : null, presence: orderedPresence };
}
export type OperationalReportModel = ReturnType<typeof buildOperationalReport>;
