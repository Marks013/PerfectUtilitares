import type { EscalaInput } from "../../src/lib/escalas/types";

export function independentShortage(input: EscalaInput) {
  const people = new Map(input.employees.map(person => [person.id, person]));
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const records: { id: string; sector: string; role: string; start: number; end: number }[] = [];
  for (const item of input.assignments) {
    if (item.kind !== "WORK") continue;
    const person = people.get(item.employeeId), shift = shifts.get(item.shiftId || "");
    if (!person || !shift) throw new Error("BENCHMARK_REFERENCE_FAILED");
    const midnight = Date.parse(item.date + "T00:00:00-03:00") / 60000;
    for (const segment of shift.segments) if (segment.kind === "WORK")
      records.push({ id: person.id, sector: person.sector, role: person.role, start: midnight + segment.start, end: midnight + segment.end });
  }
  let shortage = 0;
  const bySector: Record<string, number> = {};
  for (const demand of input.demands) {
    if (!demand.estimated || !demand.minimum) continue;
    const midnight = Date.parse(demand.date + "T00:00:00-03:00") / 60000;
    const start = midnight + demand.start, end = midnight + demand.end;
    const matches = records.filter(item => item.sector === demand.sector && (!demand.role || item.role === demand.role) && item.start < end && item.end > start);
    const edges = [...new Set([start, end, ...matches.flatMap(item => [Math.max(start, item.start), Math.min(end, item.end)])])].sort((a, b) => a - b);
    for (let index = 1; index < edges.length; index++) {
      const left = edges[index - 1], right = edges[index];
      const count = new Set(matches.filter(item => item.start <= left && item.end >= right).map(item => item.id)).size;
      const deficit = (right - left) * Math.max(0, demand.minimum - count);
      shortage += deficit;
      bySector[demand.sector] = (bySector[demand.sector] || 0) + deficit;
    }
  }
  return { total: shortage, bySector };
}

export function weekendMetrics(input: EscalaInput) {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const groups = new Map<string, { sector: string; saturday?: number; sunday?: number }[]>();
  const firstHistoryDay = new Date(Date.parse(input.startDate + "T12:00:00Z") - 21 * 86400000).toISOString().slice(0, 10);
  const weekdayOf = (day: string) => new Date(day + "T12:00:00Z").getUTCDay();
  for (const person of input.employees.filter(person => person.planningEnabled !== false)) {
    const assignments = input.assignments.filter(item => item.employeeId === person.id);
    const prior = [...new Map([...(person.planningHistory || []), ...person.history].map(item => [item.date, item])).values()];
    const occupied = (entries: typeof assignments) => {
      const dates = new Set<string>();
      for (const item of entries) {
        if (item.kind === "DUTY") dates.add(item.date);
        if (item.kind !== "WORK") continue;
        for (const segment of shifts.get(item.shiftId || "")?.segments || []) {
          if (segment.kind === "BREAK") continue;
          for (let offset = Math.floor(segment.start / 1440); offset <= Math.floor((segment.end - 1) / 1440); offset++)
            dates.add(new Date(Date.parse(item.date + "T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10));
        }
      }
      return dates;
    };
    const currentOccupied = occupied(assignments), priorOccupied = occupied(prior);
    const score = (weekday: number) => {
      const pythonWeekday = (weekday + 6) % 7;
      const available = assignments.filter(item => weekdayOf(item.date) === weekday && item.kind !== "ABSENCE"
        && !(item.kind === "OFF" && item.locked) && !person.fixedOffDays.includes(pythonWeekday)
        && !input.policy.closedDates.includes(item.date)
        && !(input.policy.holidayDates.includes(item.date) && !input.policy.authorizedHolidayDates.includes(item.date) && !input.simulation));
      if (!available.length) return undefined;
      const historicWork = [...priorOccupied].filter(day => firstHistoryDay <= day && day < input.startDate && weekdayOf(day) === weekday);
      const known = new Set([...prior.filter(item => firstHistoryDay <= item.date && item.date < input.startDate
        && weekdayOf(item.date) === weekday && ["WORK", "DUTY", "OFF"].includes(item.kind)).map(item => item.date), ...historicWork]);
      return Math.floor(10000 * (available.filter(item => currentOccupied.has(item.date)).length + historicWork.length) / (available.length + known.size));
    };
    const untimed = ["MISSING", "UNTIMED"].includes(person.scheduleMode || "");
    const key = JSON.stringify([person.sector, untimed, untimed ? [] : person.weeklyHours,
      Math.min(person.maxConsecutiveSundays, person.sundayRestRule === "COMMERCE" ? 2 : 1)]);
    const group = groups.get(key) || [];
    group.push({ sector: person.sector, saturday: score(6), sunday: score(0) });
    groups.set(key, group);
  }
  const spread = (key: "saturday" | "sunday") => [...groups.values()].reduce((sum, group) => {
    const scores = group.map(item => item[key]).filter((value): value is number => value !== undefined);
    return sum + (scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0);
  }, 0);
  const sectors: Record<string, number> = {};
  for (const group of groups.values()) {
    const scores = group.map(item => item.sunday).filter((value): value is number => value !== undefined);
    sectors[group[0].sector] = (sectors[group[0].sector] || 0) + (scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0);
  }
  return { saturdayRateSpread: spread("saturday"), sundayRateSpread: spread("sunday"), sectorSundayRateSpreads: sectors };
}
