import { absoluteMinute, addDays, dateRange, dayOfWeek, visibleDates, weekStart } from "./dates";
import { keepsPriorityLeader } from "./movement";
import { keepsSaturdayBalance } from "./saturday-balance";
import { buildCoveragePresence, sectorCoverageGaps } from "./coverage-presence";
import { regularRestQuality } from "./rest-spacing";
import { preservesRestDistribution, restPairSummary } from "./rest-quality";
import { validateEscala } from "./validation";
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

/** Improve a valid roster by exchanging two complete duties, not isolated cells. */
export function exchangeRestImprovement(input: EscalaInput, validation: EscalaValidation, deadline: number,
  state: { checked: number } = { checked: 0 }): EscalaInput {
  if (!validation.valid || performance.now() >= deadline || state.checked >= 32) return input;
  const records = new Map<string, EscalaAssignment[]>();
  for (const record of input.assignments) {
    const group = records.get(record.employeeId) ?? [];
    group.push(record); records.set(record.employeeId, group);
  }
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const visible = new Set(visibleDates(input));
  const quality = restPairSummary(input);
  const ranked = new Map(quality.people.map(person => [person.employeeId, person]));
  const noClock = (person: EscalaEmployee) => person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING";
  const eligible = input.employees.filter(person => person.planningEnabled !== false && person.offMode === "VARIABLE" && person.offPattern === "ANY")
    .sort((a, b) => (ranked.get(b.id)?.correctableExcess ?? 0) - (ranked.get(a.id)?.correctableExcess ?? 0)
      || (ranked.get(b.id)?.adjustablePairs ?? 0) - (ranked.get(a.id)?.adjustablePairs ?? 0) || a.id.localeCompare(b.id));
  const peers = new Map<string, EscalaEmployee[]>();
  for (const person of eligible) {
    const key = JSON.stringify([person.sector, person.role, noClock(person)]);
    const group = peers.get(key) ?? []; group.push(person); peers.set(key, group);
  }
  const editable = (person: EscalaEmployee, record: EscalaAssignment) => visible.has(record.date) && !record.locked
    && dayOfWeek(record.date) !== 6 && record.date >= person.activeFrom && (!person.activeUntil || record.date <= person.activeUntil)
    && !input.policy.closedDates.includes(record.date) && !person.fixedOffDays.includes(dayOfWeek(record.date));
  const dailyDeficits = (proposal: EscalaInput, sector: string, dates: Set<string>) => {
    const result = new Map<string, number>();
    const local = { ...proposal, employees: proposal.employees.filter(person => person.sector === sector),
      demands: proposal.demands.filter(demand => demand.sector === sector && dates.has(demand.date)) };
    for (const gap of sectorCoverageGaps(local)) {
      if (gap.sector !== sector || !dates.has(gap.date)) continue;
      const roles = new Map<string, number>();
      for (const role of gap.roles) roles.set(role.role, Math.max(roles.get(role.role) ?? 0, role.minimum - role.present, 0));
      const roleMissing = [...roles.values()].reduce((total, missing) => total + missing, 0);
      const missing = Math.max(0, gap.minimum - gap.present, roleMissing);
      result.set(gap.date, (result.get(gap.date) ?? 0) + missing * (gap.end - gap.start));
    }
    return result;
  };
  const deficits = new Map<string, Map<string, number>>();
  for (const person of eligible) {
    if (performance.now() >= deadline || state.checked >= 32) return input;
    if (!(ranked.get(person.id)?.adjustablePairs)) continue;
    const own = records.get(person.id) ?? [];
    const ownQuality = regularRestQuality(input, person, own);
    const pairedDays = new Set(own.filter(record => record.kind === "OFF"
      && own.some(other => other.kind === "OFF" && [addDays(record.date, -1), addDays(record.date, 1)].includes(other.date))).map(record => record.date));
    // A Sunday/history boundary may be the other half of the pair.
    if (!pairedDays.size) own.filter(record => record.kind === "OFF").forEach(record => { pairedDays.add(record.date); });
    const kind = noClock(person) ? "DUTY" : "WORK";
    for (const off of own.filter(record => record.kind === "OFF" && pairedDays.has(record.date) && editable(person, record))) {
      for (const work of own.filter(record => record.kind === kind && editable(person, record) && weekStart(record.date) === weekStart(off.date))) {
        if (performance.now() >= deadline || state.checked >= 32) return input;
        const shift = shifts.get(work.shiftId ?? "");
        if (kind === "WORK" && (!shift || shift.segments.some(segment => segment.start < 0 || segment.end > 1440))) continue;
        for (const peer of peers.get(JSON.stringify([person.sector, person.role, noClock(person)])) ?? []) {
          if (peer.id === person.id) continue;
          if (performance.now() >= deadline || state.checked >= 32) return input;
          const other = records.get(peer.id) ?? [];
          const peerWork = other.find(record => record.date === off.date && record.kind === kind && editable(peer, record));
          const peerOff = other.find(record => record.date === work.date && record.kind === "OFF" && editable(peer, record));
          if (!peerWork || !peerOff) continue;
          const peerShift = shifts.get(peerWork.shiftId ?? "");
          if (kind === "WORK" && (!peerShift || peerShift.segments.some(segment => segment.start < 0 || segment.end > 1440))) continue;
          const asOff = (record: EscalaAssignment): EscalaAssignment => { const { shiftId: _shift, ...rest } = record; return { ...rest, kind: "OFF" }; };
          const asWork = (record: EscalaAssignment, source: EscalaAssignment): EscalaAssignment => ({ ...record, kind,
            ...(kind === "WORK" ? { shiftId: source.shiftId } : {}) });
          const replacements = new Map<EscalaAssignment, EscalaAssignment>([[work, asOff(work)], [off, asWork(off, work)],
            [peerWork, asOff(peerWork)], [peerOff, asWork(peerOff, peerWork)]]);
          const proposal = { ...input, assignments: input.assignments.map(record => replacements.get(record) ?? record) };
          const nextOwn = regularRestQuality(proposal, person), peerQuality = regularRestQuality(input, peer), nextPeer = regularRestQuality(proposal, peer);
          if (nextOwn.longWindows.length > ownQuality.longWindows.length || nextPeer.longWindows.length > peerQuality.longWindows.length
            || nextOwn.adjacentPairs + nextPeer.adjacentPairs > ownQuality.adjacentPairs + peerQuality.adjacentPairs
            || !preservesRestDistribution(input, proposal, true)) continue;
          state.checked++;
          if (!keepsSaturdayBalance(input, proposal.assignments)) continue;
          if (!keepsPriorityLeader(proposal, person, work.date) || !keepsPriorityLeader(proposal, peer, off.date)) continue;
          if (kind === "WORK") {
            const dates = new Set([work.date, off.date]);
            const cacheKey = JSON.stringify([person.sector, ...[...dates].sort()]);
            let previous = deficits.get(cacheKey);
            if (!previous) { previous = dailyDeficits(input, person.sector, dates); deficits.set(cacheKey, previous); }
            const current = dailyDeficits(proposal, person.sector, dates);
            if ([...dates].some(day => (current.get(day) ?? 0) > (previous.get(day) ?? 0))) continue;
          }
          if (performance.now() >= deadline || !validateEscala(proposal).valid || performance.now() >= deadline) continue;
          return proposal;
        }
      }
    }
  }
  return input;
}
