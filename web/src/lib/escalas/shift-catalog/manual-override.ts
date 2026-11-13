import { addDays, dateRange, isDate, weekStart } from "../dates";
import { EscalaError } from "../errors";
import { effectiveWeeklyHours, usesMixed42Week } from "../labor-rules";
import { referenceNotices } from "../reference-notices";
import { fitsStoreClosing, storeClosingMinutes } from "../store-hours";
import { validateJourney, workJourney } from "../validation-time";
import type { EscalaEmployee, EscalaInput, EscalaIssue, EscalaManualShiftOverride, EscalaShift } from "../types";
import { clockMinutes } from "./domain";

export function manualCatalogShift(selection: EscalaManualShiftOverride): EscalaShift {
  const values = selection.markings.map(clockMinutes);
  const [start, firstEnd, secondStart, end] = values;
  if (values.some(value => value === null) || start === null || firstEnd === null || secondStart === null || end === null
    || firstEnd <= start || !((secondStart === 0 && end === 0) || secondStart >= firstEnd && end > secondStart)) {
    throw new EscalaError(422, "MANUAL_SHIFT_MARKINGS", "As quatro marcações do turno manual precisam formar períodos completos, ordenados e sem sobreposição.");
  }
  const segments: EscalaShift["segments"] = [{ start, end: firstEnd, kind: "WORK" }];
  if (secondStart !== 0 || end !== 0) {
    if (secondStart > firstEnd) segments.push({ start: firstEnd, end: secondStart, kind: "BREAK" });
    segments.push({ start: secondStart, end, kind: "WORK" });
  }
  const paid = segments.reduce((sum, segment) => sum + (segment.kind === "WORK" ? segment.end - segment.start : 0), 0);
  if (paid <= 0 || paid > 600 || (segments.at(-1) as (typeof segments)[number]).end - start > 1080) {
    throw new EscalaError(422, "MANUAL_SHIFT_MARKINGS", "O turno manual excede os limites estruturais de duração ou amplitude.");
  }
  return { id: selection.shiftId, name: selection.markings.join(" "), segments };
}

export function withManualShiftOverride(person: EscalaEmployee, selection: EscalaManualShiftOverride): EscalaEmployee {
  if (!isDate(selection.effectiveFrom) || !isDate(selection.effectiveUntil) || selection.effectiveUntil < selection.effectiveFrom) {
    throw new EscalaError(400, "TURNO_INVALID_DATES", "Confira o início e o fim da seleção de turno.");
  }
  const intervals: EscalaManualShiftOverride[] = [];
  for (const old of person.manualShiftOverrides ?? []) {
    if (old.effectiveUntil < selection.effectiveFrom || old.effectiveFrom > selection.effectiveUntil) intervals.push(old);
    else {
      if (old.effectiveFrom < selection.effectiveFrom) intervals.push({ ...old, effectiveUntil: addDays(selection.effectiveFrom, -1) });
      if (old.effectiveUntil > selection.effectiveUntil) intervals.push({ ...old, effectiveFrom: addDays(selection.effectiveUntil, 1) });
    }
  }
  intervals.push(selection);
  intervals.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const normalized: EscalaManualShiftOverride[] = [];
  for (const next of intervals) {
    const previous = normalized.at(-1);
    if (previous && previous.catalogCode === next.catalogCode && previous.shiftId === next.shiftId
      && previous.markings.join("|") === next.markings.join("|") && addDays(previous.effectiveUntil, 1) === next.effectiveFrom) {
      normalized[normalized.length - 1] = { ...previous, effectiveUntil: next.effectiveUntil };
    } else normalized.push({ ...next, markings: [...next.markings] });
  }
  if (normalized.length > 12) throw new EscalaError(422, "MANUAL_SHIFT_INTERVAL_LIMIT", "A seleção excede doze períodos por pessoa. Revise os períodos antes de aplicar.");
  return { ...person, scheduleMode: person.scheduleMode ?? "TIMED", manualShiftOverrides: normalized, manualShiftBaseIds: person.manualShiftBaseIds ?? [...person.shiftIds],
    originalShiftIds: person.originalShiftIds ?? [...person.shiftIds], manualShiftByDate: undefined };
}

export function manualShiftAt(person: EscalaEmployee, date: string): string | undefined {
  return person.manualShiftOverrides?.find(choice => date >= choice.effectiveFrom && date <= choice.effectiveUntil)?.shiftId;
}

export function materializeManualShiftOverrides(input: EscalaInput): EscalaInput {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const signature = (shift: EscalaShift) => JSON.stringify(shift.segments.map(({ start, end, kind }) => ({ start, end, kind })));
  const employees = input.employees.map(person => {
    if (!person.manualShiftOverrides?.length) return person;
    const base = person.manualShiftBaseIds ?? person.shiftIds;
    const selections = [...person.manualShiftOverrides].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const byDate: Record<string, string> = {};
    for (const choice of selections) {
      const shift = manualCatalogShift(choice), existing = shifts.get(shift.id);
      if (existing && signature(existing) !== signature(shift)) throw new EscalaError(409, "TURNO_LOCAL_ID_CONFLICT", "O turno manual conflita com uma definição local. Revise a seleção; os dados foram preservados.");
      if (!existing) shifts.set(shift.id, shift);
      if (person.planningEnabled === false) continue;
      for (const day of dateRange(input.startDate, input.endDate)) {
        if (day >= choice.effectiveFrom && day <= choice.effectiveUntil && day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil)) byDate[day] = choice.shiftId;
      }
    }
    const shiftIds = [...new Set(base)];
    if (shiftIds.length > 12) throw new EscalaError(422, "ESCALA_SHIFT_OPTIONS_LIMIT", "Referências, seleções manuais e bloqueios excedem doze horários por pessoa.");
    return { ...person, shiftIds, manualShiftOverrides: selections, manualShiftBaseIds: [...base], manualShiftByDate: byDate };
  });
  if (shifts.size > 120) throw new EscalaError(422, "ESCALA_SHIFT_LIMIT", "As seleções manuais excedem o limite de horários da proposta.");
  return { ...input, employees, shifts: [...shifts.values()] };
}

/** Reference checks do not fabricate attendance or approve documentary evidence. */
export function manualShiftIssues(input: EscalaInput, flexibleDays = false): EscalaIssue[] {
  const issues: EscalaIssue[] = [];
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  for (const person of input.employees) {
    if (person.planningEnabled === false) continue;
    for (const choice of person.manualShiftOverrides ?? []) {
      const issue = (code: string, message: string, date?: string) => issues.push({ code, message, severity: "ERROR", employeeId: person.id, ...(date ? { date } : {}) });
      if (person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED") {
        issue("MANUAL_SHIFT_SCHEDULE_MODE", "A seleção manual exige uma referência de horário controlado; não foi criado horário para ENC ou cadastro sem horário."); continue;
      }
      if (choice.effectiveFrom < input.startDate || choice.effectiveUntil > input.endDate || choice.effectiveFrom < person.activeFrom || person.activeUntil && choice.effectiveUntil > person.activeUntil) {
        issue("MANUAL_SHIFT_DATES", "A vigência manual precisa estar dentro do planejamento e do vínculo."); continue;
      }
      const shift = shifts.get(choice.shiftId);
      if (!shift) { issue("MANUAL_SHIFT_MISSING", "O turno manual não foi materializado nesta revisão."); continue; }
      const paid = shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
      for (const date of dateRange(choice.effectiveFrom, choice.effectiveUntil)) {
        const old = input.assignments.find(day => day.employeeId === person.id && day.date === date);
        if (old?.kind === "WORK" && old.locked && old.shiftId !== choice.shiftId) {
          issue("MANUAL_SHIFT_LOCK_CONFLICT", "Há trabalho bloqueado com outro turno na vigência. Revise o bloqueio; a seleção não foi aplicada.", date); continue;
        }
        // This clock is conditional WORK, never attendance. Non-work records stay intact.
        if (old && ["ABSENCE", "HOLIDAY", "OFF"].includes(old.kind)) continue;
        if (input.generationMode !== "HOURS_ONLY" && (!old || flexibleDays && !old.locked)) continue;
        if (!fitsStoreClosing(shift, storeClosingMinutes(input))) issue("STORE_CLOSING_EXCEEDED", "O turno manual termina após o fechamento configurado.", date);
        const hours = person.weeklyHoursMode === "BRANCH" ? input.defaultWeeklyHours : person.weeklyHours;
        const expected = effectiveWeeklyHours({ weeklyHours: hours }, addDays(weekStart(date), 6)) * 12;
        if (usesMixed42Week(input, person, date) ? paid !== 480 && paid !== 540 : paid !== Math.min(expected, person.simulationDailyMinutes ?? Infinity)) {
          issue("MANUAL_SHIFT_WEEKLY_HOURS", "O turno escolhido não corresponde à distribuição semanal vigente. Escolha um código compatível; a referência não será ajustada automaticamente.", date);
        }
        try {
          const checks = validateJourney(input, workJourney({ employeeId: person.id, date, kind: "WORK", shiftId: shift.id }, shift), undefined, usesMixed42Week(input, person, date));
          issues.push(...referenceNotices(checks).filter(entry => entry.severity === "ERROR" && !["CLOSED_DATE", "HOLIDAY_WORK", "CCT_SUNDAY_CERTIFICATE", "CCT_HOLIDAY_CERTIFICATE", "CCT_NIGHT_CERTIFICATE"].includes(entry.code)));
        } catch { issue("CIVIL_TIME_INVALID", "O turno manual não pôde ser conferido no fuso desta data.", date); }
      }
    }
  }
  return [...new Map(issues.map(issue => [JSON.stringify([issue.code, issue.employeeId, issue.date]), issue])).values()];
}

/** Independent check before and after solver selection; never patches the returned roster. */
export function manualAssignmentIssues(input: EscalaInput, previous: readonly EscalaInput["assignments"][number][] = input.assignments): EscalaIssue[] {
  const issues: EscalaIssue[] = [];
  const locks = new Map(previous.filter(day => day.locked).map(day => [`${day.employeeId}\0${day.date}`, day]));
  const people = new Map(input.employees.map(person => [person.id, person]));
  for (const day of input.assignments) {
    const person = people.get(day.employeeId);
    if (!person?.manualShiftOverrides?.length || person.planningEnabled === false || day.kind !== "WORK") continue;
    const selected = manualShiftAt(person, day.date);
    const locked = locks.get(`${person.id}\0${day.date}`);
    if (day.locked && !(locked?.kind === day.kind && locked.shiftId === day.shiftId)) issues.push({
      code: "MANUAL_SHIFT_LOCK_CREATED", severity: "ERROR", employeeId: person.id, date: day.date,
      message: "A escolha manual de turno não autoriza criar bloqueios na proposta calculada." });
    if (selected && day.shiftId !== selected) issues.push({ code: "MANUAL_SHIFT_MISMATCH", severity: "ERROR", employeeId: person.id, date: day.date,
      message: "O horário de trabalho não respeita a seleção manual vigente. Gere novamente sem alterar os dias protegidos." });
    if (!selected && !day.locked && !person.shiftIds.includes(day.shiftId ?? "")) issues.push({
      code: "MANUAL_SHIFT_OUTSIDE_RANGE", severity: "ERROR", employeeId: person.id, date: day.date,
      message: "Um turno exclusivo da seleção manual foi usado fora da vigência. A seleção não amplia seu período." });
  }
  return issues;
}
