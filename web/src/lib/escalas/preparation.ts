import { addDays } from "./dates";
import { proposeAutomaticCoverage } from "./automatic-coverage";
import { effectiveWeeklyHours, maximumMealMinutes, minimumMealMinutes, usesMixed42 } from "./labor-rules";
import { fitProposalToClosing, fitsStoreClosing, storeClosingMinutes } from "./store-hours";
import { applyRestEligibility } from "./eligibility";
import type { EscalaEmployee, EscalaInput, EscalaShift, WeeklyHours } from "./types";

import { materializeManualShiftOverrides } from "./shift-catalog/manual-override";
/** Legacy references below the saved branch default may be individual contracts and are never raised. */
export function planningWeeklyHours(person: EscalaEmployee, savedDefault: WeeklyHours, requested: WeeklyHours): Pick<EscalaEmployee, "weeklyHours" | "weeklyHoursMode"> {
  if (person.weeklyHoursMode === "INDIVIDUAL") return { weeklyHours: person.weeklyHours, weeklyHoursMode: "INDIVIDUAL" };
  const branchReference = person.weeklyHoursMode === "BRANCH" || (person.weeklyHoursMode !== "INDIVIDUAL"
    && person.sourceSchedule?.report === "FPRE136" && person.weeklyHours === savedDefault);
  const individualMode = person.weeklyHoursMode ?? (person.sourceSchedule?.report === "FPRE136" ? "INDIVIDUAL" : undefined);
  return branchReference ? { weeklyHours: requested, weeklyHoursMode: "BRANCH" }
    : { weeklyHours: Math.min(requested, person.weeklyHours) as WeeklyHours, ...(individualMode ? { weeklyHoursMode: individualMode } : {}) };
}

function minutes(shift: EscalaShift): number {
  return shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

export function preparedShiftSignature(shift: EscalaShift): string {
  // PostgreSQL JSONB may reorder object keys without changing the shift.
  return JSON.stringify(shift.segments.map(({ start, end, kind }) => ({ start, end, kind })));
}

function shiftId(shift: EscalaShift): string {
  let hash = 2166136261;
  for (const character of preparedShiftSignature(shift)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
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
  const periods: EscalaShift["segments"] = [];
  for (const match of person.sourceSchedule.weekday.matchAll(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/g)) {
    let start = Number(match[1]) * 60 + Number(match[2]);
    let end = Number(match[3]) * 60 + Number(match[4]);
    if (start === 0 && end === 0) continue;
    const previous = periods.at(-1);
    if (previous && start < previous.end) { start += 1440; end += 1440; }
    if (end <= start) end += 1440;
    if (end > 2880 || (previous && start < previous.end)) return null;
    periods.push({ start, end, kind: "WORK" });
  }
  if (!periods.length) return null;
  const segments: EscalaShift["segments"] = [];
  for (const period of periods) {
    const previous = segments.at(-1);
    if (previous && previous.end < period.start) segments.push({ start: previous.end, end: period.start, kind: "BREAK" });
    segments.push(period);
  }
  return { id: "original", name: "Referência FPRE136", segments };
}

/** Import provenance, not an inferred contract or a new clock proposal. */
export function importedShiftReference(person: EscalaEmployee): EscalaShift | null {
  const source = originalShift(person);
  return source ? { ...source, id: shiftId(source), name: "Horário importado" } : null;
}

/** Only untouched generated clocks may be reconstructed from import provenance. */
export function isAutomaticPreparedShift(shift: EscalaShift): boolean {
  return shift.id === shiftId(shift) || shift.id === shiftId(shift).replace("prep-", "flex-");
}

/** Civil work only: unpaid meals and paid pauses do not create night attendance. */
export function civilNightWorkMinutes(shift: EscalaShift): number {
  return shift.segments.reduce((sum, segment) => {
    if (segment.kind !== "WORK") return sum;
    let night = 0;
    for (let day = Math.floor(segment.start / 1440); day <= Math.floor((segment.end - 1) / 1440); day++) {
      const midnight = day * 1440;
      night += Math.max(0, Math.min(segment.end, midnight + 300) - Math.max(segment.start, midnight));
      night += Math.max(0, Math.min(segment.end, midnight + 1440) - Math.max(segment.start, midnight + 1320));
    }
    return sum + night;
  }, 0);
}

/** A small automatic search, with the saved reference first and no added night work. */
export function automaticShiftAlternatives(person: EscalaEmployee, reference: EscalaShift, limitWorkBlocks: boolean, closing = 1320, maximumMeal = Infinity): EscalaShift[] {
  if (!reference.id.startsWith("prep-") || reference.id !== shiftId(reference)) return [reference];
  const source = originalShift(person);
  if (!source) return [reference];
  const target = minutes(reference), night = civilNightWorkMinutes(reference);
  const referenceMeal = Math.max(0, ...reference.segments.filter(segment => segment.kind === "BREAK").map(segment => segment.end - segment.start));
  const candidates = [reference, ...adjustedShifts(source, target, "BOTH", true, limitWorkBlocks, closing, referenceMeal, maximumMeal)];
  const [first, meal, last] = reference.segments;
  if (reference.segments.length === 3 && first.kind === "WORK" && meal.kind === "BREAK" && last.kind === "WORK"
    && first.end === meal.start && meal.end === last.start) {
    for (const offset of [-30, 30]) {
      const copy = structuredClone(reference);
      copy.segments[0].end += offset;
      copy.segments[1].start += offset;
      copy.segments[1].end += offset;
      copy.segments[2].start += offset;
      if (copy.segments.some(segment => segment.end <= segment.start) || limitWorkBlocks && requiresWorkBlockBalance(copy)) continue;
      copy.id = shiftId(copy).replace("prep-", "flex-");
      copy.name = `Proposta ${Math.floor(target / 60)}h${String(target % 60).padStart(2, "0")} · intervalo ${offset < 0 ? "antecipado" : "posterior"}`;
      candidates.push(copy);
    }
  }
  const unique = new Map<string, EscalaShift>();
  for (const candidate of candidates) {
    if (candidate.segments.some(segment => segment.kind === "BREAK" && segment.end - segment.start > maximumMeal)) continue;
    if (!fitsStoreClosing(candidate, closing)) continue;
    if (civilNightWorkMinutes(candidate) > night || candidate.segments.some(segment => segment.start < 0 || segment.end > 2880)) continue;
    const signature = preparedShiftSignature(candidate);
    if (!unique.has(signature)) unique.set(signature, candidate);
    if (unique.size === 4) break;
  }
  return [...unique.values()];
}

/** Rebuild identified automatic proposals when a meal is outside the configured bounds. */
export function refreshProposedWorkBlocks(person: EscalaEmployee, proposal: EscalaShift, enabled: boolean, closing = 1320, minimumMeal = 0, maximumMeal = Infinity): EscalaShift {
  if (!isAutomaticPreparedShift(proposal)) return proposal;
  const first = proposal.segments[0].start, last = proposal.segments.at(-1)?.end ?? first;
  const meal = Math.max(0, ...proposal.segments.filter(segment => segment.kind === "BREAK" && segment.start > first && segment.end < last).map(segment => segment.end - segment.start));
  if (meal < minimumMeal || meal > maximumMeal) {
    // Repair the saved proposal, not the immutable imported source. Paid minutes stay exact.
    const candidates = adjustedShifts(proposal, minutes(proposal), "BOTH", true, enabled, closing, minimumMeal, maximumMeal);
    return candidates.find(candidate => {
      const intervals = candidate.segments.filter(segment => segment.kind === "BREAK").map(segment => segment.end - segment.start);
      return Math.max(0, ...intervals) >= minimumMeal && intervals.every(length => length <= maximumMeal);
    }) ?? proposal;
  }
  if (proposal.id.startsWith("flex-") && proposal.id === shiftId(proposal).replace("prep-", "flex-")) {
    // Optional meal alternatives remain stable; only enforce a newly enabled block limit.
    return enabled && requiresWorkBlockBalance(proposal)
      ? adjustedShifts(proposal, minutes(proposal), "PRESERVE_START", true, true, closing, minimumMeal, maximumMeal)[0] ?? proposal : proposal;
  }
  if (!proposal.id.startsWith("prep-") || proposal.id !== shiftId(proposal)) return proposal;
  const source = originalShift(person);
  if (!source) return proposal;
  const referenceMeal = Math.max(0, ...proposal.segments.filter(segment => segment.kind === "BREAK").map(segment => segment.end - segment.start));
  return adjustedShifts(source, minutes(proposal), "BOTH", true, enabled, closing, referenceMeal, maximumMeal)
    .find(candidate => candidate.segments[0].start === proposal.segments[0].start
      && candidate.segments.at(-1)?.end === proposal.segments.at(-1)?.end) ?? proposal;
}

/** Planning preference for automatic split shifts, unrelated to the short-journey pause rule. */
export function requiresWorkBlockBalance(shift: EscalaShift): boolean {
  const [first, meal, last] = shift.segments;
  return shift.segments.length === 3 && first.kind === "WORK" && meal.kind === "BREAK" && last.kind === "WORK"
    && first.end === meal.start && meal.end === last.start
    && (first.end - first.start > 270 || last.end - last.start > 270);
}

/** Candidate proposals only: bound unpaid meals without changing paid minutes or imported evidence. */
function adjustedShifts(source: EscalaShift, target: number, strategy: "BOTH" | "PRESERVE_START" | "PRESERVE_END", simulation = false, limitWorkBlocks = false, closing = 1320, minimumMeal = 0, maximumMeal = Infinity): EscalaShift[] {
  const delta = target - minutes(source);
  const positions = source.segments.flatMap((segment, index) => segment.kind === "WORK" ? [index] : []);
  if (!positions.length || (!simulation && source.segments.some((segment) => segment.kind !== "BREAK" && segment.start < 300))) return [];
  const results: EscalaShift[] = [];
  if (minimumMeal > maximumMeal) return results;
  for (const anchor of ["arrival", "departure"] as const) {
    if ((strategy === "PRESERVE_START" && anchor !== "arrival") || (strategy === "PRESERVE_END" && anchor !== "departure")) continue;
    const copy = structuredClone(source);
    if (anchor === "arrival") copy.segments[positions[positions.length - 1]].end += delta;
    else copy.segments[positions[0]].start -= delta;
    if (source.segments.length === 1 && positions.length === 1 && minimumMeal > 0) {
      const start = anchor === "arrival" ? source.segments[0].start : source.segments[0].end - target - minimumMeal;
      const firstMinutes = Math.floor(target / 2);
      copy.segments = [
        { start, end: start + firstMinutes, kind: "WORK" },
        { start: start + firstMinutes, end: start + firstMinutes + minimumMeal, kind: "BREAK" },
        { start: start + firstMinutes + minimumMeal, end: start + target + minimumMeal, kind: "WORK" },
      ];
    }
    // Move only the proposed side of each unpaid interval; paid blocks retain their duration.
    for (let index = 1; index < copy.segments.length - 1; index++) {
      const interval = copy.segments[index];
      if (interval.kind !== "BREAK") continue;
      const length = interval.end - interval.start;
      const offset = Math.min(maximumMeal, Math.max(minimumMeal, length)) - length;
      if (anchor === "arrival") {
        interval.end += offset;
        for (const block of copy.segments.slice(index + 1)) { block.start += offset; block.end += offset; }
      } else {
        interval.start -= offset;
        for (const block of copy.segments.slice(0, index)) { block.start -= offset; block.end -= offset; }
      }
    }
    if (limitWorkBlocks && requiresWorkBlockBalance(copy)) {
      if (target > 540) continue;
      const [first, meal, last] = copy.segments;
      const length = first.end - first.start;
      const bounded = Math.min(270, Math.max(target - 270, length));
      const offset = bounded - length;
      // Move the meal, never shorten it or change the proposed arrival/departure.
      first.end += offset;
      meal.start += offset;
      meal.end += offset;
      last.start += offset;
    }
    const shiftedForClosing = !fitsStoreClosing(copy, closing);
    fitProposalToClosing(copy, closing);
    if (copy.segments.some((segment, index) => segment.end <= segment.start || segment.start < (simulation ? 0 : 300) || segment.end > (simulation ? 2880 : 1320)
      || (index > 0 && segment.start < copy.segments[index - 1].end))) continue;
    copy.id = shiftId(copy);
    copy.name = `Proposta ${Math.floor(target / 60)}h${String(target % 60).padStart(2, "0")} · ${shiftedForClosing ? "ajustada ao fechamento" : anchor === "arrival" ? "entrada mantida" : "saída mantida"}`;
    if (!results.some((item) => preparedShiftSignature(item) === preparedShiftSignature(copy))) results.push(copy);
  }
  return results;
}

/** Distinguish the temporary 9h option from a manually registered shift. */
export function isGeneratedMixed42Shift(id: string): boolean {
  return id.startsWith("mixed42-");
}

/** Fit the fixed 3h interval without inventing a night schedule. */
function longMixedShifts(source: EscalaShift, strategy: "BOTH" | "PRESERVE_START" | "PRESERVE_END", closing: number): EscalaShift[] {
  const paid = source.segments.filter(segment => segment.kind !== "BREAK");
  if (!paid.length) return [];
  const starts = new Set([
    ...(strategy !== "PRESERVE_END" ? [paid[0].start] : []),
    ...(strategy !== "PRESERVE_START" ? [paid[paid.length - 1].end - 720] : []),
  ]);
  return [...new Set([...starts].map(start => Math.min(start, Math.min(closing, 1320) - 720)))].filter(start => start >= 300).map(start => {
    const shift: EscalaShift = { id: "", name: "Proposta 9h · intervalo de 3h", segments: [
      { start, end: start + 270, kind: "WORK" },
      { start: start + 270, end: start + 450, kind: "BREAK" },
      { start: start + 450, end: start + 720, kind: "WORK" },
    ] };
    return { ...shift, id: shiftId(shift).replace("prep-", "mixed42-") };
  });
}

/** One explicit branch action, without claiming imported schedules or contracts were confirmed. */
export function prepareRoster(input: EscalaInput, hours: WeeklyHours, missingSchedule: "EXCLUDE" | "BRANCH_DEFAULT" = "EXCLUDE", strategy: "BOTH" | "PRESERVE_START" | "PRESERVE_END" = "BOTH"): EscalaInput {
  if (input.assignments.some((assignment) => assignment.locked)) throw new Error("A proposta tem dias bloqueados. Preserve a revisão ou peça a um aprovador para desbloquear antes de reaplicar a configuração em lote.");
  const closing = storeClosingMinutes(input);
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const register = (shift: EscalaShift) => {
    const existing = shifts.get(shift.id);
    if (existing && preparedShiftSignature(existing) !== preparedShiftSignature(shift)) throw new Error("Conflito entre identificadores de horários; nenhuma proposta foi alterada.");
    shifts.set(shift.id, shift);
  };
  const employees = input.employees.map((person): EscalaEmployee => {
    const eligible = applyRestEligibility(person);
    if (eligible.planningEnabled === false) return eligible;
    if ((person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING")) return { ...person, planningEnabled: true, planningExclusionReason: undefined, shiftIds: [] };
    const source = originalShift(person);
    const originalShiftIds = !person.sourceSchedule ? person.manualShiftBaseIds ?? person.originalShiftIds : undefined;
    const base = person.sourceSchedule ? (source ? [source] : []) : (originalShiftIds ?? person.shiftIds)
      .filter(id => !isGeneratedMixed42Shift(id)).map(id => shifts.get(id))
      .filter((shift): shift is EscalaShift => Boolean(shift));
    // Never silently turn a short/undefined imported contract into a full-time journey.
    const shortReference = Boolean(input.simulation && person.sourceSchedule?.report === "FPRE136" && base.length && base.every((shift) => minutes(shift) < 360));
    const simulationDailyMinutes = shortReference ? Math.min(...base.map(minutes)) : undefined;
    const needsDefault = !base.length || (!input.simulation && person.sourceSchedule?.report === "FPRE136" && base.every((shift) => minutes(shift) < 360));
    if (needsDefault && missingSchedule === "EXCLUDE") return { ...person, planningEnabled: false,
      planningExclusionReason: !base.length ? "Horário não definido no FPRE136" : "Jornada curta: não ampliada automaticamente" };
    const sources = needsDefault ? [defaultShift()] : base;
    const reference = planningWeeklyHours(person, input.defaultWeeklyHours, hours);
    const { weeklyHours } = reference;
    const targets = new Set<number>();
    const mixed = usesMixed42({ ...input, defaultWeeklyHours: hours }, { ...person, ...reference, simulationDailyMinutes });
    let needsLong = false;
    for (let start = input.startDate; start <= input.endDate; start = addDays(start, 7)) {
      const effective = effectiveWeeklyHours({ weeklyHours }, start);
      if (mixed && effective === 42) { needsLong = true; targets.add(480); }
      else targets.add(Math.min(effective * 12, simulationDailyMinutes ?? Infinity));
    }
    // An exact saved manual option needs no reconstruction or new identifier.
    const ordinary = sources.flatMap((source) => [...targets].flatMap((target) =>
      !needsLong && originalShiftIds?.includes(source.id) && minutes(source) === target
        && fitsStoreClosing(source, closing)
        && !(input.policy.limitContinuousWorkBlocks === true && requiresWorkBlockBalance(source))
        ? [source] : adjustedShifts(source, target, strategy, input.simulation, input.policy.limitContinuousWorkBlocks === true, closing,
          minimumMealMinutes(input.policy, target, input.simulation), maximumMealMinutes(input.policy, input.startDate))));
    // Old drafts lacking provenance cannot recover discarded manual references.
    const retainedOriginalIds = person.manualShiftOverrides?.length ? person.originalShiftIds ?? [...person.shiftIds] : needsLong && !person.sourceSchedule
      ? originalShiftIds ?? (!person.shiftIds.some(isGeneratedMixed42Shift) ? [...person.shiftIds] : undefined)
      : undefined;
    const long = needsLong ? sources.flatMap(source => longMixedShifts(source, strategy, closing)) : [];
    let candidates = needsLong ? (long.length && ordinary.length ? [...long, ...ordinary] : []) : ordinary;
    if (!candidates.length && !needsLong && missingSchedule === "BRANCH_DEFAULT") candidates = [...targets].flatMap((target) => adjustedShifts(defaultShift(), target, strategy, input.simulation, input.policy.limitContinuousWorkBlocks === true, closing,
      minimumMealMinutes(input.policy, target, input.simulation), maximumMealMinutes(input.policy, input.startDate)));
    candidates.forEach(register);
    const longIds = [...new Set(long.map(shift => shift.id))];
    const ordinaryIds = [...new Set(candidates.filter(shift => !isGeneratedMixed42Shift(shift.id)).map(shift => shift.id))];
    // Reserve room for both durations even with many manual references.
    const shiftIds = candidates.length && needsLong ? [...longIds.slice(0, 6), ...ordinaryIds.slice(0, 6)] : ordinaryIds.slice(0, 12);
    return { ...person, ...reference, simulationDailyMinutes, shiftIds, originalShiftIds: retainedOriginalIds, fixedImportedShiftId: undefined,
      ...(person.manualShiftOverrides?.length ? { manualShiftBaseIds: [...shiftIds] } : {}), planningEnabled: shiftIds.length > 0,
      planningExclusionReason: shiftIds.length ? undefined : "Horário noturno ou sem adaptação diurna compatível" };
  });
  // Reference text remains on each imported employee; only keep referenced shift definitions.
  const used = new Set([...employees.flatMap((person) => [...person.shiftIds, ...(person.originalShiftIds ?? [])]), ...employees.flatMap((person) => [...person.history, ...(person.planningHistory ?? []), ...(person.planningFuture ?? [])].flatMap((item) => item.shiftId ? [item.shiftId] : []))]);
  const retained = [...shifts.values()].filter((shift) => used.has(shift.id));
  if (retained.length > 120) throw new Error("A configuração gerou mais de 120 horários. Reduza as opções de horários da filial antes de aplicar.");
  return materializeManualShiftOverrides({ ...input, defaultWeeklyHours: hours, employees, shifts: retained,
    assignments: input.assignments.filter((assignment) => assignment.kind === "ABSENCE" || assignment.kind === "HOLIDAY"),
    policy: { ...input.policy, ...(input.policy.coverageReview ? { coverageReview: "SUGGESTED" as const } : {}) } });
}

/** Backward-compatible entry point; automatic estimates never become confirmed minima. */
export function proposeCoverage(input: EscalaInput): EscalaInput {
  return proposeAutomaticCoverage(input);
}
