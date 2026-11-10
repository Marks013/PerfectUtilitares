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

/** Move the entire proposal earlier; never shorten paid work or its meal interval. */
export function fitProposalToClosing(shift: EscalaShift, closing: number): void {
  const offset = Math.max(0, ...shift.segments.map(segment => segment.end - closing));
  if (offset) shift.segments = shift.segments.map(segment => ({ ...segment, start: segment.start - offset, end: segment.end - offset }));
}
