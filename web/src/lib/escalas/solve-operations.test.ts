import { beforeEach, describe, expect, it, vi } from "vitest";
import { solveOwner, startGenerationOperation, runGenerationOperation, cancelGenerationOperation, generationOperationStatus } from "./solve-operations";
import { EscalaError, requireEscalaCapability, type EscalaActor } from "./access";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { buildEscalaApprovedPolicy } from "./approved-policy";
import { EscalaSolverError } from "./solver-errors";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), get: vi.fn(), generate: vi.fn(), recheck: vi.fn(), cancel: vi.fn() }));
const authorization = vi.hoisted(() => ({
  workspace: vi.fn(), branch: vi.fn(), revision: vi.fn(), approval: vi.fn(), policy: vi.fn(), session: vi.fn(), user: vi.fn(), grants: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/prisma", () => {
  const db = {
    escalaSolveOperation: mocks,
    escalaWorkspace: { findFirst: authorization.workspace },
    escalaWorkforce: { findUnique: async () => null },
    escalaBranchAccess: { findUnique: authorization.branch, findMany: authorization.grants },
    escalaRevision: { findUnique: authorization.revision },
    escalaBranchPolicyVersion: { findFirst: authorization.approval },
    escalaModuleAccessPolicy: { findUnique: authorization.policy },
    escalaModuleSession: { findFirst: authorization.session },
    user: { findFirst: authorization.user },
    $executeRaw: authorization.lock, $queryRaw: vi.fn(),
  };
  return { prisma: { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) } };
});
vi.mock("./service", () => ({ getEscala: mocks.get, generateEscala: mocks.generate, recheckEscalaGeneration: mocks.recheck }));
vi.mock("./solver-transport", async original => ({ ...await original<typeof import("./solver-transport")>(), solverCapability: () => "private-capability", cancelSolverOperation: mocks.cancel }));
const actor: EscalaActor = { userId: null, tenantId: "t1", admin: false, moduleSessionId: "s1" };
const operationId = "4ea6210f-fb9a-449f-b6f4-413b3c79ec05";
type Row = { id: string; tenantId: string; workspaceId: string; expectedRevision: number; ownerKey: string; state: string; expiresAt: Date; finishedAt?: Date };
let row: Row;
function matches(where: Record<string, unknown>, record: Row = row) {
  for (const [key, value] of Object.entries(where)) {
    const current = record[key as keyof Row];
    if ((key === "state" || key === "id") && typeof value === "object") { if (!(value as { in: string[] }).in.includes(String(current))) return false; }
    else if (key === "expiresAt" && typeof value === "object") {
      const comparison = value as { gt?: Date; lt?: Date; lte?: Date };
      if (comparison.gt && record.expiresAt <= comparison.gt
        || comparison.lt && record.expiresAt >= comparison.lt
        || comparison.lte && record.expiresAt > comparison.lte) return false;
    } else if (current !== value) return false;
  }
  return true;
}

function pauseAtBoundary() {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { reached, release, wait: async () => { entered(); await released; } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.recheck.mockResolvedValue(undefined);
  row = { id: operationId, tenantId: "t1", workspaceId: "w1", expectedRevision: 1, ownerKey: "owner", state: "CREATED", expiresAt: new Date(Date.now() + 120_000) };
  mocks.get.mockResolvedValue({ id: "w1", revision: 1, canEdit: true, input: { branchCode: "02" } });
  authorization.policy.mockResolvedValue({ tenantId: "t1", mode: "SCOPED", version: 1 });
  authorization.user.mockResolvedValue({ id: "u1", tenantId: "t1", status: "ACTIVE", role: "OPERATOR" });
  authorization.grants.mockImplementation(async () => {
    const grant = await authorization.branch();
    return grant ? [{ tenantId: "t1", userId: "u1", branchCode: "02", role: grant.role }] : [];
  });
  authorization.session.mockImplementation(async () => {
    const grant = await authorization.branch();
    return { id: "s1", tenantId: "t1", operatorId: "o", permissionVersion: 1, accessPolicyVersion: 1,
      createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60000), revokedAt: null,
      operator: { id: "o", tenantId: "t1", active: true, permissionVersion: 1,
        branchGrants: grant ? [{ tenantId: "t1", operatorId: "o", branchCode: "02", active: true,
          capabilities: ["workspace.read", "workspace.save", "schedule.generate"] }] : [] } };
  });
  authorization.workspace.mockImplementation(async ({ where }) =>
    where.id === "w1" && where.tenantId === "t1" ? { branchCode: "02" } : null,
  );
  authorization.branch.mockResolvedValue({ role: "PLANNER" });
  authorization.revision.mockRejectedValue(new Error("Revision must not be loaded by control requests"));
  mocks.findFirst.mockImplementation(async ({ where }) => matches(where) ? { ...row } : null);
  mocks.findUniqueOrThrow.mockImplementation(async () => ({ ...row }));
  mocks.create.mockImplementation(async ({ data }) => ({ ...row, ...data }));
  mocks.updateMany.mockImplementation(async ({ where, data }) => { const count = Number(matches(where)); if (count) Object.assign(row, data); return { count }; });
  mocks.findMany.mockResolvedValue([]); mocks.count.mockResolvedValue(0);
  authorization.lock.mockResolvedValue(0);
  mocks.cancel.mockResolvedValue("CANCELLED"); mocks.generate.mockResolvedValue({ result: { status: "FEASIBLE" } });
});

function approvedGenerationFixture() {
  const value = newInput("02", "Synthetic completion", "2026-11", 42);
  value.startDate = "2026-11-02"; value.endDate = "2026-11-08"; delete value.visibleMonth;
  value.planningWeekStartsOn = "MONDAY";
  Object.assign(value.policy, { source: "Synthetic approval", reviewed: true, reviewedBy: "Synthetic admin", compensationAuthorized: true, calendarMode: "MANUAL" });
  value.shifts = [{ id: "day", name: "Synthetic", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  value.employees = [{ ...newEmployee(42, "day"), id: "e1", registration: "1", name: "Synthetic", sector: "Store", role: "Operator", activeFrom: value.startDate, scheduleMode: "TIMED" }];
  value.assignments = []; value.demands = [];
  const built = buildEscalaApprovedPolicy({ input: value, version: 1,
    provenance: { tenantId: "t1", approvedById: "synthetic-admin", approvedAt: "2026-11-20T12:00:00.000Z", origin: null },
    selectedSeedAssignments: [], regimeModelSelections: [{ id: "model", label: "Approved", employeeId: "e1" }] });
  if (!built.ok) throw new Error("Invalid completion approval fixture");
  const approval = { ...built.value, id: "approval", approvedAt: new Date(built.value.approvedAt), revokedAt: null as Date | null };
  authorization.approval.mockImplementation(async ({ where }) => where.tenantId === "t1" && where.id === approval.id ? { ...approval } : null);
  return { approval, value };
}

function authorizeStartGeneration(canEdit = true) {
  const { approval, value } = approvedGenerationFixture();
  mocks.get.mockResolvedValue({ id: "w1", revision: 1, status: "DRAFT", canEdit, approvedPolicyVersionId: approval.id, input: value });
  return approval;
}

async function completionAuthorization() {
  const { approval, value } = approvedGenerationFixture();
  const session = await authorization.session();
  authorization.session.mockImplementation(async () => structuredClone(session));
  let revision = 1;
  authorization.workspace.mockImplementation(async ({ where }) => where.id === "w1" && where.tenantId === "t1"
    ? { id: "w1", tenantId: "t1", branchCode: "02", branchName: value.branchName, startDate: value.startDate, endDate: value.endDate,
      revision, status: "DRAFT", updatedAt: new Date("2026-11-20T12:00:00.000Z") } : null);
  authorization.revision.mockImplementation(async ({ where }) => ({ input: value, revision: where.tenantId_workspaceId_revision.revision,
    status: "DRAFT", createdAt: new Date("2026-11-20T12:00:00.000Z"), approvedPolicyVersionId: approval.id }));
  const actual = await vi.importActual<typeof import("./service")>("./service");
  mocks.recheck.mockImplementation(async (currentActor: EscalaActor, id: string, expectedRevision: number) => {
    expect(row.state).toBe("COMPLETED");
    return actual.recheckEscalaGeneration(currentActor, id, expectedRevision);
  });
  const proposal = (status: "FEASIBLE" | "INFEASIBLE") => ({ result: { status, assignments: [], wallTimeSeconds: 1, message: "Synthetic terminal result" },
    proposalInput: structuredClone(value), validation: { valid: status === "FEASIBLE", issues: [] },
    ...(status === "FEASIBLE" ? { proposalProof: "synthetic-opaque-proof", candidateReceipt: { synthetic: true } } : {}) });
  return { approval, session, proposal, currentRevision: () => revision, advanceRevision: () => { revision = 2; } };
}

describe("generation operation ownership and atomic lifecycle", () => {
  it.each((["FEASIBLE", "INFEASIBLE"] as const).flatMap(status => (["approval", "revision"] as const).map(change => ({ status, change }))))
    ("withholds $status when $change changes during completion using the real final guard", async ({ status, change }) => {
      const fixture = await completionAuthorization();
      const proposal = fixture.proposal(status);
      mocks.generate.mockResolvedValueOnce(proposal);
      const boundary = pauseAtBoundary();
      const update = mocks.updateMany.getMockImplementation();
      if (!update) throw new Error("Missing persistence fixture");
      mocks.updateMany.mockImplementation(async args => {
        const result = await update(args);
        if (args.data.state === "COMPLETED") await boundary.wait();
        return result;
      });
      let delivered = false;
      const pending = runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)
        .then(result => { delivered = true; return result; });
      const rejection = expect(pending).rejects.toMatchObject({ status: 409,
        code: change === "approval" ? "ESCALA_CONFIG_REVOKED" : "ESCALA_STALE_REVISION" });
      await boundary.reached;
      expect(row.state).toBe("COMPLETED");
      expect(delivered).toBe(false);
      if (change === "approval") fixture.approval.revokedAt = new Date();
      else fixture.advanceRevision();
      boundary.release(); await rejection;
      expect(delivered).toBe(false);
      expect(fixture.session.revokedAt).toBeNull();
      expect(fixture.currentRevision()).toBe(change === "approval" ? 1 : 2);
      expect(row.state).toBe("COMPLETED");
      expect(mocks.recheck).toHaveBeenCalledExactlyOnceWith(actor, "w1", 1);
      // The failed delivery cannot rewrite the completed lifecycle through a RUNNING-only CAS.
      expect(mocks.updateMany.mock.calls.some(([args]) => args.data.state === "FAILED")).toBe(false);
      expect(mocks.generate).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain("synthetic-opaque-proof");
    });

  it.each(["FEASIBLE", "INFEASIBLE"] as const)("returns the unchanged authorized %s result only after completion and the real final guard", async status => {
    const fixture = await completionAuthorization();
    fixture.session.operator.branchGrants[0].capabilities = ["workspace.read", "schedule.generate"];
    const proposal = fixture.proposal(status);
    mocks.generate.mockResolvedValueOnce(proposal);
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).resolves.toBe(proposal);
    expect(row.state).toBe("COMPLETED");
    expect(mocks.recheck).toHaveBeenCalledExactlyOnceWith(actor, "w1", 1);
    expect(authorization.approval).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "t1", id: "approval" } }));
    expect(fixture.session.revokedAt).toBeNull();
    expect(fixture.currentRevision()).toBe(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it.each(["FEASIBLE", "INFEASIBLE"] as const)("marks FAILED when the service refuses %s before COMPLETED", async () => {
    mocks.generate.mockRejectedValueOnce(new EscalaError(409, "ESCALA_CONFIG_REVOKED", "Synthetic revoked approval"));
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal))
      .rejects.toMatchObject({ status: 409, code: "ESCALA_CONFIG_REVOKED" });
    expect(row.state).toBe("FAILED");
    expect(mocks.updateMany.mock.calls.some(([args]) => args.data.state === "COMPLETED")).toBe(false);
    expect(mocks.recheck).not.toHaveBeenCalled();
  });
  it("carries the prior candidate to the service without saving a snapshot in operation state", async () => {
    const reference = { input: { synthetic: true }, receipt: { synthetic: true } };
    const signal = new AbortController().signal;
    await runGenerationOperation(actor, "owner", operationId, "w1", 1, signal, reference);
    expect(mocks.generate).toHaveBeenCalledWith(actor, "w1", 1, expect.objectContaining({ signal, comparisonReference: reference }));
    expect(mocks.updateMany.mock.calls.every(([args]) => !JSON.stringify(args.data).includes("synthetic"))).toBe(true);
    expect(row.state).toBe("COMPLETED");
  });
  it("does not reserve a generation slot for a published workspace", async () => {
    mocks.get.mockResolvedValue({ id: "w1", revision: 1, status: "PUBLISHED", input: { branchCode: "02" } });
    await expect(startGenerationOperation(actor, "owner", "w1", 1)).rejects.toMatchObject({ code: "ESCALA_REOPEN_REQUIRED" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["complete", "cancel"] as const)("allows generation-only access to start and %s its operation without SAVE", async action => {
    const session = await authorization.session();
    session.operator.branchGrants[0].capabilities = ["workspace.read", "schedule.generate"];
    authorization.session.mockImplementation(async () => structuredClone(session));
    authorizeStartGeneration(false);
    for (const capability of ["workspace.save", "schedule.apply"] as const) {
      await expect(requireEscalaCapability(actor, capability, "02")).rejects.toMatchObject({ status: 403, code: "ESCALA_ACTION_FORBIDDEN" });
    }
    await expect(startGenerationOperation(actor, "owner", "w1", 1)).resolves.toMatchObject({ operationId, state: "CREATED" });
    await expect(generationOperationStatus(actor, "owner", operationId)).resolves.toMatchObject({ state: "CREATED" });
    if (action === "complete") {
      const proposal = { result: { status: "FEASIBLE" }, proposalInput: { synthetic: "preview" }, proposalProof: "synthetic-service-proof" };
      mocks.generate.mockResolvedValueOnce(proposal);
      await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).resolves.toEqual(proposal);
      await expect(generationOperationStatus(actor, "owner", operationId)).resolves.toMatchObject({ state: "COMPLETED" });
      expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(actor, "w1", 1, expect.objectContaining({ operationId, signal: expect.any(AbortSignal) }));
    } else {
      await expect(cancelGenerationOperation(actor, "owner", operationId)).resolves.toMatchObject({ state: "CANCELLED" });
      expect(mocks.generate).not.toHaveBeenCalled();
    }
    expect(authorization.revision).not.toHaveBeenCalled();
  });

  it.each(["revoked-session", "policy-version", "workspace-revision"] as const)("rechecks %s after waiting for the initial access lock", async change => {
    const session = await authorization.session();
    authorization.session.mockImplementation(async () => structuredClone(session));
    const boundary = pauseAtBoundary();
    authorization.lock.mockImplementationOnce(boundary.wait);
    const pending = startGenerationOperation(actor, "owner", "w1", 1);
    const rejection = expect(pending).rejects.toMatchObject(change === "workspace-revision"
      ? { status: 409, code: "ESCALA_REVISION_CONFLICT" }
      : { status: 401, code: "ESCALA_ACCESS_REQUIRED" });
    await boundary.reached;
    expect(mocks.create).not.toHaveBeenCalled();
    if (change === "revoked-session") session.revokedAt = new Date();
    else if (change === "policy-version") authorization.policy.mockResolvedValue({ tenantId: "t1", mode: "SCOPED", version: 2 });
    else authorization.workspace.mockImplementation(async ({ where }) => where.id === "w1" && where.tenantId === "t1"
      && (where.revision === undefined || where.revision === 2) ? { revision: 2, branchCode: "02" } : null);
    boundary.release();
    await rejection;
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(["processing", "completion", "final-read"] as const)("withholds the proposal after access is revoked during %s", async point => {
    const session = await authorization.session();
    authorization.session.mockImplementation(async () => structuredClone(session));
    const boundary = pauseAtBoundary();
    if (point === "processing") mocks.generate.mockImplementationOnce(async () => {
      await boundary.wait();
      return { result: { status: "FEASIBLE" } };
    });
    if (point === "completion") {
      const update = mocks.updateMany.getMockImplementation();
      if (!update) throw new Error("The persistence fixture must be configured");
      mocks.updateMany.mockImplementation(async args => {
        const result = await update(args);
        if (args.data.state === "COMPLETED") await boundary.wait();
        return result;
      });
    }
    if (point === "final-read") {
      const find = mocks.findFirst.getMockImplementation();
      if (!find) throw new Error("The ownership fixture must be configured");
      mocks.findFirst.mockImplementation(async args => {
        if (row.state === "COMPLETED") await boundary.wait();
        return find(args);
      });
    }
    let delivered = false;
    const pending = runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)
      .then(result => { delivered = true; return result; });
    const rejection = expect(pending).rejects.toMatchObject({ status: 401, code: "ESCALA_ACCESS_REQUIRED" });
    await boundary.reached;
    session.revokedAt = new Date();
    boundary.release();
    await rejection;
    expect(delivered).toBe(false);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    // Completion is metadata only. Revocation must deny delivery and later reads,
    // without pretending the simulated transaction rolls back a completed job.
    expect(row.state).toBe("COMPLETED");
    await expect(generationOperationStatus(actor, "owner", operationId)).rejects.toMatchObject({ status: 401 });
    await expect(cancelGenerationOperation(actor, "owner", operationId)).rejects.toMatchObject({ status: 401 });
  });

  it("cleans only its owner's expired operations and cannot query or cancel another owner's row", async () => {
    authorizeStartGeneration();
    const old = new Date(Date.now() - 2 * 86_400_000);
    const foreignId = "b5986455-f36b-440e-b1be-015ab98ab028";
    const rows: Row[] = [
      { ...row, expiresAt: new Date(Date.now() - 1_000) },
      { ...row, id: "116842b6-5ea2-43a4-b729-23b713dce76b", state: "COMPLETED", expiresAt: old },
      { ...row, id: foreignId, ownerKey: "another-owner", state: "COMPLETED", expiresAt: old },
      { ...row, id: "710e2784-20bc-432c-bc92-48a60b97928e", ownerKey: "another-owner", state: "RUNNING", expiresAt: old },
      { ...row, id: "dbd1c9e0-f43f-4038-93db-acf5542d2052", tenantId: "t2", state: "COMPLETED", expiresAt: old },
    ];
    const protectedRows = structuredClone(rows.slice(2));
    mocks.findFirst.mockImplementation(async ({ where }) => {
      const found = rows.find(value => matches(where, value));
      return found ? { ...found } : null;
    });
    mocks.updateMany.mockImplementation(async ({ where, data }) => {
      const selected = rows.filter(value => matches(where, value));
      selected.forEach(value => { Object.assign(value, data); });
      return { count: selected.length };
    });
    mocks.findMany.mockImplementation(async ({ where }) => rows.filter(value => matches(where, value)).map(value => ({ id: value.id })));
    mocks.deleteMany.mockImplementation(async ({ where }) => {
      const selected = rows.filter(value => matches(where, value));
      selected.forEach(value => { rows.splice(rows.indexOf(value), 1); });
      return { count: selected.length };
    });
    await expect(startGenerationOperation(actor, "owner", "w1", 1)).resolves.toMatchObject({ state: "CREATED" });
    expect(rows.map(value => value.id)).toEqual([operationId, ...protectedRows.map(value => value.id)]);
    expect(rows[0].state).toBe("TIMED_OUT");
    expect(rows.slice(1)).toEqual(protectedRows);
    await expect(generationOperationStatus(actor, "owner", operationId)).resolves.toMatchObject({ state: "TIMED_OUT" });
    for (const control of [generationOperationStatus, cancelGenerationOperation]) {
      await expect(control(actor, "owner", foreignId)).rejects.toMatchObject({ status: 404, code: "ESCALA_OPERATION_NOT_FOUND" });
    }
    expect(rows.slice(1)).toEqual(protectedRows);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("hashes stable authenticated identity with tenant independently of cookie renewal", () => {
    const request = (cookie: string) => new Request("http://localhost", { headers: { cookie } });
    expect(solveOwner(request(""), actor)).not.toBe(solveOwner(request(""), { ...actor, moduleSessionId: "s2" }));
    expect(solveOwner(request(""), actor)).not.toBe(solveOwner(request(""), { ...actor, tenantId: "t2" }));
    const account = { ...actor, userId: "u1", moduleSessionId: undefined, accountSessionId: "stable-login-1" };
    expect(solveOwner(request("authjs.session-token.1=b; authjs.session-token.0=a"), account)).toBe(solveOwner(request("authjs.session-token.0=a; authjs.session-token.1=b"), account));
    expect(solveOwner(request("authjs.session-token=a"), account)).toBe(solveOwner(request("authjs.session-token=b"), account));
    expect(solveOwner(request(""), account)).not.toBe(solveOwner(request(""), { ...account, accountSessionId: "another-login" }));
    expect(() => solveOwner(request(""), { ...account, accountSessionId: undefined })).toThrow();
  });
  it.each([
    ["status", generationOperationStatus],
    ["cancel", cancelGenerationOperation],
  ] as const)("authorizes %s using workspace metadata without loading a revision", async (_name, control) => {
    const account = { userId: "u1", tenantId: "t1", admin: false, accountSessionId: "login" };
    mocks.get.mockRejectedValue(new Error("Full workspace validation must not run"));
    await expect(control(account, "owner", operationId)).resolves.toMatchObject({
      state: control === generationOperationStatus ? "CREATED" : "CANCELLED",
    });
    expect(authorization.workspace).toHaveBeenCalledExactlyOnceWith({
      where: { id: "w1", tenantId: "t1" },
      select: { branchCode: true },
    });
    expect(authorization.grants).toHaveBeenCalledWith({
      where: { tenantId: "t1", userId: "u1" },
      select: { tenantId: true, userId: true, branchCode: true, role: true },
    });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(authorization.revision).not.toHaveBeenCalled();
    expect(mocks.recheck).not.toHaveBeenCalled();
    expect(authorization.approval).not.toHaveBeenCalled();
  });
  it.each([
    ["status", generationOperationStatus],
    ["cancel", cancelGenerationOperation],
  ] as const)("denies %s for a missing workspace or revoked branch access", async (_name, control) => {
    await expect(control(actor, "another-owner", operationId)).rejects.toMatchObject({
      status: 404, code: "ESCALA_OPERATION_NOT_FOUND",
    });
    await expect(control({ ...actor, tenantId: "t2" }, "owner", operationId)).rejects.toMatchObject({
      status: 404, code: "ESCALA_OPERATION_NOT_FOUND",
    });
    expect(authorization.workspace).not.toHaveBeenCalled();
    expect(authorization.branch).not.toHaveBeenCalled();

    authorization.workspace.mockResolvedValueOnce(null);
    await expect(control(actor, "owner", operationId)).rejects.toMatchObject({
      status: 404, code: "ESCALA_NOT_FOUND",
    });
    const account = { userId: "u1", tenantId: "t1", admin: false, accountSessionId: "login" };
    authorization.branch.mockResolvedValueOnce(null);
    await expect(control(account, "owner", operationId)).rejects.toMatchObject({
      status: 403, code: "ESCALA_BRANCH_FORBIDDEN",
    });
    authorization.branch.mockResolvedValue({ role: "VIEWER" });
    await expect(control(account, "owner", operationId)).rejects.toMatchObject({
      status: 403, code: "ESCALA_ACTION_FORBIDDEN",
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("creates only metadata for the selected revision", async () => {
    authorizeStartGeneration();
    expect(await startGenerationOperation(actor, "owner", "w1", 1)).toMatchObject({ operationId, state: "CREATED" });
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: "t1", workspaceId: "w1", ownerKey: "owner", expectedRevision: 1 }) });
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain("private-capability");
    mocks.get.mockResolvedValue({ revision: 2, canEdit: true, input: { branchCode: "02" } });
    await expect(startGenerationOperation(actor, "owner", "w1", 1)).rejects.toMatchObject({ status: 409 });
  });
  it("does not check or reserve a slot when approval is revoked while waiting for the access lock", async () => {
    const approval = authorizeStartGeneration();
    const boundary = pauseAtBoundary();
    authorization.lock.mockImplementationOnce(boundary.wait);
    const rejection = expect(startGenerationOperation(actor, "owner", "w1", 1)).rejects.toMatchObject({
      status: 409, code: "ESCALA_CONFIG_REVOKED",
    });
    await boundary.reached;
    expect(authorization.approval).not.toHaveBeenCalled();
    approval.revokedAt = new Date();
    boundary.release();
    await rejection;
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects another tenant, session or revision without invoking the solver", async () => {
    await expect(cancelGenerationOperation(actor, "another-session", operationId)).rejects.toMatchObject({ status: 404 });
    await expect(cancelGenerationOperation({ ...actor, tenantId: "t2" }, "owner", operationId)).rejects.toMatchObject({ status: 404 });
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 2, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
    expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("cancels before start and never submits the model", async () => {
    expect(await cancelGenerationOperation(actor, "owner", operationId)).toMatchObject({ state: "CANCELLED" });
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).rejects.toMatchObject({ code: "SOLVER_CANCELLED" });
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("confirms a running cancellation and is idempotent", async () => {
    row.state = "RUNNING";
    expect(await cancelGenerationOperation(actor, "owner", operationId)).toMatchObject({ state: "CANCELLED" });
    expect(await cancelGenerationOperation(actor, "owner", operationId)).toMatchObject({ state: "CANCELLED" });
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
  it("does not claim cancellation when the processor has not confirmed it", async () => {
    row.state = "RUNNING"; mocks.cancel.mockRejectedValueOnce(new Error("offline"));
    await expect(cancelGenerationOperation(actor, "owner", operationId)).rejects.toThrow("offline");
    expect(row.state).toBe("CANCEL_REQUESTED");
    expect(await generationOperationStatus(actor, "owner", operationId)).toMatchObject({ state: "CANCELLED" });
  });
  it("finalizes expired cancellation despite an offline solver and stops retrying on polls", async () => {
    row.state = "CANCEL_REQUESTED";
    row.expiresAt = new Date(Date.now() - 1_000);
    mocks.cancel.mockRejectedValue(new Error("offline"));
    await expect(generationOperationStatus(actor, "owner", operationId)).resolves.toMatchObject({ state: "TIMED_OUT" });
    await expect(generationOperationStatus(actor, "owner", operationId)).resolves.toMatchObject({ state: "TIMED_OUT" });
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({ operationId, cancelToken: "private-capability" });
  });
  it("expires an unclaimed operation without creating a solver cancellation record", async () => {
    row.expiresAt = new Date(Date.now() - 1_000);
    await expect(generationOperationStatus(actor, "owner", operationId)).resolves.toMatchObject({ state: "TIMED_OUT" });
    expect(row.state).toBe("TIMED_OUT");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("keeps a confirmed cancellation that wins the expiry race", async () => {
    row.state = "CANCEL_REQUESTED";
    row.expiresAt = new Date(Date.now() - 1_000);
    mocks.updateMany.mockImplementationOnce(async () => {
      row.state = "CANCELLED";
      return { count: 0 };
    });
    await expect(generationOperationStatus(actor, "owner", operationId)).resolves.toMatchObject({ state: "CANCELLED" });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("rejects a late proposal after expiry even when the solver did not confirm cancellation", async () => {
    mocks.generate.mockImplementationOnce(async () => {
      row.expiresAt = new Date(Date.now() - 1_000);
      mocks.cancel.mockRejectedValueOnce(new Error("offline"));
      await expect(generationOperationStatus(actor, "owner", operationId)).resolves.toMatchObject({ state: "TIMED_OUT" });
      return { result: { status: "FEASIBLE" } };
    });
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).rejects.toMatchObject({ code: "SOLVER_TIMED_OUT" });
    expect(row.state).toBe("TIMED_OUT");
  });
  it.each([
    ["CANCEL_REQUESTED", true, "SOLVER_CANCELLED"],
    ["CREATED", true, "SOLVER_TIMED_OUT"],
    ["RUNNING", false, "ESCALA_OPERATION_CHANGED"],
  ] as const)("rereads a lost claim with state %s", async (state, expired, code) => {
    mocks.updateMany.mockImplementationOnce(async () => {
      row.state = state;
      if (expired) row.expiresAt = new Date(Date.now() - 500);
      return { count: 0 };
    });
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).rejects.toMatchObject({ code });
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each(["RUNNING", "COMPLETED"] as const)("keeps a stale revision when the %s CAS loses", async state => {
    const update = mocks.updateMany.getMockImplementation();
    if (!update) throw new Error("Missing operation update mock implementation");
    mocks.updateMany.mockImplementation(async args => args.data.state === state ? { count: 0 } : update(args));
    mocks.recheck.mockRejectedValueOnce(new EscalaError(409, "ESCALA_STALE_REVISION", "Synthetic"));
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
    expect(row.state).toBe(state === "RUNNING" ? "CREATED" : "RUNNING");
  });

  it.each([["CANCEL_REQUESTED", "SOLVER_CANCELLED"], ["RUNNING", "SOLVER_TIMED_OUT"]] as const)
    ("withholds an expired proposal with state %s", async (state, code) => {
      mocks.generate.mockImplementationOnce(async () => {
        row.state = state; row.expiresAt = new Date(Date.now() - 500);
        return { result: { status: "FEASIBLE" } };
      });
      await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).rejects.toMatchObject({ code });
      expect(row.state).toBe(state);
      expect(mocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({
        id: operationId, tenantId: "t1", ownerKey: "owner", workspaceId: "w1", expectedRevision: 1, state: "RUNNING", expiresAt: { gt: expect.any(Date) },
      }) }));
    });
  it("does not write TIMED_OUT when explicit cancellation wins a solver timeout", async () => {
    mocks.generate.mockImplementationOnce(async () => {
      row.state = "CANCEL_REQUESTED";
      row.expiresAt = new Date(Date.now() - 500);
      throw new EscalaSolverError("SOLVER_TIMED_OUT");
    });
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).rejects.toMatchObject({ code: "SOLVER_CANCELLED" });
    expect(row.state).toBe("CANCEL_REQUESTED");
  });

  it("withholds delivery if the deadline passes during the final revision check", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const expiredAt = row.expiresAt.getTime() + 1;
      mocks.recheck.mockImplementationOnce(async () => { vi.setSystemTime(expiredAt); });
      await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).rejects.toMatchObject({ code: "SOLVER_TIMED_OUT" });
      expect(row.state).toBe("COMPLETED");
    } finally { vi.useRealTimers(); }
  });

  it("returns a valid completed proposal and makes later cancellation a no-op", async () => {
    expect(await runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).toEqual({ result: { status: "FEASIBLE" } });
    expect(row.state).toBe("COMPLETED");
    expect(await cancelGenerationOperation(actor, "owner", operationId)).toMatchObject({ state: "COMPLETED" });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("rejects a late successful result after cancellation wins the state transition", async () => {
    mocks.generate.mockImplementationOnce(async () => { await cancelGenerationOperation(actor, "owner", operationId); return { result: { status: "FEASIBLE" } }; });
    await expect(runGenerationOperation(actor, "owner", operationId, "w1", 1, new AbortController().signal)).rejects.toMatchObject({ code: "SOLVER_CANCELLED" });
    expect(row.state).toBe("CANCELLED");
  });
});
