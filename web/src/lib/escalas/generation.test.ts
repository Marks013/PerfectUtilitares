import { describe, expect, it } from "vitest";
import { dateRange } from "./dates";
import { prepareGeneration } from "./generation";
import { prepareRoster } from "./preparation";
import { escalaInputSchema } from "./schema";
import { isMixed42LongShift } from "./labor-rules";
import { validateEscala } from "./validation";
import type { EscalaInput } from "./types";
import { adaptCompatibleSchedules } from "./schedule-adaptation";

function input(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "08", branchName: "Filial de teste", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "", validFrom: "2026-01-01", validUntil: "2028-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44,
      dailyLimitMinutes: 600, compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60,
      maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
    employees: [{ id: "p1", registration: "0001", name: "Pessoa de teste", sector: "Setor", role: "Cargo", weeklyHours: 42, shiftIds: ["source"], activeFrom: "",
      planningEnabled: true, scheduleMode: "TIMED", sourceSchedule: { report: "FPRE136", code: "0026", description: "Referência", weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00" },
      offMode: "MIXED", fixedOffDays: [2], offPattern: "PREFER_CONSECUTIVE", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [3], historyKnown: false, history: [] }],
    shifts: [{ id: "source", name: "Referência original", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 980, kind: "WORK" }] }],
    demands: [], assignments: [],
  };
}

const minutes = (value: EscalaInput, id: string) => value.shifts.find((shift) => shift.id === id)?.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);

describe("42h mixed distribution for selected sectors", () => {
  it("regenerates and adapts a saved mixed roster with JSONB segment key ordering", () => {
    const raw = input();
    raw.mixed42Sectors = ["Setor"];
    const saved = prepareGeneration(raw).input;
    saved.shifts = saved.shifts.map(shift => ({ ...shift, segments: shift.segments.map(({ start, end, kind }) => ({ end, kind, start })) }));
    const shiftId = saved.employees[0].shiftIds[0];
    saved.assignments = [{ employeeId: "p1", date: saved.startDate, kind: "WORK", shiftId, locked: true }];
    const regenerated = prepareGeneration(saved);
    expect(regenerated.input.assignments).toEqual(saved.assignments);
    expect(regenerated.input.employees[0].shiftIds).toEqual(saved.employees[0].shiftIds);
    expect(adaptCompatibleSchedules(saved, "PRESERVE_START").exceptions).toEqual([]);
    saved.policy.limitContinuousWorkBlocks = true;
    const adjusted = prepareGeneration(saved).input;
    expect(adjusted.assignments).toEqual(saved.assignments);
    expect(escalaInputSchema.safeParse(adjusted).success).toBe(true);
  });

  it("prepares two durations, preserves references, and estimates both durations without changing explicit minima", () => {
    const raw = input();
    raw.mixed42Sectors = ["Setor"];
    raw.policy.dailyLimitMinutes = 528;
    raw.employees.push({ ...raw.employees[0], id: "p2", registration: "0002", sector: "Outro setor" });
    const explicit = { id: "required", sector: "Setor", date: raw.startDate, start: 420, end: 480, minimum: 1 };
    raw.demands.push(explicit);
    raw.assignments.push({ employeeId: "p1", date: raw.startDate, kind: "ABSENCE", locked: true });
    const original = structuredClone(raw);
    const { input: prepared } = prepareGeneration(raw);
    const [mixed, ordinary] = prepared.employees;
    expect(new Set(mixed.shiftIds.map(id => minutes(prepared, id)))).toEqual(new Set([480, 540]));
    expect(new Set(ordinary.shiftIds.map(id => minutes(prepared, id)))).toEqual(new Set([504]));
    expect(prepared.shifts.filter(shift => minutes(prepared, shift.id) === 540).every(isMixed42LongShift)).toBe(true);
    expect(prepared.assignments).toEqual(raw.assignments);
    expect(prepared.demands).toContainEqual(explicit);
    expect(prepared.demands.some(demand => demand.estimated && demand.sector === "Setor")).toBe(true);
    expect(prepared.policy.dailyLimitMinutes).toBe(528);
    expect(prepared.policy.collectiveAgreement).toBeUndefined();
    expect(prepared.policy.mealIntervalAgreement).toBeUndefined();
    expect(mixed.sourceSchedule).toEqual(raw.employees[0].sourceSchedule);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
    expect(raw).toEqual(original);
  });

  it("validates 42h in transition, blocks publication, and rejects malformed long shifts", () => {
    const raw = input();
    raw.startDate = "2027-01-04"; raw.endDate = "2027-01-10";
    raw.mixed42Sectors = ["Setor"]; raw.policy.dailyLimitMinutes = 528;
    const { input: prepared } = prepareGeneration(raw);
    const short = prepared.shifts.find(shift => minutes(prepared, shift.id) === 480);
    const long = prepared.shifts.find(isMixed42LongShift);
    if (!short || !long) throw new Error("Os dois horários devem estar disponíveis.");
    prepared.demands = [];
    prepared.assignments = dateRange(prepared.startDate, prepared.endDate).map((date, index) => index === 2 || index === 6
      ? { employeeId: "p1", date, kind: "OFF" }
      : { employeeId: "p1", date, kind: "WORK", shiftId: index === 0 || index === 1 ? long.id : short.id });
    const result = validateEscala(prepared);
    expect(result.valid).toBe(true);
    expect(result.readyToPublish).toBe(false);
    expect(result.summaries[0].workedMinutes).toBe(2520);
    expect(result.issues.filter(issue => issue.code === "MIXED_42_SIMULATION")).toHaveLength(1);
    expect(validateEscala({ ...prepared, simulation: false }).issues.some(issue => issue.code === "DISTRIBUTION_DAILY_LIMIT")).toBe(true);
    const corrupted = structuredClone(prepared);
    const bad = corrupted.shifts.find(shift => shift.id === long.id);
    if (!bad) throw new Error("Horário de 9h ausente.");
    bad.segments[1].end -= 1; bad.segments[2].start -= 1; bad.segments[2].end -= 1;
    expect(validateEscala(corrupted).issues.some(issue => issue.code === "MIXED_42_SHIFT")).toBe(true);
    const excessive = structuredClone(prepared);
    excessive.assignments[3] = { employeeId: "p1", date: "2027-01-07", kind: "ABSENCE" };
    excessive.assignments[4].shiftId = long.id;
    expect(validateEscala(excessive).issues.some(issue => issue.code === "MIXED_42_WEEK")).toBe(true);
  });

  it("returns to 8h24 when deselected and never creates 9h options in the 40h phase", () => {
    const raw = input(); raw.mixed42Sectors = ["Setor"];
    const mixed = prepareGeneration(raw).input;
    const uniform = prepareGeneration({ ...mixed, mixed42Sectors: [] }).input;
    expect(new Set(uniform.employees[0].shiftIds.map(id => minutes(uniform, id)))).toEqual(new Set([504]));
    raw.startDate = "2027-12-20"; raw.endDate = "2027-12-26";
    const forty = prepareGeneration(raw).input;
    expect(new Set(forty.employees[0].shiftIds.map(id => minutes(forty, id)))).toEqual(new Set([480]));
  });

  it("does not extend short imported references to 8h or 9h", () => {
    const raw = input(); raw.mixed42Sectors = ["Setor"];
    const source = raw.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência importada ausente.");
    source.weekday = "07:00-12:00";
    const { input: prepared } = prepareGeneration(raw);
    expect(prepared.employees[0].simulationDailyMinutes).toBe(300);
    expect(prepared.employees[0].shiftIds.map(id => minutes(prepared, id))).toEqual([300]);
  });

  it("restores exact manual options after a persisted mixed draft without exposing originals to the solver", () => {
    const raw = input();
    raw.employees[0].sourceSchedule = undefined;
    raw.shifts[0].segments[2].end = 1044;
    raw.shifts[0].name = "Horário manual escolhido";
    raw.mixed42Sectors = ["Setor"];
    const original = structuredClone(raw.shifts[0]);
    const mixed = prepareGeneration(raw).input;
    expect(mixed.employees[0].originalShiftIds).toEqual(["source"]);
    expect(mixed.employees[0].shiftIds).not.toContain("source");
    expect(mixed.shifts).toContainEqual(original);
    const saved = escalaInputSchema.parse(JSON.parse(JSON.stringify(mixed)));
    const adapted = adaptCompatibleSchedules(saved, "BOTH").input;
    expect(adapted.employees[0].originalShiftIds).toEqual(["source"]);
    expect(escalaInputSchema.safeParse(adapted).success).toBe(true);
    const restored = prepareGeneration({ ...adapted, mixed42Sectors: [] }).input;
    expect(restored.employees[0].shiftIds).toEqual(["source"]);
    expect(restored.employees[0].originalShiftIds).toBeUndefined();
    expect(restored.shifts).toEqual([original]);
    expect(escalaInputSchema.safeParse(restored).success).toBe(true);
  });

  it("retains historical and locked turns while restoring the manual reference", () => {
    const raw = input();
    raw.employees[0].sourceSchedule = undefined;
    raw.shifts[0].segments[2].end = 1044;
    raw.mixed42Sectors = ["Setor"];
    const mixed = prepareGeneration(raw).input;
    const long = mixed.shifts.find(isMixed42LongShift);
    if (!long) throw new Error("Horário de 9h ausente.");
    const lock = { employeeId: "p1", date: raw.startDate, kind: "WORK" as const, shiftId: long.id, locked: true };
    mixed.assignments = [lock];
    mixed.employees[0].history = [{ employeeId: "p1", date: "2026-10-25", kind: "WORK", shiftId: long.id }];
    const restored = prepareGeneration({ ...mixed, mixed42Sectors: [] }).input;
    expect(restored.assignments).toContainEqual(lock);
    expect(restored.employees[0].shiftIds).toEqual(["source", long.id]);
    expect(restored.shifts.some(shift => shift.id === long.id)).toBe(true);
    expect(escalaInputSchema.safeParse(restored).success).toBe(true);
  });

  it("does not fabricate references for older mixed drafts and rejects unresolved original IDs", () => {
    const raw = input(); raw.employees[0].sourceSchedule = undefined; raw.mixed42Sectors = ["Setor"];
    const mixed = prepareGeneration(raw).input;
    delete mixed.employees[0].originalShiftIds;
    const older = prepareRoster(mixed, 42);
    expect(older.employees[0].originalShiftIds).toBeUndefined();
    older.employees[0].originalShiftIds = ["missing"];
    expect(escalaInputSchema.safeParse(older).success).toBe(false);
  });
});

describe("whole-branch generation preparation", () => {
  it("retains a saved short-reference roster when preparation changes no scheduling semantics", () => {
    const value = input();
    value.startDate = "2026-10-26"; value.endDate = "2026-12-06"; value.simulation = true;
    const reference = value.employees[0].sourceSchedule;
    if (!reference) throw new Error("Referência ausente");
    reference.weekday = "07:00-10:00 / 12:00-14:50";
    value.shifts[0].segments = [{ start: 420, end: 600, kind: "WORK" }, { start: 600, end: 720, kind: "BREAK" }, { start: 720, end: 890, kind: "WORK" }];
    const prepared = prepareRoster(value, 42, "EXCLUDE", "PRESERVE_START");
    const shiftId = prepared.employees[0].shiftIds[0];
    const days = dateRange(prepared.startDate, prepared.endDate);
    prepared.assignments = days.map((date, index) => ({ employeeId: "p1", date, kind: index % 7 < 5 ? "WORK" : "OFF", ...(index % 7 < 5 ? { shiftId } : {}) }));
    prepared.assignments[0].locked = true;
    prepared.assignments[1] = { employeeId: "p1", date: days[1], kind: "ABSENCE" };
    const original = structuredClone(prepared);
    const result = prepareGeneration(prepared);
    expect(result.preparation.adjustedEmployeeIds).toEqual([]);
    expect(result.input.assignments).toEqual(original.assignments);
    expect(result.input.employees[0].simulationDailyMinutes).toBe(350);
    expect(result.input.employees[0].weeklyHours).toBe(42);
    expect(result.input.shifts).toEqual(original.shifts);
    expect(prepared).toEqual(original);
  });

  it("does not overwrite a manually edited proposal that retained its old identifier", () => {
    const value = input();
    const reference = value.employees[0].sourceSchedule;
    if (!reference) throw new Error("Referência ausente");
    reference.weekday = "07:00-12:00 / 14:00-16:20";
    value.policy.limitContinuousWorkBlocks = false;
    const selected = prepareRoster(value, 42, "EXCLUDE", "PRESERVE_START");
    selected.shifts[0].segments[0].end += 5;
    selected.shifts[0].segments[1].start += 5;
    selected.shifts[0].segments[1].end += 5;
    selected.shifts[0].segments[2].start += 5;
    selected.policy.limitContinuousWorkBlocks = true;
    const result = prepareGeneration(selected);
    expect(result.preparation.adjustedEmployeeIds).toEqual([]);
    expect(result.input.shifts).toEqual(selected.shifts);
  });
  it.each(["PRESERVE_START", "PRESERVE_END"] as const)("rebalances and restores an automatic %s proposal when the preference changes", strategy => {
    const value = input();
    const reference = value.employees[0].sourceSchedule;
    if (!reference) throw new Error("Referência ausente");
    reference.weekday = "07:00-12:00 / 14:00-16:20";
    value.policy.limitContinuousWorkBlocks = false;
    const original = prepareRoster(value, 42, "EXCLUDE", strategy);
    const sourceShift = original.shifts.find(shift => shift.id === original.employees[0].shiftIds[0]);
    if (!sourceShift) throw new Error("Proposta original ausente");
    original.policy.limitContinuousWorkBlocks = true;
    const balanced = prepareGeneration(original);
    expect(balanced.preparation.adjustedEmployeeIds).toEqual(["p1"]);
    const shift = balanced.input.shifts.find(item => item.id === balanced.input.employees[0].shiftIds[0]);
    if (!shift) throw new Error("Proposta equilibrada ausente");
    expect(shift.segments[0].start).toBe(sourceShift.segments[0].start);
    expect(shift.segments.at(-1)?.end).toBe(sourceShift.segments.at(-1)?.end);
    expect(Math.max(...shift.segments.filter(segment => segment.kind === "WORK").map(segment => segment.end - segment.start))).toBeLessThanOrEqual(270);
    balanced.input.policy.limitContinuousWorkBlocks = false;
    const restored = prepareGeneration(balanced.input);
    expect(restored.input.shifts.find(item => item.id === restored.input.employees[0].shiftIds[0])).toEqual(sourceShift);
    expect(restored.input.employees[0].sourceSchedule).toEqual(value.employees[0].sourceSchedule);
  });
  it("updates old automatic proposals but retains a locked long block and all protected records", () => {
    const value = input();
    const reference = value.employees[0].sourceSchedule;
    if (!reference) throw new Error("Referência ausente");
    reference.weekday = "07:00-10:20 / 12:20-16:20";
    value.policy.limitContinuousWorkBlocks = false;
    const original = prepareRoster(value, 42, "EXCLUDE", "PRESERVE_START");
    const oldShift = original.shifts[0];
    original.policy.limitContinuousWorkBlocks = true;
    original.assignments = [{ employeeId: "p1", date: original.startDate, kind: "WORK", shiftId: oldShift.id, locked: true },
      { employeeId: "p1", date: "2026-10-27", kind: "ABSENCE" }, { employeeId: "p1", date: "2026-10-28", kind: "OFF" }];
    const prepared = prepareGeneration(original);
    expect(prepared.input.assignments).toEqual(original.assignments);
    expect(prepared.input.shifts.find(shift => shift.id === oldShift.id)).toEqual(oldShift);
    expect(prepared.input.employees[0].shiftIds).toContain(oldShift.id);
    expect(prepared.input.employees[0].shiftIds.some(id => id !== oldShift.id)).toBe(true);
  });

  it("excludes company-confirmed apprentices without deleting protected absence or locked records", () => {
    const value = input();
    value.employees[0].role = "AUX. DE SERVIÇOS EM SUPER";
    value.assignments = [
      { employeeId: "p1", date: value.startDate, kind: "WORK", shiftId: "source", locked: true },
      { employeeId: "p1", date: "2026-10-27", kind: "ABSENCE" },
      { employeeId: "p1", date: "2026-10-28", kind: "OFF" },
    ];
    const before = JSON.stringify(value);
    const result = prepareGeneration(value);
    expect(result.input.employees[0].planningEnabled).toBe(false);
    expect(result.preparation.excludedEmployeeIds).toEqual(["p1"]);
    expect(result.input.assignments).toEqual(value.assignments.slice(0, 2));
    expect(result.preparation.includedEmployees).toBe(0);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("adapts a branch-managed reference without FPRE metadata to the single selected workload", () => {
    const value = input(); value.employees[0].sourceSchedule = undefined;
    value.employees[0].weeklyHoursMode = "BRANCH";
    const prepared = prepareGeneration(value);
    expect(prepared.input.employees[0].shiftIds.every(id => minutes(prepared.input, id) === 504)).toBe(true);
    expect(prepared.input.employees[0].weeklyHours).toBe(42);
  });
  it("adapts an imported 6x1 reference and supplies provisional coverage without approving any rule", () => {
    const value = input(); const original = structuredClone(value);
    const prepared = prepareGeneration(value);
    expect(prepared.preparation).toMatchObject({ adjustedEmployeeIds: ["p1"], excludedEmployeeIds: [], includedEmployees: 1, untimedEmployees: 0 });
    expect(prepared.preparation.generatedCoverageSlots).toBeGreaterThan(0);
    expect(prepared.input.employees[0].shiftIds.map((id) => minutes(prepared.input, id))).toEqual([504]);
    expect(prepared.input.shifts[0].segments[0].start).toBe(420);
    expect(prepared.input.policy).toEqual({ ...value.policy, coverageReview: "SUGGESTED" });
    expect(prepared.input.employees[0]).toMatchObject({ offMode: "MIXED", fixedOffDays: [2], offPattern: "PREFER_CONSECUTIVE", maxConsecutiveSundays: 2, sundayRestRule: "COMMERCE", preferredOffDays: [3], historyKnown: false });
    expect(escalaInputSchema.safeParse(prepared.input).success).toBe(true);
    expect(value).toEqual(original);
  });

  it("honors an explicitly selected shorter branch target without increasing a shorter contract", () => {
    const value = input(); value.defaultWeeklyHours = 40; value.employees[0].weeklyHoursMode = "BRANCH";
    const prepared = prepareGeneration(value).input;
    expect(prepared.employees[0].weeklyHours).toBe(40);
    expect(prepared.employees[0].shiftIds.every((id) => minutes(prepared, id) === 480)).toBe(true);
    prepared.defaultWeeklyHours = 44;
    prepared.employees[0].weeklyHoursMode = "INDIVIDUAL";
    expect(prepareGeneration(prepared).input.employees[0].weeklyHours).toBe(40);
  });
  it("preserves the selected start-preserving shift proposal instead of restoring every alternative", () => {
    const selected = prepareRoster(input(), 42, "EXCLUDE", "PRESERVE_START");
    expect(selected.employees[0].shiftIds).toHaveLength(1);
    const prepared = prepareGeneration(selected);
    expect(prepared.preparation.adjustedEmployeeIds).toEqual([]);
    expect(prepared.input.employees[0].shiftIds).toEqual(selected.employees[0].shiftIds);
    expect(prepared.input.shifts).toEqual(selected.shifts);
  });

  it("keeps a late reference included by preserving departure when extending it would enter the night period", () => {
    const value = input();
    const original = value.employees[0].sourceSchedule;
    if (!original) throw new Error("Missing fixture reference");
    value.employees[0].sourceSchedule = { ...original, weekday: "12:10-16:10 / 18:10-21:30" };
    value.shifts[0].segments = [{ start: 730, end: 970, kind: "WORK" }, { start: 970, end: 1090, kind: "BREAK" }, { start: 1090, end: 1290, kind: "WORK" }];
    const prepared = prepareGeneration(value);
    const selected = prepared.input.shifts.find((shift) => shift.id === prepared.input.employees[0].shiftIds[0]);
    expect(prepared.preparation.excludedEmployeeIds).toEqual([]);
    expect(selected?.segments[0].start).toBe(666);
    expect(selected?.segments.at(-1)?.end).toBe(1290);
    expect(minutes(prepared.input, selected?.id ?? "")).toBe(504);
  });

  it("respects the dated ceiling without rewriting the contract reference or approving transition terms", () => {
    const value = input(); value.startDate = "2028-01-03"; value.endDate = "2028-01-09";
    const prepared = prepareGeneration(value).input;
    expect(prepared.employees[0].weeklyHours).toBe(42);
    expect(prepared.employees[0].shiftIds.every((id) => minutes(prepared, id) === 480)).toBe(true);
    expect(prepared.policy.compensationAuthorized).toBe(false);
    expect(prepared.policy.transitionWeekAccepted).toBeUndefined();
  });

  it("keeps only the original ten night minutes when neither imported adaptation is daytime", () => {
    const value = input();
    const source = value.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência de teste ausente");
    source.weekday = "12:50-16:30 / 18:30-22:10";
    value.shifts[0].segments = [{ start: 770, end: 990, kind: "WORK" }, { start: 990, end: 1110, kind: "BREAK" }, { start: 1110, end: 1330, kind: "WORK" }];
    value.assignments = [{ employeeId: "p1", date: value.startDate, kind: "WORK", shiftId: "source", locked: true },
      { employeeId: "p1", date: "2026-10-27", kind: "ABSENCE" }];
    const original = structuredClone(value);
    const prepared = prepareGeneration(value).input;
    const selected = prepared.shifts.find(shift => shift.id === prepared.employees[0].shiftIds[0]);
    expect(selected?.segments).toEqual([{ start: 706, end: 990, kind: "WORK" }, { start: 990, end: 1110, kind: "BREAK" }, { start: 1110, end: 1330, kind: "WORK" }]);
    expect(minutes(prepared, selected?.id ?? "")).toBe(504);
    expect(prepared.assignments).toEqual(original.assignments);
    expect(prepared.shifts.find(shift => shift.id === "source")).toEqual(original.shifts[0]);
    expect(prepared.employees[0].sourceSchedule).toEqual(source);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
    const night = { ...prepared, assignments: [{ employeeId: "p1", date: value.startDate, kind: "WORK" as const, shiftId: selected?.id }] };
    expect(validateEscala(night).issues.some(issue => issue.code === "NIGHT_CREDIT_PENDING")).toBe(true);
    expect(value).toEqual(original);
  });

  it("preserves arrival when keeping an early departure would add more work before 05h", () => {
    const value = input();
    const source = value.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência de teste ausente");
    source.weekday = "03:50-07:30 / 09:30-13:10";
    value.shifts[0].segments = [{ start: 230, end: 450, kind: "WORK" }, { start: 450, end: 570, kind: "BREAK" }, { start: 570, end: 790, kind: "WORK" }];
    const prepared = prepareGeneration(value).input;
    const selected = prepared.shifts.find(shift => shift.id === prepared.employees[0].shiftIds[0]);
    expect(selected?.segments[0].start).toBe(230);
    expect(selected?.segments.at(-1)?.end).toBe(854);
    expect(minutes(prepared, selected?.id ?? "")).toBe(504);
  });

  it("keeps arrival on equal night work across midnight instead of using the unpaid meal as work", () => {
    const value = input();
    const source = value.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência de teste ausente");
    source.weekday = "20:50-00:30 / 02:30-06:10";
    value.shifts[0].segments = [{ start: 1250, end: 1470, kind: "WORK" }, { start: 1470, end: 1590, kind: "BREAK" }, { start: 1590, end: 1810, kind: "WORK" }];
    const prepared = prepareGeneration(value).input;
    const selected = prepared.shifts.find(shift => shift.id === prepared.employees[0].shiftIds[0]);
    expect(selected?.segments[0].start).toBe(1250);
    expect(selected?.segments.at(-1)?.end).toBe(1874);
    expect(minutes(prepared, selected?.id ?? "")).toBe(504);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
  });

  it("does not reconsider valid manually selected night alternatives", () => {
    const value = input();
    const source = value.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência de teste ausente");
    source.weekday = "12:50-16:30 / 18:30-22:10";
    value.shifts = [
      { id: "manual-late", name: "Horário manual", segments: [{ start: 770, end: 990, kind: "WORK" }, { start: 990, end: 1110, kind: "BREAK" }, { start: 1110, end: 1394, kind: "WORK" }] },
      { id: "manual-early", name: "Alternativa manual", segments: [{ start: 706, end: 990, kind: "WORK" }, { start: 990, end: 1110, kind: "BREAK" }, { start: 1110, end: 1330, kind: "WORK" }] },
    ];
    value.employees[0].shiftIds = value.shifts.map(shift => shift.id);
    const prepared = prepareGeneration(value);
    expect(prepared.preparation.adjustedEmployeeIds).toEqual([]);
    expect(prepared.input.shifts).toEqual(value.shifts);
    expect(prepared.input.employees[0].shiftIds).toEqual(value.employees[0].shiftIds);
  });

  it("does not reinclude excluded people, invent manager hours or alter custom distributions", () => {
    const value = input();
    value.employees[0].planningEnabled = false;
    value.employees.push({ ...structuredClone(value.employees[0]), id: "manager", registration: "0002", planningEnabled: true, scheduleMode: "UNTIMED", shiftIds: [] });
    value.employees.push({ ...structuredClone(value.employees[0]), id: "custom", registration: "0003", planningEnabled: true, sourceSchedule: undefined });
    const prepared = prepareGeneration(value);
    expect(prepared.input.employees).toEqual(value.employees);
    expect(prepared.preparation).toMatchObject({ adjustedEmployeeIds: [], excludedEmployeeIds: [], includedEmployees: 2, untimedEmployees: 1 });
    expect(prepared.input.employees[1].shiftIds).toEqual([]);
  });

  it("lists an unsafe short imported journey as an exception instead of expanding its hours", () => {
    const value = input(); const source = value.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência de teste ausente");
    value.employees[0].sourceSchedule = { ...source, weekday: "07:00-11:00" };
    value.shifts[0].segments = [{ start: 420, end: 660, kind: "WORK" }];
    const prepared = prepareGeneration(value);
    expect(prepared.preparation.excludedEmployeeIds).toEqual([]);
    expect(prepared.input.employees[0]).toMatchObject({ planningEnabled: true, simulationDailyMinutes: 240, weeklyHours: 42 });
    expect(prepared.preparation.includedEmployees).toBe(1);
    expect(prepared.input.employees[0].shiftIds.every((id) => minutes(prepared.input, id) === 240)).toBe(true);
    expect(prepared.input.employees).toHaveLength(1);
  });

  it("preserves locked work, its exact shift definition, absences and actual history during adaptation", () => {
    const value = input();
    value.assignments = [{ employeeId: "p1", date: value.startDate, kind: "WORK", shiftId: "source", locked: true },
      { employeeId: "p1", date: "2026-10-27", kind: "ABSENCE" }, { employeeId: "p1", date: "2026-10-28", kind: "WORK", shiftId: "source" }];
    value.employees[0].history = [{ employeeId: "p1", date: "2026-10-25", kind: "WORK", shiftId: "source" }];
    const prepared = prepareGeneration(value).input;
    expect(prepared.assignments).toEqual(value.assignments.slice(0, 2));
    expect(prepared.employees[0].shiftIds).toContain("source");
    expect(prepared.shifts.find((shift) => shift.id === "source")).toEqual(value.shifts[0]);
    expect(prepared.employees[0].history).toEqual(value.employees[0].history);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
  });

  it.each(["ABSENCE", "OFF"] as const)("does not exclude an incompatible person who has a preserved %s commitment", (kind) => {
    const value = input(); const source = value.employees[0].sourceSchedule;
    if (!source) throw new Error("Referência de teste ausente");
    value.employees[0].sourceSchedule = { ...source, weekday: "07:00-11:00" };
    value.assignments = [{ employeeId: "p1", date: value.startDate, kind, locked: kind === "OFF" }];
    const prepared = prepareGeneration(value);
    expect(prepared.preparation.excludedEmployeeIds).toEqual([]);
    expect(prepared.input.assignments).toEqual(value.assignments);
    expect(prepared.input.employees[0].simulationDailyMinutes).toBe(240);
    expect(value.employees[0].planningEnabled).toBe(true);
  });

  it("recalculates estimates without turning a legacy global review into confirmed operational minima", () => {
    const value = prepareGeneration(input()).input;
    value.policy.coverageReview = "CONFIRMED";
    const explicit = { ...value.demands[0], id: "manual-zero", minimum: 0, estimated: false };
    value.demands = [explicit, ...value.demands.slice(1)];
    const repeated = prepareGeneration(value);
    expect(repeated.preparation.adjustedEmployeeIds).toEqual([]);
    expect(repeated.preparation.generatedCoverageSlots).toBeGreaterThan(0);
    expect(repeated.input.demands.find(demand => demand.id === explicit.id)).toEqual(explicit);
    expect(repeated.input.demands.filter(demand => demand.id !== explicit.id).every(demand => demand.estimated === true)).toBe(true);
    expect(repeated.input.policy.coverageReview).toBe("SUGGESTED");
  });

  it("keeps a complete custom coverage declaration, including zero minimums, byte-for-byte", () => {
    const value = input(); value.employees[0].sourceSchedule = undefined;
    value.demands = dateRange(value.startDate, value.endDate).map((date) => ({ id: `manual-${date}`, date, sector: "Setor", start: 420, end: 980, minimum: 0 }));
    value.policy.coverageReview = "CONFIRMED";
    expect(prepareGeneration(value).input).toEqual({ ...value, simulation: true });
  });
});
