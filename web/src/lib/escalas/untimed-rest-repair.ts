import { absoluteMinute, addDays, dateRange, dayOfWeek, visibleDates, weekStart } from "./dates";
import { keepsPriorityLeader } from "./movement";
import { keepsSaturdayBalance } from "./saturday-balance";
import { regularRestQuality } from "./rest-spacing";
import { validateEmployee } from "./validation-employee";
import { workJourney } from "./validation-time";
import type { EscalaAssignment, EscalaInput, EscalaShift, EscalaValidation } from "./types";

/** Repair presence-only rests without inventing clocks or changing hourly coverage. */
export function repairUntimedRests(input: EscalaInput, validation: EscalaValidation, deadline: number): EscalaInput {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const days = dateRange(input.startDate, input.endDate), visible = new Set(visibleDates(input));
  const weekByDate = new Map(days.map(day => [day, weekStart(day)]));
  for (const person of input.employees) {
    if (performance.now() >= deadline) break;
    if (person.planningEnabled === false || person.offMode !== "VARIABLE"
      || !["UNTIMED", "MISSING"].includes(person.scheduleMode ?? "")) continue;
    const records = input.assignments.filter(record => record.employeeId === person.id);
    const quality = regularRestQuality(input, person, records);
    if (!quality.longWindows.length) continue;
    const problemDays = new Set(quality.longWindows.flatMap(day => [day, addDays(day, 1), addDays(day, 2)]));
    const editable = records.filter(record => !record.locked && dayOfWeek(record.date) !== 6
      && record.date >= person.activeFrom && (!person.activeUntil || record.date <= person.activeUntil)
      && !input.policy.closedDates.includes(record.date) && !person.fixedOffDays.includes(dayOfWeek(record.date)));
    const candidates: { work: EscalaAssignment; off: EscalaAssignment; longGain: number; pairGain: number }[] = [];
    for (const off of editable.filter(record => record.kind === "OFF" && problemDays.has(record.date))) {
      for (const work of editable.filter(record => record.kind === "DUTY" && weekStart(record.date) === weekStart(off.date))) {
        if (!keepsPriorityLeader(input, person, work.date)) continue;
        const current = records.map(record => record === work ? { ...record, kind: "OFF" as const }
          : record === off ? { ...record, kind: "DUTY" as const } : record);
        const next = regularRestQuality(input, person, current);
        const longGain = quality.longWindows.length - next.longWindows.length;
        const pairGain = quality.adjacentPairs - next.adjacentPairs;
        if (longGain > 0 && pairGain >= 0) candidates.push({ work, off, longGain, pairGain });
      }
    }
    candidates.sort((a, b) => b.longGain - a.longGain || b.pairGain - a.pairGain
      || a.work.date.localeCompare(b.work.date) || a.off.date.localeCompare(b.off.date));
    const prior = [...new Map([...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])]
      .map(record => [record.date, record])).values()];
    for (const candidate of candidates) {
      if (performance.now() >= deadline) return input;
      const replacements = new Map<EscalaAssignment, EscalaAssignment>([
        [candidate.work, { ...candidate.work, kind: "OFF" }],
        [candidate.off, { ...candidate.off, kind: "DUTY" }],
      ]);
      const current = records.map(record => replacements.get(record) ?? record);
      const journeys = [...prior, ...current].filter(record => record.kind === "WORK")
        .map(record => workJourney(record, shifts.get(record.shiftId ?? "") as EscalaShift, absoluteMinute));
      const result = validateEmployee(input, person, { current, journeys, days, visible, weekByDate,
        reservations: (validation.boundaryReservations ?? []).filter(record => record.employeeId === person.id) });
      if (result.issues.some(issue => issue.severity === "ERROR" && issue.code !== "CONSECUTIVE_REST_LIMIT")) continue;
      const assignments = input.assignments.map(record => replacements.get(record) ?? record);
      if (!keepsSaturdayBalance(input, assignments)) continue;
      return { ...input, assignments };
    }
  }
  return input;
}
