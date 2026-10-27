import { addDays, dateRange, dayOfWeek } from "./dates";
import { effectiveWeeklyHours } from "./labor-rules";
import type { EscalaEmployee, EscalaInput, EscalaShift, WeeklyHours } from "./types";

function minutes(shift: EscalaShift): number {
  return shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

function signature(shift: EscalaShift): string {
  return JSON.stringify(shift.segments);
}

function shiftId(shift: EscalaShift): string {
  let hash = 2166136261;
  for (const character of signature(shift)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `prep-${(hash >>> 0).toString(16)}`;
}

function defaultShift(): EscalaShift {
  return { id: "branch-default", name: "Padrão da filial", segments: [
    { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" },
    { start: 780, end: 1020, kind: "WORK" },
  ] };
}

function originalShift(person: EscalaEmployee): EscalaShift | null {
  if (!person.sourceSchedule) return null;
  const periods = [...person.sourceSchedule.weekday.matchAll(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/g)]
    .map((match) => ({ start: Number(match[1]) * 60 + Number(match[2]), end: Number(match[3]) * 60 + Number(match[4]), kind: "WORK" as const }))
    .filter((period) => period.end > period.start);
  if (!periods.length || periods.some((period, index) => period.start < 0 || period.end > 1440 || (index > 0 && period.start < periods[index - 1].end))) return null;
  const segments: EscalaShift["segments"] = [];
  for (const period of periods) {
    const previous = segments.at(-1);
    if (previous && previous.end < period.start) segments.push({ start: previous.end, end: period.start, kind: "BREAK" });
    segments.push(period);
  }
  return { id: "original", name: "Referência FPRE136", segments };
}

/** Candidate proposals only: preserve meal times and either arrival or departure. */
function adjustedShifts(source: EscalaShift, target: number): EscalaShift[] {
  const delta = target - minutes(source);
  const positions = source.segments.flatMap((segment, index) => segment.kind === "WORK" ? [index] : []);
  if (!positions.length || source.segments.some((segment) => segment.kind !== "BREAK" && (segment.start < 300 || segment.end > 1320))) return [];
  const results: EscalaShift[] = [];
  for (const anchor of ["arrival", "departure"] as const) {
    const copy = structuredClone(source);
    if (anchor === "arrival") copy.segments[positions[positions.length - 1]].end += delta;
    else copy.segments[positions[0]].start -= delta;
    if (copy.segments.some((segment, index) => segment.end <= segment.start || segment.start < 300 || segment.end > 1320
      || (index > 0 && segment.start < copy.segments[index - 1].end))) continue;
    copy.id = shiftId(copy);
    copy.name = `Proposta ${Math.floor(target / 60)}h${String(target % 60).padStart(2, "0")} · ${anchor === "arrival" ? "entrada mantida" : "saída mantida"}`;
    if (!results.some((item) => signature(item) === signature(copy))) results.push(copy);
  }
  return results;
}

/** One explicit branch action, without claiming imported schedules or contracts were confirmed. */
export function prepareRoster(input: EscalaInput, hours: WeeklyHours, missingSchedule: "EXCLUDE" | "BRANCH_DEFAULT" = "EXCLUDE"): EscalaInput {
  if (input.assignments.some((assignment) => assignment.locked)) throw new Error("A proposta tem dias bloqueados. Preserve a revisão ou peça a um aprovador para desbloquear antes de reaplicar a configuração em lote.");
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const register = (shift: EscalaShift) => {
    const existing = shifts.get(shift.id);
    if (existing && signature(existing) !== signature(shift)) throw new Error("Conflito entre identificadores de horários; nenhuma proposta foi alterada.");
    shifts.set(shift.id, shift);
  };
  const employees = input.employees.map((person): EscalaEmployee => {
    if (person.scheduleMode === "UNTIMED") return { ...person, planningEnabled: true, planningExclusionReason: undefined,
      shiftIds: [], sundayRestRule: "PROTECTIVE", maxConsecutiveSundays: 1 };
    const source = originalShift(person);
    const base = person.sourceSchedule ? (source ? [source] : []) : person.shiftIds.map((id) => shifts.get(id)).filter((shift): shift is EscalaShift => Boolean(shift));
    // Never silently turn a short/undefined imported contract into a full-time journey.
    const needsDefault = !base.length || (person.sourceSchedule?.report === "FPRE136" && base.every((shift) => minutes(shift) < 360));
    if ((needsDefault && missingSchedule === "EXCLUDE") || (person.planningEnabled === false && !person.sourceSchedule)) return { ...person, planningEnabled: false,
      planningExclusionReason: person.planningEnabled === false && !person.sourceSchedule ? "Fora da geração por configuração" : !base.length ? "Horário não definido no FPRE136" : "Jornada curta: não ampliada automaticamente" };
    const sources = needsDefault ? [defaultShift()] : base;
    const weeklyHours = Math.min(hours, person.weeklyHours) as WeeklyHours;
    const targets = new Set<number>();
    for (let start = input.startDate; start <= input.endDate; start = addDays(start, 7)) targets.add(effectiveWeeklyHours({ weeklyHours }, start) * 12);
    let candidates = sources.flatMap((source) => [...targets].flatMap((target) => adjustedShifts(source, target)));
    if (!candidates.length && missingSchedule === "BRANCH_DEFAULT") candidates = [...targets].flatMap((target) => adjustedShifts(defaultShift(), target));
    candidates.forEach(register);
    const shiftIds = [...new Set(candidates.map((shift) => shift.id))].slice(0, 12);
    return { ...person, weeklyHours, shiftIds, planningEnabled: shiftIds.length > 0,
      planningExclusionReason: shiftIds.length ? undefined : "Horário noturno ou sem adaptação diurna compatível",
      sundayRestRule: "PROTECTIVE", maxConsecutiveSundays: 1 };
  });
  // Reference text remains on each imported employee; only keep referenced shift definitions.
  const used = new Set([...employees.flatMap((person) => person.shiftIds), ...employees.flatMap((person) => [...person.history, ...(person.planningHistory ?? [])].flatMap((item) => item.shiftId ? [item.shiftId] : []))]);
  const retained = [...shifts.values()].filter((shift) => used.has(shift.id));
  if (retained.length > 120) throw new Error("A configuração gerou mais de 120 horários. Reduza as opções de horários da filial antes de aplicar.");
  return { ...input, defaultWeeklyHours: hours, employees, shifts: retained,
    assignments: input.assignments.filter((assignment) => assignment.kind === "ABSENCE"
      && employees.some((person) => person.id === assignment.employeeId && person.planningEnabled !== false)),
    policy: { ...input.policy, ...(input.policy.coverageReview ? { coverageReview: "SUGGESTED" as const } : {}) } };
}

/** Initial staffing heuristic; a branch-wide review is required, not fictitious operating demand. */
export function proposeCoverage(input: EscalaInput): EscalaInput {
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const existing = new Set(input.demands.map((demand) => `${demand.sector}\0${demand.date}`));
  const demands = input.demands.map((demand) => ({ ...demand }));
  const sectors = [...new Set(input.employees.filter((person) => person.planningEnabled !== false && person.scheduleMode !== "UNTIMED").map((person) => person.sector).filter(Boolean))];
  for (const sector of sectors) {
    for (const day of dateRange(input.startDate, input.endDate)) {
      if (input.policy.closedDates.includes(day) || existing.has(`${sector}\0${day}`)) continue;
      const members = input.employees.filter((person) => person.planningEnabled !== false && person.scheduleMode !== "UNTIMED" && person.sector === sector
        && person.activeFrom <= day && (!person.activeUntil || person.activeUntil >= day));
      if (!members.length) continue;
      const intervals = members.map((person) => ({ id: person.id, shifts: person.shiftIds.map((id) => shifts.get(id)).filter((shift): shift is EscalaShift => shift !== undefined && minutes(shift) === effectiveWeeklyHours(person, day) * 12) }));
      const points = [...new Set(intervals.flatMap((person) => person.shifts.flatMap((shift) => shift.segments.filter((segment) => segment.kind === "WORK").flatMap((segment) => [segment.start, segment.end]))))].filter((value) => value >= 0 && value <= 1440).sort((a, b) => a - b);
      for (let index = 0; index < points.length - 1; index++) {
        const start = points[index], end = points[index + 1];
        // Count only coverage common to every alternative. Otherwise the same team can be required
        // at both opposing tails of mutually exclusive shift proposals, producing false infeasibility.
        const available = intervals.filter((person) => person.shifts.length > 0 && person.shifts.every((shift) => shift.segments.some((segment) => segment.kind === "WORK" && segment.start <= start && segment.end >= end))).length;
        // Sunday has a fortnightly protective rest ceiling. Zero remains explicit for branch review.
        const minimum = Math.floor(available * (dayOfWeek(day) === 6 ? 1 / 2 : 5 / 7));
        const previous = demands.at(-1);
        if (previous?.id.startsWith("suggest-") && previous.date === day && previous.sector === sector && previous.end === start && previous.minimum === minimum) previous.end = end;
        else demands.push({ id: `suggest-${demands.length}-${day}`, date: day, sector, start, end, minimum });
      }
    }
  }
  if (demands.length > 12000) throw new Error("A sugestão excedeu 12.000 faixas; reduza o período ou as variações de horários antes de aplicar.");
  return { ...input, demands, policy: { ...input.policy, coverageReview: "SUGGESTED" } };
}
