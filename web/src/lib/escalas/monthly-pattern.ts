import { closedHolidayDates } from "./calendar";
import { addDays, dayOfWeek, monthBounds, visibleDates } from "./dates";
import { isEscalaPlanningParticipant } from "./eligibility";
import { effectiveScheduleMode } from "./fpre136-schedule";
import { preparedShiftSignature } from "./preparation";
import { manualShiftAt } from "./shift-catalog/manual-override";
import { fitsStoreClosing, storeClosingMinutes } from "./store-hours";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift } from "./types";

type PatternDay = "WORK" | "DUTY" | "OFF";
type Evidence = { offset: number; kind: PatternDay };

function active(person: EscalaEmployee, date: string) {
  return date >= person.activeFrom && (!person.activeUntil || date <= person.activeUntil);
}

function indexPeople(input: EscalaInput) {
  const people = new Map<string, EscalaEmployee | undefined>();
  for (const person of input.employees) {
    const registration = person.registration.trim();
    people.set(registration, registration && !people.has(registration) ? person : undefined);
  }
  return people;
}

function indexAssignments(input: EscalaInput) {
  const assignments = new Map<string, Map<string, EscalaAssignment>>();
  for (const item of input.assignments) {
    const days = assignments.get(item.employeeId) ?? new Map<string, EscalaAssignment>();
    days.set(item.date, item);
    assignments.set(item.employeeId, days);
  }
  return assignments;
}

function fullCivilMonth(dates: readonly string[]) {
  if (!dates.length) return undefined;
  const bounds = monthBounds(dates[0].slice(0, 7));
  return dates[0] === bounds.startDate && dates.at(-1) === bounds.endDate ? bounds : undefined;
}

// A cycle must repeat twice in every position. Missing and exceptional source days are not votes.
function repeatingPattern(evidence: readonly Evidence[], length: number) {
  const slots = new Map<number, { kind: PatternDay; count: number }>();
  for (const { offset, kind } of evidence) {
    const index = offset % length, previous = slots.get(index);
    if (previous && previous.kind !== kind) return undefined;
    slots.set(index, { kind, count: (previous?.count ?? 0) + 1 });
  }
  if (slots.size !== length || [...slots.values()].some(slot => slot.count < 2)) return undefined;
  return Array.from({ length }, (_, index) => slots.get(index)?.kind);
}

function learnPattern(person: EscalaEmployee, dates: readonly string[], rows: ReadonlyMap<string, EscalaAssignment>, holidays: ReadonlySet<string>, shifts: ReadonlyMap<string, string>) {
  const evidence: Evidence[] = [];
  const workingKinds = new Set<PatternDay>();
  const clocks = new Set<string>();
  for (const [offset, date] of dates.entries()) {
    if (!active(person, date) || holidays.has(date) || manualShiftAt(person, date)) continue;
    const assignment = rows.get(date);
    if (!assignment || assignment.kind === "ABSENCE" || assignment.kind === "HOLIDAY") continue;
    if (assignment.kind !== "OFF") workingKinds.add(assignment.kind);
    if (assignment.kind === "WORK") {
      const clock = assignment.shiftId && shifts.get(assignment.shiftId);
      if (!clock) return undefined;
      clocks.add(clock);
    }
    evidence.push({ offset, kind: assignment.kind });
  }
  if (workingKinds.size !== 1 || clocks.size > 1 || !evidence.some(day => day.kind === "OFF")) return undefined;
  const pattern = repeatingPattern(evidence, 7) ?? repeatingPattern(evidence, 14);
  return pattern && { pattern, clock: [...clocks][0], work: [...workingKinds][0] };
}

function workWithClock(person: EscalaEmployee, date: string, clock: string, shifts: ReadonlyMap<string, EscalaShift>, closing: number) {
  const fixed = manualShiftAt(person, date) ?? person.fixedImportedShiftId;
  const ids = fixed ? [fixed] : person.manualShiftBaseIds ?? person.shiftIds;
  return ids.find(id => {
    const shift = shifts.get(id);
    return shift && preparedShiftSignature(shift) === clock && fitsStoreClosing(shift, closing);
  });
}

/** Carry a demonstrated cycle into blank days of the next civil month, within the destination's existing options. */
export function inheritMonthlyPattern(target: EscalaInput, source: EscalaInput): EscalaInput {
  if (target.branchCode !== source.branchCode || target.generationMode === "HOURS_ONLY") return target;
  const sourceDates = visibleDates(source), targetDates = visibleDates(target);
  const from = fullCivilMonth(sourceDates), to = fullCivilMonth(targetDates);
  if (!from || !to || addDays(from.endDate, 1) !== to.startDate) return target;

  const sourcePeople = indexPeople(source), targetPeople = indexPeople(target);
  const sourceAssignments = indexAssignments(source), targetAssignments = indexAssignments(target);
  const sourceClocks = new Map(source.shifts.map(shift => [shift.id, preparedShiftSignature(shift)]));
  const targetShifts = new Map(target.shifts.map(shift => [shift.id, shift]));
  const sourceExceptions = new Set([...source.policy.holidayDates, ...source.policy.closedDates]);
  const closed = new Set(target.policy.closedDates), closedHolidays = closedHolidayDates(target);
  const holidays = new Set(target.policy.holidayDates), authorizedHolidays = new Set(target.policy.authorizedHolidayDates);
  const closing = storeClosingMinutes(target);
  const additions: EscalaAssignment[] = [], marked = new Set<EscalaAssignment>();

  for (const [registration, person] of targetPeople) {
    const previous = sourcePeople.get(registration);
    if (!person || !previous || !isEscalaPlanningParticipant(person) || !isEscalaPlanningParticipant(previous)) continue;
    const sourceRows = sourceAssignments.get(previous.id);
    if (!sourceRows) continue;
    if (previous.weeklyHours !== person.weeklyHours || previous.weeklyHoursMode !== person.weeklyHoursMode
      || JSON.stringify(previous.sourceSchedule ?? null) !== JSON.stringify(person.sourceSchedule ?? null)) continue;
    const learned = learnPattern(previous, sourceDates, sourceRows, sourceExceptions, sourceClocks);
    if (!learned) continue;
    const scheduleMode = effectiveScheduleMode(person);
    if (scheduleMode === "MISSING" || (scheduleMode === "UNTIMED") !== (learned.work === "DUTY")) continue;

    const current = targetAssignments.get(person.id);
    for (const [offset, date] of targetDates.entries()) {
      if (!active(person, date) || date < target.policy.validFrom || date > target.policy.validUntil) continue;
      const kind = learned.pattern[(sourceDates.length + offset) % learned.pattern.length];
      const exists = current?.get(date);
      if (closedHolidays.has(date) && kind === "OFF") {
        if (exists?.kind === "HOLIDAY" && !exists.carriedHolidayRest) marked.add(exists);
        else if (!exists) additions.push({ employeeId: person.id, date, kind: "HOLIDAY", monthlyCarry: true, carriedHolidayRest: true });
        continue;
      }
      if (exists || closed.has(date) || !kind) continue;
      if (kind === "OFF") {
        if ((target.restRulesVersion ?? 0) >= 2 && dayOfWeek(date) === 5) continue;
        const holiday = holidays.has(date);
        if (!holiday || target.policy.holidayRestAllowed || dayOfWeek(date) === 6) {
          additions.push({ employeeId: person.id, date, kind, locked: false, monthlyCarry: true, ...(holiday ? { carriedHolidayRest: true } : {}) });
        }
      } else if (!person.fixedOffDays.includes(dayOfWeek(date)) && (!holidays.has(date) || authorizedHolidays.has(date))) {
        if (kind === "DUTY") additions.push({ employeeId: person.id, date, kind, locked: false, monthlyCarry: true });
        else if (learned.clock) {
          const shiftId = workWithClock(person, date, learned.clock, targetShifts, closing);
          if (shiftId) additions.push({ employeeId: person.id, date, kind, shiftId, locked: false, monthlyCarry: true });
        }
      }
    }
  }
  if (!additions.length && !marked.size) return target;
  const assignments = target.assignments.map(day => marked.has(day) ? { ...day, monthlyCarry: true as const, carriedHolidayRest: true as const } : day);
  return { ...target, assignments: [...assignments, ...additions] };
}
