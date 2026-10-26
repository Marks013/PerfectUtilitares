import { addDays, dateRange, dayOfWeek, weekStart } from "./dates";
import type { EscalaEmployee, EscalaEmployeeSummary, EscalaInput, EscalaIssue } from "./types";
import { interveningOffs, type WorkJourney } from "./validation-time";

function isActive(person: EscalaEmployee, day: string): boolean {
  return day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil);
}

export function validateEmployee(input: EscalaInput, person: EscalaEmployee, journeys: WorkJourney[]): { issues: EscalaIssue[]; summary: EscalaEmployeeSummary } {
  const issues: EscalaIssue[] = [];
  const issue = (code: string, message: string, date?: string, severity: "ERROR" | "PENDING" = "ERROR") => issues.push({ code, message, severity, employeeId: person.id, ...(date ? { date } : {}) });
  const current = input.assignments.filter((assignment) => assignment.employeeId === person.id);
  const all = [...person.history, ...current].sort((left, right) => left.date.localeCompare(right.date));
  const byDate = new Map(all.map((assignment) => [assignment.date, assignment]));
  const currentWork = journeys.filter((journey) => journey.assignment.employeeId === person.id && journey.assignment.date >= input.startDate);
  const allWork = journeys.filter((journey) => journey.assignment.employeeId === person.id).sort((left, right) => left.start - right.start);
  const summary: EscalaEmployeeSummary = {
    employeeId: person.id, workedMinutes: currentWork.reduce((sum, journey) => sum + journey.minutes, 0),
    workDays: current.filter((assignment) => assignment.kind === "WORK").length,
    offDays: current.filter((assignment) => assignment.kind === "OFF").length,
    maxStreak: 0, sundaysWorked: 0,
  };
  if (!person.sector || !person.role) issue("ORGANIZATION_PENDING", "Informe setor e cargo antes da publicação.", undefined, "PENDING");
  if (person.weeklyHours > input.policy.weeklyLimit) issue("CONTRACT_LIMIT", "Carga contratual superior ao limite normativo vigente.");
  const historyStart = person.activeFrom > addDays(input.startDate, -21) ? person.activeFrom : addDays(input.startDate, -21);
  const historyEnd = addDays(input.startDate, -1);
  if (historyStart <= historyEnd) {
    const required = dateRange(historyStart, historyEnd).filter((day) => isActive(person, day));
    const missing = required.some((day) => !byDate.has(day));
    if (required.length && (!person.historyKnown || missing)) issue("HISTORY_PENDING", "Informe o histórico completo dos 21 dias anteriores, limitado aos dias de vínculo. Histórico desconhecido não equivale a folga.", input.startDate, "PENDING");
  }
  for (const assignment of all) {
    if (!isActive(person, assignment.date)) issue("OUTSIDE_EMPLOYMENT", "Atribuição fora do período de vínculo.", assignment.date);
  }
  for (const day of dateRange(input.startDate, input.endDate)) {
    if (!isActive(person, day)) continue;
    const assignment = byDate.get(day);
    if (!assignment) {
      issue("DAY_PENDING", "Dia de vínculo ainda sem trabalho, folga ou ausência definido.", day, "PENDING");
      continue;
    }
    if (assignment.kind === "WORK" && !person.shiftIds.includes(assignment.shiftId ?? "")) issue("SHIFT_NOT_ALLOWED", "Turno não autorizado para este colaborador.", day);
    if (assignment.kind === "WORK" && person.fixedOffDays.includes(dayOfWeek(day))) issue("FIXED_OFF", "Trabalho em dia de folga fixa aprovada.", day);
    if (assignment.kind === "OFF" && !input.policy.holidayRestAllowed && input.policy.holidayDates.includes(day)) issue("HOLIDAY_REST", "A regra aplicável não permite compensar o descanso semanal neste feriado.", day);
    if (assignment.kind === "OFF" && allWork.some((journey) => journey.assignment.date !== day && journey.occupiedDates.includes(day))) issue("OFF_OCCUPIED", "O dia marcado como folga ainda contém trabalho de uma jornada anterior.", day);
  }
  let streak = 0;
  let previousDate: string | null = null;
  for (const assignment of all) {
    if (previousDate && addDays(previousDate, 1) !== assignment.date) streak = 0;
    streak = assignment.kind === "WORK" ? streak + 1 : 0;
    if (assignment.date >= input.startDate) {
      summary.maxStreak = Math.max(summary.maxStreak, streak);
      if (streak > input.policy.maxConsecutiveWorkDays) issue("WORK_STREAK", `Sequência de ${streak} jornadas: máximo de ${input.policy.maxConsecutiveWorkDays}; o sétimo dia deve ser descanso.`, assignment.date);
    }
    previousDate = assignment.date;
  }
  for (let index = 1; index < allWork.length; index++) {
    const previous = allWork[index - 1];
    const next = allWork[index];
    if (next.assignment.date < input.startDate) continue;
    const rest = next.start - previous.end;
    if (rest < input.policy.minInterShiftMinutes) issue("INTER_SHIFT_REST", `Descanso de ${rest} minutos entre jornadas; mínimo de ${input.policy.minInterShiftMinutes}.`, next.assignment.date);
    if (interveningOffs(previous, next, byDate) && rest < input.policy.minWeeklyRestMinutes) issue("WEEKLY_REST", `Repouso com folga de ${rest} minutos; mínimo de ${input.policy.minWeeklyRestMinutes}.`, next.assignment.date);
  }
  const occupied = new Set(allWork.flatMap((journey) => journey.occupiedDates));
  let sundayStreak = 0;
  for (const day of dateRange(addDays(input.startDate, -21), input.endDate).filter((day) => dayOfWeek(day) === 6)) {
    const assignment = byDate.get(day);
    if (occupied.has(day)) sundayStreak++;
    else if (assignment?.kind === "OFF") sundayStreak = 0;
    else if (assignment?.kind === "ABSENCE" || !isActive(person, day)) sundayStreak = 0;
    else sundayStreak = 0; // Unknown history is separately blocking; do not claim it was rest.
    if (day >= input.startDate && occupied.has(day)) {
      summary.sundaysWorked++;
      if (sundayStreak > person.maxConsecutiveSundays) issue("SUNDAY_ROTATION", `Mais de ${person.maxConsecutiveSundays} domingo(s) consecutivo(s) trabalhado(s).`, day);
    }
  }
  for (let start = input.startDate; start <= input.endDate; start = addDays(start, 7)) {
    const days = dateRange(start, addDays(start, 6));
    const active = days.filter((day) => isActive(person, day));
    if (!active.length) continue;
    const entries = active.map((day) => byDate.get(day));
    const weeklyWork = currentWork.filter((journey) => weekStart(journey.assignment.date) === start);
    const minutes = weeklyWork.reduce((sum, journey) => sum + journey.minutes, 0);
    if (minutes > person.weeklyHours * 60 || minutes > input.policy.weeklyLimit * 60) issue("WEEKLY_LIMIT", `Semana com ${minutes} minutos excede a carga contratual ou normativa.`, start);
    if (entries.some((entry) => !entry)) continue;
    if (active.length < 7 || entries.some((entry) => entry?.kind === "ABSENCE")) {
      issue("PARTIAL_WEEK_PENDING", "Semana com ausência ou vínculo parcial exige regra específica; não foram criadas horas a repor nem convertidas ausências em folgas.", start, "PENDING");
      continue;
    }
    const work = entries.filter((entry) => entry?.kind === "WORK").length;
    const offs = entries.filter((entry) => entry?.kind === "OFF").map((entry) => entry?.date ?? "");
    if (work !== 5 || offs.length !== 2) issue("FIVE_BY_TWO", `Semana 5x2 exige 5 dias de trabalho e 2 folgas; encontrados ${work} e ${offs.length}.`, start);
    if (minutes !== person.weeklyHours * 60) issue("WEEKLY_MINUTES", `Carga semanal de ${minutes} minutos difere dos ${person.weeklyHours * 60} minutos contratuais.`, start);
    if (person.offPattern === "CONSECUTIVE" && offs.length === 2) {
      for (const off of offs) {
        const before = addDays(off, -1);
        const after = addDays(off, 1);
        if (byDate.get(before)?.kind === "OFF" || byDate.get(after)?.kind === "OFF") continue;
        if (after > input.endDate || (before < input.startDate && !byDate.has(before))) issue("CONSECUTIVE_PENDING", "Folga consecutiva na fronteira depende de outro dia de descanso registrado no período adjacente.", off, "PENDING");
        else issue("CONSECUTIVE_OFF", "Folgas consecutivas obrigatórias não foram respeitadas.", off);
      }
    }
  }
  return { issues, summary };
}
