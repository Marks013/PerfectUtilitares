import { absoluteMinute, addDays, dateRange, dayOfWeek, visibleDates, weekStart } from "./dates";
import { keepsPriorityLeader } from "./movement";
import { keepsSaturdayBalance } from "./saturday-balance";
import { buildCoveragePresence } from "./coverage-presence";
import { regularRestQuality } from "./rest-spacing";
import { validateEmployee } from "./validation-employee";
import { workJourney } from "./validation-time";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift, EscalaValidation } from "./types";

/** Exchange work/rest within a sector/role, preserving its estimated hourly deficit. */
export function exchangeRestRepair(input: EscalaInput, validation: EscalaValidation, deadline: number): EscalaInput {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const presence = buildCoveragePresence(input);
  const deficit = (sector: string, day: string, remove?: string, added?: { person: EscalaEmployee; shift: EscalaShift }) => {
    const intervals = (presence.get(`${day}\0${sector}`) ?? []).filter(interval => interval.employee.id !== remove)
      .concat(added ? added.shift.segments.filter(segment => segment.kind === "WORK").map(segment => ({ start: segment.start, end: segment.end, employee: added.person })) : []);
    let total = 0;
    for (const demand of input.demands) {
      if (demand.date !== day || demand.sector !== sector || !demand.minimum) continue;
      const matching = intervals.filter(interval => (!demand.role || interval.employee.role === demand.role) && interval.start < demand.end && interval.end > demand.start);
      const points = [...new Set([demand.start, demand.end, ...matching.flatMap(interval => [Math.max(demand.start, interval.start), Math.min(demand.end, interval.end)])])].sort((a, b) => a - b);
      for (let index = 1; index < points.length; index++) {
        const count = new Set(matching.filter(interval => interval.start <= points[index - 1] && interval.end >= points[index]).map(interval => interval.employee.id)).size;
        const missing = Math.max(0, demand.minimum - count);
        if (missing && !demand.estimated) return Infinity;
        total += missing * (points[index] - points[index - 1]);
      }
    }
    return total;
  };
  const records = new Map(input.employees.map(person => [person.id, input.assignments.filter(record => record.employeeId === person.id)]));
  const eligible = input.employees.filter(person => person.planningEnabled !== false && person.offMode === "VARIABLE"
    && person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING");
  const days = dateRange(input.startDate, input.endDate), visible = new Set(visibleDates(input));
  const weekByDate = new Map(days.map(day => [day, weekStart(day)]));
  const editable = (person: EscalaEmployee, record: EscalaAssignment) => !record.locked && dayOfWeek(record.date) !== 6
    && record.date >= person.activeFrom && (!person.activeUntil || record.date <= person.activeUntil)
    && !input.policy.closedDates.includes(record.date) && !person.fixedOffDays.includes(dayOfWeek(record.date));
  const validPerson = (person: EscalaEmployee, current: EscalaAssignment[]) => {
    const prior = [...new Map([...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])].map(record => [record.date, record])).values()];
    const journeys = [...prior, ...current].filter(record => record.kind === "WORK")
      .map(record => workJourney(record, shifts.get(record.shiftId ?? "") as EscalaShift, absoluteMinute));
    return !validateEmployee(input, person, { current, journeys, days, visible, weekByDate,
      reservations: (validation.boundaryReservations ?? []).filter(record => record.employeeId === person.id) }).issues
      .some(issue => issue.severity === "ERROR" && issue.code !== "CONSECUTIVE_REST_LIMIT");
  };
  for (const person of eligible) {
    const original = records.get(person.id) ?? [], quality = regularRestQuality(input, person, original);
    if (!quality.longWindows.length) continue;
    const problemDays = new Set(quality.longWindows.flatMap(day => [day, addDays(day, 1), addDays(day, 2)]));
    for (const off of original.filter(record => record.kind === "OFF" && problemDays.has(record.date) && editable(person, record))) {
      for (const work of original.filter(record => record.kind === "WORK" && editable(person, record) && weekByDate.get(record.date) === weekByDate.get(off.date))) {
        if (performance.now() >= deadline) return input;
        const shift = shifts.get(work.shiftId ?? "");
        if (!shift || shift.segments.some(segment => segment.start < 0 || segment.end > 1440)) continue;
        const originalDeficit = deficit(person.sector, work.date) + deficit(person.sector, off.date);
        for (const peer of eligible.filter(candidate => candidate.id !== person.id && candidate.sector === person.sector && candidate.role === person.role)) {
          const peerRecords = records.get(peer.id) ?? [];
          const peerWork = peerRecords.find(record => record.date === off.date && record.kind === "WORK" && editable(peer, record));
          const peerOff = peerRecords.find(record => record.date === work.date && record.kind === "OFF" && editable(peer, record));
          const peerShift = shifts.get(peerWork?.shiftId ?? "");
          if (!peerWork || !peerOff || !peerShift || peerShift.segments.some(segment => segment.start < 0 || segment.end > 1440)) continue;
          const workDeficit = deficit(person.sector, work.date, person.id, { person: peer, shift: peerShift });
          const offDeficit = deficit(person.sector, off.date, peer.id, { person, shift });
          if (workDeficit + offDeficit > originalDeficit
            || workDeficit > deficit(person.sector, work.date)
            || offDeficit > deficit(person.sector, off.date)) continue;
          const asOff = (record: EscalaAssignment): EscalaAssignment => {
            const { shiftId: _shift, ...rest } = record; return { ...rest, kind: "OFF" };
          };
          const replacements = new Map<EscalaAssignment, EscalaAssignment>([
            [work, asOff(work)], [off, { ...off, kind: "WORK", shiftId: work.shiftId }],
            [peerWork, asOff(peerWork)], [peerOff, { ...peerOff, kind: "WORK", shiftId: peerWork.shiftId }],
          ]);
          const next = original.map(record => replacements.get(record) ?? record);
          const nextPeer = peerRecords.map(record => replacements.get(record) ?? record);
          const nextQuality = regularRestQuality(input, person, next), peerQuality = regularRestQuality(input, peer, peerRecords), nextPeerQuality = regularRestQuality(input, peer, nextPeer);
          if (nextQuality.longWindows.length >= quality.longWindows.length || nextPeerQuality.longWindows.length > peerQuality.longWindows.length
            || nextQuality.adjacentPairs + nextPeerQuality.adjacentPairs > quality.adjacentPairs + peerQuality.adjacentPairs) continue;
          if (!validPerson(person, next) || !validPerson(peer, nextPeer) || performance.now() >= deadline) continue;
          const proposal = { ...input, assignments: input.assignments.map(record => replacements.get(record) ?? record) };
          if (!keepsSaturdayBalance(input, proposal.assignments)) continue;
          if (!keepsPriorityLeader(proposal, person, work.date) || !keepsPriorityLeader(proposal, peer, off.date)) continue;
          return proposal;
        }
      }
    }
  }
  return input;
}
