import type { EscalaAssignment, EscalaInput } from "./types";
import { weekendBalance } from "./weekend-balance";

export function saturdayBalance(input: EscalaInput, assignments = input.assignments): Map<string, number> {
  return weekendBalance(input, 5, assignments);
}

/** A local exchange must not spend another person's Saturday rotation. */
export function keepsSaturdayBalance(input: EscalaInput, assignments: EscalaAssignment[]): boolean {
  const before = saturdayBalance(input);
  return [...saturdayBalance(input, assignments)].every(([group, spread]) => spread <= (before.get(group) ?? 0));
}
