import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnoExportManifest, downloadTurnoExport } from "./export";

import type { EscalaWorkspace } from "../types";
const state = vi.hoisted(() => ({
  payload: null as unknown,
  getEscala: vi.fn(),
  queryRaw: vi.fn(),
  store: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: state.queryRaw } }));
vi.mock("../service", () => ({ getEscala: state.getEscala }));
vi.mock("./catalog", () => ({ storeTurnoManifest: state.store, readTurnoManifest: state.read }));

const actor = { userId: "u1", tenantId: "t1", admin: true };
function workspace(revision = 3): EscalaWorkspace {
  const employee = {
    id: "e1", registration: "0007", name: "Example", sector: "A", role: "R",
    weeklyHours: 40 as const, shiftIds: ["s1"], activeFrom: "2020-01-01", offMode: "VARIABLE" as const,
    fixedOffDays: [], offPattern: "ANY" as const, maxConsecutiveSundays: 1 as const,
    preferredOffDays: [], historyKnown: false, history: [],
  };
  return {
    id: "w1", revision, status: "DRAFT", canEdit: true, canPublish: false,
    updatedAt: "2026-12-01T00:00:00Z",
    validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null },
    input: {
      schemaVersion: 1 as const, branchCode: "01", branchName: "Branch",
      startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12",
      defaultWeeklyHours: 40 as const, timeZone: "America/Sao_Paulo" as const,
      policy: {} as never,
      employees: [employee, { ...employee, id: "e2", registration: "0008", planningEnabled: false }],
      shifts: [{ id: "s1", name: "local", segments: [{ start: 480, end: 720, kind: "WORK" as const }, { start: 720, end: 840, kind: "BREAK" as const }, { start: 840, end: 1104, kind: "WORK" as const }] }],
      assignments: [],
      demands: [],
    },
  };
}
const selections = [{ workspaceId: "w1", revision: 3, employees: [{ employeeId: "e1", localShiftId: "s1" }, { employeeId: "e2", localShiftId: "s1" }] }];
beforeEach(() => {
  vi.clearAllMocks();
  state.payload = null;
  state.getEscala.mockImplementation(async (_actor, _id) => workspace());
  state.queryRaw.mockResolvedValue([{ code: 1500, firstIn: 480, firstOut: 720, secondIn: 840, secondOut: 1104 }]);
  state.store.mockImplementation(async (_actor, payload) => { state.payload = payload; return "manifest-1"; });
  state.read.mockImplementation(async () => state.payload);
});

describe("turn TXT manifest", () => {
  it.each([true, false])("uses UNTIMED for legacy four-zero omissions with an explicit selection: %s", async selected => {
    const value = workspace();
    value.input.employees[0].scheduleMode = "MISSING";
    value.input.employees[0].sourceSchedule = { report: "FPRE136", code: "0", description: "Synthetic", weekday: "00:00-00:00 / 00:00-00:00", saturday: "00:00-00:00" };
    const before = structuredClone(value);
    state.getEscala.mockResolvedValue(value);
    const manifest = await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [{ ...selections[0], employees: selected ? selections[0].employees : [selections[0].employees[1]] }] });
    expect(manifest.rowCount).toBe(1);
    expect(manifest.omissions).toContainEqual(expect.objectContaining({ employeeId: "e1", reason: "UNTIMED" }));
    await expect(downloadTurnoExport(actor, manifest.manifestId, "TXT1", false)).rejects.toMatchObject({ code: "TURNO_EXPORT_OMISSIONS" });
    const downloaded = await downloadTurnoExport(actor, manifest.manifestId, "TXT1", true);
    expect(new TextDecoder().decode(downloaded.bytes)).toBe("0008,08:00,12:00,14:00,18:24\r\n");
    expect(value).toEqual(before);
  });
  it("keeps incomplete clocks MISSING and exports a real 07–11 single period exactly", async () => {
    const value = workspace(); value.input.employees[0].scheduleMode = "MISSING";
    value.input.employees[0].sourceSchedule = { report: "FPRE136", code: "0", description: "Synthetic", weekday: "07:00-00:00 / 00:00-00:00", saturday: "00:00-00:00" };
    value.input.employees[1].scheduleMode = "TIMED"; value.input.employees[1].shiftIds = ["single"];
    value.input.shifts.push({ id: "single", name: "Single", segments: [{ start: 420, end: 660, kind: "WORK" }] });
    state.getEscala.mockResolvedValue(value); state.queryRaw.mockResolvedValue([{ code: 1501, firstIn: 420, firstOut: 660, secondIn: 0, secondOut: 0 }]);
    const manifest = await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [{ ...selections[0], employees: [selections[0].employees[0], { employeeId: "e2", localShiftId: "single" }] }] });
    expect(manifest.omissions).toContainEqual(expect.objectContaining({ employeeId: "e1", reason: "MISSING" }));
    const downloaded = await downloadTurnoExport(actor, manifest.manifestId, "TXT1", true);
    expect(new TextDecoder().decode(downloaded.bytes)).toBe("0008,07:00,11:00,00:00,00:00\r\n");
  });
  it("accepts an explicitly selected dated manual reference outside shiftIds", async () => {
    const value = workspace() as EscalaWorkspace;
    value.input.shifts.push({ id: "manual", name: "Manual", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 720, kind: "BREAK" }, { start: 720, end: 960, kind: "WORK" }] });
    value.input.employees[0].manualShiftOverrides = [{ catalogCode: 1501, shiftId: "manual", markings: ["07:00", "11:00", "12:00", "16:00"], effectiveFrom: "2026-12-03", effectiveUntil: "2026-12-10" }];
    state.getEscala.mockResolvedValue(value);
    state.queryRaw.mockResolvedValue([{ code: 1501, firstIn: 420, firstOut: 660, secondIn: 720, secondOut: 960 }]);
    const manifest = await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [{ workspaceId: "w1", revision: 3, employees: [{ employeeId: "e1", localShiftId: "manual" }] }] });
    expect(manifest.rowCount).toBe(1);
    expect(value.input.employees[0].shiftIds).not.toContain("manual"); expect(value.input.assignments).toEqual([]);
    expect(state.getEscala).toHaveBeenCalledWith(actor, "w1");
    expect(JSON.stringify(state.queryRaw.mock.calls[0])).toContain(actor.tenantId);
    expect(manifest.omissions).toContainEqual(expect.objectContaining({ employeeId: "e2", reason: "NO_REFERENCE" }));
    await expect(downloadTurnoExport(actor, manifest.manifestId, "TXT1", false)).rejects.toMatchObject({ status: 409, code: "TURNO_EXPORT_OMISSIONS" });
    const result = await downloadTurnoExport(actor, manifest.manifestId, "TXT1", true);
    expect(new TextDecoder().decode(result.bytes)).toBe("0007,07:00,11:00,12:00,16:00\r\n");
  });
  it("rejects a superseded base and keeps paid-break omissions explicit", async () => {
    const value = workspace() as EscalaWorkspace;
    value.input.shifts.push({ id: "manual", name: "Manual", segments: [{ start: 420, end: 660, kind: "WORK" }] });
    value.input.employees[0].manualShiftOverrides = [{ catalogCode: 1501, shiftId: "manual", markings: ["07:00", "11:00", "00:00", "00:00"], effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-31" }];
    state.getEscala.mockResolvedValue(value);
    const manifest = await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [selections[0]] });
    expect(manifest.omissions).toContainEqual(expect.objectContaining({ employeeId: "e1", reason: "NO_REFERENCE" }));
    value.input.employees[0].manualShiftOverrides = undefined;
    value.input.shifts[0].segments = [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 750, kind: "PAID_BREAK" }, { start: 750, end: 990, kind: "WORK" }];
    const paid = await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [selections[0]] });
    expect(paid.rowCount).toBe(0); expect(paid.omissions.every(item => item.reason === "PAID_BREAK")).toBe(true);
  });
  it("includes generation-excluded employees when explicitly selected and preserves registration text", async () => {
    const manifest = await createTurnoExportManifest(actor, { month: 12, year: 2026, selections });
    expect(manifest.rowCount).toBe(2);
    expect(manifest.omissions).toEqual([]);
    expect(state.store).toHaveBeenCalledWith(actor, expect.objectContaining({ month: 12, year: 2026, rowsHash: expect.any(String) }), expect.any(Date));
  });

  it("reports every unselected collaborator instead of silently inventing or flattening a reference", async () => {
    const manifest = await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [{ ...selections[0], employees: [] }] });
    expect(manifest.rowCount).toBe(0);
    expect(manifest.omissions.map(item => [item.registration, item.reason])).toEqual([["0007", "NO_REFERENCE"], ["0008", "NO_REFERENCE"]]);
  });

  it("rejects employee ids outside the selected workspace", async () => {
    await expect(createTurnoExportManifest(actor, {
      month: 12, year: 2026,
      selections: [{ ...selections[0], employees: [{ employeeId: "other-tenant-person", localShiftId: "s1" }] }],
    })).rejects.toMatchObject({ code: "TURNO_EMPLOYEE_NOT_FOUND" });
  });

  it("uses one frozen selection for both byte-exact TXT outputs", async () => {
    const manifest = await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [selections[0]] });
    const txt1 = await downloadTurnoExport(actor, manifest.manifestId, "TXT1", false);
    const txt2 = await downloadTurnoExport(actor, manifest.manifestId, "TXT2", false);
    expect(new TextDecoder().decode(txt1.bytes)).toBe("0007,08:00,12:00,14:00,18:24\r\n0008,08:00,12:00,14:00,18:24\r\n");
    expect(new TextDecoder().decode(txt2.bytes)).toBe("1500,08:00 12:00 14:00 18:24,08:00,12:00,14:00,18:24\r\n");
    expect(txt1.bytes.slice(0, 3)).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(state.getEscala).toHaveBeenCalledTimes(3);
  });

  it("rejects unsafe registration delimiters without rewriting the source value", async () => {
    state.getEscala.mockImplementationOnce(async () => {
      const current = workspace();
      current.input.employees[0].registration = "00,07";
      return current;
    });
    await expect(createTurnoExportManifest(actor, { month: 12, year: 2026, selections }))
      .rejects.toMatchObject({ code: "TURNO_REGISTRATION_UNSUPPORTED" });
  });

  it("requires current revision and explicit acceptance of omissions at download", async () => {
    await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [{ ...selections[0], employees: [] }] });
    await expect(downloadTurnoExport(actor, "manifest-1", "TXT1", false)).rejects.toMatchObject({ code: "TURNO_EXPORT_EMPTY" });

    state.getEscala.mockResolvedValueOnce(workspace(4));
    await expect(downloadTurnoExport(actor, "manifest-1", "TXT1", true)).rejects.toMatchObject({ code: "TURNO_REVISION_CONFLICT" });
  });

  it("requires omission confirmation before producing partial files", async () => {
    await createTurnoExportManifest(actor, { month: 12, year: 2026, selections: [{ ...selections[0], employees: [{ employeeId: "e1", localShiftId: "s1" }] }] });
    await expect(downloadTurnoExport(actor, "manifest-1", "TXT1", false)).rejects.toMatchObject({ code: "TURNO_EXPORT_OMISSIONS" });
    await expect(downloadTurnoExport(actor, "manifest-1", "TXT1", true)).resolves.toMatchObject({ month: 12, year: 2026 });
  });
});
