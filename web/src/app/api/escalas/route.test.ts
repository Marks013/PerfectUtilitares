import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/auth";
import { EscalaError } from "@/lib/escalas/access";
import { EscalaSolverError } from "@/lib/escalas/solver-client";
import { DELETE, GET, PATCH, POST } from "./route";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";

const candidateDb = vi.hoisted(() => ({ row: vi.fn(), revision: vi.fn(), peers: vi.fn(), solver: vi.fn(), user: vi.fn(), policy: vi.fn(),
  updateWorkspace: vi.fn(), appendRevision: vi.fn(), appendAudit: vi.fn(), grants: vi.fn(), workforce: vi.fn(),
  findOperation: vi.fn(), updateOperation: vi.fn(), createOperation: vi.fn(), countOperation: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const db = { escalaWorkspace: { findFirst: candidateDb.row, findMany: candidateDb.peers, updateMany: candidateDb.updateWorkspace }, escalaRevision: { findUnique: candidateDb.revision, create: candidateDb.appendRevision },
    auditLog: { create: candidateDb.appendAudit }, escalaBranchAccess: { findMany: candidateDb.grants }, escalaWorkforce: { findUnique: candidateDb.workforce },
    user: { findFirst: candidateDb.user }, escalaModuleAccessPolicy: { findUnique: candidateDb.policy },
    escalaSolveOperation: { findFirst: candidateDb.findOperation, findUniqueOrThrow: candidateDb.findOperation, updateMany: candidateDb.updateOperation,
      create: candidateDb.createOperation, count: candidateDb.countOperation, findMany: vi.fn(async () => []), deleteMany: vi.fn() },
    $executeRaw: vi.fn(), $queryRaw: vi.fn() };
  return { prisma: { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) } };
});
vi.mock("@/lib/escalas/solver-client", async original => ({ ...await original<typeof import("@/lib/escalas/solver-client")>(), solveEscala: candidateDb.solver }));
vi.mock("@/lib/escalas/solver-transport", async original => {
  const crypto = await import("node:crypto");
  return { ...await original<typeof import("@/lib/escalas/solver-transport")>(), solverCapability: () => "synthetic-route-cancel-token",
    candidateReferenceSignature: (payload: string) => crypto.createHmac("sha256", "route-synthetic-receipt-key").update(payload).digest("hex") };
});

const mocks = vi.hoisted(() => ({ session: null as AppSession | null, createScope: null as string[] | null, list: vi.fn(), get: vi.fn(), read: vi.fn(), create: vi.fn(), upgrade: vi.fn(), save: vi.fn(), generate: vi.fn(), recheck: vi.fn(), remove: vi.fn(), removeEmployee: vi.fn(), changeAbsence: vi.fn(), rate: vi.fn(), module: vi.fn(), startOperation: vi.fn(), runOperation: vi.fn(), cancelOperation: vi.fn(), operationStatus: vi.fn() }));
vi.mock("@/lib/escalas/access", async original => ({ ...await original<typeof import("@/lib/escalas/access")>(),
  allowedBranches: async (actor: { admin: boolean }, capability?: string) => capability === "workspace.create" ? mocks.createScope : actor.admin ? null : ["02"] }));
vi.mock("@/lib/escalas/module-session", () => ({ getEscalaModuleSession: mocks.module }));
vi.mock("@/lib/escalas/operator-session-store", () => ({ getEscalaScopedModuleSession: async () => {
  const value = await mocks.module();
  return value ? { sessionId: value.id, principal: { tenantId: value.tenantId } } : null;
} }));
vi.mock("@/lib/escalas/solve-operations", () => ({ solveOwner: () => "session-owner", startGenerationOperation: mocks.startOperation, runGenerationOperation: mocks.runOperation, cancelGenerationOperation: mocks.cancelOperation, generationOperationStatus: mocks.operationStatus }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("next/headers", async (original) => ({
  ...await original<typeof import("next/headers")>(),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/api/security", async (original) => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.rate }));
vi.mock("@/lib/escalas/service", () => ({ listEscalas: mocks.list, getEscala: mocks.get, getEscalaForRead: mocks.read, createEscala: mocks.create, createEscalaApproved: mocks.create, createEscalaMonth: mocks.create, upgradeEscalaCalendar: mocks.upgrade,
  addEscalaEmployee: vi.fn(), removeEscalaEmployee: mocks.removeEmployee, changeEscalaAbsence: mocks.changeAbsence, rebaseEscalaApproval: vi.fn(), validateEscalaOperational: vi.fn(), saveEscala: mocks.save, generateEscala: mocks.generate, recheckEscalaGeneration: mocks.recheck, deleteEscala: mocks.remove, parseEscalaInput: (value: unknown) => value }));

const input = { branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01" };
const workspace = { id: "w1", revision: 1, status: "DRAFT", input, canEdit: true, canPublish: true };
const command = (body: unknown, headers: HeadersInit = { origin: "http://localhost", "content-type": "application/json" }) => new Request("http://localhost/api/escalas", { method: "POST", headers, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.recheck.mockReset();
  mocks.createScope = null;
  for (const operation of [mocks.startOperation, mocks.runOperation, mocks.cancelOperation, mocks.operationStatus]) operation.mockReset();
  mocks.session = { user: { id: "u1", tenantId: "t1", role: "ADMIN", status: "ACTIVE" }, expires: "2099" };
  mocks.list.mockResolvedValue([workspace]); mocks.get.mockResolvedValue(workspace); mocks.read.mockResolvedValue(workspace); mocks.create.mockResolvedValue(workspace); mocks.save.mockResolvedValue({ ...workspace, revision: 2 });
  mocks.generate.mockResolvedValue({ result: { status: "FEASIBLE" }, proposalInput: input, validation: { valid: true }, preparation: { adjustedEmployeeIds: [], excludedEmployeeIds: [], generatedCoverageSlots: 7, includedEmployees: 81, untimedEmployees: 12 } });
  mocks.rate.mockResolvedValue(null); mocks.module.mockResolvedValue(null);
  candidateDb.workforce.mockResolvedValue(null);
});

describe("/api/escalas", () => {
  it("synchronizes the global team into a new draft revision without rewriting a publication", async () => {
    const real = await vi.importActual<typeof import("@/lib/escalas/service")>("@/lib/escalas/service");
    mocks.read.mockImplementation(real.getEscalaForRead);
    const value = newInput("02", "Filial sintética", "2026-12", 42);
    const worker = { ...newEmployee(42), id: "worker", registration: "0012", name: "Pessoa sintética",
      activeFrom: "2026-12-01", role: "Caixa", sector: "Frente de Caixa", scheduleMode: "UNTIMED" as const };
    value.employees = [worker];
    const first = { input: structuredClone(value), revision: 1, status: "DRAFT", createdAt: new Date("2026-12-01") };
    const revisions = new Map([[1, first]]);
    let latest = { id: "w1", tenantId: "t1", branchCode: "02", branchName: value.branchName, startDate: value.startDate,
      endDate: value.endDate, status: "DRAFT", revision: 1, updatedAt: first.createdAt, workforceState: null as unknown };
    candidateDb.user.mockImplementation(async ({ where }) => ({ id: where.id, tenantId: where.tenantId, status: "ACTIVE", role: "ADMIN" }));
    candidateDb.policy.mockResolvedValue({ tenantId: "t1", mode: "ADMIN_ONLY", version: 1 });
    candidateDb.row.mockImplementation(async ({ where }) => where.id === latest.id && where.tenantId === latest.tenantId
      && (where.revision === undefined || where.revision === latest.revision) && (where.status === undefined || where.status === latest.status) ? latest : null);
    candidateDb.revision.mockImplementation(async ({ where }) => revisions.get(where.tenantId_workspaceId_revision.revision));
    candidateDb.peers.mockResolvedValue([]);
    candidateDb.workforce.mockResolvedValue({ revision: 5, snapshot: {
      version: 1, catalogs: [{ branchCode: "02", shifts: [] }],
      absences: [{ registration: "0012", startDate: "2026-12-08", endDate: "2026-12-08", source: "FPHI105" }],
      people: [{ branchCode: "02", dismissedFrom: null, employee: { ...worker, id: "global", role: "Operador de caixa" } }],
    } });
    candidateDb.updateWorkspace.mockImplementation(async ({ where, data }) => {
      if (where.revision !== latest.revision || where.status !== latest.status) return { count: 0 };
      latest = { ...latest, ...data };
      return { count: 1 };
    });
    candidateDb.appendRevision.mockImplementation(async ({ data }) => {
      revisions.set(data.revision, { ...data, createdAt: first.createdAt });
    });
    const sync = (expectedRevision: number) => POST(command({ action: "SYNC_WORKFORCE", id: "w1", expectedRevision }));
    const response = await sync(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 2, status: "DRAFT", workforce: { needsSync: false },
      input: { needsRegeneration: true, employees: [{ id: "worker", registration: "0012", role: "Operador de caixa" }],
        assignments: [{ employeeId: "worker", date: "2026-12-08", kind: "ABSENCE" }] } });
    expect(candidateDb.updateWorkspace).toHaveBeenCalledWith({ where: { id: "w1", tenantId: "t1", branchCode: "02", revision: 1, status: "DRAFT" },
      data: { revision: 2, workforceState: { baseRevision: 5, managedAbsenceKeys: [["worker", "2026-12-08"]], managedEmploymentEnds: [] } } });
    expect(candidateDb.appendRevision).toHaveBeenCalledTimes(1);
    expect(first.input).toEqual(value);
    const repeated = await sync(2);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ revision: 2 });
    expect(candidateDb.updateWorkspace).toHaveBeenCalledTimes(1);

    const updated = revisions.get(2);
    if (!updated) throw new Error("Expected synchronized draft");
    const published = { ...updated, status: "PUBLISHED", revision: 3 };
    latest = { ...latest, status: "PUBLISHED", revision: 3 };
    revisions.set(3, published);
    const denied = await sync(3);
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: { code: "ESCALA_REOPEN_REQUIRED" } });
    expect(candidateDb.appendRevision).toHaveBeenCalledTimes(1);
    expect(revisions.get(3)).toBe(published);
  });
  it("reopens the exact publication as a separately audited draft and rejects payload overrides", async () => {
    const publishedInput = newInput("02", "Filial sintética", "2026-12", 42);
    const snapshot = Object.freeze({ status: "PUBLISHED", input: publishedInput, approvedPolicyVersionId: null });
    mocks.get.mockResolvedValue({ ...workspace, input: publishedInput, status: "PUBLISHED", revision: 3, approvedPolicyVersionId: null });
    candidateDb.user.mockResolvedValue({ id: "u1", tenantId: "t1", status: "ACTIVE", role: "ADMIN", securityVersion: 1 });
    candidateDb.revision.mockResolvedValue(snapshot);
    candidateDb.updateWorkspace.mockResolvedValue({ count: 1 });
    const data = { action: "REOPEN_PUBLICATION", id: "w1", expectedRevision: 3 };
    const denied = await POST(command({ ...data, input: { branchCode: "07" } }));
    expect(denied.status).toBe(400);
    expect(candidateDb.updateWorkspace).not.toHaveBeenCalled();
    const response = await POST(command(data));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "DRAFT", revision: 4, input: publishedInput });
    expect(candidateDb.revision).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_workspaceId_revision: { tenantId: "t1", workspaceId: "w1", revision: 3 } },
    }));
    expect(candidateDb.updateWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "w1", tenantId: "t1", branchCode: "02", revision: 3, status: "PUBLISHED" },
    }));
    expect(candidateDb.appendRevision).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ status: "DRAFT", revision: 4, input: publishedInput }) });
    expect(candidateDb.appendAudit).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      action: "REOPEN_PUBLICATION", metadata: expect.objectContaining({ previousRevision: 3, revision: 4 }),
    }) });
    expect(snapshot.status).toBe("PUBLISHED");
  });

  it("denies reopening to a same-branch operator without publication permission", async () => {
    mocks.session = { user: { id: "planner", tenantId: "t1", role: "OPERATOR", status: "ACTIVE" }, expires: "2099" };
    candidateDb.user.mockResolvedValue({ id: "planner", tenantId: "t1", status: "ACTIVE", role: "OPERATOR", securityVersion: 1 });
    candidateDb.policy.mockResolvedValue({ tenantId: "t1", mode: "SCOPED" });
    candidateDb.grants.mockResolvedValue([{ tenantId: "t1", userId: "planner", branchCode: "02", role: "OPERATOR" }]);
    mocks.get.mockResolvedValue({ ...workspace, input: { ...input, branchCode: "02" }, status: "PUBLISHED", revision: 3 });
    const response = await POST(command({ action: "REOPEN_PUBLICATION", id: "w1", expectedRevision: 3 }));
    expect(response.status).toBe(403);
    expect(candidateDb.updateWorkspace).not.toHaveBeenCalled();
    expect(candidateDb.appendRevision).not.toHaveBeenCalled();
  });
  it.each([false, true])("derives creation availability from the current capability scope=%s", async allowed => {
    mocks.session = { user: { id: "planner", tenantId: "t1", role: "OPERATOR", status: "ACTIVE" }, expires: "2099" };
    mocks.createScope = allowed ? ["02"] : [];
    const response = await GET(new Request("http://localhost/api/escalas"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces: [workspace], canCreate: allowed });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("preserves explicit Sunday upgrade and refuses a stale source without SAVE", async () => {
    const upgraded = { ...workspace, id: "sunday-draft", input: { ...input, planningWeekStartsOn: "SUNDAY", planningCalendarSource: { workspaceId: "w1", revision: 1 } } };
    mocks.upgrade.mockResolvedValue(upgraded);
    const response = await POST(command({ action: "UPGRADE_CALENDAR", id: "w1", expectedRevision: 1 }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(upgraded);
    expect(mocks.upgrade).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", userId: "u1" }), "w1", 1);
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.upgrade.mockRejectedValue(new EscalaError(409, "ESCALA_STALE_REVISION", "A versão mudou."));
    expect((await POST(command({ action: "UPGRADE_CALENDAR", id: "w1", expectedRevision: 1 }))).status).toBe(409);
  });
  it.each(["direct", "job"] as const)("round-trips real service receipt and application proof through %s GENERATE and rejects tampering", async channel => {
    vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "synthetic-route-proposal-material-0000000");
    const value = newInput("02", "Synthetic", "2026-11", 42);
    value.startDate = "2026-11-02"; value.endDate = "2026-11-08"; delete value.visibleMonth;
    value.planningWeekStartsOn = "MONDAY";
    value.simulation = true; value.restRulesVersion = 2; value.policy.calendarMode = "MANUAL";
    value.shifts = [{ id: "day", name: "Day", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
    value.employees = [{ ...newEmployee(42, "day"), id: "a", registration: "a", name: "Synthetic", sector: "Store", role: "Operator", activeFrom: "2020-01-01" }];
    value.assignments = Array.from({ length: 7 }, (_, day) => ({ employeeId: "a", date: `2026-11-0${day + 2}`,
      ...([3, 6].includes(day) ? { kind: "OFF" as const } : { kind: "WORK" as const, shiftId: "day" }) }));
    value.demands = [];
    mocks.session = { user: { id: "u1", tenantId: "t1", role: "ADMIN", status: "ACTIVE" }, expires: "2099", escalaSessionId: "route-login" };
    candidateDb.user.mockImplementation(async ({ where }) => ({ id: where.id, tenantId: where.tenantId, status: "ACTIVE", role: "ADMIN", securityVersion: 1 }));
    candidateDb.policy.mockResolvedValue({ tenantId: "t1", mode: "ADMIN_ONLY", version: 1 });
    candidateDb.row.mockResolvedValue({ id: "w1", tenantId: "t1", branchCode: "02", branchName: "Synthetic", startDate: value.startDate, endDate: value.endDate, revision: 1, status: "DRAFT", updatedAt: new Date("2026-11-01") });
    candidateDb.revision.mockResolvedValue({ input: value, revision: 1, status: "DRAFT", createdAt: new Date("2026-11-01") });
    candidateDb.peers.mockResolvedValue([]);
    candidateDb.solver.mockImplementation(async context => ({ status: "FEASIBLE", assignments: context.assignments, wallTimeSeconds: 1, message: "Synthetic processor" }));
    type Operation = { id: string; tenantId: string; ownerKey: string; state: string; expiresAt: Date; workspaceId: string; expectedRevision: number };
    const operations: Operation[] = [];
    const matches = (entry: Operation, where: Record<string, unknown>) => Object.entries(where).every(([key, expected]) => {
      if (key === "expiresAt") return entry.expiresAt > (expected as { gt: Date }).gt;
      if (key === "state" && typeof expected === "object") return (expected as { in: string[] }).in.includes(entry.state);
      return entry[key as keyof Operation] === expected;
    });
    candidateDb.createOperation.mockImplementation(async ({ data }) => {
      const entry = { ...data, id: `4ea6210f-fb9a-449f-b6f4-${String(operations.length + 1).padStart(12, "0")}`, state: "CREATED" };
      operations.push(entry); return { ...entry };
    });
    candidateDb.findOperation.mockImplementation(async ({ where }) => {
      const entry = operations.find(item => matches(item, where)); return entry ? { ...entry } : null;
    });
    candidateDb.updateOperation.mockImplementation(async ({ where, data }) => {
      const entries = operations.filter(item => matches(item, where)); entries.forEach(item => { Object.assign(item, data); }); return { count: entries.length };
    });
    candidateDb.countOperation.mockImplementation(async ({ where }) => operations.filter(item => matches(item, where)).length);
    const real = await vi.importActual<typeof import("@/lib/escalas/service")>("@/lib/escalas/service");
    const jobs = await vi.importActual<typeof import("@/lib/escalas/solve-operations")>("@/lib/escalas/solve-operations");
    mocks.generate.mockImplementation(real.generateEscala); mocks.get.mockImplementation(real.getEscala);
    mocks.recheck.mockImplementation(real.recheckEscalaGeneration);
    mocks.startOperation.mockImplementation(jobs.startGenerationOperation); mocks.runOperation.mockImplementation(jobs.runGenerationOperation);
    const generate = async (comparisonReference?: unknown) => {
      let operationId: string | undefined;
      if (channel === "job") {
        const start = await POST(command({ action: "START_GENERATION", id: "w1", expectedRevision: 1 }));
        expect(start.status).toBe(201); operationId = (await start.json()).operationId;
      }
      return POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1, ...(operationId ? { operationId } : {}), ...(comparisonReference === undefined ? {} : { comparisonReference }) }));
    };
    try {
      const first = await generate(); expect(first.status).toBe(200);
      const initial = await first.json();
      expect(initial.validation.valid).toBe(true); expect(initial.candidateReceipt.signature).toMatch(/^[a-f0-9]{64}$/);
      expect(initial.proposalProof).toEqual(expect.any(String));
      const second = await generate({ input: initial.proposalInput, receipt: initial.candidateReceipt });
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ comparison: { admission: "ADMITTED" }, validation: { valid: true }, proposalProof: expect.any(String) });
      const altered = structuredClone(initial.proposalInput); altered.shifts[0].segments[0].start++;
      candidateDb.solver.mockClear();
      const rejected = await generate({ input: altered, receipt: initial.candidateReceipt });
      expect(rejected.status).toBe(400); expect(await rejected.json()).toMatchObject({ error: { code: "ESCALA_COMPARISON_REFERENCE_INVALID" } });
      expect(candidateDb.solver).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.recheck).toHaveBeenCalledTimes(channel === "job" ? 2 : 0);
      if (channel === "job") expect(mocks.recheck).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ tenantId: "t1", userId: "u1", accountSessionId: "route-login" }), "w1", 1);
      if (channel === "job") expect(JSON.stringify(operations)).not.toMatch(/candidateReceipt|comparisonReference|proposalProof|cancelToken/);
    } finally { vi.unstubAllEnvs(); }
  });

  it("returns a saved REST_ONLY scenario and generates that persisted mode without hiding it in exports", async () => {
    const restInput = { ...input, generationMode: "REST_ONLY" };
    mocks.save.mockResolvedValue({ ...workspace, revision: 2, input: restInput });
    const saved = await POST(command({ action: "SAVE", id: "w1", expectedRevision: 1, input: restInput }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ revision: 2, input: restInput });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 1, restInput);
    mocks.generate.mockResolvedValue({ result: { status: "FEASIBLE" }, proposalInput: restInput });
    const generated = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 2 }));
    expect(generated.status).toBe(200);
    expect(await generated.json()).toMatchObject({ result: { status: "FEASIBLE" }, proposalInput: restInput });
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 2, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("starts, solves, queries and cancels a session-owned operation through functional responses", async () => {
    const operationId = "4ea6210f-fb9a-449f-b6f4-413b3c79ec05";
    mocks.startOperation.mockResolvedValue({ operationId, state: "CREATED" });
    mocks.runOperation.mockResolvedValue({ result: { status: "FEASIBLE" }, proposalInput: input });
    mocks.cancelOperation.mockResolvedValue({ operationId, state: "CANCELLED" });
    mocks.operationStatus.mockResolvedValue({ operationId, state: "CANCELLED" });
    const start = await POST(command({ action: "START_GENERATION", id: "w1", expectedRevision: 1 }));
    expect(start.status).toBe(201); expect(await start.json()).toEqual({ operationId, state: "CREATED" });
    const generated = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1, operationId }));
    expect(generated.status).toBe(200); expect(await generated.json()).toMatchObject({ result: { status: "FEASIBLE" } });
    expect(mocks.runOperation).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "session-owner", operationId, "w1", 1, expect.any(AbortSignal));
    const cancel = await POST(command({ action: "CANCEL_GENERATION", operationId }));
    expect(cancel.status).toBe(200); expect(await cancel.json()).toEqual({ operationId, state: "CANCELLED" });
    expect(mocks.rate).toHaveBeenLastCalledWith(expect.any(Request), expect.objectContaining({ keyPrefix: "escalas-control", limit: 90 }));
    const status = await POST(command({ action: "GENERATION_STATUS", operationId }));
    expect(status.status).toBe(200); expect(await status.json()).toMatchObject({ state: "CANCELLED" });
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.cancelOperation.mockRejectedValue(new EscalaError(404, "ESCALA_OPERATION_NOT_FOUND", "Cálculo não disponível."));
    expect((await POST(command({ action: "CANCEL_GENERATION", operationId }))).status).toBe(404);
  });

  it("deletes the selected private revision and reports safe failures", async () => {
    const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/escalas", { method: "DELETE", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    mocks.remove.mockResolvedValue({ deletedId: "w1" });
    const response = await DELETE(request({ workspaceId: "w1", expectedRevision: 1 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ deletedId: "w1" });
    expect(mocks.remove).toHaveBeenCalledWith({ userId: "u1", tenantId: "t1", admin: true }, "w1", 1);
    expect((await DELETE(request({ workspaceId: "w1", expectedRevision: 0 }))).status).toBe(400);
    expect((await DELETE(request({ workspaceId: "w1", expectedRevision: 1 }, "https://foreign.test"))).status).toBe(403);
    mocks.remove.mockRejectedValue(new EscalaError(409, "ESCALA_DELETE_DEPENDENCY", "Outra proposta depende deste período."));
    expect((await DELETE(request({ workspaceId: "w1", expectedRevision: 1 }))).status).toBe(409);
    mocks.session = null;
    expect((await DELETE(request({ workspaceId: "w1", expectedRevision: 1 }))).status).toBe(401);
  });
  it("lists private tenant-scoped workspaces and gets an authorized workspace", async () => {
    const response = await GET(new Request("http://localhost/api/escalas"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ workspaces: [workspace], canCreate: true });
    expect(mocks.list).toHaveBeenCalledWith({ userId: "u1", tenantId: "t1", admin: true });
    expect((await GET(new Request("http://localhost/api/escalas?id=w1"))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("uses consultation only for the nominal GET and keeps mutation loading strict", async () => {
    mocks.session = null;
    mocks.module.mockResolvedValue({ id: "module-1", tenantId: "company", expiresAt: new Date("2030-01-01") });
    const branchActor = { userId: null, tenantId: "company", admin: false, moduleSessionId: "module-1" };
    const draft = { ...workspace, canEdit: false, canPublish: false, approvedPolicyVersionId: null };
    mocks.read.mockResolvedValueOnce(draft).mockRejectedValueOnce(new EscalaError(403, "ESCALA_BRANCH_FORBIDDEN", "Filial não autorizada."));
    const response = await GET(new Request("http://localhost/api/escalas?id=w1&tenantId=foreign"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject(draft);
    expect(mocks.read).toHaveBeenNthCalledWith(1, branchActor, "w1");
    const denied = await GET(new Request("http://localhost/api/escalas?id=other-branch"));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "ESCALA_BRANCH_FORBIDDEN" } });
    expect(mocks.read).toHaveBeenNthCalledWith(2, branchActor, "other-branch");
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.get.mockRejectedValueOnce(new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Aprovação necessária."));
    expect((await POST(command({ action: "PUBLISH", id: "w1", expectedRevision: 1 }))).status).toBe(409);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(branchActor, "w1");
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("creates, saves and publishes through versioned services", async () => {
    expect((await POST(command({ action: "CREATE", input }))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), input);
    expect((await POST(command({ action: "SAVE", id: "w1", expectedRevision: 1, input }))).status).toBe(200);
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 1, input);
    expect((await POST(command({ action: "PUBLISH", id: "w1", expectedRevision: 1 }))).status).toBe(200);
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 1, input, true);
  });
  it("returns the whole-branch generation preview and preparation summary without an implicit save", async () => {
    const generated = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }));
    expect(generated.status).toBe(200);
    expect(await generated.json()).toMatchObject({ result: { status: "FEASIBLE" }, preparation: { includedEmployees: 81, untimedEmployees: 12, generatedCoverageSlots: 7 } });
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 1, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.rate).toHaveBeenCalledWith(expect.any(Request), { keyPrefix: "escalas-solver", limit: 6, windowMs: 120_000 });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("denies unauthenticated sessions, missing tenants and foreign origins", async () => {
    mocks.session = null;
    expect((await GET(new Request("http://localhost/api/escalas"))).status).toBe(401);
    mocks.session = { user: { id: "u1", role: "ADMIN", status: "ACTIVE" }, expires: "2099" };
    expect((await GET(new Request("http://localhost/api/escalas"))).status).toBe(403);
    expect((await POST(command({ action: "CREATE", input }, { origin: "https://foreign.test", "content-type": "application/json" }))).status).toBe(403);
    expect((await POST(command({ action: "CREATE", input }, { "content-type": "application/json" }))).status).toBe(403);
  });
  it("rejects malformed commands, unknown options and invalid IDs", async () => {
    expect((await POST(command({ action: "SUGGEST", id: "w1", expectedRevision: 1, employeeId: "e1", weekStart: "2026-10-26" }))).status).toBe(400);
    expect((await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1, employeeId: "e1" }))).status).toBe(400);
    expect((await POST(command({ action: "SAVE", id: "w1", expectedRevision: 0, input }))).status).toBe(400);
    expect((await POST(command({ action: "CREATE", tenantId: "foreign", input }))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/escalas?id="))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/escalas", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: "{" }))).status).toBe(400);
  });
  it("preserves concurrency and solver availability errors with actionable status", async () => {
    mocks.save.mockRejectedValue(new EscalaError(409, "ESCALA_STALE_REVISION", "A versão mudou."));
    expect((await POST(command({ action: "SAVE", id: "w1", expectedRevision: 1, input }))).status).toBe(409);
    mocks.generate.mockRejectedValue(new EscalaSolverError("SOLVER_BUSY"));
    expect((await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }))).status).toBe(429);
    mocks.generate.mockRejectedValue(new EscalaSolverError("SOLVER_UNAVAILABLE"));
    expect((await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }))).status).toBe(503);
    mocks.generate.mockRejectedValue(new EscalaSolverError("SOLVER_INVALID_INPUT"));
    const invalid = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "SOLVER_INVALID_INPUT" } });
    mocks.generate.mockRejectedValue(new EscalaSolverError("SOLVER_UNSUPPORTED_INPUT"));
    const unsupported = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }));
    expect(unsupported.status).toBe(503);
    expect(await unsupported.json()).toMatchObject({ error: { code: "SOLVER_UNSUPPORTED_INPUT" } });
    mocks.generate.mockRejectedValue(new EscalaSolverError("SOLVER_INTERNAL_ERROR"));
    expect((await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }))).status).toBe(500);
    mocks.generate.mockRejectedValue(new EscalaSolverError("SOLVER_INPUT_TOO_LARGE"));
    const oversized = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "SOLVER_INPUT_TOO_LARGE" } });
    mocks.create.mockRejectedValue({ code: "P2002" });
    expect((await POST(command({ action: "CREATE", input }))).status).toBe(409);
  });
  it("honors limits and method contracts", async () => {
    mocks.rate.mockResolvedValue(Response.json({ error: "limit" }, { status: 429, headers: { "Retry-After": "73" } }));
    expect((await POST(command({ action: "CREATE", input }))).status).toBe(429);
    const generation = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }));
    expect(generation.status).toBe(429);
    expect(generation.headers.get("Retry-After")).toBe("73");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(PATCH().headers.get("allow")).toBe("GET, POST, DELETE");
  });
});

it("uses a verified module company for successful query/create/save/generate, ignoring client scope attempts", async () => {
  mocks.session = null; mocks.module.mockResolvedValue({ id: "module-1", tenantId: "default-company", expiresAt: new Date("2030-01-01") });
  const actor = { userId: null, tenantId: "default-company", admin: false, moduleSessionId: "module-1" };
  const listing = await GET(new Request("http://localhost/api/escalas?tenantId=foreign"));
  expect(listing.status).toBe(200); expect(await listing.json()).toMatchObject({ canCreate: true }); expect(mocks.list).toHaveBeenLastCalledWith(actor);
  expect((await POST(command({ action: "CREATE_APPROVED", approvedPolicyVersionId: "approval" }))).status).toBe(201); expect(mocks.create).toHaveBeenLastCalledWith(actor, "approval");
  expect((await POST(command({ action: "SAVE", id: "w1", expectedRevision: 1, input }))).status).toBe(200); expect(mocks.save).toHaveBeenLastCalledWith(actor, "w1", 1, input);
  expect((await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }))).status).toBe(200); expect(mocks.generate).toHaveBeenLastCalledWith(actor, "w1", 1, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it("removes a collaborator through the scoped revision action and returns the saved workspace", async () => {
  mocks.session = null;
  mocks.module.mockResolvedValue({ id: "module-1", tenantId: "default-company", expiresAt: new Date("2030-01-01") });
  const saved = { ...workspace, revision: 2 };
  mocks.removeEmployee.mockResolvedValueOnce(saved);
  const data = { action: "REMOVE_EMPLOYEE", id: "w1", expectedRevision: 1, employeeId: "p1" };

  const result = await POST(command(data));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(saved);
  expect(mocks.removeEmployee).toHaveBeenCalledWith(
    { userId: null, tenantId: "default-company", admin: false, moduleSessionId: "module-1" }, "w1", 1, "p1");
  expect((await POST(command({ ...data, branchCode: "07" }))).status).toBe(400);
  expect(mocks.removeEmployee).toHaveBeenCalledTimes(1);
});

it("accepts the month command from a verified nominal session without accepting a caller-supplied policy", async () => {
  mocks.session = null;
  mocks.module.mockResolvedValue({ id: "module-1", tenantId: "default-company", expiresAt: new Date("2030-01-01") });
  const data = { action: "CREATE_MONTH", branchCode: "07", month: "2027-01" };
  const created = await POST(command(data));
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual(workspace);
  expect(mocks.create).toHaveBeenCalledWith({ userId: null, tenantId: "default-company", admin: false, moduleSessionId: "module-1" }, "07", "2027-01");
  mocks.create.mockResolvedValueOnce({ ...workspace, openedExisting: true });
  expect((await POST(command(data))).status).toBe(200);
  expect((await POST(command({ ...data, approvedPolicyVersionId: "forged" }))).status).toBe(400);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});

it.each(["ADD_ABSENCE", "REMOVE_ABSENCE"] as const)("persists %s as a revisioned scoped absence action", async action => {
  mocks.session = null;
  mocks.module.mockResolvedValue({ id: "module-1", tenantId: "default-company", expiresAt: new Date("2030-01-01") });
  const dates = { employeeId: "p1", startDate: "2026-12-01", endDate: "2026-12-04" };
  const saved = { ...workspace, revision: 2, input: { ...input, assignments: [], needsRegeneration: true } };
  mocks.changeAbsence.mockResolvedValueOnce(saved);
  const body = { action, id: "w1", expectedRevision: 1, ...dates };
  const response = await POST(command(body));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(saved);
  expect(mocks.changeAbsence).toHaveBeenCalledExactlyOnceWith(
    { userId: null, tenantId: "default-company", admin: false, moduleSessionId: "module-1" }, "w1", 1, { action, ...dates },
  );
  for (const invalid of [{ ...body, endDate: "2026-12-32" }, { ...body, tenantId: "other" }, { ...body, absenceSource: "MANUAL" }]) {
    expect((await POST(command(invalid))).status).toBe(400);
  }
  expect(mocks.changeAbsence).toHaveBeenCalledTimes(1);
});
