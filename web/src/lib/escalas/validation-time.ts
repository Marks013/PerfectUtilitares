import { absoluteMinute, addDays, dateRange } from "./dates";
import type { EscalaAssignment, EscalaInput, EscalaIssue, EscalaShift } from "./types";

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
  }
  return issues;
}

export function validateCoverage(input: EscalaInput, journeys: WorkJourney[]): { issues: EscalaIssue[]; minimumCoverageMargin: number | null } {
  const issues: EscalaIssue[] = [];
  let minimumCoverageMargin: number | null = null;
  const employees = new Map(input.employees.map((person) => [person.id, person]));
  const bySectorAndDate = new Map<string, WorkJourney[]>();
  for (const journey of journeys) {
    const sector = employees.get(journey.assignment.employeeId)?.sector;
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
      minimumCoverageMargin = minimumCoverageMargin === null ? margin : Math.min(minimumCoverageMargin, margin);
      if (margin < 0 && !reported) {
        const minute = demand.start + points[index] - start;
        issues.push({ code: "COVERAGE_DEFICIT", severity: "ERROR", date: demand.date,
          message: `${demand.sector}${demand.role ? ` / ${demand.role}` : ""}: ${present} presente(s), mínimo ${demand.minimum}, a partir de ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}.` });
        reported = true;
      }
    }
  }
  const demandedDates = new Set(input.demands.map((demand) => `${demand.sector}\0${demand.date}`));
  for (const sector of new Set(input.employees.map((person) => person.sector).filter(Boolean))) {
    const members = input.employees.filter((person) => person.sector === sector);
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
