import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/auth";
import { EscalaError } from "@/lib/escalas/access";
import { EscalaSolverError } from "@/lib/escalas/solver-client";
import { DELETE, GET, PATCH, POST } from "./route";

const mocks = vi.hoisted(() => ({ session: null as AppSession | null, list: vi.fn(), get: vi.fn(), create: vi.fn(), save: vi.fn(), generate: vi.fn(), remove: vi.fn(), rate: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/api/security", async (original) => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.rate }));
vi.mock("@/lib/escalas/service", () => ({ listEscalas: mocks.list, getEscala: mocks.get, createEscala: mocks.create, saveEscala: mocks.save, generateEscala: mocks.generate, deleteEscala: mocks.remove, parseEscalaInput: (value: unknown) => value }));

const input = { branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01" };
const workspace = { id: "w1", revision: 1, status: "DRAFT", input, canEdit: true, canPublish: true };
const command = (body: unknown, headers: HeadersInit = { origin: "http://localhost", "content-type": "application/json" }) => new Request("http://localhost/api/escalas", { method: "POST", headers, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { user: { id: "u1", tenantId: "t1", role: "ADMIN", status: "ACTIVE" }, expires: "2099" };
  mocks.list.mockResolvedValue([workspace]); mocks.get.mockResolvedValue(workspace); mocks.create.mockResolvedValue(workspace); mocks.save.mockResolvedValue({ ...workspace, revision: 2 });
  mocks.generate.mockResolvedValue({ result: { status: "FEASIBLE" }, proposalInput: input, validation: { valid: true }, preparation: { adjustedEmployeeIds: [], excludedEmployeeIds: [], generatedCoverageSlots: 7, includedEmployees: 81, untimedEmployees: 12 } });
  mocks.rate.mockResolvedValue(null);
});

describe("/api/escalas", () => {
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
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1");
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
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 1);
    expect(mocks.rate).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ keyPrefix: "escalas-solver", limit: 6 }));
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
    mocks.create.mockRejectedValue({ code: "P2002" });
    expect((await POST(command({ action: "CREATE", input }))).status).toBe(409);
  });
  it("honors limits and method contracts", async () => {
    mocks.rate.mockResolvedValue(Response.json({ error: "limit" }, { status: 429 }));
    expect((await POST(command({ action: "CREATE", input }))).status).toBe(429);
    expect(PATCH().headers.get("allow")).toBe("GET, POST, DELETE");
  });
});
