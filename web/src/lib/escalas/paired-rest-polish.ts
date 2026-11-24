import { absoluteMinute, addDays, dateRange, dayOfWeek, visibleDates, weekStart } from "./dates";
import { isEscalaPlanningParticipant } from "./eligibility";
import { regularRestQuality } from "./rest-spacing";
import { preservesRestDistribution } from "./rest-quality";
import { manualShiftAt } from "./shift-catalog/manual-override";
import { validateEscala } from "./validation";
import { validateEmployee } from "./validation-employee";
import { workJourney } from "./validation-time";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaValidation } from "./types";

function rest(record: EscalaAssignment): EscalaAssignment {
  const { shiftId: _shiftId, ...day } = record;
  return { ...day, kind: "OFF" };
}

/** Move whole duties in same-week pairs with exactly equal coverage, then verify the batch. */
export function polishEqualClockRestPairs(input: EscalaInput, validation: EscalaValidation, deadline: number): EscalaInput {
  const expired = () => performance.now() >= deadline;
  if (!validation.valid || input.generationMode === "HOURS_ONLY" || expired()) return input;
  const days = dateRange(input.startDate, input.endDate), visible = new Set(visibleDates(input));
  const weeks = new Map(days.map(day => [day, weekStart(day, input)]));
  const closed = new Set(input.policy.closedDates);
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const clocks = new Map(input.shifts.filter(shift => shift.segments.every(segment => segment.start >= 0 && segment.end <= 1440))
    .map(shift => [shift.id, JSON.stringify(shift.segments.map(({start, end, kind}) => [start, end, kind]))]));
  const byPerson = new Map<string, Map<string, EscalaAssignment>>();
  for (const day of input.assignments) {
    const personDays = byPerson.get(day.employeeId) ?? new Map<string, EscalaAssignment>();
    personDays.set(day.date, day); byPerson.set(day.employeeId, personDays);
  }
  const reservations = new Map<string, NonNullable<EscalaValidation["boundaryReservations"]>>();
  for (const reservation of validation.boundaryReservations ?? []) {
    const records = reservations.get(reservation.employeeId) ?? [];
    records.push(reservation); reservations.set(reservation.employeeId, records);
  }
  const peers = new Map<string, EscalaEmployee[]>();
  const key = (person: EscalaEmployee) => JSON.stringify([person.sector, person.role,
    person.scheduleMode, person.leadership ?? null]);
  for (const person of input.employees) {
    if (!isEscalaPlanningParticipant(person) || person.offMode !== "VARIABLE" || person.offPattern !== "ANY") continue;
    const group = peers.get(key(person)) ?? []; group.push(person); peers.set(key(person), group);
  }
  const editable = (person: EscalaEmployee, day: EscalaAssignment) => visible.has(day.date) && !day.locked
    && day.date >= person.activeFrom && (!person.activeUntil || day.date <= person.activeUntil)
    && dayOfWeek(day.date) < 5 && !closed.has(day.date) && !person.fixedOffDays.includes(dayOfWeek(day.date))
    && !manualShiftAt(person, day.date);
  const workingClock = (day: EscalaAssignment) => day.kind === "DUTY" ? "DUTY"
    : day.kind === "WORK" ? clocks.get(day.shiftId ?? "") : undefined;
  const periods = (person: EscalaEmployee, current: EscalaAssignment[]) => {
    const records = new Map([...(person.planningHistory ?? []), ...person.history, ...current, ...(person.planningFuture ?? [])]
      .map(record => [record.date, record]));
    const journeys: ReturnType<typeof workJourney>[] = [];
    for (const record of records.values()) {
      if (record.kind !== "WORK") continue;
      const shift = shifts.get(record.shiftId ?? "");
      if (!shift) return null;
      journeys.push(workJourney(record, shift, absoluteMinute));
    }
    return journeys;
  };
  const valid = (person: EscalaEmployee, current: EscalaAssignment[]) => {
    const journeys = periods(person, current);
    return journeys !== null && !validateEmployee(input, person, {
      current, days, journeys, visible, weekByDate: weeks, reservations: reservations.get(person.id) ?? [],
    }).issues.some(issue => issue.severity === "ERROR");
  };
  const replacements = new Map<EscalaAssignment, EscalaAssignment>();
  const moved = new Set<string>();
  const transfer = (target: EscalaAssignment, source: EscalaAssignment): EscalaAssignment =>
    source.kind === "DUTY" ? {...target, kind: "DUTY"} : {...target, kind: "WORK", shiftId: source.shiftId};
  let checked = 0;
  groupSearch: for (const group of peers.values()) {
    if (group.length < 2) continue;
    for (const person of group) {
      if (expired() || checked >= 64) break groupSearch;
      if (moved.has(person.id)) continue;
      const own = byPerson.get(person.id);
      if (!own) continue;
      const original = [...own.values()], quality = regularRestQuality(input, person, original);
      if (!quality.adjacentPairs) continue;
      // Start at the first visible pair. Known boundary rest is only context.
      const previous = new Map([...(person.planningHistory ?? []), ...person.history, ...original, ...(person.planningFuture ?? [])]
        .map(record => [record.date, record.kind]));
      for (const off of original) {
        if (expired()) break groupSearch;
        if (off.kind !== "OFF" || !editable(person, off) || ![-1, 1].some(offset => previous.get(addDays(off.date, offset)) === "OFF")) continue;
        for (const work of original) {
          if (expired()) break groupSearch;
          const clock = workingClock(work);
          if (!clock || weeks.get(off.date) !== weeks.get(work.date) || !editable(person, work)) continue;
          const asWork = transfer(off, work), asRest = rest(work);
          const ownNext = original.map(day => day === off ? asWork : day === work ? asRest : day);
          const nextQuality = regularRestQuality(input, person, ownNext);
          if (nextQuality.adjacentPairs >= quality.adjacentPairs || nextQuality.longWindows.length > quality.longWindows.length) continue;
          for (const peer of group) {
            if (expired() || checked >= 64) break groupSearch;
            if (peer.id === person.id || moved.has(peer.id)) continue;
            const other = byPerson.get(peer.id);
            const peerWork = other?.get(off.date), peerOff = other?.get(work.date);
            if (!other || !peerWork || !peerOff || peerOff.kind !== "OFF" || workingClock(peerWork) !== clock
              || !editable(peer, peerWork) || !editable(peer, peerOff)) continue;
            const peerRecords = [...other.values()], peerAsWork = transfer(peerOff, peerWork), peerAsRest = rest(peerWork);
            const peerNext = peerRecords.map(day => day === peerOff ? peerAsWork : day === peerWork ? peerAsRest : day);
            const peerQuality = regularRestQuality(input, peer, peerRecords), nextPeer = regularRestQuality(input, peer, peerNext);
            if (nextPeer.adjacentPairs > peerQuality.adjacentPairs || nextPeer.longWindows.length > peerQuality.longWindows.length) continue;
            checked++;
            if (!valid(person, ownNext) || !valid(peer, peerNext)) continue;
            replacements.set(off, asWork); replacements.set(work, asRest);
            replacements.set(peerOff, peerAsWork); replacements.set(peerWork, peerAsRest);
            moved.add(person.id); moved.add(peer.id);
            break;
          }
          if (moved.has(person.id)) break;
        }
        if (moved.has(person.id)) break;
      }
    }
  }
  if (!replacements.size) return input;
  const proposal = {...input, assignments: input.assignments.map(day => replacements.get(day) ?? day)};
  return preservesRestDistribution(input, proposal, true) && validateEscala(proposal).valid ? proposal : input;
}
