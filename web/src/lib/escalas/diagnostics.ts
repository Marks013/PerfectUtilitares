import { absoluteMinute, visibleDates } from "./dates";
import type { EscalaAssignment, EscalaInput, EscalaIssue } from "./types";
import { workJourney } from "./validation-time";

export type CoverageGap = {
  date: string; sector: string; role?: string; start: number; end: number;
  present: number; minimum: number; missing: number; estimated: boolean;
};
export type EscalaDiagnosticNotice = {
  code: string; severity: EscalaIssue["severity"]; label: string; message: string; count: number;
  dates: string[]; employeeIds: string[]; global: boolean;
};

const globalNotices: Record<string, { code?: string; label: string; message: string }> = {
  DAY_PENDING: { label: "Escala ainda não gerada", message: "Gere a proposta para definir trabalho e folgas." },
  SHORT_REFERENCE_PRESERVED: { label: "Referências curtas", message: "A duração original foi mantida, sem ampliação automática. A carga contratual individual não foi presumida; confira antes da aplicação." },
  HISTORY_UNVERIFIED: { label: "Continuidade anterior", message: "Histórico anterior não conferido. A continuidade usa apenas os registros disponíveis; nenhuma folga anterior foi presumida." },
  MISSING_SCHEDULE: { code: "SCHEDULE_UNVERIFIED", label: "Horários não apurados", message: "Há pessoas planejadas por presença diária. Horas, intervalos e cobertura horária dessas pessoas não foram apurados." },
  UNTIMED_REST_UNVERIFIED: { code: "SCHEDULE_UNVERIFIED", label: "Horários não apurados", message: "Há pessoas planejadas por presença diária. Horas, intervalos e cobertura horária dessas pessoas não foram apurados." },
  NIGHT_RULE_PENDING: { code: "NIGHT_REVIEW", label: "Horários noturnos", message: "As referências noturnas exigem conferência específica; os minutos civis não representam a hora noturna reduzida." },
  NIGHT_CREDIT_PENDING: { code: "NIGHT_REVIEW", label: "Horários noturnos", message: "As referências noturnas exigem conferência específica; os minutos civis não representam a hora noturna reduzida." },
  POLICY_PENDING: { label: "Regras da filial", message: "Norma e responsável pela conferência ainda não informados. A proposta apoia a revisão, sem certificar conformidade." },
  POLICY_VALIDITY: { label: "Vigência das regras", message: "A norma informada não abrange todo o período do planejamento." },
  COVERAGE_REVIEW_PENDING: { label: "Cobertura estimada", message: "A cobertura automática estima a distribuição da equipe; não comprova a necessidade operacional. Confira os desfalques identificados." },
  COVERAGE_PENDING: { label: "Cobertura não definida", message: "Parte do período ou dos setores não tem faixas de referência. A conferência de cobertura considera somente as faixas existentes." },
  COMPENSATION_REQUIRED: { label: "Distribuição acima de oito horas", message: "Há jornadas propostas acima de oito horas sem compensação confirmada. Essa autorização não foi presumida." },
  COLLECTIVE_AGREEMENT_REQUIRED: { label: "Acordo coletivo", message: "A distribuição acima de oito horas na transição depende de instrumento coletivo vigente ainda não conferido." },
  CCT_SUNDAY_CERTIFICATE: { label: "Autorização para domingos", message: "Há trabalho proposto aos domingos sem certidão sindical conferida para a filial." },
  CCT_HOLIDAY_CERTIFICATE: { label: "Autorização para feriados", message: "Há trabalho proposto em feriados sem certidão sindical conferida para a filial." },
  CCT_NIGHT_CERTIFICATE: { label: "Autorização após vinte horas", message: "Há prorrogação ou trabalho noturno após vinte horas sem certidão sindical conferida." },
  CCT_VALIDITY: { label: "Vigência do instrumento coletivo", message: "O planejamento ultrapassa a vigência do instrumento coletivo informado." },
  SUNDAY_RULE_PENDING: { label: "Revezamento dominical", message: "Há pessoas com regra dominical ainda não conferida. O cargo, sozinho, não comprova o enquadramento." },
  TRANSITION_WEEK_PENDING: { label: "Semana de transição", message: "Há semana que atravessa mudança de carga. Confira o limite aplicado à semana completa; nenhum rateio diário foi presumido." },
};
const issueLabels: Record<string, string> = {
  WORK_STREAK: "Sequência de trabalho", INTER_SHIFT_REST: "Descanso entre jornadas", WEEKLY_REST: "Repouso semanal",
  CONSECUTIVE_OFF: "Folgas consecutivas", DAY_PENDING: "Dia sem definição", MEAL_INTERVAL: "Intervalo para refeição",
  CLOSED_DATE: "Trabalho em data fechada", HOLIDAY_WORK: "Trabalho em feriado", HOLIDAY_REST: "Descanso em feriado",
};
const coverageCodes = new Set(["COVERAGE_DEFICIT", "ESTIMATED_COVERAGE_GAP"]);

/** Recalculate exact slices instead of trying to recover an interval from a prose warning. */
function coverageGaps(input: EscalaInput, visible: ReadonlySet<string>): CoverageGap[] {
  const people = new Map(input.employees.map(person => [person.id, person]));
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const assignments = new Map<string, EscalaAssignment>();
  for (const person of input.employees) {
    for (const record of [...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])]) assignments.set(`${record.employeeId}\0${record.date}`, record);
  }
  for (const record of input.assignments) assignments.set(`${record.employeeId}\0${record.date}`, record);
  type Interval = { employeeId: string; role: string; start: number; end: number };
  const intervalsBySectorDate = new Map<string, Interval[]>();
  for (const assignment of assignments.values()) {
    const person = people.get(assignment.employeeId), shift = shifts.get(assignment.shiftId ?? "");
    if (assignment.kind !== "WORK" || !person || !shift || person.planningEnabled === false || person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED"
      || assignment.date < person.activeFrom || (person.activeUntil && assignment.date > person.activeUntil)) continue;
    try {
      const journey = workJourney(assignment, shift);
      for (const day of journey.occupiedDates) {
        if (!visible.has(day) || day < person.activeFrom || (person.activeUntil && day > person.activeUntil)) continue;
        const key = `${person.sector}\0${day}`, intervals = intervalsBySectorDate.get(key) ?? [];
        intervals.push(...journey.coverage.map(interval => ({ ...interval, employeeId: person.id, role: person.role })));
        intervalsBySectorDate.set(key, intervals);
      }
    } catch {
      // The independent verifier retains invalid civil-time diagnostics; no presence is invented here.
    }
  }
  type Demand = EscalaInput["demands"][number];
  const groups = new Map<string, { demand: Demand; estimated: boolean; demands: Demand[] }>();
  for (const demand of input.demands) {
    if (!visible.has(demand.date) || demand.minimum <= 0) continue;
    const estimated = demand.estimated === true;
    const key = JSON.stringify([demand.date, demand.sector, demand.role ?? "", estimated]);
    const group = groups.get(key) ?? { demand, estimated, demands: [] };
    group.demands.push(demand); groups.set(key, group);
  }
  const gaps: CoverageGap[] = [];
  for (const { demand, estimated, demands } of groups.values()) {
    const midnight = absoluteMinute(demand.date, 0);
    const intervals = (intervalsBySectorDate.get(`${demand.sector}\0${demand.date}`) ?? []).filter(interval => !demand.role || interval.role === demand.role);
    const points = [...new Set([...demands.flatMap(item => [item.start, item.end]), ...intervals.flatMap(interval => [interval.start - midnight, interval.end - midnight])])].sort((left, right) => left - right);
    let previous: CoverageGap | undefined;
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index], end = points[index + 1];
      const references = demands.filter(item => item.start <= start && item.end >= end);
      if (!references.length) { previous = undefined; continue; }
      // Overlapping references constrain the same team, not separate additive staffing requirements.
      const minimum = Math.max(...references.map(item => item.minimum));
      const present = new Set(intervals.filter(interval => interval.start <= midnight + start && interval.end >= midnight + end).map(interval => interval.employeeId)).size;
      if (present >= minimum) { previous = undefined; continue; }
      if (previous && previous.end === start && previous.present === present && previous.minimum === minimum) previous.end = end;
      else {
        previous = { date: demand.date, sector: demand.sector, ...(demand.role ? { role: demand.role } : {}), start, end, present, minimum, missing: minimum - present, estimated };
        gaps.push(previous);
      }
    }
  }
  return gaps.sort((left, right) => left.sector.localeCompare(right.sector, "pt-BR") || (left.role ?? "").localeCompare(right.role ?? "", "pt-BR") || left.date.localeCompare(right.date) || left.start - right.start || left.end - right.end || Number(left.estimated) - Number(right.estimated));
}

/** Concise operational view; callers retain the original issues for the technical audit trail. */
export function buildEscalaDiagnostics(input: EscalaInput, issues: readonly EscalaIssue[]) {
  const visible = new Set(visibleDates(input)), coverage = coverageGaps(input, visible);
  const groups = new Map<string, EscalaDiagnosticNotice>();
  let technicalIssueCount = 0;
  for (const issue of issues) {
    const definition = input.simulation && issue.code === "HOLIDAY_WORK" && issue.severity !== "ERROR"
      ? { label: "Trabalho em feriados", message: "Há jornadas propostas em feriados sem autorização informada. Essa autorização não foi presumida; confira antes da aplicação." }
      : globalNotices[issue.code];
    if (!definition && issue.date && !visible.has(issue.date)) { technicalIssueCount++; continue; }
    // Exact recalculation replaces abbreviated coverage messages, but legacy data without demands remains visible.
    if (input.demands.length && coverageCodes.has(issue.code)) continue;
    const code = definition?.code ?? issue.code, global = Boolean(definition);
    const key = JSON.stringify([code, global ? "" : issue.severity, global ? "" : issue.message, global ? "" : issue.employeeId ?? ""]);
    const group = groups.get(key) ?? { code, severity: issue.severity, label: definition?.label ?? issueLabels[code] ?? (issue.severity === "ERROR" ? "Impedimento" : issue.severity === "PENDING" ? "Atenção" : "Informação"),
      message: definition?.message ?? issue.message, count: 0, dates: [], employeeIds: [], global };
    if (["ERROR", "PENDING", "WARNING"].indexOf(issue.severity) < ["ERROR", "PENDING", "WARNING"].indexOf(group.severity)) group.severity = issue.severity;
    group.count++;
    if (!global && issue.date && !group.dates.includes(issue.date)) group.dates.push(issue.date);
    if (issue.employeeId && !group.employeeIds.includes(issue.employeeId)) group.employeeIds.push(issue.employeeId);
    groups.set(key, group);
  }
  const notices = [...groups.values()];
  for (const notice of notices) { notice.dates.sort(); notice.employeeIds.sort(); }
  notices.sort((left, right) => ["ERROR", "PENDING", "WARNING"].indexOf(left.severity) - ["ERROR", "PENDING", "WARNING"].indexOf(right.severity) || Number(left.global) - Number(right.global) || left.label.localeCompare(right.label, "pt-BR"));
  return { coverage, notices, technicalIssueCount, totalIssueCount: issues.length };
}
