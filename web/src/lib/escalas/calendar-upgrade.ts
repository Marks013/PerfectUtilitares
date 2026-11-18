import { addDays, dateRange, monthBounds, visibleDates } from "./dates";
import { EscalaError } from "./errors";
import { planningMonthPeriod, planningWeekStart, planningWeekStartsOn } from "./planning-calendar";
import type { EscalaAssignment, EscalaEmployee, EscalaInput } from "./types";

function sameDay(a: EscalaAssignment, b: EscalaAssignment): boolean {
  return a.kind === b.kind && a.shiftId === b.shiftId;
}

/** An origin revision is immutable; only its protected outer days constrain the new draft. */
function retainCalendarSourceBoundaries(input: EscalaInput, source: EscalaInput): EscalaInput {
  const shifts = [...input.shifts];
  for (const day of source.assignments.filter(day => (day.locked || day.kind === "ABSENCE" || day.kind === "HOLIDAY")
    && (day.date < input.startDate || day.date > input.endDate)
    && day.date >= addDays(input.startDate, -56) && day.date <= addDays(input.endDate, 21))) {
    const original = source.employees.find(person => person.id === day.employeeId);
    if (!original || !input.employees.some(person => person.id === original.id && person.registration === original.registration))
      throw new EscalaError(409, "ESCALA_CALENDAR_BOUNDARY_CONFLICT", "Há uma decisão de continuidade protegida para uma pessoa removida ou com matrícula alterada. Preserve essa pessoa antes de atualizar a semana.");
  }
  const employees = input.employees.map(person => {
    const original = source.employees.find(old => old.id === person.id && old.registration === person.registration);
    if (!original) return person;
    const outside = source.assignments.filter(day => day.employeeId === original.id
      && (day.locked || day.kind === "ABSENCE" || day.kind === "HOLIDAY")
      && (day.date < input.startDate || day.date > input.endDate)
      && day.date >= addDays(input.startDate, -56) && day.date <= addDays(input.endDate, 21));
    if (!outside.length) return person;
    const history = new Map((person.planningHistory ?? []).map(day => [day.date, day]));
    const future = new Map((person.planningFuture ?? []).map(day => [day.date, day]));
    for (const day of outside) {
      const records = day.date < input.startDate ? history : future;
      const existing = records.get(day.date);
      if (existing && !sameDay(existing, day)) throw new EscalaError(409, "ESCALA_CALENDAR_BOUNDARY_CONFLICT", `Há uma decisão protegida divergente em ${day.date}. Confira a continuidade; o planejamento original foi preservado.`);
      const actual = person.history.find(record => record.date === day.date);
      if (actual && !sameDay(actual, day)) throw new EscalaError(409, "ESCALA_CALENDAR_BOUNDARY_CONFLICT", `O histórico informado diverge de uma decisão protegida em ${day.date}. Confira a continuidade antes de continuar.`);
      if (day.shiftId) {
        const originalShift = source.shifts.find(shift => shift.id === day.shiftId);
        const currentShift = shifts.find(shift => shift.id === day.shiftId);
        if (!originalShift || currentShift && JSON.stringify(currentShift.segments) !== JSON.stringify(originalShift.segments))
          throw new EscalaError(409, "ESCALA_CALENDAR_BOUNDARY_CONFLICT", "Um horário de continuidade protegido foi alterado. Preserve essa referência ou revise a origem antes de continuar.");
        if (!currentShift) shifts.push(structuredClone(originalShift));
      }
      records.set(day.date, { ...day, employeeId: person.id, locked: true });
    }
    return { ...person, planningHistory: [...history.values()].sort((a, b) => a.date.localeCompare(b.date)),
      planningFuture: [...future.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  });
  if (shifts.length > 120) throw new EscalaError(422, "ESCALA_CONTINUITY_SHIFT_LIMIT", "A continuidade excede 120 horários distintos. Revise as referências antes de atualizar a semana.");
  return { ...input, employees, shifts };
}

/** Rehydrate server-saved source commitments after discarding untrusted client context. */
export function preserveCalendarSourceContext(previous: EscalaInput, next: EscalaInput): EscalaInput {
  if (!previous.planningCalendarSource) return next;
  const boundary = previous.employees.flatMap(person => [...(person.planningHistory ?? []), ...(person.planningFuture ?? [])]
    .filter(day => day.locked === true));
  return retainCalendarSourceBoundaries(next, { ...previous, assignments: boundary });
}

/** Create a new dated proposal; never move dates or reinterpret the saved source in place. */
export function sundayCalendarDraft(source: EscalaInput, origin: { workspaceId: string; revision: number }): EscalaInput {
  if (planningWeekStartsOn(source) === "SUNDAY") throw new EscalaError(409, "ESCALA_CALENDAR_CURRENT", "Este planejamento já usa semanas de domingo a sábado.");
  const visible = visibleDates(source);
  const inferred = visible[0]?.slice(0, 7);
  const month = source.visibleMonth ?? (inferred && visible[0] === monthBounds(inferred).startDate
    && visible.at(-1) === monthBounds(inferred).endDate ? inferred : undefined);
  const calendar = { planningWeekStartsOn: "SUNDAY" as const };
  const startDate = planningWeekStart(source.startDate, calendar);
  const period = month ? planningMonthPeriod(month, calendar)
    : { startDate, endDate: addDays(startDate, dateRange(source.startDate, source.endDate).length - 1) };
  const inside = (date: string) => date >= period.startDate && date <= period.endDate;
  const assignments = new Map(source.assignments.filter(day => inside(day.date)).map(day => [JSON.stringify([day.employeeId, day.date]), structuredClone(day)]));
  const employees: EscalaEmployee[] = source.employees.map(person => {
    const copy = structuredClone(person);
    // A newly included boundary day may already be actual history or published context.
    // Retain its date and decision, instead of turning it into an optimization opportunity.
    for (const day of [...person.history, ...(person.planningHistory ?? []), ...(person.planningFuture ?? [])].filter(day => inside(day.date))) {
      const key = JSON.stringify([person.id, day.date]), existing = assignments.get(key);
      if (existing && !sameDay(existing, day)) throw new EscalaError(409, "ESCALA_CALENDAR_BOUNDARY_CONFLICT", `A continuidade diverge da grade em ${day.date}. Confira esse dia antes de atualizar a semana.`);
      assignments.set(key, { ...day, locked: true });
    }
    copy.history = copy.history.filter(day => day.date < period.startDate && day.date >= addDays(period.startDate, -56));
    copy.planningHistory = (copy.planningHistory ?? []).filter(day => day.date < period.startDate && day.date >= addDays(period.startDate, -56));
    copy.planningFuture = (copy.planningFuture ?? []).filter(day => day.date > period.endDate && day.date <= addDays(period.endDate, 21));
    if (copy.manualShiftOverrides?.length) {
      copy.manualShiftOverrides = copy.manualShiftOverrides.map(choice => ({ ...choice,
        effectiveFrom: choice.effectiveFrom < period.startDate ? period.startDate : choice.effectiveFrom,
        effectiveUntil: choice.effectiveUntil > period.endDate ? period.endDate : choice.effectiveUntil,
      })).filter(choice => choice.effectiveFrom <= choice.effectiveUntil);
      delete copy.manualShiftByDate;
      if (!copy.manualShiftOverrides.length) {
        copy.shiftIds = [...(copy.manualShiftBaseIds ?? copy.shiftIds)];
        delete copy.manualShiftOverrides;
        delete copy.manualShiftBaseIds;
      }
    }
    return copy;
  });
  const { generationBasis: _oldBasis, coverageBasis: _oldCoverage, ...retained } = structuredClone(source);
  const draft: EscalaInput = { ...retained, ...period, ...calendar, ...(month ? { visibleMonth: month } : {}),
    planningCalendarSource: { ...origin }, needsRegeneration: true, employees, assignments: [...assignments.values()],
    movementPriorities: source.movementPriorities?.flatMap(priority => {
      const startDate = priority.startDate < period.startDate ? period.startDate : priority.startDate;
      const endDate = priority.endDate > period.endDate ? period.endDate : priority.endDate;
      return startDate <= endDate ? [{ ...priority, startDate, endDate }] : [];
    }),
    demands: source.demands.filter(demand => !demand.estimated && inside(demand.date)).map(demand => ({ ...demand })) };
  return retainCalendarSourceBoundaries(draft, source);
}
