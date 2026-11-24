import { holidayCalendarFor } from "./calendar";
import { EscalaError } from "./errors";
import type { EscalaInput } from "./types";

export const manualHolidayRestMessage = "Não é possível criar ou mover uma folga manualmente para um feriado.";

export function holidayRestDates(input: EscalaInput): Set<string> {
  const dates = new Set(input.policy.holidayDates);
  if (input.policy.calendarMode === "LOCAL") {
    for (const holiday of holidayCalendarFor(input).holidays) dates.add(holiday.date);
  }
  return dates;
}

/** Compare kinds, not edit intent supplied by a client. An existing OFF survives a calendar update. */
export function assertNoNewManualHolidayRest(previous: EscalaInput | undefined, next: EscalaInput): void {
  const holidays = holidayRestDates(next);
  if (previous) for (const date of holidayRestDates(previous)) holidays.add(date);
  if (!holidays.size) return;
  const existing = new Set(previous?.assignments.filter(day => day.kind === "OFF")
    .map(day => JSON.stringify([day.employeeId, day.date])));
  const added = next.assignments.find(day => day.kind === "OFF" && holidays.has(day.date)
    && !existing.has(JSON.stringify([day.employeeId, day.date])));
  if (added) throw new EscalaError(422, "ESCALA_MANUAL_HOLIDAY_REST", manualHolidayRestMessage);
}
