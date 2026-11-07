import { addDays, dateRange, dayOfWeek, weekStart } from "./dates";
import { dailyMinuteCeiling, effectiveWeeklyMinutes, isMixed42LongShift, usesMixed42Week } from "./labor-rules";
import type { EscalaGenerationConflict, EscalaInput } from "./types";
type EscalaDemand = EscalaInput["demands"][number];

type Budget = { sector: string; role?: string; week: string; demands: EscalaDemand[] };
const duration = (minutes: number) => Math.floor(minutes / 60) + "h" + String(minutes % 60).padStart(2, "0");
const displayDate = (date: string) => date.split("-").reverse().join("/");

/** Integrate the strongest concurrent requirement, without charging overlapping minima twice. */
function requiredMinutes(demands: EscalaDemand[]): number {
  let minutes = 0;
  for (const date of new Set(demands.map((demand) => demand.date))) {
    const rows = demands.filter((demand) => demand.date === date);
    const edges = [...new Set(rows.flatMap((demand) => [demand.start, demand.end]))].sort((a, b) => a - b);
    for (let index = 0; index + 1 < edges.length; index++) {
      minutes += (edges[index + 1] - edges[index]) * Math.max(0, ...rows.filter((demand) => demand.start <= edges[index] && demand.end >= edges[index + 1]).map((demand) => demand.minimum));
    }
  }
  return minutes;
}

/** Necessary-condition proof only. It never changes settings or claims to identify every possible conflict. */
export function findGenerationConflicts(input: EscalaInput): EscalaGenerationConflict[] {
  const individual: EscalaGenerationConflict[] = [];
  const employees = new Map(input.employees.map((person) => [person.id, person]));
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  for (const assignment of input.assignments) {
    const person = employees.get(assignment.employeeId);
    if (!assignment.locked || (assignment.kind !== "WORK" && assignment.kind !== "DUTY") || !person || person.planningEnabled === false) continue;
    if (person.offMode !== "VARIABLE" && person.fixedOffDays.includes(dayOfWeek(assignment.date))) individual.push({
      code: "LOCKED_WORK_ON_FIXED_REST", target: "team", employeeId: person.id, date: assignment.date,
      message: "Há trabalho bloqueado em " + displayDate(assignment.date) + ", mas esse dia também é uma folga fixa do colaborador. Confira qual condição deve ser mantida; nenhuma será retirada automaticamente.",
    });
    if (assignment.kind !== "WORK" || !assignment.shiftId || assignment.date < person.activeFrom
      || (person.activeUntil && assignment.date > person.activeUntil)) continue;
    const shift = shifts.get(assignment.shiftId);
    if (!shift || !isMixed42LongShift(shift) || usesMixed42Week(input, person, assignment.date)
      || Math.min(input.policy.dailyLimitMinutes, dailyMinuteCeiling(assignment.date)) >= 540) continue;
    const canRestoreMixed = usesMixed42Week({ ...input, mixed42Sectors: [person.sector] }, person, assignment.date);
    individual.push({
      code: "LOCKED_9H_SHIFT_OVER_DAILY_LIMIT", target: "team", employeeId: person.id, date: assignment.date,
      message: `${person.name} tem um horário de 9h bloqueado em ${displayDate(assignment.date)}, acima do limite deste cenário. `
        + (canRestoreMixed ? `Se quiser manter esse horário, reative a jornada mista no setor ${person.sector}. Caso contrário, ` : "")
        + "peça a um aprovador para revisar o bloqueio antes de gerar novamente. O horário não foi alterado.",
    });
  }
  const groups = new Map<string, Budget>();
  for (const demand of input.demands) {
    if (demand.estimated === true || demand.minimum <= 0 || demand.date < input.startDate || demand.date > input.endDate) continue;
    const week = weekStart(demand.date), key = JSON.stringify([demand.sector, demand.role ?? "", week]);
    const group = groups.get(key) ?? { sector: demand.sector, ...(demand.role ? { role: demand.role } : {}), week, demands: [] };
    group.demands.push(demand);
    groups.set(key, group);
  }
  const closed = new Set(input.policy.closedDates);
  const assignments = new Map(input.assignments.map((item) => [JSON.stringify([item.employeeId, item.date]), item]));
  const repeated = new Map<string, { group: Budget; required: number; capacity: number; weeks: string[] }>();
  for (const group of groups.values()) {
    const first = group.week < input.startDate ? input.startDate : group.week;
    const last = addDays(group.week, 6) > input.endDate ? input.endDate : addDays(group.week, 6);
    const dates = dateRange(first, last);
    let capacity = 0;
    for (const person of input.employees) {
      if (person.planningEnabled === false || person.sector !== group.sector || (group.role && person.role !== group.role)) continue;
      const timed = person.scheduleMode !== "MISSING" && person.scheduleMode !== "UNTIMED";
      const previousDate = addDays(group.week, -1);
      const previous = assignments.get(JSON.stringify([person.id, previousDate]))
        ?? person.history.find((item) => item.date === previousDate)
        ?? person.planningHistory?.find((item) => item.date === previousDate);
      const extraIds = input.assignments.filter((item) => item.employeeId === person.id && item.locked && item.kind === "WORK" && item.date >= first && item.date <= last).map((item) => item.shiftId);
      const allowed = [...new Set([...person.shiftIds, ...extraIds, previous?.kind === "WORK" ? previous.shiftId : undefined])].flatMap((id) => { const shift = id ? shifts.get(id) : undefined; return shift ? [shift] : []; });
      const maximumWork = !timed ? 0 : Math.max(0, ...allowed.map((shift) => shift.segments.reduce((sum, segment) => sum + (segment.kind === "WORK" ? segment.end - segment.start : 0), 0)));
      const available = dates.filter((date) => {
        if (date < person.activeFrom || (person.activeUntil && date > person.activeUntil) || closed.has(date)
          || (person.offMode !== "VARIABLE" && person.fixedOffDays.includes(dayOfWeek(date)))) return false;
        const assignment = assignments.get(JSON.stringify([person.id, date]));
        return assignment?.kind !== "ABSENCE" && !(assignment?.kind === "OFF" && assignment.locked);
      }).length;
      capacity += Math.min(effectiveWeeklyMinutes(person, group.week), Math.min(5, available) * maximumWork);
      // Civil coverage can arrive from the previous Sunday's journey. Overestimate uncertain carry rather than invent an impossibility.
      if ((timed || previous?.kind === "WORK") && (!previous || previous.kind === "WORK") && person.activeFrom <= previousDate) {
        const previousShift = previous?.shiftId ? shifts.get(previous.shiftId) : undefined;
        const carryShifts = previousShift ? [previousShift] : allowed;
        capacity += Math.max(0, ...carryShifts.map((shift) => shift.segments.reduce((sum, segment) => sum + (segment.kind === "WORK" ? Math.max(0, Math.min(2880, segment.end) - Math.max(1440, segment.start)) : 0), 0)));
      }
    }
    const required = requiredMinutes(group.demands);
    if (required <= capacity) continue;
    const key = JSON.stringify([group.sector, group.role ?? "", required, capacity]);
    const repeat = repeated.get(key);
    if (repeat) {
      repeat.weeks.push(group.week);
      if (input.visibleMonth && group.week.slice(0, 7) === input.visibleMonth && repeat.group.week.slice(0, 7) !== input.visibleMonth) repeat.group = group;
    } else repeated.set(key, { group, required, capacity, weeks: [group.week] });
  }
  const coverage: EscalaGenerationConflict[] = [...repeated.values()].sort((a, b) => (b.required - b.capacity) - (a.required - a.capacity)).slice(0, 20).map(({ group, required, capacity, weeks }) => ({
    code: "COVERAGE_WEEKLY_CAPACITY", target: "coverage", sector: group.sector, ...(group.role ? { role: group.role } : {}),
    date: [...group.demands].sort((a, b) => a.date.localeCompare(b.date))[0].date,
    message: group.sector + (group.role ? " / " + group.role : "") + ": os mínimos exigem " + duration(required) + " de atendimento na semana de " + displayDate(group.week) + " a " + displayDate(addDays(group.week, 6)) + ", mas a equipe com horário tem capacidade de, no máximo, " + duration(capacity) + ". " + (weeks.length > 1 ? "O conflito se repete em " + weeks.length + " semanas do horizonte. " : "") + "Revise os mínimos obrigatórios ou escolha a cobertura automática estimada.",
  }));
  return [...individual, ...coverage].slice(0, 20);
}
