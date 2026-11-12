import { addDays, dateRange, dayOfWeek, visibleDates, weekStart } from "./dates";
import { effectiveSundayLimit, effectiveWeeklyHours } from "./labor-rules";
import type { EscalaEmployee, EscalaInput } from "./types";

type RestPersonQuality = {
  employeeId: string; totalPairs: number; imposedPairs: number; adjustablePairs: number;
  correctableExcess: number; weeklyRepetitions: number;
};
export type RestPairSummary = {
  targetMonthlyPairs: 2; totalPairs: number; imposedPairs: number; adjustablePairs: number;
  correctableExcess: number; peopleAboveTarget: number; concentration: number; weeklyRepetitions: number;
  people: RestPersonQuality[];
};

/** Only explicitly variable, adjustable dates participate in automatic spacing. */
function personPairs(input: EscalaInput, person: EscalaEmployee) {
  const records = new Map([...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? []),
    ...input.assignments.filter(record => record.employeeId === person.id)].map(record => [record.date, record]));
  const mutable = (day: string) => {
    const record = records.get(day);
    return person.offMode === "VARIABLE" && person.offPattern === "ANY" && day >= input.startDate && day <= input.endDate
      && day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil) && record && !record.locked
      && !input.policy.closedDates.includes(day) && !person.fixedOffDays.includes(dayOfWeek(day));
  };
  return [...records].flatMap(([after, record]) => {
    const before = addDays(after, -1);
    if (record.kind !== "OFF" || records.get(before)?.kind !== "OFF" || after < input.startDate
      || after > addDays(input.endDate, 1) || after < person.activeFrom || person.activeUntil && after > person.activeUntil) return [];
    return [{ after, adjustable: Boolean(mutable(before) || mutable(after)) }];
  });
}

/** Each pair belongs to the calendar period containing its second regular OFF. */
export function restPairSummary(input: EscalaInput): RestPairSummary {
  const visible = new Set(visibleDates(input));
  const people = input.employees.filter(person => person.planningEnabled !== false).map(person => {
    const pairs = personPairs(input, person).filter(pair => visible.has(pair.after));
    const totalPairs = pairs.length, imposedPairs = pairs.filter(pair => !pair.adjustable).length;
    const adjustablePairs = totalPairs - imposedPairs;
    const weeks = new Set(pairs.filter(pair => pair.adjustable).map(pair => weekStart(pair.after)));
    return { employeeId: person.id, totalPairs, imposedPairs, adjustablePairs,
      correctableExcess: Math.max(0, totalPairs - 2) - Math.max(0, imposedPairs - 2),
      weeklyRepetitions: [...weeks].filter(week => weeks.has(addDays(week, -7))).length };
  });
  const sum = (field: "totalPairs" | "imposedPairs" | "adjustablePairs" | "correctableExcess" | "weeklyRepetitions") => people.reduce((total, person) => total + person[field], 0);
  return { targetMonthlyPairs: 2, totalPairs: sum("totalPairs"), imposedPairs: sum("imposedPairs"), adjustablePairs: sum("adjustablePairs"),
    correctableExcess: sum("correctableExcess"), peopleAboveTarget: people.filter(person => person.correctableExcess > 0).length,
    concentration: people.reduce((total, person) => total + person.adjustablePairs * (person.adjustablePairs - 1) / 2, 0),
    weeklyRepetitions: sum("weeklyRepetitions"), people };
}

/** Positive means the second summary improves the bounded lexicographic preference. */
export function compareRestQuality(before: RestPairSummary, after: RestPairSummary): number {
  return before.correctableExcess - after.correctableExcess || before.adjustablePairs - after.adjustablePairs
    || before.concentration - after.concentration || before.weeklyRepetitions - after.weeklyRepetitions;
}

function groups(input: EscalaInput, summary: RestPairSummary) {
  const byPerson = new Map(summary.people.map(person => [person.employeeId, person]));
  const days = dateRange(input.startDate, input.endDate);
  const result = new Map<string, number>();
  for (const person of input.employees) {
    if (person.planningEnabled === false) continue;
    const noClock = person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING";
    const key = JSON.stringify([noClock, person.sector, effectiveSundayLimit(person),
      noClock ? [] : days.filter((_, index) => index % 7 === 0).map(day => effectiveWeeklyHours(person, day))]);
    result.set(key, (result.get(key) ?? 0) + (byPerson.get(person.id)?.adjustablePairs ?? 0));
  }
  return result;
}

/** Do not transfer an excess, concentrate an equal total, or hide pairs in padding. */
export function preservesRestDistribution(input: EscalaInput, proposal: EscalaInput, requireImprovement = false): boolean {
  const before = restPairSummary(input), after = restPairSummary(proposal);
  const original = new Map(before.people.map(person => [person.employeeId, person]));
  if (after.people.some(person => person.correctableExcess > (original.get(person.employeeId)?.correctableExcess ?? 0))) return false;
  const oldGroups = groups(input, before);
  if ([...groups(proposal, after)].some(([key, total]) => total > (oldGroups.get(key) ?? 0))) return false;
  if (before.correctableExcess === after.correctableExcess && before.adjustablePairs === after.adjustablePairs
    && after.concentration > before.concentration) return false;
  const visible = new Set(visibleDates(input));
  const boundaryPairs = (value: EscalaInput) => value.employees.filter(person => person.planningEnabled !== false)
    .flatMap(person => personPairs(value, person).filter(pair => pair.adjustable && !visible.has(pair.after))
      .map(pair => `${person.id}\0${pair.after.slice(0, 7)}`)).reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map<string, number>());
  const boundaryBefore = boundaryPairs(input);
  if ([...boundaryPairs(proposal)].some(([key, count]) => count > (boundaryBefore.get(key) ?? 0))) return false;
  return !requireImprovement || compareRestQuality(before, after) > 0;
}
