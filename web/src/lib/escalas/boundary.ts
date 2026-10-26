import { addDays, dayOfWeek, isDate } from "./dates";
import { sortEmployees } from "./order";
import type { EscalaAssignment, EscalaInput } from "./types";

/**
 * Explicit planning commitments from approved fixed days, not attendance history.
 * Preserve these reservations when the following period is published.
 */
export function fixedBoundaryReservations(input: EscalaInput): EscalaAssignment[] {
  if (!isDate(input.endDate) || dayOfWeek(input.endDate) !== 6) return [];
  const monday = addDays(input.endDate, 1);
  if (!input.policy.holidayRestAllowed && input.policy.holidayDates.includes(monday)) return [];
  const sundayOffs = new Set(input.assignments
    .filter((item) => item.date === input.endDate && item.kind === "OFF")
    .map((item) => item.employeeId));
  return sortEmployees(input.employees).filter((person) => person.offPattern === "CONSECUTIVE"
    && (person.offMode === "FIXED" || person.offMode === "MIXED")
    && person.fixedOffDays.includes(0)
    && person.activeFrom <= input.endDate
    && (!person.activeUntil || person.activeUntil >= monday)
    && sundayOffs.has(person.id))
    .map((person) => ({ employeeId: person.id, date: monday, kind: "OFF", locked: true }));
}
