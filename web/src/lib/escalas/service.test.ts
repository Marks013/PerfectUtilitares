import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaInput } from "./types";
import { assertRevision, createEscala, generateEscala, getEscala, listEscalas, parseEscalaInput, preserveLockedAssignments, saveEscala, suggestEscala } from "./service";
import { allowedBranches, branchPermission, escalaActor, requireEscalaPermission } from "./access";

const mocks = vi.hoisted(() => ({
  workspace: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  revision: { findUnique: vi.fn(), create: vi.fn() }, grants: { findUnique: vi.fn(), findMany: vi.fn() },
  audit: { create: vi.fn() }, transaction: vi.fn(), solve: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaWorkspace: mocks.workspace, escalaRevision: mocks.revision, escalaBranchAccess: mocks.grants, auditLog: mocks.audit, $transaction: mocks.transaction } }));
vi.mock("./solver-client", async (original) => ({ ...await original<typeof import("./solver-client")>(), solveEscala: mocks.solve }));
const actor = { tenantId: "company-a", userId: "user-a", admin: true };
const operator = { ...actor, admin: false };

function input(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "Instrumento validado no cenário", validFrom: "2026-01-01", validUntil: "2027-01-01", reviewed: true, reviewedBy: "Responsável", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 6, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false },
    employees: [{ id: "e1", registration: "0001", name: "Ana", sector: "Reposição", role: "Repositor", weeklyHours: 42, shiftIds: ["day"], activeFrom: "2026-10-26", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [5, 6], historyKnown: false, history: [] }],
    shifts: [{ id: "day", name: "Diurno", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
    demands: Array.from({ length: 7 }, (_, index) => ({ id: `d${index}`, date: new Date(Date.UTC(2026, 9, 26 + index)).toISOString().slice(0, 10), sector: "Reposição", start: 480, end: 720, minimum: index < 5 ? 1 : 0 })),
    assignments: Array.from({ length: 7 }, (_, index) => ({ employeeId: "e1", date: new Date(Date.UTC(2026, 9, 26 + index)).toISOString().slice(0, 10), kind: index < 5 ? "WORK" as const : "OFF" as const, ...(index < 5 ? { shiftId: "day" } : {}) })),
  };
}
function row(overrides = {}) { return { id: "w1", tenantId: actor.tenantId, branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", revision: 1, status: "DRAFT", updatedAt: new Date("2026-10-26T12:00:00Z"), ...overrides }; }
function version(value = input(), revision = 1, status = "DRAFT") { return { input: value, revision, status, createdAt: row().updatedAt }; }

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.findFirst.mockResolvedValue(row());
  mocks.workspace.findMany.mockResolvedValue([row()]);
  mocks.workspace.create.mockResolvedValue(row());
  mocks.workspace.updateMany.mockResolvedValue({ count: 1 });
  mocks.revision.findUnique.mockResolvedValue(version());
  mocks.grants.findMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ escalaWorkspace: mocks.workspace, escalaRevision: mocks.revision, auditLog: mocks.audit }));
  mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: input().assignments, wallTimeSeconds: 0.1, message: "Proposta viável" });
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
  it("limits individual suggestions to three complete joint solves, validating the requested pair", async () => {
    const result = await suggestEscala(actor, "w1", 1, "e1", input().startDate);
    expect(mocks.solve).toHaveBeenCalledTimes(2);
    expect(mocks.solve.mock.calls[0][1]).toEqual({ employeeId: "e1", weekStart: "2026-10-26", excludedOffPairs: [] });
    expect(mocks.solve.mock.calls[1][1].excludedOffPairs).toEqual([["2026-10-31", "2026-11-01"]]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ employeeId: "e1", offDates: ["2026-10-31", "2026-11-01"], status: "VALIDATED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects absent employees and incomplete weeks in suggestions", async () => {
    await expect(suggestEscala(actor, "w1", 1, "missing", input().startDate)).rejects.toMatchObject({ status: 400 });
    await expect(suggestEscala(actor, "w1", 1, "e1", "2026-10-27")).rejects.toMatchObject({ status: 400 });
    const current = await getEscala(actor, "w1");
    expect(() => assertRevision(current, 9)).toThrow(/versão/);
  });
  it("identifies incomplete setup before contacting the solver", async () => {
    const empty = input(); empty.employees = []; empty.assignments = [];
    mocks.revision.findUnique.mockResolvedValue(version(empty));
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ status: 422, code: "ESCALA_SETUP_REQUIRED" });
    await expect(suggestEscala(actor, "w1", 1, "e1", input().startDate)).rejects.toMatchObject({ status: 422 });
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
