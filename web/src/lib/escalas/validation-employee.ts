import { addDays, dateRange, dayOfWeek, weekStart, visibleDates } from "./dates";
import { fixedBoundaryReservations } from "./boundary";
import type { EscalaAssignment, EscalaEmployee, EscalaEmployeeSummary, EscalaInput, EscalaIssue } from "./types";
import { interveningOffs, type WorkJourney } from "./validation-time";
import { effectiveSundayLimit, effectiveWeeklyMinutes, effectiveWorkDayLimit } from "./labor-rules";

function isActive(person: EscalaEmployee, day: string): boolean {
  return day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil);
}

export function validateEmployee(input: EscalaInput, person: EscalaEmployee, journeys: WorkJourney[], reservations: EscalaAssignment[] = fixedBoundaryReservations(input)): { issues: EscalaIssue[]; summary: EscalaEmployeeSummary } {
  const issues: EscalaIssue[] = [];
  const issue = (code: string, message: string, date?: string, severity: EscalaIssue["severity"] = "ERROR") => issues.push({ code, message, severity, employeeId: person.id, ...(date ? { date } : {}) });
  const current = input.assignments.filter((assignment) => assignment.employeeId === person.id);
  const all = [...new Map([...(person.planningHistory ?? []), ...person.history, ...current, ...(person.planningFuture ?? [])].map((item) => [item.date, item])).values()].sort((left, right) => left.date.localeCompare(right.date));
  const byDate = new Map(all.map((assignment) => [assignment.date, assignment]));
  const reservedOffDates = new Set(reservations.filter((assignment) => assignment.employeeId === person.id).map((assignment) => assignment.date));
  const currentWork = journeys.filter((journey) => journey.assignment.employeeId === person.id && journey.assignment.date >= input.startDate && journey.assignment.date <= input.endDate);
  const untimed = person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING";
  const visible = new Set(visibleDates(input));
  const monthly = current.filter((assignment) => visible.has(assignment.date));
  const allWork = journeys.filter((journey) => journey.assignment.employeeId === person.id).sort((left, right) => left.start - right.start);
  const summary: EscalaEmployeeSummary = {
    employeeId: person.id, workedMinutes: untimed ? 0 : currentWork.filter((journey) => visible.has(journey.assignment.date)).reduce((sum, journey) => sum + journey.minutes, 0),
    workDays: monthly.filter((assignment) => assignment.kind === "WORK" || assignment.kind === "DUTY").length,
    offDays: monthly.filter((assignment) => assignment.kind === "OFF").length,
    maxStreak: 0, sundaysWorked: 0,
  };
  if (person.planningEnabled === false) {
    if (current.some(entry => !entry.locked && entry.kind !== "ABSENCE")) issue("DISABLED_ASSIGNMENT", "Há atribuições para uma pessoa fora da geração. Remova as atribuições ou inclua a pessoa na proposta.");
    return { issues, summary };
  }
  if (!person.sector || !person.role) issue("ORGANIZATION_PENDING", "Informe setor e cargo antes da publicação.", undefined, "PENDING");
  if (!untimed && !person.shiftIds.length) issue("EMPLOYEE_SHIFT_PENDING", "Nenhum horário de planejamento definido. Use a configuração em lote da filial ou mantenha este registro fora da geração.", undefined, "PENDING");
  if (person.scheduleMode === "MISSING") issue("MISSING_SCHEDULE", "Horário não informado: presença e folgas podem ser simuladas, mas horas, intervalos e cobertura horária não foram verificados. Informe um horário ou confirme explicitamente o modo sem controle de horário antes da publicação.", undefined, "PENDING");
  if (untimed) issue("UNTIMED_REST_UNVERIFIED", "Sem horário fixo: o rodízio confere dias de trabalho, folgas e domingos. Horas e intervalos entre jornadas não foram apurados nem presumidos; o cadastro não certifica enquadramento de exceção da CLT.", undefined, "WARNING");
  if ((!person.sundayRestRule || person.sundayRestRule === "UNREVIEWED") && person.maxConsecutiveSundays > 1) issue("SUNDAY_RULE_PENDING", "Dois domingos consecutivos exigem enquadramento conferido na regra geral do comércio. A regra quinzenal protetiva pode ser usada para toda a equipe.", undefined, "PENDING");
  const sundayLimit = effectiveSundayLimit(person);
  const historyStart = person.activeFrom > addDays(input.startDate, -21) ? person.activeFrom : addDays(input.startDate, -21);
  const historyEnd = addDays(input.startDate, -1);
  if (historyStart <= historyEnd) {
    const required = dateRange(historyStart, historyEnd).filter((day) => isActive(person, day));
    const actualDates = new Set(person.history.map((assignment) => assignment.date));
    const missing = required.some((day) => !actualDates.has(day));
    if (required.length && (!person.historyKnown || missing)) issue("HISTORY_UNVERIFIED", "Continuidade anterior não conferida: o planejamento usa somente os dias e históricos informados. Nenhuma folga anterior foi presumida. O histórico é opcional e esta publicação não certifica a transição com o período anterior.", input.startDate, "WARNING");
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
    if ((assignment.kind === "DUTY") !== untimed && (assignment.kind === "DUTY" || assignment.kind === "WORK")) issue("SCHEDULE_MODE", "Dia de trabalho incompatível com o modo de horário do colaborador.", day);
    if ((assignment.kind === "WORK" || assignment.kind === "DUTY") && person.fixedOffDays.includes(dayOfWeek(day))) issue("FIXED_OFF", "Trabalho em dia de folga fixa aprovada.", day);
    if (assignment.kind === "OFF" && !input.policy.holidayRestAllowed && input.policy.holidayDates.includes(day)) issue("HOLIDAY_REST", "A regra aplicável não permite compensar o descanso semanal neste feriado.", day);
    if (assignment.kind === "OFF" && allWork.some((journey) => journey.assignment.date !== day && journey.occupiedDates.includes(day))) issue("OFF_OCCUPIED", "O dia marcado como folga ainda contém trabalho de uma jornada anterior.", day);
    if (assignment.kind === "ABSENCE" && allWork.some((journey) => journey.occupiedDates.includes(day))) issue("ABSENCE_OCCUPIED", "O afastamento coincide com trabalho de uma jornada que atravessa a meia-noite. Ajuste o horário ou o dia anterior; o afastamento deve permanecer preservado.", day);
  }
  const maximumWorkDays = effectiveWorkDayLimit(input.policy);
  let streak = 0;
  let previousDate: string | null = null;
  for (const assignment of all) {
    if (previousDate && addDays(previousDate, 1) !== assignment.date) streak = 0;
    streak = assignment.kind === "WORK" || assignment.kind === "DUTY" ? streak + 1 : 0;
    if (assignment.date >= input.startDate) {
      if (visible.has(assignment.date)) summary.maxStreak = Math.max(summary.maxStreak, streak);
      if (streak > maximumWorkDays && addDays(assignment.date, -maximumWorkDays) <= input.endDate) issue("WORK_STREAK", `Sequência de ${streak} dias de trabalho: este modelo 5×2 permite no máximo ${maximumWorkDays} consecutivos. Revise uma folga antes de continuar a sequência.`, assignment.date);
    }
    previousDate = assignment.date;
  }
  for (let index = 1; index < allWork.length; index++) {
    const previous = allWork[index - 1];
    const next = allWork[index];
    if (next.assignment.date < input.startDate || previous.assignment.date > input.endDate) continue;
    const rest = next.start - previous.end;
    if (rest < input.policy.minInterShiftMinutes) issue("INTER_SHIFT_REST", `Descanso de ${rest} minutos entre jornadas; mínimo de ${input.policy.minInterShiftMinutes}.`, next.assignment.date);
    if (interveningOffs(previous, next, byDate) && rest < input.policy.minWeeklyRestMinutes) issue("WEEKLY_REST", `Repouso com folga de ${rest} minutos; mínimo de ${input.policy.minWeeklyRestMinutes}.`, next.assignment.date);
  }
  const occupied = new Set([...allWork.flatMap((journey) => journey.occupiedDates), ...all.filter((assignment) => assignment.kind === "DUTY").map((assignment) => assignment.date)]);
  let sundayStreak = 0;
  const continuityEnd = all.reduce((end, assignment) => assignment.date > end ? assignment.date : end, input.endDate);
  for (const day of dateRange(addDays(input.startDate, -21), continuityEnd).filter((day) => dayOfWeek(day) === 6)) {
    const assignment = byDate.get(day);
    if (occupied.has(day)) sundayStreak++;
    else if (assignment?.kind === "OFF") sundayStreak = 0;
    else if (assignment?.kind === "ABSENCE" || !isActive(person, day)) sundayStreak = 0;
    else sundayStreak = 0; // Unknown history is separately blocking; do not claim it was rest.
    if (day >= input.startDate && occupied.has(day)) {
      if (visible.has(day)) summary.sundaysWorked++;
      if (sundayStreak > sundayLimit && addDays(day, -7 * sundayLimit) <= input.endDate) issue("SUNDAY_ROTATION", `Mais de ${sundayLimit} domingo(s) consecutivo(s) trabalhado(s); confira o enquadramento e o histórico.`, day);
    }
  }
  // Explain real availability once per interval. Month clipping is not partial employment.
  const formatDate = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
  const absences = current.filter((entry) => entry.kind === "ABSENCE" && isActive(person, entry.date)).map((entry) => entry.date).sort();
  for (let index = 0; index < absences.length;) {
    const first = absences[index];
    let last = first;
    let count = 1;
    while (++index < absences.length && absences[index] === addDays(last, 1)) { last = absences[index]; count++; }
    issues.push({ code: "ABSENCE_AVAILABILITY", severity: "WARNING", employeeId: person.id, date: first, periodEnd: last,
      message: `Afastamento de ${formatDate(first)} a ${formatDate(last)} (${count} dia(s)). Sem disponibilidade para trabalho e cobertura nessas datas. A jornada integral 5×2 é conferida apenas nas semanas sem afastamento. Nenhuma ação é necessária se as datas estiverem corretas; para corrigir, abra os afastamentos deste colaborador.` });
  }
  if (person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate)
    && (person.activeFrom > input.startDate || person.activeUntil && person.activeUntil < input.endDate)) {
    const first = person.activeFrom > input.startDate ? person.activeFrom : input.startDate;
    const last = person.activeUntil && person.activeUntil < input.endDate ? person.activeUntil : input.endDate;
    const cause = [person.activeFrom > input.startDate ? `admissão em ${formatDate(person.activeFrom)}` : "",
      person.activeUntil && person.activeUntil < input.endDate ? `desligamento em ${formatDate(person.activeUntil)}` : ""].filter(Boolean).join(" e ");
    issues.push({ code: "EMPLOYMENT_AVAILABILITY", severity: "WARNING", employeeId: person.id, date: first, periodEnd: last,
      message: `Disponível neste planejamento de ${formatDate(first)} a ${formatDate(last)} por ${cause}. Fora dessas datas não há vínculo ativo; isso não significa contrato com jornada reduzida. Nas semanas de admissão ou desligamento não se exige a jornada semanal integral. Nenhuma ação é necessária se as datas estiverem corretas.` });
  }
  for (let start = input.startDate; start <= input.endDate; start = addDays(start, 7)) {
    const days = dateRange(start, addDays(start, 6));
    const active = days.filter((day) => isActive(person, day));
    if (!active.length) continue;
    const entries = active.map((day) => byDate.get(day));
    const weeklyWork = currentWork.filter((journey) => weekStart(journey.assignment.date) === start);
    const minutes = weeklyWork.reduce((sum, journey) => sum + journey.minutes, 0);
    const target = effectiveWeeklyMinutes(person, start) / 60;
    if (!untimed && target > input.policy.weeklyLimit) issue("CONTRACT_LIMIT", "Carga contratual efetiva superior ao limite normativo cadastrado.", start);
    if (!untimed && (minutes > target * 60 || minutes > input.policy.weeklyLimit * 60)) issue("WEEKLY_LIMIT", `Semana com ${minutes} minutos excede a carga efetiva ou normativa; alvo de ${target * 60} minutos.`, start);
    if (entries.some((entry) => !entry)) continue;
    const work = entries.filter((entry) => entry?.kind === "WORK" || entry?.kind === "DUTY").length;
    const offs = entries.filter((entry) => entry?.kind === "OFF").map((entry) => entry?.date ?? "");
    const limitedAvailability = active.length < 7 || entries.some((entry) => entry?.kind === "ABSENCE");
    if (work > 5 || !limitedAvailability && (work !== 5 || offs.length !== 2)) issue("FIVE_BY_TWO", `Semana 5×2: no máximo 5 dias de trabalho; em semana completa, 5 dias de trabalho e 2 folgas. Encontrados ${work} dia(s) de trabalho e ${offs.length} folga(s), de ${formatDate(start)} a ${formatDate(addDays(start, 6))}.`, start);
    if (!limitedAvailability && !untimed && minutes !== target * 60) issue("WEEKLY_MINUTES", `Carga semanal de ${minutes} minutos difere dos ${target * 60} minutos vigentes nesta semana.`, start);
    if (person.offPattern === "CONSECUTIVE" && offs.length === 2) {
      for (const off of offs) {
        const before = addDays(off, -1);
        const after = addDays(off, 1);
        if (byDate.get(before)?.kind === "OFF" || byDate.get(after)?.kind === "OFF" || (reservedOffDates.has(after) && !byDate.has(after))) continue;
        if ((after > input.endDate && !byDate.has(after)) || (before < input.startDate && !byDate.has(before))) issue("CONSECUTIVE_PENDING", "Folga consecutiva na fronteira depende de outro dia de descanso registrado no período adjacente.", off, "PENDING");
        else issue("CONSECUTIVE_OFF", "Folgas consecutivas obrigatórias não foram respeitadas.", off);
      }
    }
  }
  for (const future of person.planningFuture ?? []) {
    if (future.kind === "OFF" && allWork.some((journey) => journey.assignment.date <= input.endDate && journey.occupiedDates.includes(future.date)))
      issue("OFF_OCCUPIED", "Uma jornada deste período ocupa uma folga já publicada no próximo período.", future.date);
  }
  if (person.offPattern === "CONSECUTIVE") {
    for (const future of person.planningFuture ?? []) {
      if (future.kind !== "OFF" || future.date !== addDays(input.endDate, 1)) continue;
      const before = byDate.get(input.endDate), after = byDate.get(addDays(future.date, 1));
      if (before?.kind === "OFF" || after?.kind === "OFF") continue;
      if (!before || !after) issue("CONSECUTIVE_PENDING", "A primeira folga publicada no próximo período depende de outro descanso adjacente ainda não informado.", future.date, "PENDING");
      else issue("CONSECUTIVE_OFF", "A alteração rompe o par de folgas consecutivas já publicado na fronteira do próximo período.", future.date);
    }
  }
  return { issues, summary };
}
