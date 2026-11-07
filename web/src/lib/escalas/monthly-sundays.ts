import { addDays, dayOfWeek, visibleDates } from "./dates";
import type { EscalaInput } from "./types";

/** Visible-month counts only; unavailable or unknown days never become earned rest. */
export function monthlySundays(input: EscalaInput) {
  const sundays = visibleDates(input).filter(date => dayOfWeek(date) === 6);
  const records = new Map(input.assignments.map(record => [record.employeeId + "\0" + record.date, record]));
  const shifts = new Map((input.shifts ?? []).map(shift => [shift.id, shift]));
  const occupied = new Set<string>();
  for (const record of input.assignments) {
    if (record.kind === "DUTY") occupied.add(record.employeeId + "\0" + record.date);
    if (record.kind !== "WORK") continue;
    for (const segment of shifts.get(record.shiftId ?? "")?.segments ?? []) {
      if (segment.kind === "BREAK") continue;
      for (let offset = Math.floor(segment.start / 1440); offset <= Math.floor((segment.end - 1) / 1440); offset++) occupied.add(record.employeeId + "\0" + addDays(record.date, offset));
    }
  }
  return new Map(input.employees.map(person => {
    let worked = 0, off = 0, absent = 0, unknown = 0;
    for (const date of sundays) {
      if (date < person.activeFrom || person.activeUntil && date > person.activeUntil) continue;
      const record = records.get(person.id + "\0" + date);
      if (record?.kind === "ABSENCE") absent++;
      else if (occupied.has(person.id + "\0" + date) || record?.kind === "WORK" || record?.kind === "DUTY") worked++;
      else if (record?.kind === "OFF") off++;
      else unknown++;
    }
    return [person.id, { worked, off, absent, unknown, available: worked + off }] as const;
  }));
}
