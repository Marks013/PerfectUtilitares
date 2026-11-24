import { isEscalaPlanningParticipant } from "./eligibility";
import type { EscalaInput } from "./types";
import { buildCoveragePresence, coverageTimeline } from "./coverage-presence";
import { dayOfWeek, weekStart } from "./dates";
import { isDecember2026Cutover } from "./planning-calendar";
import { manualShiftAt } from "./shift-catalog/manual-override";

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
type CoverageZero = { date: string; sector: string; role: string | null };

/** Daily groups only: an employee in another role does not cover a qualified role. */
export function competingRestCoverageZeros(input: EscalaInput): Map<string, CoverageZero> {
  const closed = new Set(input.policy.closedDates);
  const people = new Map(input.employees.filter(isEscalaPlanningParticipant).map(person => [person.id, {
    ...person, sector: normalize(person.sector), role: normalize(person.role ?? ""),
  }]));
  const cells = new Map<string, { zero: CoverageZero; eligible: number; working: boolean }>();
  for (const day of input.assignments) {
    if (day.date < input.startDate || day.date > input.endDate || closed.has(day.date)
      || (day.kind !== "WORK" && day.kind !== "DUTY" && day.kind !== "OFF")) continue;
    const person = people.get(day.employeeId);
    if (!person || day.date < person.activeFrom || (person.activeUntil && day.date > person.activeUntil)) continue;
    for (const role of person.role ? [null, person.role] : [null]) {
      const zero = { date: day.date, sector: person.sector, role };
      const key = JSON.stringify([zero.date, zero.sector, zero.role]);
      const prior = cells.get(key);
      if (prior) {
        prior.eligible++;
        prior.working ||= day.kind !== "OFF";
      } else cells.set(key, { zero, eligible: 1, working: day.kind !== "OFF" });
    }
  }
  const zeros = new Map<string, CoverageZero>();
  for (const [key, cell] of cells) {
    if (cell.eligible >= 2 && !cell.working) zeros.set(key, cell.zero);
  }
  return zeros;
}

export function preservesCompetingRestCoverage(before: ReadonlyMap<string, CoverageZero>, after: ReadonlyMap<string, CoverageZero>) {
  for (const key of after.keys()) if (!before.has(key)) return false;
  return true;
}

export function competingRestSectorCount(zeros: ReadonlyMap<string, CoverageZero>): number {
  let count = 0;
  for (const zero of zeros.values()) if (zero.role === null) count++;
  return count;
}

/** Positive means fewer empty sector/days first, then fewer empty role/days. */
export function compareCompetingRestPresence(before: ReadonlyMap<string, CoverageZero>, after: ReadonlyMap<string, CoverageZero>): number {
  return competingRestSectorCount(before) - competingRestSectorCount(after) || before.size - after.size;
}

export function withCompetingRestWarning(message: string, zeros: ReadonlyMap<string, CoverageZero>): string {
  if (!zeros.size) return message;
  const sectors = competingRestSectorCount(zeros);
  const byDate = [...zeros.values()].sort((a, b) => a.date.localeCompare(b.date) || a.sector.localeCompare(b.sector)
    || (a.role ?? "").localeCompare(b.role ?? ""));
  const examples = byDate.slice(0, 3).map(({ date, sector, role }) =>
    `${date.slice(8, 10)}/${date.slice(5, 7)}: ${sector}${role ? ` / ${role}` : " (setor inteiro)"}`).join("; ");
  return `${message} Todos os elegíveis ainda estão de folga em ${sectors} combinações de setor e dia (setor inteiro) e ${zeros.size - sectors} de cargo, setor e dia. Exemplos: ${examples}.`;
}

type Day = EscalaInput["assignments"][number];
type Person = EscalaInput["employees"][number];
type Swap = { person: Person; off: Day; work: Day; emptySector: boolean; weight: number };
type RepairOptions = {
  signal?: AbortSignal; pinned: (day: Day) => boolean;
  accepts: (incumbent: EscalaInput, proposal: EscalaInput) => boolean;
};

/** Bounded in-memory repair. The caller still decides coverage and roster validity. */
export function repairCompetingRestCoverage(seed: EscalaInput, options: RepairOptions): EscalaInput {
  if (!isDecember2026Cutover(seed)) return seed;
  const deadline = performance.now() + 1800;
  const stopped = () => options.signal?.aborted || performance.now() >= deadline;
  const closed = new Set(seed.policy.closedDates);
  let current = seed;
  let proposals = 0;
  let comparisons = 0;
  for (let round = 0; round < 3 && !stopped(); round++) {
    const zeros = competingRestCoverageZeros(current);
    if (!zeros.size) break;
    const zeroCounts = new Map<string, number>();
    for (const { date } of zeros.values()) zeroCounts.set(date, (zeroCounts.get(date) ?? 0) + 1);
    const daysByPerson = new Map<string, Day[]>();
    const positions = new Map<Day, number>();
    current.assignments.forEach((day, index) => {
      positions.set(day, index);
      const days = daysByPerson.get(day.employeeId);
      if (days) days.push(day);
      else daysByPerson.set(day.employeeId, [day]);
    });
    const swaps: Swap[] = [];
    for (const person of current.employees) {
      if (stopped()) break;
      if (!isEscalaPlanningParticipant(person) || person.offMode !== "VARIABLE" || person.offPattern !== "ANY") continue;
      const dates = daysByPerson.get(person.id) ?? [];
      const sector = normalize(person.sector), role = normalize(person.role ?? "");
      const days = dates.filter(day => day.date >= person.activeFrom && (!person.activeUntil || day.date <= person.activeUntil)
        && !closed.has(day.date) && !person.fixedOffDays.includes(dayOfWeek(day.date))
        && !options.pinned(day) && !manualShiftAt(person, day.date));
      const donors = days.filter(day => day.kind === "WORK" || day.kind === "DUTY");
      for (const off of days) {
        if (off.kind !== "OFF") continue;
        const emptySector = zeros.has(JSON.stringify([off.date, sector, null]));
        const emptyRole = role !== "" && zeros.has(JSON.stringify([off.date, sector, role]));
        if (!emptySector && !emptyRole) continue;
        const week = weekStart(off.date, current);
        const weight = (zeroCounts.get(off.date) ?? 0);
        for (const work of donors) {
          if (weekStart(work.date, current) === week) swaps.push({ person, off, work, emptySector, weight });
        }
      }
    }
    swaps.sort((a, b) => Number(b.emptySector) - Number(a.emptySector) || b.weight - a.weight || b.off.date.localeCompare(a.off.date)
      || a.work.date.localeCompare(b.work.date));
    if (!swaps.length || stopped()) break;
    const presence = buildCoveragePresence(current);
    const timelines = new Map<string, ReturnType<typeof coverageTimeline>>();
    const demandByRole = new Map<string, EscalaInput["demands"]>();
    for (const demand of current.demands) {
      if (!demand.role || demand.estimated === true || demand.minimum <= 0) continue;
      const key = JSON.stringify([demand.sector, demand.date, demand.role]);
      const list = demandByRole.get(key);
      if (list) list.push(demand);
      else demandByRole.set(key, [demand]);
    }
    const comparedSectors = new Map<string, number>();
    let improved = false;
    for (const { person, off, work } of swaps.slice(0, 1200)) {
      if (stopped() || proposals >= 72 || comparisons >= 12) break;
      const compared = comparedSectors.get(person.sector) ?? 0;
      if (compared >= 3) continue;
      const key = JSON.stringify([person.sector, work.date]);
      let timeline = timelines.get(key);
      if (!timeline) {
        timeline = coverageTimeline(current, work.date, person.sector, presence);
        timelines.set(key, timeline);
      }
      // Cheap donor filter before constructing or validating an alternative.
      const roleNeeds = demandByRole.get(JSON.stringify([person.sector, work.date, person.role])) ?? [];
      if (timeline.some(slice => slice.people.some(present => present.id === person.id)
        && (slice.present <= slice.minimum || roleNeeds.some(demand => demand.start <= slice.start
          && demand.end >= slice.end && slice.people.filter(present => present.role === person.role).length <= demand.minimum)))) continue;
      const { shiftId, ...formerWork } = work;
      const nextOff = { ...formerWork, kind: "OFF" as const };
      const nextWork = { ...off, kind: work.kind, ...(shiftId ? { shiftId } : {}) };
      const assignments = current.assignments.slice();
      const oldOff = positions.get(off), oldWork = positions.get(work);
      if (oldOff === undefined || oldWork === undefined) continue;
      assignments[oldOff] = nextWork;
      assignments[oldWork] = nextOff;
      const proposal = { ...current, assignments };
      proposals++;
      const nextZeros = competingRestCoverageZeros(proposal);
      if (compareCompetingRestPresence(zeros, nextZeros) <= 0 || !preservesCompetingRestCoverage(zeros, nextZeros) || stopped()) continue;
      comparisons++;
      comparedSectors.set(person.sector, compared + 1);
      // The deadline prevents new comparisons, not adoption of an already verified result.
      if (!options.accepts(current, proposal) || options.signal?.aborted) continue;
      current = proposal;
      improved = true;
      break;
    }
    if (!improved) break;
  }
  return current;
}
