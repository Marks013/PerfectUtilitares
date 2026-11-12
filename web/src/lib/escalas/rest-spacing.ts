import { addDays, dayOfWeek } from "./dates";
import type { EscalaAssignment, EscalaEmployee, EscalaInput } from "./types";

/** Operational planning quality, not an assertion about legal rest entitlements. */
export function regularRestQuality(input: EscalaInput, person: EscalaEmployee,
  current: readonly EscalaAssignment[] = input.assignments.filter(record => record.employeeId === person.id)) {
  if (person.planningEnabled === false || person.offMode !== "VARIABLE") return { adjacentPairs: 0, longWindows: [] as string[] };
  const records = new Map([...(person.planningHistory ?? []), ...person.history, ...current, ...(person.planningFuture ?? [])]
    .map(record => [record.date, record]));
  const closed = new Set(input.policy.closedDates);
  const mutable = (day: string) => {
    const record = records.get(day);
    return Boolean(record && day >= input.startDate && day <= input.endDate && day >= person.activeFrom
      && (!person.activeUntil || day <= person.activeUntil) && !record.locked
      && record.kind !== "ABSENCE" && record.kind !== "HOLIDAY" && !closed.has(day)
      && !person.fixedOffDays.includes(dayOfWeek(day)));
  };
  let adjacentPairs = 0;
  const longWindows: string[] = [];
  for (const [day, record] of records) {
    if (record.kind !== "OFF") continue;
    const next = addDays(day, 1), last = addDays(day, 2);
    if (records.get(next)?.kind !== "OFF") continue;
    if (person.offPattern === "ANY" && [day, next].some(mutable)) adjacentPairs++;
    if (records.get(last)?.kind === "OFF" && [day, next, last].some(mutable)) longWindows.push(day);
  }
  return { adjacentPairs, longWindows: longWindows.sort() };
}
