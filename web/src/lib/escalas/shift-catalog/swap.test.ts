import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTurnoSwap, previewTurnoSwap } from "./swap";
import type { EscalaAssignment } from "../types";

const state = vi.hoisted(() => ({ get: vi.fn(), parse: vi.fn(), save: vi.fn(), entry: vi.fn(), oldCode: vi.fn(), validate: vi.fn() }));
vi.mock("../service", () => ({ getEscala: state.get, parseEscalaInput: state.parse, saveEscala: state.save }));
vi.mock("../validation", () => ({ validateEscala: state.validate }));
vi.mock("./catalog", () => ({ getTurnoCatalogEntry: state.entry, findTurnoCatalogCode: state.oldCode }));

const actor = { userId: "u1", tenantId: "t1", admin: true };
const request = {
  workspaceId: "w1", expectedRevision: 3, employeeId: "e1", catalogCode: 1500,
  effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-31",
};
function current(sourceSchedule?: unknown, assignments: EscalaAssignment[] = [
  { employeeId: "e1", date: "2026-12-01", kind: "WORK", shiftId: "old", locked: false },
  { employeeId: "e1", date: "2026-12-02", kind: "WORK", shiftId: "old", locked: true },
  { employeeId: "e1", date: "2026-12-03", kind: "ABSENCE" },
  { employeeId: "e1", date: "2026-12-04", kind: "OFF" },
  { employeeId: "e2", date: "2026-12-01", kind: "WORK", shiftId: "old", locked: false },
]) {
  const employee = {
    id: "e1", registration: "0001", name: "Example", sector: "A", role: "R",
    weeklyHours: 40, shiftIds: ["old"], activeFrom: "2020-01-01", offMode: "VARIABLE",
    fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1,
    preferredOffDays: [], historyKnown: false, history: [],
    ...(sourceSchedule ? { sourceSchedule } : {}),
  };
  return {
    id: "w1", revision: 3, status: "DRAFT", canEdit: true,
    input: {
      schemaVersion: 1, branchCode: "01", branchName: "Branch",
      startDate: "2026-11-30", endDate: "2027-01-03", defaultWeeklyHours: 40,
      timeZone: "America/Sao_Paulo", employees: [employee],
      policy: { source: "", reviewed: false, reviewedBy: "", validFrom: "2026-01-01", validUntil: "2027-12-31", weeklyLimit: 44,
        dailyLimitMinutes: 528, compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100,
        minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
      shifts: [{ id: "old", name: "old", segments: [{ start: 480, end: 720, kind: "WORK" }] }],
      assignments, demands: [],
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.get.mockResolvedValue(current());
  state.entry.mockResolvedValue({ code: 1500, markings: ["09:00", "13:00", "14:00", "18:00"], name: "09:00 13:00 14:00 18:00" });
  state.oldCode.mockResolvedValue(null);
  state.validate.mockReturnValue({ valid: true, issues: [] });
  state.parse.mockImplementation(value => value);
  state.save.mockResolvedValue({ id: "w1", revision: 4, status: "DRAFT" });
});

describe("dated swap compatibility", () => {
  it("blocks a conflicting locked workday and a weekly-incompatible code", async () => {
    const source = { report: "FPRE136", code: "A", description: "source", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00" };
    state.get.mockResolvedValue(current(source));
    let preview = await previewTurnoSwap(actor, request);
    expect(preview.canApply).toBe(false);
    expect(preview.validationIssues.some(i => i.code === "MANUAL_SHIFT_LOCK_CONFLICT")).toBe(true);
    const references = current(source, []);
    state.get.mockResolvedValue({ ...references, input: { ...references.input, generationMode: "HOURS_ONLY" } });
    state.entry.mockResolvedValue({ code: 1500, markings: ["08:00", "12:00", "13:00", "17:24"], name: "Synthetic 42h" });
    preview = await previewTurnoSwap(actor, request);
    expect(preview.canApply).toBe(false);
    expect(preview.validationIssues.some(i => i.code === "MANUAL_SHIFT_WEEKLY_HOURS")).toBe(true);
    await expect(applyTurnoSwap(actor, { ...request, previewId: preview.previewId, confirm: true })).rejects.toMatchObject({ code: "TURNO_VALIDATION_FAILED" });
    expect(state.save).not.toHaveBeenCalled();
  });
});

describe("employee turn swap", () => {
  it("preserves ambiguous legacy work instead of globally declaring it automatic", async () => {
    const source = { report: "FPRE136", code: "X", description: "Legacy CSV", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00" };
    const value = current(source, [{ employeeId: "e1", date: "2026-12-07", kind: "WORK", shiftId: "old" }]);
    const before = structuredClone(value); state.get.mockResolvedValue(value);
    const preview = await previewTurnoSwap(actor, request);
    expect(preview.affected).toEqual([]); expect(preview.canApply).toBe(false);
    expect(preview.preserved).toContainEqual({ date: "2026-12-07", reason: "MANUAL" });
    await expect(applyTurnoSwap(actor, { ...request, previewId: preview.previewId, confirm: true })).rejects.toMatchObject({ code: "TURNO_VALIDATION_FAILED" });
    expect(value).toStrictEqual(before); expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["ABSENCE", "HOLIDAY", "OFF"] as const)("preserves %s when the conditional target cannot be worked", async kind => {
    const value = current(undefined, [{ employeeId: "e1", date: "2026-12-07", kind, ...(kind === "OFF" ? { locked: true } : {}) }]);
    state.get.mockResolvedValue({ ...value, input: { ...value.input, generationMode: "HOURS_ONLY", storeClosingMinutes: 1000 } });
    state.entry.mockResolvedValue({ code: 1500, markings: ["14:00", "18:00", "19:00", "23:00"], name: "Structurally valid, unavailable" });
    const scoped = { ...request, effectiveFrom: "2026-12-07", effectiveUntil: "2026-12-07" };
    const preview = await previewTurnoSwap(actor, scoped);
    expect(preview.canApply).toBe(true);
    await applyTurnoSwap(actor, { ...scoped, previewId: preview.previewId, confirm: true });
    expect(state.save.mock.calls[0][3].assignments).toEqual(value.input.assignments);
    expect(state.save.mock.calls[0][3].employees[0].shiftIds).toEqual(["old"]);
  });
  it("uses an explicit 42h branch scenario for a converted 44h CSV reference", async () => {
    const source = { report: "FPRE136", code: "X", description: "Original 44h", weekday: "08:00-12:00 / 13:00-17:48", saturday: "08:00-12:00" };
    const value = current(source, []);
    state.get.mockResolvedValue({ ...value, input: { ...value.input, defaultWeeklyHours: 42,
      employees: [{ ...value.input.employees[0], weeklyHours: 44, weeklyHoursMode: "BRANCH" }] } });
    state.entry.mockResolvedValue({ code: 1500, markings: ["08:00", "12:00", "13:00", "17:24"], name: "Selected 42h" });
    const preview = await previewTurnoSwap(actor, request);
    expect(preview.canApply).toBe(true);
    await applyTurnoSwap(actor, { ...request, previewId: preview.previewId, confirm: true });
    expect(state.save.mock.calls[0][3].employees[0]).toMatchObject({ weeklyHours: 42, weeklyHoursMode: "BRANCH", sourceSchedule: source });
    expect(state.save.mock.calls[0][3].assignments).toEqual([]);
  });
  it("uses the independent real validator to block short inter-shift rest", async () => {
    const actual = await vi.importActual<typeof import("../validation")>("../validation");
    state.validate.mockImplementation(actual.validateEscala);
    const value = current(undefined, [
      { employeeId: "e1", date: "2026-12-07", kind: "WORK", shiftId: "old", locked: false },
      { employeeId: "e1", date: "2026-12-08", kind: "WORK", shiftId: "old", locked: false },
    ]);
    value.input.shifts[0].segments = [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }];
    state.get.mockResolvedValue({ ...value, input: { ...value.input, storeClosingMinutes: 1440 } });
    state.entry.mockResolvedValue({ code: 1500, markings: ["14:00", "18:00", "19:00", "23:00"], name: "Synthetic late clock" });
    const preview = await previewTurnoSwap(actor, { ...request, effectiveFrom: "2026-12-07", effectiveUntil: "2026-12-07" });
    expect(preview.canApply).toBe(false);
    expect(preview.validationIssues.some(i => i.code === "INTER_SHIFT_REST")).toBe(true);
    expect(state.save).not.toHaveBeenCalled();
  });
  it("does not reuse a confirmation after changing only the last effective date", async () => {
    state.get.mockResolvedValue(current(undefined, []));
    const preview = await previewTurnoSwap(actor, request);
    await expect(applyTurnoSwap(actor, { ...request, effectiveUntil: "2026-12-30", previewId: preview.previewId, confirm: true })).rejects.toMatchObject({ code: "TURNO_PREVIEW_STALE" });
    expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["closing", "meal"] as const)("blocks an invalid %s even without a daily roster", async reason => {
    const value = current(undefined, []);
    state.get.mockResolvedValue({ ...value, input: { ...value.input, generationMode: "HOURS_ONLY", storeClosingMinutes: reason === "closing" ? 1000 : 1200 } });
    if (reason === "meal") state.entry.mockResolvedValue({ code: 1500, markings: ["08:00", "16:00", "00:00", "00:00"], name: "No meal" });
    const preview = await previewTurnoSwap(actor, request);
    expect(preview.canApply).toBe(false);
    expect(preview.validationIssues.some(i => i.code === (reason === "closing" ? "STORE_CLOSING_EXCEEDED" : "MEAL_INTERVAL"))).toBe(true);
  });
  it("previews only unlocked work assignments and preserves manual, locked, absence, off and other people", async () => {
    const value = current();
    value.input.shifts.push({ id: "matching", name: "Compatible locked clock", segments: [
      { start: 540, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" }, { start: 840, end: 1080, kind: "WORK" },
    ] });
    value.input.employees[0].shiftIds.push("matching");
    value.input.assignments[1].shiftId = "matching";
    state.get.mockResolvedValue(value);
    const preview = await previewTurnoSwap(actor, request);
    expect(preview.affected.map(day => day.date)).toEqual(["2026-12-01"]);
    expect(preview.preserved).toEqual([
      { date: "2026-12-02", reason: "LOCKED" },
      { date: "2026-12-03", reason: "ABSENCE" },
      { date: "2026-12-04", reason: "OFF" },
    ]);
    expect(preview.validationLevel).toBe("FULL_SCHEDULE");
    const result = await applyTurnoSwap(actor, { ...request, previewId: preview.previewId, confirm: true });
    expect(result).toMatchObject({ revision: 4 });
    const savedInput = state.save.mock.calls[0][3];
    expect(savedInput.employees[0].originalShiftIds).toEqual(["old", "matching"]);
    expect(savedInput.assignments[1]).toEqual(expect.objectContaining({ locked: true, shiftId: "matching" }));
    expect(savedInput.assignments[2]).toMatchObject({ kind: "ABSENCE" });
    expect(savedInput.assignments[3]).toMatchObject({ kind: "OFF" });
    expect(savedInput.assignments[4].shiftId).toBe("old");
  });

  it("does not create assignments when applying a reference to a plan without a grid", async () => {
    state.get.mockResolvedValue(current(undefined, []));
    const preview = await previewTurnoSwap(actor, request);
    expect(preview.validationLevel).toBe("NO_SCHEDULE");
    const result = await applyTurnoSwap(actor, { ...request, previewId: preview.previewId, confirm: true });
    expect(result).toMatchObject({ revision: 4 });
    expect(state.save.mock.calls[0][3].assignments).toEqual([]);
  });

  it("persists a dated catalog selection while retaining the imported CSV source", async () => {
    const source = { report: "FPRE136", code: "A", description: "source", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00" };
    state.get.mockResolvedValue(current(source, []));
    const preview = await previewTurnoSwap(actor, request);
    expect(preview.canApply).toBe(true);
    await applyTurnoSwap(actor, { ...request, previewId: preview.previewId, confirm: true });
    const saved = state.save.mock.calls[0][3];
    expect(saved.employees[0].sourceSchedule).toEqual(source);
    expect(saved.employees[0].manualShiftOverrides).toEqual([expect.objectContaining({ catalogCode: 1500, effectiveFrom: request.effectiveFrom, effectiveUntil: request.effectiveUntil, markings: ["09:00", "13:00", "14:00", "18:00"] })]);
    expect(saved.assignments).toEqual([]);
  });

  it("rejects stale revision before applying the confirmed preview", async () => {
    state.get.mockResolvedValue({ ...current(), revision: 4 });
    await expect(previewTurnoSwap(actor, request)).rejects.toMatchObject({ code: "TURNO_REVISION_CONFLICT" });
  });
});
