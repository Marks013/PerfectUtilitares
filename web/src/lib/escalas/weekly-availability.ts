import { dateRange, dayOfWeek } from "./dates";
import { isRestPlanningExcludedRole } from "./eligibility";
import { dailyMinuteCeiling, effectiveWeeklyMinutes, isMixed42LongShift, usesMixed42Week } from "./labor-rules";
import { planningWeeklyHours } from "./preparation";
import type { EscalaInput } from "./types";

type Availability = { availableHoursMin: number; availableHoursMax: number; scheduledHours: number; timedPeopleDays: number; untimedPeopleDays: number };

/** An upper bound from known availability, not guaranteed coverage or a new weekly contract. */
export function weeklySectorAvailability(input: EscalaInput): Map<string, Availability> {
  const days = dateRange(input.startDate, input.endDate);
  const weeks = days.filter((_, index) => index % 7 === 0);
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const paid = new Map(input.shifts.map(shift => [shift.id,
    shift.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)]));
  const assignments = new Map(input.assignments.map(item => [`${item.employeeId}\0${item.date}`, item]));
  const closed = new Set(input.policy.closedDates);
  const sectors = new Map<string, { weekly: number[]; row: Availability }>();
  for (const person of input.employees) {
    if (person.planningEnabled === false || isRestPlanningExcludedRole(person.role) || person.activeFrom > input.endDate
      || person.activeUntil && person.activeUntil < input.startDate) continue;
    const group = sectors.get(person.sector) ?? { weekly: weeks.map(() => 0), row: {
      availableHoursMin: 0, availableHoursMax: 0, scheduledHours: 0, timedPeopleDays: 0, untimedPeopleDays: 0,
    } };
    sectors.set(person.sector, group);
    const timed = person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING";
    const active = (day: string) => day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil);
    for (const day of days) {
      const entry = assignments.get(`${person.id}\0${day}`);
      if (!active(day) || !entry) continue;
      if (timed && entry.kind === "WORK" && entry.shiftId && paid.has(entry.shiftId)) {
        group.row.scheduledHours += (paid.get(entry.shiftId) ?? 0) / 60;
        group.row.timedPeopleDays++;
      } else if (!timed && entry.kind === "DUTY") group.row.untimedPeopleDays++;
    }
    if (!timed || person.simulationDailyMinutes !== undefined || !person.shiftIds.some(id => shifts.has(id))) continue;
    const reference = planningWeeklyHours(person, input.defaultWeeklyHours, input.defaultWeeklyHours);
    weeks.forEach((week, index) => {
      const capacities = days.slice(index * 7, index * 7 + 7).flatMap(day => {
        const entry = assignments.get(`${person.id}\0${day}`);
        if (!active(day) || closed.has(day) || entry?.kind === "ABSENCE" || entry?.locked && entry.kind === "OFF"
          || person.offMode !== "VARIABLE" && person.fixedOffDays.includes(dayOfWeek(day))) return [];
        const allowed = entry?.locked && entry.kind === "WORK" && entry.shiftId ? [entry.shiftId] : person.shiftIds;
        const longest = Math.max(0, ...allowed.map(id => {
          const shift = shifts.get(id);
          const maximum = shift && usesMixed42Week(input, person, day) && isMixed42LongShift(shift)
            ? 540 : Math.min(input.policy.dailyLimitMinutes, dailyMinuteCeiling(day));
          return Math.min(paid.get(id) ?? 0, maximum);
        }));
        return [longest];
      }).sort((a, b) => b - a).slice(0, 5);
      group.weekly[index] += Math.min(effectiveWeeklyMinutes(reference, week),
        input.policy.weeklyLimit * 60, capacities.reduce((sum, value) => sum + value, 0)) / 60;
    });
  }
  return new Map([...sectors].map(([sector, group]) => [sector, { ...group.row,
    availableHoursMin: group.weekly.length ? Math.min(...group.weekly) : 0,
    availableHoursMax: Math.max(0, ...group.weekly),
  }]));
}
