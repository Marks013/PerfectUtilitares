import { addDays, dateRange, dayOfWeek } from "./dates";
import { effectiveSundayLimit, effectiveWeeklyHours } from "./labor-rules";
import type { EscalaAssignment, EscalaInput } from "./types";

/** Comparable civil-weekend rates, including the processor's 21 known prior days. */
export function weekendBalance(input: EscalaInput, weekday: 5 | 6, assignments = input.assignments): Map<string, number> {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const days = dateRange(input.startDate, input.endDate);
  const original = new Map(input.assignments.map(record => [`${record.employeeId}\0${record.date}`, record]));
  const current = new Map<string, EscalaAssignment[]>();
  for (const record of assignments) {
    const records = current.get(record.employeeId) ?? [];
    records.push(record); current.set(record.employeeId, records);
  }
  const occupied = (records: EscalaAssignment[]) => {
    const dates = new Set<string>();
    for (const record of records) {
      if (record.kind === "DUTY") dates.add(record.date);
      if (record.kind !== "WORK") continue;
      for (const segment of shifts.get(record.shiftId ?? "")?.segments ?? []) {
        if (segment.kind === "BREAK") continue;
        for (let offset = Math.floor(segment.start / 1440); offset <= Math.floor((segment.end - 1) / 1440); offset++) dates.add(addDays(record.date, offset));
      }
    }
    return dates;
  };
  const groups = new Map<string, number[]>();
  for (const person of input.employees) {
    if (person.planningEnabled === false) continue;
    const noClock = person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING";
    const group = JSON.stringify([noClock, person.sector, effectiveSundayLimit(person),
      noClock ? [] : days.filter((_, index) => index % 7 === 0).map(day => effectiveWeeklyHours(person, day))]);
    const rates = groups.get(group) ?? []; groups.set(group, rates);
    const available = days.filter(day => dayOfWeek(day) === weekday && day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil))
      .filter(day => {
        const old = original.get(`${person.id}\0${day}`);
        return !input.policy.closedDates.includes(day) && !person.fixedOffDays.includes(weekday)
          && !(input.policy.holidayDates.includes(day) && !input.policy.authorizedHolidayDates.includes(day) && !input.simulation)
          && old?.kind !== "ABSENCE" && !(old?.locked && old.kind === "OFF");
      });
    if (!available.length) continue;
    const prior = [...new Map([...(person.planningHistory ?? []), ...person.history].map(record => [record.date, record])).values()];
    const first = addDays(input.startDate, -21);
    const historical = (day: string) => day >= first && day < input.startDate && dayOfWeek(day) === weekday;
    const priorWorked = [...occupied(prior)].filter(historical);
    const known = new Set([...prior.filter(record => ["WORK", "DUTY", "OFF"].includes(record.kind) && historical(record.date)).map(record => record.date), ...priorWorked]);
    const presence = occupied([...prior, ...(current.get(person.id) ?? [])]);
    rates.push(Math.floor((available.filter(day => presence.has(day)).length + priorWorked.length) * 10000 / (available.length + known.size)));
  }
  return new Map([...groups].map(([group, rates]) => [group, rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : 0]));
}
