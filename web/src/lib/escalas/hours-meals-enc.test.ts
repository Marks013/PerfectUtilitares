import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { exportEscalaXlsx } from "./export";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { effectiveScheduleMode } from "./fpre136-schedule";
import { dateRange } from "./dates";
import { matchesRestOnlyReferences, prepareGeneration } from "./generation";
import { generationScenarioBasis, validateHoursReferences } from "./hours-reference";
import { automaticShiftAlternatives, prepareRoster, preparedShiftSignature, refreshProposedWorkBlocks } from "./preparation";
import { assignmentPresentation, buildEscalaSchedule } from "./presentation";
import { adaptCompatibleSchedules } from "./schedule-adaptation";
import type { EscalaEmployee, EscalaShift } from "./types";
import { manualShiftAt, manualShiftIssues, materializeManualShiftOverrides, withManualShiftOverride } from "./shift-catalog/manual-override";

function setWeekday(person: EscalaEmployee, weekday: string) {
  if (!person.sourceSchedule) throw new Error("Synthetic source missing");
  person.sourceSchedule.weekday = weekday;
}

const paid = (shift: EscalaShift) => shift.segments.reduce((sum, block) => sum + (block.kind === "BREAK" ? 0 : block.end - block.start), 0);
const meals = (shift: EscalaShift) => shift.segments.filter(block => block.kind === "BREAK").map(block => block.end - block.start);
function automatic(shift: EscalaShift, prefix = "prep-"): EscalaShift {
  let hash = 2166136261;
  for (const c of preparedShiftSignature(shift)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return { ...shift, id: `${prefix}${(hash >>> 0).toString(16)}` };
}
function fixture(meal = 180, daily = 440) {
  const input = newInput("07", "Synthetic", "2026-12", 42);
  input.startDate = "2026-12-07"; input.endDate = "2026-12-13";
  delete input.visibleMonth; // This fixture is one complete technical week, not a monthly workspace.
  input.simulation = false; input.generationMode = "DAYS_AND_HOURS";
  input.mixed42Sectors = []; input.policy.minMealMinutes = 60;
  input.policy.limitContinuousWorkBlocks = false;
  input.shifts = [{ id: "original", name: "Imported", segments: [
    { start: 460, end: 690, kind: "WORK" }, { start: 690, end: 690 + meal, kind: "BREAK" },
    { start: 690 + meal, end: 460 + daily + meal, kind: "WORK" },
  ] }];
  const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  input.employees = [{ ...newEmployee(42, "original"), id: "one", registration: "S1", name: "Synthetic", role: "Operador", sector: "Loja", scheduleMode: "TIMED",
    sourceSchedule: { report: "FPRE136", code: "S", description: "Synthetic", weekday: `07:40-11:30 / ${clock(690 + meal)}-${clock(460 + daily + meal)}`, saturday: "07:00-11:00" } }];
  return input;
}

function datedManualFixture(mode: "REST_ONLY" | "HOURS_ONLY" | "DAYS_AND_HOURS", from = "2026-12-07", until = "2026-12-13") {
  const input = fixture(180, 504);
  input.generationMode = mode; input.policy.compensationAuthorized = true;
  input.employees[0] = withManualShiftOverride(input.employees[0], {
    catalogCode: 1500, shiftId: "manual-1500", markings: ["07:40", "11:30", "13:30", "18:04"], effectiveFrom: from, effectiveUntil: until,
  });
  return materializeManualShiftOverrides(input);
}

describe("dated manual meal precedence through real override helpers", () => {
  it.each(["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const)("accepts a valid full-horizon override over an excessive imported base in %s", mode => {
    const input = datedManualFixture(mode);
    input.assignments = [{ employeeId: "one", date: "2026-12-07", kind: "ABSENCE", locked: true },
      { employeeId: "one", date: "2026-12-08", kind: "HOLIDAY", locked: true },
      { employeeId: "one", date: "2026-12-09", kind: "OFF", locked: true }];
    const before = structuredClone(input);
    expect(input.employees[0].manualShiftBaseIds).toEqual(["original"]);
    expect(manualShiftIssues(input, true)).toEqual([]);
    const result = prepareGeneration(input).input, person = result.employees[0];
    expect(dateRange(input.startDate, input.endDate).every(date => manualShiftAt(person, date) === "manual-1500" && person.manualShiftByDate?.[date] === "manual-1500")).toBe(true);
    expect(result.shifts.find(shift => shift.id === "original")).toEqual(input.shifts[0]);
    expect(person.manualShiftBaseIds).toEqual(["original"]);
    expect(person.sourceSchedule).toEqual(input.employees[0].sourceSchedule);
    expect(result.assignments).toEqual(input.assignments); expect(result.policy.mealIntervalAgreement).toBeUndefined();
    expect(matchesRestOnlyReferences(result, [{ employeeId: "one", date: "2026-12-10", kind: "WORK", shiftId: "manual-1500" }])).toBe(true);
    expect(matchesRestOnlyReferences(result, [{ employeeId: "one", date: "2026-12-10", kind: "WORK", shiftId: "original" }])).toBe(false);
    expect(input).toEqual(before);
  });
  it.each(["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const)("keeps the imported-base conflict for an uncovered active date in %s", mode => {
    const input = datedManualFixture(mode, "2026-12-08"), before = structuredClone(input);
    expect(manualShiftAt(input.employees[0], "2026-12-07")).toBeUndefined();
    expect(() => prepareGeneration(input)).toThrow(expect.objectContaining({ code: "ESCALA_IMPORTED_MEAL_CONFLICT" }));
    expect(input).toEqual(before);
  });
  it("considers employment boundaries instead of requiring manual clocks outside the active period", () => {
    const input = datedManualFixture("HOURS_ONLY", "2026-12-08", "2026-12-11");
    input.employees[0].activeFrom = "2026-12-08"; input.employees[0].activeUntil = "2026-12-11";
    const before = structuredClone(input), result = prepareGeneration(input).input;
    expect(Object.keys(result.employees[0].manualShiftByDate ?? {})).toEqual(dateRange("2026-12-08", "2026-12-11"));
    expect(result.employees[0].sourceSchedule).toEqual(input.employees[0].sourceSchedule); expect(input).toEqual(before);
  });
  it("accepts the union of two real manual periods but rejects a gap between them", () => {
    const input = datedManualFixture("HOURS_ONLY", "2026-12-07", "2026-12-09");
    input.employees[0] = withManualShiftOverride(input.employees[0], {
      catalogCode: 1501, shiftId: "manual-1501", markings: ["07:40", "11:30", "13:30", "18:04"], effectiveFrom: "2026-12-10", effectiveUntil: input.endDate,
    });
    const materialized = materializeManualShiftOverrides(input), before = structuredClone(materialized);
    const result = prepareGeneration(materialized).input;
    expect(result.employees[0].manualShiftByDate?.["2026-12-09"]).toBe("manual-1500");
    expect(result.employees[0].manualShiftByDate?.["2026-12-10"]).toBe("manual-1501");
    expect(materialized).toEqual(before);
    const gap = datedManualFixture("HOURS_ONLY", "2026-12-07", "2026-12-08");
    gap.employees[0] = withManualShiftOverride(gap.employees[0], {
      catalogCode: 1501, shiftId: "manual-1501", markings: ["07:40", "11:30", "13:30", "18:04"], effectiveFrom: "2026-12-10", effectiveUntil: gap.endDate,
    });
    expect(() => prepareGeneration(materializeManualShiftOverrides(gap))).toThrow(expect.objectContaining({ code: "ESCALA_IMPORTED_MEAL_CONFLICT" }));
  });
  it("does not bypass a conflicting locked WORK covered by the manual period", () => {
    const input = datedManualFixture("HOURS_ONLY");
    input.assignments = [{ employeeId: "one", date: "2026-12-07", kind: "WORK", shiftId: "original", locked: true }];
    const before = structuredClone(input);
    expect(() => prepareGeneration(input)).toThrow(expect.objectContaining({ code: "MANUAL_SHIFT_LOCK_CONFLICT" }));
    expect(input).toEqual(before);
  });
});

describe("automatic meal bounds without changing imported evidence", () => {
  it.each([180, 135])("adapts a %s minute source meal to a bounded exact 42h proposal", meal => {
    const input = fixture(meal), before = structuredClone(input);
    for (const strategy of ["PRESERVE_START", "PRESERVE_END", "BOTH"] as const) {
      const result = prepareRoster(input, 42, "EXCLUDE", strategy);
      const selected = result.shifts.filter(shift => result.employees[0].shiftIds.includes(shift.id));
      expect(selected.length).toBeGreaterThan(0);
      for (const shift of selected) {
        expect(paid(shift)).toBe(504); expect(meals(shift)).toEqual([120]);
        expect(shift.segments.at(-1)?.end).toBeLessThanOrEqual(1200);
        expect(1440 - (shift.segments[shift.segments.length - 1].end - shift.segments[0].start)).toBeGreaterThanOrEqual(input.policy.minInterShiftMinutes);
        if (strategy === "PRESERVE_START") expect(shift.segments[0].start).toBe(460);
        if (strategy === "PRESERVE_END") expect(shift.segments.at(-1)?.end).toBe(input.shifts[0].segments.at(-1)?.end);
      }
      expect(result.employees[0].sourceSchedule).toEqual(input.employees[0].sourceSchedule);
      expect(result.policy.mealIntervalAgreement).toBeUndefined();
    }
    expect(input).toEqual(before);
  });
  it.each(["prep-", "flex-"])("repairs a saved %s proposal, and keeps alternatives within the same bounds", prefix => {
    const input = fixture(); const source = input.shifts[0];
    const proposal = automatic({ ...source, segments: [source.segments[0], source.segments[1], { ...source.segments[2], end: 1144 }] }, prefix);
    const before = structuredClone(proposal);
    const repaired = refreshProposedWorkBlocks(input.employees[0], proposal, false, 1200, 60, 120);
    expect(paid(repaired)).toBe(504); expect(meals(repaired)).toEqual([120]);
    expect(refreshProposedWorkBlocks(input.employees[0], repaired, false, 1200, 60, 120)).toEqual(repaired);
    for (const candidate of automaticShiftAlternatives(input.employees[0], repaired, false, 1200, 120)) {
      expect(paid(candidate)).toBe(504); expect(meals(candidate)).toEqual([120]);
    }
    expect(proposal).toEqual(before);
    expect(refreshProposedWorkBlocks(input.employees[0], { ...proposal, id: "manual" }, false, 1200, 60, 120)).toEqual({ ...proposal, id: "manual" });
  });
  it("repairs only unlocked automatic clocks through generation, retaining protected records", () => {
    const input = fixture(); const source = input.shifts[0];
    const proposal = automatic({ ...source, segments: [source.segments[0], source.segments[1], { ...source.segments[2], end: 1144 }] }, "flex-");
    input.shifts.push(proposal); input.employees[0].shiftIds = [proposal.id];
    input.assignments = [{ employeeId: "one", date: "2026-12-07", kind: "ABSENCE", locked: true }, { employeeId: "one", date: "2026-12-08", kind: "HOLIDAY" }];
    const before = structuredClone(input), result = prepareGeneration(input).input;
    for (const shift of result.shifts.filter(shift => result.employees[0].shiftIds.includes(shift.id))) {
      expect(paid(shift)).toBe(504); expect(meals(shift)).toEqual([120]);
    }
    expect(result.assignments).toEqual(input.assignments); expect(input).toEqual(before);
    input.assignments.push({ employeeId: "one", date: "2026-12-09", kind: "WORK", shiftId: proposal.id, locked: true });
    expect(() => prepareGeneration(input)).toThrow(expect.objectContaining({ code: "ESCALA_MEAL_LOCK_CONFLICT" }));
  });
  it.each(["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const)("reports operational incompatibility for an exact imported clock in %s", mode => {
    const input = fixture(180, 504); input.generationMode = mode;
    const before = structuredClone(input);
    expect(() => prepareGeneration(input)).toThrow(expect.objectContaining({ code: "ESCALA_IMPORTED_MEAL_CONFLICT" }));
    expect(input).toEqual(before);
  });
  it("keeps a compatible imported clock and explicitly configured maximum unchanged", () => {
    const input = fixture(120, 504), before = structuredClone(input);
    const result = prepareGeneration(input).input;
    expect(result.employees[0].fixedImportedShiftId).toBe("original");
    expect(result.shifts.find(shift => shift.id === "original")).toEqual(input.shifts[0]);
    const extended = fixture(180, 504);
    extended.policy.mealIntervalAgreement = { source: "Synthetic explicit configuration", maximumMinutes: 180, validFrom: "2026-01-01", validUntil: "2027-12-31", reviewed: true, reviewedBy: "Synthetic" };
    expect(prepareGeneration(extended).input.employees[0].fixedImportedShiftId).toBe("original");
    expect(input).toEqual(before);
  });
  it("reports a preserved-entry conflict instead of silently moving the user clock to fit closing", () => {
    const input = fixture(); input.storeClosingMinutes = 1000;
    const before = structuredClone(input), result = adaptCompatibleSchedules(input, "PRESERVE_START");
    expect(result.input.employees).toEqual(input.employees);
    expect(result.exceptions[0].reason).toContain("manter a entrada ou saída");
    expect(adaptCompatibleSchedules(input, "BOTH").exceptions).toEqual([]);
    expect(input).toEqual(before);
  });
  it("keeps a manually corrected selected clock instead of rejecting unused imported evidence", () => {
    const input = fixture(180, 504);
    input.shifts[0].segments[1].end -= 60;
    input.shifts[0].segments[2].start -= 60; input.shifts[0].segments[2].end -= 60;
    const before = structuredClone(input), result = prepareGeneration(input).input;
    expect(result.employees[0].shiftIds).toEqual(["original"]); expect(input).toEqual(before);
  });
  it("does not generate an impossible proposal or silently change an explicit anchor", () => {
    const input = fixture(); input.storeClosingMinutes = 540;
    const before = structuredClone(input), result = adaptCompatibleSchedules(input, "PRESERVE_START");
    expect(result.input.employees).toEqual(input.employees); expect(result.exceptions).toHaveLength(1);
    expect(input).toEqual(before);
  });
});
describe("canonical legacy zero-clock presentation without migration", () => {
  it("renders ENC in actual HOURS_ONLY XLSX without adding any clock or daily grid", () => {
    const input = fixture(); input.generationMode = "HOURS_ONLY";
    input.employees[0].scheduleMode = "MISSING"; input.employees[0].shiftIds = [];
    setWeekday(input.employees[0], "00:00-00:00 / 00:00-00:00");
    const before = structuredClone(input), validation = validateHoursReferences(input);
    const archive = unzipSync(exportEscalaXlsx({ id: "synthetic", revision: 1, input, validation, status: "DRAFT", canEdit: true, canPublish: false, updatedAt: "2026-12-01" }, "hours"));
    const sheets = Object.entries(archive).filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).map(([, bytes]) => strFromU8(bytes)).join("\n");
    expect(sheets).toContain(">ENC<"); expect(sheets).not.toContain(">NP<");
    expect(sheets).toContain("ENC — Sem horário fixo"); expect(input).toEqual(before);
  });
  it.each(["MISSING", undefined] as const)("classifies exactly four confirmed zero clocks from legacy %s as UNTIMED", mode => {
    const input = fixture(), person = input.employees[0];
    person.scheduleMode = mode; person.shiftIds = [];
    setWeekday(person, "00:00-00:00 / 00:00-00:00");
    const before = structuredClone(input);
    expect(effectiveScheduleMode(person)).toBe("UNTIMED");
    input.generationMode = "HOURS_ONLY"; input.needsRegeneration = false; input.simulation = true;
    input.generationBasis = generationScenarioBasis(input);
    const model = buildEscalaSchedule(input);
    expect(model.people[0].proposedSchedule).toBe("ENC — Sem horário fixo");
    expect(model.people[0].proposedVariants).toEqual([]); expect(model.dates).toEqual([]);
    expect(validateHoursReferences(input).issues.some(issue => issue.code === "EMPLOYEE_SHIFT_PENDING")).toBe(false);
    expect(validateHoursReferences(input).issues.some(issue => issue.code === "HOURS_REFERENCE_PENDING")).toBe(true);
    expect(person).toEqual(before.employees[0]); expect(input.assignments).toEqual([]);
  });
  it.each(["00:00-00:00", "00:00-00:00 / ", "07:00-00:00 / 00:00-00:00"])("keeps incomplete MISSING source %s pending", weekday => {
    const input = fixture(), person = input.employees[0]; person.scheduleMode = "MISSING"; person.shiftIds = [];
    setWeekday(person, weekday);
    expect(effectiveScheduleMode(person)).toBe("MISSING");
    expect(assignmentPresentation(person, input.startDate, { employeeId: "one", date: input.startDate, kind: "DUTY" }, new Map()).code).toBe("NP");
    input.generationMode = "HOURS_ONLY";
    expect(buildEscalaSchedule(input).people[0].proposedSchedule).toContain("NP");
  });
  it("keeps 07–11 plus an unused zero pair timed, with no inference from role", () => {
    const input = fixture(), person = input.employees[0]; person.role = "Gerente";
    setWeekday(person, "07:00-11:00 / 00:00-00:00");
    expect(effectiveScheduleMode(person)).toBe("TIMED");
    person.scheduleMode = "MISSING"; delete person.sourceSchedule;
    expect(effectiveScheduleMode(person)).toBe("MISSING");
  });
});
