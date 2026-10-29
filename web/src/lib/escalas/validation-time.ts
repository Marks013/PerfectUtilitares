import { absoluteMinute, addDays, dateRange, dayOfWeek, visibleDates } from "./dates";
import type { EscalaAssignment, EscalaInput, EscalaIssue, EscalaShift } from "./types";
import { certificateAuthorizes, collectiveExtensionAuthorized, dailyMinuteCeiling, SUPERMARKET_CCT, TRANSITION_42_DATE, TRANSITION_40_DATE } from "./labor-rules";

export type WorkJourney = {
  assignment: EscalaAssignment;
  shift: EscalaShift;
  start: number;
  end: number;
  minutes: number;
  coverage: { start: number; end: number }[];
  occupiedDates: string[];
};

function paidMinutes(shift: EscalaShift): number {
  return shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

export function workJourney(assignment: EscalaAssignment, shift: EscalaShift): WorkJourney {
  const paid = shift.segments.filter((segment) => segment.kind !== "BREAK");
  const occupied = new Set<string>();
  for (const segment of paid) {
    for (let day = Math.floor(segment.start / 1440); day <= Math.floor((segment.end - 1) / 1440); day++) occupied.add(addDays(assignment.date, day));
  }
  return {
    assignment, shift,
    start: absoluteMinute(assignment.date, paid[0].start),
    end: absoluteMinute(assignment.date, paid.at(-1)?.end ?? paid[0].end),
    minutes: paidMinutes(shift),
    coverage: shift.segments.filter((segment) => segment.kind === "WORK").map((segment) => ({
      start: absoluteMinute(assignment.date, segment.start), end: absoluteMinute(assignment.date, segment.end),
    })),
    occupiedDates: [...occupied].sort(),
  };
}

function isNightShift(shift: EscalaShift): boolean {
  return shift.segments.some((segment) => segment.kind !== "BREAK" && (
    segment.start < 300 || segment.end > 1320
  ));
}

export function validateJourney(input: EscalaInput, journey: WorkJourney): EscalaIssue[] {
  const { assignment, shift, minutes } = journey;
  const issues: EscalaIssue[] = [];
  const issue = (code: string, message: string, severity: "ERROR" | "PENDING" = "ERROR", date = assignment.date) => issues.push({ code, message, severity, employeeId: assignment.employeeId, date });
  if (minutes > input.policy.dailyLimitMinutes) issue("DAILY_LIMIT", "A jornada ultrapassa o limite diário autorizado.");
  if (minutes > 480 && !input.policy.compensationAuthorized) issue("COMPENSATION_REQUIRED", "Jornada superior a 8h exige distribuição/compensação autorizada.");
  if (minutes > dailyMinuteCeiling(assignment.date)) issue("DISTRIBUTION_DAILY_LIMIT", "A jornada supera a distribuição deste regime na data: até 8h24 na fase de 42 horas e até 8h na fase de 40 horas.");
  if (minutes > 480 && assignment.date >= TRANSITION_42_DATE && assignment.date < TRANSITION_40_DATE
    && !collectiveExtensionAuthorized(input.policy, assignment.date)) issue("COLLECTIVE_AGREEMENT_REQUIRED", "Distribuição acima de oito horas na transição exige acordo ou convenção coletiva conferido e vigente na data. A autorização genérica não basta.");
  const first = shift.segments[0].start;
  const last = shift.segments.at(-1)?.end ?? first;
  const breaks = shift.segments.filter((segment) => segment.kind === "BREAK" && segment.start > first && segment.end < last);
  // Only an uninterrupted, unpaid interval is a meal; several short pauses are not summed.
  const meal = Math.max(0, ...breaks.map((segment) => segment.end - segment.start));
  const minimum = minutes > 360 ? input.policy.minMealMinutes : minutes > 240 ? 15 : 0;
  if (meal < minimum) issue("MEAL_INTERVAL", `Intervalo para refeição insuficiente: mínimo de ${minimum} minutos para esta jornada.`);
  if (isNightShift(shift)) {
    if (!input.policy.nightWorkReviewed) issue("NIGHT_RULE_PENDING", "Horário noturno exige regra específica conferida, inclusive cômputo da hora noturna.", "PENDING");
    issue("NIGHT_CREDIT_PENDING", "Jornada noturna mantida em rascunho: esta versão calcula minutos civis e ainda não representa a hora noturna reduzida. A conferência da norma, sozinha, não libera a publicação.", "PENDING");
  }
  for (const day of journey.occupiedDates) {
    if (input.policy.closedDates.includes(day)) issue("CLOSED_DATE", `Há trabalho em data de fechamento obrigatório: ${day}.`, "ERROR", day);
    if (input.policy.holidayDates.includes(day) && !input.policy.authorizedHolidayDates.includes(day)) issue("HOLIDAY_WORK", `Trabalho em feriado sem autorização registrada: ${day}.`, "ERROR", day);
    if (!certificateAuthorizes(input.policy, day, "sundays") && dayOfWeek(day) === 6) issue("CCT_SUNDAY_CERTIFICATE", "Domingo sem certidão sindical prévia conferida e válida para a filial (cláusula 46).", "ERROR", day);
    if (!certificateAuthorizes(input.policy, day, "holidays") && input.policy.holidayDates.includes(day)) issue("CCT_HOLIDAY_CERTIFICATE", "Feriado sem certidão sindical prévia conferida e válida para a filial (cláusula 46).", "ERROR", day);
    const offset = Math.round((absoluteMinute(day, 0) - absoluteMinute(assignment.date, 0)) / 1440) * 1440;
    const after20 = shift.segments.some((segment) => segment.kind !== "BREAK" && segment.start < offset + 1440 && segment.end > offset + 1200);
    if (after20 && (minutes > 480 || isNightShift(shift)) && !certificateAuthorizes(input.policy, day, "after20")) issue("CCT_NIGHT_CERTIFICATE", "Prorrogação ou trabalho noturno após 20h exige a certidão sindical prévia e revisão do regime (cláusula 46).", "ERROR", day);
    if (input.policy.normativeProfile === SUPERMARKET_CCT && ["12-25", "01-01", "05-01"].includes(day.slice(5))) issue("CCT_PUBLIC_SERVICE_PENDING", "A CCT veda atendimento ao público nesta data. Trabalho interno exige classificação e conferência específica, ainda não representada; não foi presumido fechamento de todo trabalho.", "PENDING", day);
  }
  return issues;
}

export function validateUntimedDuty(input: EscalaInput, assignment: EscalaAssignment): EscalaIssue[] {
  const day = assignment.date;
  const issues: EscalaIssue[] = [];
  const issue = (code: string, message: string, severity: EscalaIssue["severity"] = "ERROR") => issues.push({ code, message, severity, date: day, employeeId: assignment.employeeId });
  if (input.policy.closedDates.includes(day)) issue("CLOSED_DATE", "Há trabalho sem horário fixo em data de fechamento obrigatório.");
  if (input.policy.holidayDates.includes(day) && !input.policy.authorizedHolidayDates.includes(day)) issue("HOLIDAY_WORK", "Trabalho sem horário fixo em feriado sem autorização registrada.");
  if (dayOfWeek(day) === 6 && !certificateAuthorizes(input.policy, day, "sundays")) issue("CCT_SUNDAY_CERTIFICATE", "Domingo sem certidão sindical prévia conferida para a filial.");
  if (input.policy.holidayDates.includes(day) && !certificateAuthorizes(input.policy, day, "holidays")) issue("CCT_HOLIDAY_CERTIFICATE", "Feriado sem certidão sindical prévia conferida para a filial.");
  if (input.policy.normativeProfile === SUPERMARKET_CCT && ["12-25", "01-01", "05-01"].includes(day.slice(5))) issue("CCT_PUBLIC_SERVICE_PENDING", "A CCT veda atendimento ao público nesta data. A atividade interna exige classificação específica.", "PENDING");
  return issues;
}

export function validateCoverage(input: EscalaInput, journeys: WorkJourney[]): { issues: EscalaIssue[]; minimumCoverageMargin: number | null } {
  const issues: EscalaIssue[] = [];
  let minimumCoverageMargin: number | null = null;
  const visible = new Set(visibleDates(input));
  const employees = new Map(input.employees.map((person) => [person.id, person]));
  const bySectorAndDate = new Map<string, WorkJourney[]>();
  for (const journey of journeys) {
    const employee = employees.get(journey.assignment.employeeId);
    const sector = (employee?.scheduleMode === "UNTIMED" || employee?.scheduleMode === "MISSING") ? undefined : employee?.sector;
    if (!sector) continue;
    for (const day of journey.occupiedDates) {
      const key = `${sector}\0${day}`;
      const existing = bySectorAndDate.get(key) ?? [];
      existing.push(journey);
      bySectorAndDate.set(key, existing);
    }
  }
  for (const demand of input.demands) {
    const start = absoluteMinute(demand.date, demand.start);
    const end = absoluteMinute(demand.date, demand.end);
    const intervals = (bySectorAndDate.get(`${demand.sector}\0${demand.date}`) ?? []).filter((journey) => {
      const person = employees.get(journey.assignment.employeeId);
      return person?.sector === demand.sector && (!demand.role || person.role === demand.role);
    }).flatMap((journey) => journey.coverage.map((interval) => ({ ...interval, employeeId: journey.assignment.employeeId })))
      .filter((interval) => interval.end > start && interval.start < end);
    const points = [...new Set([start, end, ...intervals.flatMap((interval) => [Math.max(start, interval.start), Math.min(end, interval.end)])])].sort((left, right) => left - right);
    let reported = false;
    for (let index = 0; index < points.length - 1; index++) {
      const present = new Set(intervals.filter((interval) => interval.start <= points[index] && interval.end >= points[index + 1]).map((interval) => interval.employeeId)).size;
      const margin = present - demand.minimum;
      if (visible.has(demand.date)) minimumCoverageMargin = minimumCoverageMargin === null ? margin : Math.min(minimumCoverageMargin, margin);
      if (margin < 0 && !reported) {
        const minute = demand.start + points[index] - start;
        const estimated = demand.estimated === true;
        issues.push({ code: estimated ? "ESTIMATED_COVERAGE_GAP" : "COVERAGE_DEFICIT", severity: estimated ? "PENDING" : "ERROR", date: demand.date,
          message: `${demand.sector}${demand.role ? ` / ${demand.role}` : ""}: ${present} presente(s), ${estimated ? "estimativa" : "mínimo"} ${demand.minimum}, a partir de ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}.${estimated ? " Confira a necessidade e os horários desta faixa antes de confirmar a cobertura." : ""}` });
        reported = true;
      }
    }
  }
  const demandedDates = new Set(input.demands.map((demand) => `${demand.sector}\0${demand.date}`));
  for (const sector of new Set(input.employees.filter((person) => person.planningEnabled !== false && (person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING")).map((person) => person.sector).filter(Boolean))) {
    const members = input.employees.filter((person) => person.planningEnabled !== false && (person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING") && person.sector === sector);
    const missing = dateRange(input.startDate, input.endDate).filter((day) => !input.policy.closedDates.includes(day)
      && members.some((person) => day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil))
      && !demandedDates.has(`${sector}\0${day}`));
    if (missing.length) issues.push({ code: "COVERAGE_PENDING", severity: "PENDING", date: missing[0], message: `Setor ${sector}: ${missing.length} data(s) sem cobertura cadastrada, a partir de ${missing[0]}. Declare as faixas e o mínimo, inclusive zero quando autorizado. A conferência cobre somente as faixas declaradas.` });
  }
  return { issues, minimumCoverageMargin };
}

export function interveningOffs(previous: WorkJourney, next: WorkJourney, assignments: Map<string, EscalaAssignment>): boolean {
  const first = addDays(previous.assignment.date, 1);
  const last = addDays(next.assignment.date, -1);
  return first <= last && dateRange(first, last).some((day) => assignments.get(day)?.kind === "OFF");
}
