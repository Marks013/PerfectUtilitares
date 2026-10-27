import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaInput } from "./types";
import { createEscala, generateEscala, getEscala, listEscalas, parseEscalaInput, preserveLockedAssignments, saveEscala } from "./service";
import { allowedBranches, branchPermission, escalaActor, requireEscalaPermission } from "./access";
import { addDays, dateRange, dayOfWeek } from "./dates";
import { validateEscala } from "./validation";
import { publishedPlanningContext } from "./continuity";

const mocks = vi.hoisted(() => ({
  workspace: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  revision: { findUnique: vi.fn(), create: vi.fn() }, grants: { findUnique: vi.fn(), findMany: vi.fn() },
  audit: { create: vi.fn() }, transaction: vi.fn(), solve: vi.fn(), peers: vi.fn(), advisory: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaWorkspace: mocks.workspace, escalaRevision: mocks.revision, escalaBranchAccess: mocks.grants, auditLog: mocks.audit, $transaction: mocks.transaction } }));
vi.mock("./solver-client", async (original) => ({ ...await original<typeof import("./solver-client")>(), solveEscala: mocks.solve }));
const actor = { tenantId: "company-a", userId: "user-a", admin: true };
const operator = { ...actor, admin: false };

function input(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "Instrumento validado no cenário", validFrom: "2026-01-01", validUntil: "2027-01-01", reviewed: true, reviewedBy: "Responsável", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 6, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false },
    employees: [{ id: "e1", registration: "0001", name: "Ana", sector: "Reposição", role: "Repositor", weeklyHours: 42, shiftIds: ["day"], activeFrom: "2026-10-26", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "CLT_386", preferredOffDays: [5, 6], historyKnown: false, history: [] }],
    shifts: [{ id: "day", name: "Diurno", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
    demands: Array.from({ length: 7 }, (_, index) => ({ id: `d${index}`, date: new Date(Date.UTC(2026, 9, 26 + index)).toISOString().slice(0, 10), sector: "Reposição", start: 480, end: 720, minimum: index < 5 ? 1 : 0 })),
    assignments: Array.from({ length: 7 }, (_, index) => ({ employeeId: "e1", date: new Date(Date.UTC(2026, 9, 26 + index)).toISOString().slice(0, 10), kind: index < 5 ? "WORK" as const : "OFF" as const, ...(index < 5 ? { shiftId: "day" } : {}) })),
  };
}
function row(overrides = {}) { return { id: "w1", tenantId: actor.tenantId, branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", revision: 1, status: "DRAFT", updatedAt: new Date("2026-10-26T12:00:00Z"), ...overrides }; }
function version(value = input(), revision = 1, status = "DRAFT") { return { input: value, revision, status, createdAt: row().updatedAt }; }

function period(startDate: string, weeks = 1): EscalaInput {
  const value = input();
  value.startDate = startDate;
  value.endDate = addDays(startDate, weeks * 7 - 1);
  value.employees[0].activeFrom = "2020-01-01";
  value.employees[0].historyKnown = true;
  const assignment = (date: string) => ({ employeeId: "e1", date, kind: dayOfWeek(date) < 5 ? "WORK" as const : "OFF" as const, ...(dayOfWeek(date) < 5 ? { shiftId: "day" } : {}) });
  value.employees[0].history = dateRange(addDays(startDate, -21), addDays(startDate, -1)).map(assignment);
  value.assignments = dateRange(value.startDate, value.endDate).map(assignment);
  value.demands = dateRange(value.startDate, value.endDate).map((date) => ({ id: `d-${date}`, date, sector: "Reposição", start: 480, end: 720, minimum: dayOfWeek(date) < 5 ? 1 : 0 }));
  return value;
}

function useCurrent(value: EscalaInput, status = "DRAFT") {
  mocks.workspace.findFirst.mockResolvedValue(row({ branchCode: value.branchCode, startDate: value.startDate, endDate: value.endDate, status }));
  mocks.revision.findUnique.mockResolvedValue(version(value, 1, status));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.findFirst.mockResolvedValue(row());
  mocks.workspace.findMany.mockResolvedValue([row()]);
  mocks.workspace.create.mockResolvedValue(row());
  mocks.workspace.updateMany.mockResolvedValue({ count: 1 });
  mocks.revision.findUnique.mockResolvedValue(version());
  mocks.grants.findMany.mockResolvedValue([]);
  mocks.peers.mockResolvedValue([]);
  mocks.advisory.mockResolvedValue(1);
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ escalaWorkspace: { ...mocks.workspace, findMany: mocks.peers }, escalaRevision: mocks.revision, auditLog: mocks.audit, $executeRaw: mocks.advisory }));
  mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: input().assignments, wallTimeSeconds: 0.1, message: "Proposta viável" });
});

describe("Escalas publication continuity", () => {
  it("reconstructs trusted planning history by textual registration and semantic shift, without attendance inference", async () => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    current.employees[0].historyKnown = false;
    current.employees[0].planningHistory = [{ employeeId: "e1", date: "2026-11-01", kind: "WORK", shiftId: "day" }];
    const previous = period("2026-10-26");
    previous.employees[0].id = "old-person";
    previous.employees[0].shiftIds = ["old-shift"];
    previous.shifts[0].id = "old-shift";
    previous.shifts[0].segments[2].end = 1020;
    for (const item of [...previous.assignments, ...previous.employees[0].history]) {
      item.employeeId = "old-person";
      if (item.shiftId) item.shiftId = "old-shift";
    }
    useCurrent(current);
    mocks.workspace.findMany.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    mocks.solve.mockResolvedValue({ status: "UNKNOWN", assignments: [], wallTimeSeconds: 1, message: "Prazo" });
    const result = await generateEscala(actor, "w1", 1);
    const person = result.proposalInput.employees[0];
    expect(person.history).toEqual([]);
    expect(person.historyKnown).toBe(false);
    expect(person.planningHistory).toHaveLength(7);
    expect(person.planningHistory?.at(-1)).toEqual({ employeeId: "e1", date: "2026-11-01", kind: "OFF" });
    const work = person.planningHistory?.find((item) => item.kind === "WORK");
    expect(work?.shiftId).toMatch(/^plan-/);
    expect(result.proposalInput.shifts.find((shift) => shift.id === work?.shiftId)?.segments).toEqual(previous.shifts[0].segments);
    expect(mocks.solve.mock.calls[0][0]).toEqual(result.proposalInput);
    expect(mocks.workspace.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: actor.tenantId, branchCode: "2", id: { not: "w1" } }),
      select: { revisions: expect.objectContaining({ where: { tenantId: actor.tenantId, status: "PUBLISHED" }, take: 1, orderBy: { revision: "desc" } }) } }));
    expect(publishedPlanningContext(current, [previous]).shifts).toEqual(result.proposalInput.shifts);
  });

  it("rejects the seventh contiguous workday across two non-overlapping published periods", async () => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    current.employees[0].historyKnown = false;
    const previous = period("2026-10-26");
    previous.assignments = previous.assignments.map((item, index) => ({ employeeId: "e1", date: item.date, kind: index === 0 ? "OFF" : "WORK", ...(index === 0 ? {} : { shiftId: "day" }) }));
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ status: 409, code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining("2026-11-02") });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
  });

  it("checks a later published period when inserting its preceding week", async () => {
    const current = period("2026-10-26");
    current.assignments = current.assignments.map((item, index) => ({ employeeId: "e1", date: item.date, kind: index === 0 ? "OFF" : "WORK", ...(index === 0 ? {} : { shiftId: "day" }) }));
    const later = period("2026-11-02");
    later.employees[0].history = [];
    later.employees[0].historyKnown = false;
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: later }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining("2026-11-02") });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
  });

  it("preserves protective Sunday rotation from the previous published Sunday", async () => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    current.employees[0].historyKnown = false;
    current.assignments[4] = { employeeId: "e1", date: "2026-11-06", kind: "OFF" };
    current.assignments[6] = { employeeId: "e1", date: "2026-11-08", kind: "WORK", shiftId: "day" };
    current.demands[4].minimum = 0;
    const previous = period("2026-10-26");
    previous.assignments[4] = { employeeId: "e1", date: "2026-10-30", kind: "OFF" };
    previous.assignments[6] = { employeeId: "e1", date: "2026-11-01", kind: "WORK", shiftId: "day" };
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining("domingo") });
  });

  it("rejects conflicting published duplicates and respects binding dates, disabled people and textual registrations", () => {
    const current = period("2026-11-02");
    const previous = period("2026-10-26");
    const conflict = structuredClone(previous);
    conflict.assignments[0] = { employeeId: "e1", date: previous.startDate, kind: "OFF" };
    expect(() => publishedPlanningContext(current, [previous, conflict])).toThrow(/divergentes/);
    current.employees[0].registration = "1";
    expect(publishedPlanningContext(current, [previous]).employees[0].planningHistory).toBeUndefined();
    current.employees[0].registration = "0001";
    current.employees[0].activeFrom = current.startDate;
    expect(publishedPlanningContext(current, [previous]).employees[0].planningHistory).toBeUndefined();
    current.employees[0].activeFrom = "";
    current.employees[0].planningEnabled = false;
    expect(publishedPlanningContext(current, [previous]).employees[0].planningHistory).toBeUndefined();
    current.employees[0].planningEnabled = true;
    expect(() => publishedPlanningContext(current, [{ ...previous, branchCode: "3" }])).toThrow(/filial/);
  });

  it.each(["work", "off"])("protects inter-shift rest and an occupied %s day at the publication boundary", async (kind) => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    const previous = period("2026-10-26");
    previous.shifts.push({ id: "night", name: "Noturno", segments: [{ start: 1200, end: 1440, kind: "WORK" }, { start: 1440, end: 1500, kind: "BREAK" }, { start: 1500, end: 1740, kind: "WORK" }] });
    previous.employees[0].shiftIds.push("night");
    previous.assignments[6] = { employeeId: "e1", date: "2026-11-01", kind: "WORK", shiftId: "night" };
    if (kind === "off") {
      current.assignments[0] = { employeeId: "e1", date: "2026-11-02", kind: "OFF" };
      current.assignments[5] = { employeeId: "e1", date: "2026-11-07", kind: "WORK", shiftId: "day" };
      current.demands[0].minimum = 0; current.demands[5].minimum = 1;
    }
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining(kind === "off" ? "ainda contém trabalho" : "entre jornadas") });
  });

  it("resolves consecutive rest against the previous published Sunday without fabricating attendance", async () => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    current.employees[0].offPattern = "CONSECUTIVE";
    current.employees[0].offMode = "MIXED";
    current.employees[0].fixedOffDays = [0];
    current.assignments[0] = { employeeId: "e1", date: "2026-11-02", kind: "OFF" };
    current.assignments[5] = { employeeId: "e1", date: "2026-11-07", kind: "WORK", shiftId: "day" };
    current.demands[0].minimum = 0; current.demands[5].minimum = 1;
    const previous = period("2026-10-26");
    previous.assignments[6] = { employeeId: "e1", date: "2026-11-01", kind: "WORK", shiftId: "day" };
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining("consecutivas") });
  });

  it("fails clearly when copied planning shifts exceed the existing 120-shift input limit", () => {
    const current = period("2026-11-02");
    current.shifts = Array.from({ length: 120 }, (_, index) => ({ ...current.shifts[0], id: `shift-${index}` }));
    const previous = period("2026-10-26");
    previous.shifts[0].segments[2].end = 1020;
    expect(() => publishedPlanningContext(current, [previous])).toThrow(/120/);
  });

  it("allows identical assignments in overlapping complete-week periods", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    const result = await saveEscala(actor, "w1", 1, current, true);
    expect(result.status).toBe("PUBLISHED");
    expect(result.revision).toBe(2);
    expect(mocks.revision.create).toHaveBeenCalledOnce();
  });

  it("rejects divergent published work/off decisions without writes or personal data in the error", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    previous.assignments[0] = { employeeId: "e1", date: "2026-11-02", kind: "OFF" };
    previous.assignments[5] = { employeeId: "e1", date: "2026-11-07", kind: "WORK", shiftId: "day" };
    previous.demands[0].minimum = 0; previous.demands[5].minimum = 1;
    expect(validateEscala(current).readyToPublish).toBe(true);
    expect(validateEscala(previous).readyToPublish).toBe(true);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    const original = JSON.stringify(current);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ status: 409, code: "ESCALA_PUBLISHED_OVERLAP", message: expect.stringContaining("2026-11-02") });
    try { await saveEscala(actor, "w1", 1, current, true); } catch (error) {
      expect(String(error)).not.toContain("Ana");
      expect(String(error)).not.toContain("0001");
    }
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    expect(mocks.revision.create).not.toHaveBeenCalled();
    expect(mocks.audit.create).not.toHaveBeenCalled();
    expect(JSON.stringify(current)).toBe(original);
  });

  it("compares exact textual registrations and semantic segments rather than names, IDs or lock flags", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    const employee = previous.employees[0];
    employee.id = "imported-person"; employee.name = "Nome atualizado"; employee.shiftIds = ["imported-shift"];
    previous.shifts[0].id = "imported-shift"; previous.shifts[0].name = "Outro nome do mesmo turno";
    for (const assignment of [...previous.assignments, ...employee.history]) {
      assignment.employeeId = employee.id;
      if (assignment.shiftId) assignment.shiftId = "imported-shift";
      assignment.locked = true;
    }
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    expect((await saveEscala(actor, "w1", 1, current, true)).status).toBe("PUBLISHED");
    const otherRegistration = structuredClone(previous);
    otherRegistration.employees[0].registration = "1";
    otherRegistration.shifts[0].segments.forEach((segment) => { segment.start += 60; segment.end += 60; });
    mocks.peers.mockResolvedValue([{ revisions: [{ input: otherRegistration }] }]);
    expect((await saveEscala(actor, "w1", 1, current, true)).status).toBe("PUBLISHED");
  });

  it("rejects different shift segments even when employee and shift IDs are equal", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    previous.shifts[0].segments.forEach((segment) => { segment.start += 60; segment.end += 60; });
    previous.demands.forEach((demand) => { demand.start += 60; demand.end += 60; });
    expect(validateEscala(previous).readyToPublish).toBe(true);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_OVERLAP" });
    expect(mocks.revision.create).not.toHaveBeenCalled();
  });

  it("checks the latest published revision even when the other workspace currently has a draft", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    previous.assignments[0] = { employeeId: "e1", date: "2026-11-02", kind: "OFF" };
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ status: "DRAFT", revision: 8, revisions: [{ input: previous, revision: 5, status: "PUBLISHED" }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_OVERLAP" });
    expect(mocks.peers).toHaveBeenCalledWith({
      where: { tenantId: "company-a", branchCode: "2", id: { not: "w1" }, startDate: { lte: "2026-11-29" }, endDate: { gte: "2026-10-05" } },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      select: { revisions: { where: { tenantId: "company-a", status: "PUBLISHED" }, orderBy: { revision: "desc" }, take: 1, select: { input: true } } },
    });
  });

  it("compares declared current history with an earlier published schedule without changing history", async () => {
    const current = period("2026-11-02");
    const previous = period("2026-10-26");
    const record = current.employees[0].history.find((assignment) => assignment.date === "2026-10-30");
    if (record) { record.kind = "OFF"; delete record.shiftId; }
    expect(validateEscala(current).readyToPublish).toBe(true);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    const history = JSON.stringify(current.employees[0].history);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_OVERLAP", message: expect.stringContaining("2026-10-30") });
    expect(JSON.stringify(current.employees[0].history)).toBe(history);
  });

  it("protects the declared history of a later published schedule when approving an earlier period", async () => {
    const current = period("2026-10-26");
    const previous = period("2026-11-02");
    const record = previous.employees[0].history.find((assignment) => assignment.date === "2026-10-26");
    if (record) { record.kind = "OFF"; delete record.shiftId; }
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_OVERLAP", message: expect.stringContaining("2026-10-26") });
  });

  it("protects the fixed Monday reservation paired with a published final Sunday off, across different imported IDs", async () => {
    const previous = period("2026-10-26");
    previous.employees[0].offMode = "FIXED";
    previous.employees[0].fixedOffDays = [0, 6];
    previous.employees[0].offPattern = "CONSECUTIVE";
    previous.assignments[0] = { employeeId: "e1", date: "2026-10-26", kind: "OFF" };
    previous.assignments[5] = { employeeId: "e1", date: "2026-10-31", kind: "WORK", shiftId: "day" };
    previous.demands[0].minimum = 0; previous.demands[5].minimum = 1;
    expect(validateEscala(previous).readyToPublish).toBe(true);
    const current = period("2026-11-02");
    current.employees[0].history = current.employees[0].history.map((assignment) => {
      const published = previous.assignments.find((item) => item.date === assignment.date);
      return published ? { ...published } : assignment;
    });
    current.employees[0].id = "future-person";
    current.employees[0].shiftIds = ["future-shift"];
    current.shifts[0].id = "future-shift";
    for (const assignment of [...current.assignments, ...current.employees[0].history]) {
      assignment.employeeId = "future-person";
      if (assignment.shiftId) assignment.shiftId = "future-shift";
    }
    expect(validateEscala(current).readyToPublish).toBe(true);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ status: "DRAFT", revisions: [{ input: previous }] }]);
    const historical = JSON.stringify(current.employees[0].history);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ status: 409, code: "ESCALA_PUBLISHED_OVERLAP", message: expect.stringContaining("2026-11-02") });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(current.employees[0].history)).toBe(historical);
    expect(previous.assignments).toHaveLength(7);
    expect(previous.employees[0].history).toHaveLength(21);
  });

  it("does not compare two historical declarations without a published assignment on that date", async () => {
    const current = period("2026-11-02");
    const previous = period("2026-11-09");
    const record = previous.employees[0].history.find((assignment) => assignment.date === "2026-10-26");
    if (record) { record.kind = "OFF"; delete record.shiftId; }
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }, { revisions: [] }]);
    expect((await saveEscala(actor, "w1", 1, current, true)).status).toBe("PUBLISHED");
  });

  it("acquires the parameterized branch lock before reading peers or writing and uses fresh statement snapshots", async () => {
    const events: string[] = [];
    mocks.advisory.mockImplementation(async () => { events.push("lock"); return 1; });
    mocks.peers.mockImplementation(async () => { events.push("read"); return []; });
    mocks.workspace.updateMany.mockImplementation(async () => { events.push("update"); return { count: 1 }; });
    await saveEscala(actor, "w1", 1, input(), true);
    expect(events).toEqual(["lock", "read", "update"]);
    const [sql, key] = mocks.advisory.mock.calls[0];
    expect(Array.from(sql as TemplateStringsArray).join("?")).toBe("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))");
    expect(key).toBe('escalas-publication:["company-a","2"]');
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
    expect(mocks.workspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "w1", tenantId: "company-a", revision: 1 } }));
  });

  it("does not lock or compare peers when saving an unpublished draft", async () => {
    await saveEscala(actor, "w1", 1, input());
    expect(mocks.advisory).not.toHaveBeenCalled();
    expect(mocks.peers).not.toHaveBeenCalled();
  });

  it("fails closed for an unreadable published snapshot and rechecks idempotent publications", async () => {
    useCurrent(input(), "PUBLISHED");
    mocks.peers.mockResolvedValue([{ revisions: [{ input: { schemaVersion: 999 } }] }]);
    await expect(saveEscala(actor, "w1", 1, input(), true)).rejects.toMatchObject({ status: 409, code: "ESCALA_PUBLISHED_OVERLAP" });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    mocks.peers.mockResolvedValue([]);
    mocks.workspace.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await expect(saveEscala(actor, "w1", 1, input(), true)).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
  });
});

describe("Escalas permissions", () => {
  it("requires an active tenant and gives ADMIN access only to the session tenant", async () => {
    expect(() => escalaActor({ user: { id: "a", tenantId: null, role: "ADMIN", status: "ACTIVE" }, expires: "2099" })).toThrow(/empresa/);
    expect(() => escalaActor({ user: { id: "a", tenantId: "a", role: "ADMIN", status: "BLOCKED" }, expires: "2099" })).toThrow(/ativo/);
    expect(escalaActor({ user: { id: "a", tenantId: "a", role: "OPERATOR", status: "ACTIVE" }, expires: "2099" })).toEqual({ userId: "a", tenantId: "a", admin: false });
    await expect(branchPermission(actor, "2")).resolves.toEqual({ canEdit: true, canPublish: true });
    expect(mocks.grants.findUnique).not.toHaveBeenCalled();
  });
  it("denies operators without explicit branch grants", async () => {
    mocks.grants.findUnique.mockResolvedValue(null);
    await expect(branchPermission(operator, "2")).rejects.toMatchObject({ status: 403 });
    expect(mocks.grants.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_userId_branchCode: { tenantId: "company-a", userId: "user-a", branchCode: "2" } } }));
    mocks.grants.findUnique.mockResolvedValue({ role: "OTHER" });
    await expect(branchPermission(operator, "2")).rejects.toMatchObject({ status: 403 });
  });
  it.each(["VIEWER", "PLANNER", "APPROVER"])("resolves %s without escalating privileges", async (role) => {
    mocks.grants.findUnique.mockResolvedValue({ role });
    const permission = await branchPermission(operator, "2");
    expect(permission).toEqual({ canEdit: role !== "VIEWER", canPublish: role === "APPROVER" });
    if (role !== "APPROVER") expect(() => requireEscalaPermission(permission, "publish")).toThrow(/publicar/);
    if (role === "VIEWER") expect(() => requireEscalaPermission(permission, "edit")).toThrow(/alterar/);
  });
  it("lists only explicitly granted branches for operators", async () => {
    mocks.grants.findMany.mockResolvedValue([{ branchCode: "2" }]);
    expect(await allowedBranches(operator)).toEqual(["2"]);
    expect(await allowedBranches(actor)).toBeNull();
    await listEscalas(operator);
    expect(mocks.workspace.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "company-a", branchCode: { in: ["2"] } } }));
  });
});

describe("Escalas revision service", () => {
  it("rejects malformed snapshots and stores a complete tenant-scoped first revision atomically", async () => {
    expect(() => parseEscalaInput({ ...input(), tenantId: "foreign" })).toThrow(/tenantId/);
    expect(parseEscalaInput(input()).employees[0].registration).toBe("0001");
    const result = await createEscala(actor, input());
    expect(result.revision).toBe(1);
    expect(result.validation.readyToPublish).toBe(true);
    expect(mocks.revision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: "company-a", workspaceId: "w1", revision: 1, status: "DRAFT", input: input(), createdById: "user-a" }) });
    const audit = mocks.audit.create.mock.calls[0][0];
    expect(audit.data.metadata).toEqual({ tenantId: "company-a", revision: 1, employeeCount: 1 });
    expect(JSON.stringify(audit)).not.toContain("Ana");
  });
  it("sorts branches naturally before rendering lists", async () => {
    mocks.workspace.findMany.mockResolvedValue([row({ id: "10", branchCode: "10" }), row({ id: "2", branchCode: "2" }), row({ id: "1", branchCode: "1" })]);
    expect((await listEscalas(actor)).map((workspace) => workspace.id)).toEqual(["1", "2", "10"]);
  });
  it("does not disclose a workspace belonging to another company", async () => {
    mocks.workspace.findFirst.mockResolvedValue(null);
    await expect(getEscala(actor, "foreign-id")).rejects.toMatchObject({ status: 404 });
    expect(mocks.workspace.findFirst).toHaveBeenCalledWith({ where: { id: "foreign-id", tenantId: "company-a" } });
    expect(mocks.revision.findUnique).not.toHaveBeenCalled();
  });
  it("reads an immutable historical revision and fails for an absent version", async () => {
    const result = await getEscala(actor, "w1", 1);
    expect(result.input).toEqual(input());
    expect(mocks.revision.findUnique).toHaveBeenCalledWith({ where: { tenantId_workspaceId_revision: { tenantId: "company-a", workspaceId: "w1", revision: 1 } } });
    mocks.revision.findUnique.mockResolvedValue(null);
    await expect(getEscala(actor, "w1", 9)).rejects.toMatchObject({ status: 404 });
  });
  it("saves a new draft without updating the previous published revision", async () => {
    mocks.revision.findUnique.mockResolvedValue(version(input(), 1, "PUBLISHED"));
    const result = await saveEscala(actor, "w1", 1, input());
    expect(result).toMatchObject({ revision: 2, status: "DRAFT" });
    expect(mocks.revision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ revision: 2, status: "DRAFT" }) });
    expect(mocks.workspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "w1", tenantId: "company-a", revision: 1 } }));
  });
  it("persists confirmed estimates as hard minima so a later setup edit cannot relax them", async () => {
    const value = input(); value.policy.coverageReview = "CONFIRMED";
    value.demands = value.demands.map((demand) => ({ ...demand, estimated: true }));
    const saved = await saveEscala(actor, "w1", 1, value);
    expect(saved.input.demands.every((demand) => demand.estimated === false)).toBe(true);
    const stored = mocks.revision.create.mock.calls[0][0].data.input as EscalaInput;
    expect(stored.demands.every((demand) => demand.estimated === false)).toBe(true);
    expect(value.demands.every((demand) => demand.estimated === true)).toBe(true);
  });
  it("freezes confirmed legacy minima even when the next save resets the branch review", async () => {
    const previous = input(); previous.policy.coverageReview = "CONFIRMED";
    previous.demands = previous.demands.map((demand) => ({ ...demand, estimated: true }));
    useCurrent(previous);
    const next = structuredClone(previous); next.policy.coverageReview = "SUGGESTED";
    const result = await saveEscala(actor, "w1", 1, next);
    expect(result.input.policy.coverageReview).toBe("SUGGESTED");
    expect(result.input.demands.every((demand) => demand.estimated === false)).toBe(true);
  });
  it("rejects stale revisions before writes and enforces the transactional compare-and-swap", async () => {
    await expect(saveEscala(actor, "w1", 2, input())).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.workspace.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveEscala(actor, "w1", 1, input())).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
    expect(mocks.revision.create).not.toHaveBeenCalled();
  });
  it("keeps branch and period identity fixed", async () => {
    await expect(saveEscala(actor, "w1", 1, { ...input(), branchCode: "3" })).rejects.toMatchObject({ code: "ESCALA_IDENTITY_CHANGED" });
  });
  it("publishes only an independently ready snapshot, preserving the approval revision", async () => {
    const result = await saveEscala(actor, "w1", 1, input(), true);
    expect(result).toMatchObject({ revision: 2, status: "PUBLISHED" });
    expect(mocks.revision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "PUBLISHED", revision: 2 }) });
    const pending = input(); pending.policy.reviewed = false;
    await expect(saveEscala(actor, "w1", 1, pending, true)).rejects.toMatchObject({ status: 422 });
    mocks.revision.findUnique.mockResolvedValue(version(input(), 1, "PUBLISHED"));
    expect((await saveEscala(actor, "w1", 1, input(), true)).revision).toBe(1);
  });
  it("preserves locked cells and shift definitions; only approvers can explicitly unlock unchanged assignments", () => {
    const previous = input(); previous.assignments[0].locked = true;
    const changed = structuredClone(previous); changed.assignments[0] = { ...changed.assignments[0], kind: "OFF", shiftId: undefined };
    expect(() => preserveLockedAssignments(previous, changed)).toThrow(/bloqueado/);
    const changedShift = structuredClone(previous); changedShift.shifts[0].segments[2].end -= 1;
    expect(() => preserveLockedAssignments(previous, changedShift)).toThrow(/horário/);
    const unlock = structuredClone(previous); unlock.assignments[0].locked = false;
    expect(() => preserveLockedAssignments(previous, unlock)).toThrow();
    expect(() => preserveLockedAssignments(previous, unlock, true)).not.toThrow();
    expect(() => preserveLockedAssignments(previous, previous)).not.toThrow();
  });
  it("generates a preview and revalidates it without persisting", async () => {
    const result = await generateEscala(actor, "w1", 1);
    expect(result.validation.readyToPublish).toBe(true);
    expect(result.proposalInput.assignments).toEqual(input().assignments);
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.solve.mockResolvedValue({ status: "UNKNOWN", assignments: [], wallTimeSeconds: 1, message: "Prazo encerrado" });
    expect((await generateEscala(actor, "w1", 1)).proposalInput).toEqual(input());
  });
  it("rejects a generated response when another editor changed the revision", async () => {
    mocks.revision.findUnique.mockResolvedValueOnce(version()).mockResolvedValueOnce(version(input(), 2));
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
  });
  it("rejects a feasible response with an unassigned day even when missing days are draft pendings", async () => {
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: input().assignments.slice(1), wallTimeSeconds: 0.1, message: "Concluído" });
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("generates one joint preview with pending policy and automatically proposed coverage, without approving or persisting", async () => {
    const value = input(); value.assignments = []; value.demands = [];
    value.policy.reviewed = false; value.policy.source = ""; value.policy.reviewedBy = "";
    useCurrent(value);
    const result = await generateEscala(actor, "w1", 1);
    expect(mocks.solve).toHaveBeenCalledTimes(1);
    expect(mocks.solve.mock.calls[0]).toHaveLength(1);
    expect(result.preparation).toMatchObject({ includedEmployees: 1, untimedEmployees: 0 });
    expect(result.preparation.generatedCoverageSlots).toBeGreaterThan(0);
    expect(result.proposalInput.policy).toMatchObject({ reviewed: false, source: "", reviewedBy: "", coverageReview: "SUGGESTED" });
    expect(result.validation.valid).toBe(true);
    expect(result.validation.readyToPublish).toBe(false);
    expect(result.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "POLICY_PENDING" }), expect.objectContaining({ code: "COVERAGE_REVIEW_PENDING" })]));
    expect(result.validation.issues.some((issue) => issue.code === "DAY_PENDING" || issue.code === "COVERAGE_PENDING")).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("identifies incomplete setup before contacting the solver", async () => {
    const empty = input(); empty.employees = []; empty.assignments = [];
    mocks.revision.findUnique.mockResolvedValue(version(empty));
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ status: 422, code: "ESCALA_SETUP_REQUIRED" });
    expect(mocks.solve).not.toHaveBeenCalled();
  });
  it("generates rest rotation for an untimed manager without requiring a fictitious shift", async () => {
    const value = input();
    value.employees[0] = { ...value.employees[0], scheduleMode: "UNTIMED", shiftIds: [] };
    value.shifts = []; value.demands = [];
    value.assignments = value.assignments.map((item) => ({ employeeId: item.employeeId, date: item.date, kind: item.kind === "WORK" ? "DUTY" : item.kind }));
    useCurrent(value);
    mocks.solve.mockResolvedValue({ status: "OPTIMAL", assignments: value.assignments, wallTimeSeconds: 0.1, message: "Concluído" });
    const result = await generateEscala(actor, "w1", 1);
    expect(result.validation.readyToPublish).toBe(true);
    expect(result.validation.summaries[0]).toMatchObject({ workDays: 5, offDays: 2, workedMinutes: 0 });
  });
  it.each(["excluded", "inactive", "no-shift"])("rejects %s setup before contacting Python", async (scenario) => {
    const value = input();
    if (scenario === "excluded") { value.employees[0].planningEnabled = false; value.assignments = []; }
    if (scenario === "inactive") { value.employees[0].activeFrom = "2027-01-01"; value.assignments = []; }
    if (scenario === "no-shift") value.employees[0].shiftIds = [];
    useCurrent(value);
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_SETUP_REQUIRED", status: 422 });
    expect(mocks.solve).not.toHaveBeenCalled();
  });
  it("rejects forbidden CCT holiday rest and missing extended-day authorization as configuration", async () => {
    const cct = input(); cct.policy.normativeProfile = "SINDECOMU_SUPERMARKETS_2026_2027";
    useCurrent(cct);
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_CCT_HOLIDAY_REST", status: 422 });
    const extended = input(); extended.policy.compensationAuthorized = false;
    useCurrent(extended);
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_DAILY_EXTENSION_REQUIRED", status: 422 });
    expect(mocks.solve).not.toHaveBeenCalled();
  });
  it("does not misclassify unsupported non-worked holidays as a staffing impossibility", async () => {
    const holiday = input(); holiday.policy.holidayRestAllowed = false; holiday.policy.holidayDates = ["2026-10-28"];
    mocks.revision.findUnique.mockResolvedValue(version(holiday));
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ status: 422, code: "ESCALA_HOLIDAY_POLICY_REQUIRED" });
    expect(mocks.solve).not.toHaveBeenCalled();
  });
  it("never returns a hard-invalid solved proposal for application", async () => {
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: input().assignments.map((item) => ({ employeeId: item.employeeId, date: item.date, kind: "OFF" })), wallTimeSeconds: 0.1, message: "Resposta inconsistente" });
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
