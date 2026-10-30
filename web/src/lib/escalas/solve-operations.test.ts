import { beforeEach, describe, expect, it, vi } from "vitest";
import { solveOwner, startGenerationOperation, runGenerationOperation, cancelGenerationOperation, generationOperationStatus } from "./solve-operations";
import type { EscalaActor } from "./access";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), get: vi.fn(), generate: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaSolveOperation: mocks } }));
vi.mock("./service", () => ({ getEscala: mocks.get, generateEscala: mocks.generate }));
vi.mock("./solver-transport", () => ({ solverCapability: () => "private-capability", cancelSolverOperation: mocks.cancel }));
const actor: EscalaActor = { userId: null, tenantId: "t1", admin: false, moduleSessionId: "s1" };
const operationId = "4ea6210f-fb9a-449f-b6f4-413b3c79ec05";
type Row = { id: string; tenantId: string; workspaceId: string; expectedRevision: number; ownerKey: string; state: string; expiresAt: Date; finishedAt?: Date };
let row: Row;
function matches(where: Record<string, unknown>) {
  for (const [key, value] of Object.entries(where)) {
    const current = row[key as keyof Row];
    if (key === "state" && typeof value === "object") { if (!(value as { in: string[] }).in.includes(row.state)) return false; }
    else if (key === "expiresAt" && typeof value === "object") {
      const comparison = value as { gt?: Date; lt?: Date };
      if (comparison.gt && row.expiresAt <= comparison.gt || comparison.lt && row.expiresAt >= comparison.lt) return false;
    } else if (current !== value) return false;
  }
  return true;
}
beforeEach(() => {
  vi.resetAllMocks();
  row = { id: operationId, tenantId: "t1", workspaceId: "w1", expectedRevision: 1, ownerKey: "owner", state: "CREATED", expiresAt: new Date(Date.now() + 120_000) };
  mocks.get.mockResolvedValue({ id: "w1", revision: 1, canEdit: true });
  mocks.findFirst.mockImplementation(async ({ where }) => matches(where) ? { ...row } : null);
  mocks.findUniqueOrThrow.mockImplementation(async () => ({ ...row }));
  mocks.create.mockImplementation(async ({ data }) => ({ ...row, ...data }));
  mocks.updateMany.mockImplementation(async ({ where, data }) => { const count = Number(matches(where)); if (count) Object.assign(row, data); return { count }; });
  mocks.findMany.mockResolvedValue([]); mocks.count.mockResolvedValue(0);
  mocks.cancel.mockResolvedValue("CANCELLED"); mocks.generate.mockResolvedValue({ result: { status: "FEASIBLE" } });
});

describe("generation operation ownership and atomic lifecycle", () => {
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
  it("creates only metadata for the selected revision", async () => {
    expect(await startGenerationOperation(actor, "owner", "w1", 1)).toMatchObject({ operationId, state: "CREATED" });
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: "t1", workspaceId: "w1", ownerKey: "owner", expectedRevision: 1 }) });
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain("private-capability");
    mocks.get.mockResolvedValue({ revision: 2, canEdit: true });
    await expect(startGenerationOperation(actor, "owner", "w1", 1)).rejects.toMatchObject({ status: 409 });
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
