import { canonicalBranchCode } from "./branch-code";
import type { EscalaInput, EscalaShift } from "./types";

/** Operational closing, independent of labor authorizations and imported clock references. */
export function storeClosingMinutes(input: Pick<EscalaInput, "branchCode" | "storeClosingMinutes">): number {
  return input.storeClosingMinutes ?? (canonicalBranchCode(input.branchCode) === "18" ? 1320 : 1200);
}

export function storeClosingLabel(input: Pick<EscalaInput, "branchCode" | "storeClosingMinutes">): string {
  const value = storeClosingMinutes(input) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function fitsStoreClosing(shift: EscalaShift, closing: number): boolean {
  return shift.segments.every(segment => segment.start >= 0 && segment.end <= closing);
}

/** Check actual included workdays only; imported references and attendance history remain unchanged. */
export function workAfterStoreClosing(input: EscalaInput): EscalaInput["assignments"] {
  const closing = storeClosingMinutes(input);
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const people = new Map(input.employees.map(person => [person.id, person]));
  return input.assignments.filter(day => {
    const person = people.get(day.employeeId);
    const shift = shifts.get(day.shiftId ?? "");
    return day.kind === "WORK" && day.date >= input.startDate && day.date <= input.endDate
      && person && person.planningEnabled !== false && day.date >= person.activeFrom
      && (!person.activeUntil || day.date <= person.activeUntil)
      && shift && !fitsStoreClosing(shift, closing);
  });
}

/** Move the entire proposal earlier; never shorten paid work or its meal interval. */
export function fitProposalToClosing(shift: EscalaShift, closing: number): void {
  const offset = Math.max(0, ...shift.segments.map(segment => segment.end - closing));
  if (offset) shift.segments = shift.segments.map(segment => ({ ...segment, start: segment.start - offset, end: segment.end - offset }));
}
