import { buildCoveragePresence } from "./coverage-presence";
import { dayOfWeek, visibleDates } from "./dates";
import { compareSectors } from "./order";
import { applyBranchRestCalendar } from "./rest-configuration";
import type { EscalaEmployee, EscalaInput } from "./types";

export type SundaySectorObservation = {
  date: string;
  sector: string;
  active: number;
  off: number;
  lockedOff: number;
  timed: number;
  duty: number;
  absent: number;
  holiday: number;
  unverified: number;
  allOff: boolean;
};

/** Read-only facts about OPEN Sundays in the visible calendar, never staffing minimums. */
export function sundaySectorObservations(input: EscalaInput): SundaySectorObservation[] {
  const current = applyBranchRestCalendar(input);
  const closed = new Set(current.policy.closedDates);
  if (!current.simulation) for (const day of current.policy.holidayDates) {
    if (!current.policy.authorizedHolidayDates.includes(day)) closed.add(day);
  }
  const sundays = visibleDates(current).filter(day => dayOfWeek(day) === 6 && !closed.has(day));
  if (!sundays.length) return [];

  const bySector = new Map<string, EscalaEmployee[]>();
  for (const person of current.employees) {
    if (person.planningEnabled === false || !person.sector) continue;
    const team = bySector.get(person.sector) ?? [];
    team.push(person);
    bySector.set(person.sector, team);
  }
  const records = new Map(current.assignments.map(record => [
    JSON.stringify([record.employeeId, record.date]), record,
  ]));
  // Timed presence includes a Saturday shift carrying past midnight, but never
  // treats an UNTlMED DUTY, a meal break or an absence as hourly service.
  const presence = buildCoveragePresence(current);
  const results: SundaySectorObservation[] = [];

  for (const [sector, team] of [...bySector].sort(([a], [b]) => compareSectors(a, b))) {
    for (const day of sundays) {
      const active = team.filter(person => day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil));
      if (!active.length) continue;
      const timedIds = new Set((presence.get(day + "\0" + sector) ?? []).map(interval => interval.employee.id));
      const accounted = new Set(timedIds);
      let off = 0, lockedOff = 0, duty = 0, absent = 0, holiday = 0;
      for (const person of active) {
        const record = records.get(JSON.stringify([person.id, day]));
        if (record?.kind === "OFF") {
          off++;
          if (record.locked) lockedOff++;
        } else if (record?.kind === "ABSENCE") absent++;
        else if (record?.kind === "HOLIDAY") holiday++;
        else if (record?.kind === "DUTY" && !accounted.has(person.id)) {
          duty++;
          accounted.add(person.id);
        }
      }
      const unverified = Math.max(0, active.length - accounted.size - off - absent - holiday);
      results.push({ date: day, sector, active: active.length, off, lockedOff, timed: timedIds.size,
        duty, absent, holiday, unverified, allOff: off === active.length });
    }
  }
  return results;
}

/** Comparable open Sundays only; no inferred number of workers required. */
export function sundaySectorVariation(rows: readonly SundaySectorObservation[]) {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    // Do not compare Sundays with different active populations or leave/holiday counts.
    const key = JSON.stringify([row.sector, row.active, row.absent, row.holiday]);
    const values = groups.get(key) ?? [];
    values.push(row.off);
    groups.set(key, values);
  }
  let offSpread = 0;
  for (const counts of groups.values()) if (counts.length > 1) {
    offSpread += Math.max(...counts) - Math.min(...counts);
  }
  return {
    comparableOffSpread: offSpread,
    sectorDaysWithoutKnownService: rows.filter(row => row.timed === 0 && row.duty === 0).length,
    sectorDaysAllOff: rows.filter(row => row.allOff).length,
    sectorDaysWithUnverifiedPresence: rows.filter(row => row.unverified > 0).length,
  };
}
