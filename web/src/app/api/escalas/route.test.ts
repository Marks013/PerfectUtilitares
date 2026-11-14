import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/auth";
import { EscalaError } from "@/lib/escalas/access";
import { EscalaSolverError } from "@/lib/escalas/solver-client";
import { DELETE, GET, PATCH, POST } from "./route";

import { newEmployee, newInput } from "@/components/escalas/workspace-model";
const candidateDb = vi.hoisted(() => ({ row: vi.fn(), revision: vi.fn(), peers: vi.fn(), solver: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaWorkspace: { findFirst: candidateDb.row, findMany: candidateDb.peers }, escalaRevision: { findUnique: candidateDb.revision } } }));
vi.mock("@/lib/escalas/solver-client", async original => ({ ...await original<typeof import("@/lib/escalas/solver-client")>(), solveEscala: candidateDb.solver }));
vi.mock("@/lib/escalas/solver-transport", async original => {
  const crypto = await import("node:crypto");
  return { ...await original<typeof import("@/lib/escalas/solver-transport")>(), candidateReferenceSignature: (payload: string) => crypto.createHmac("sha256", "route-synthetic-receipt-key").update(payload).digest("hex") };
});
const mocks = vi.hoisted(() => ({ session: null as AppSession | null, list: vi.fn(), get: vi.fn(), create: vi.fn(), save: vi.fn(), generate: vi.fn(), remove: vi.fn(), rate: vi.fn(), module: vi.fn(), startOperation: vi.fn(), runOperation: vi.fn(), cancelOperation: vi.fn(), operationStatus: vi.fn() }));
vi.mock("@/lib/escalas/module-session", () => ({ getEscalaModuleSession: mocks.module }));
vi.mock("@/lib/escalas/solve-operations", () => ({ solveOwner: () => "session-owner", startGenerationOperation: mocks.startOperation, runGenerationOperation: mocks.runOperation, cancelGenerationOperation: mocks.cancelOperation, generationOperationStatus: mocks.operationStatus }));
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
  mocks.rate.mockResolvedValue(null); mocks.module.mockResolvedValue(null);
});

describe("/api/escalas", () => {
  it("successfully round-trips a real service-produced receipt through GENERATE and rejects tampering before the solver", async () => {
    const value = newInput("02", "Synthetic", "2026-11", 42);
    value.startDate = "2026-11-02"; value.endDate = "2026-11-08"; delete value.visibleMonth;
    value.simulation = true; value.restRulesVersion = 2; value.policy.calendarMode = "MANUAL";
    value.shifts = [{ id: "day", name: "Day", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
    value.employees = [{ ...newEmployee(42, "day"), id: "a", registration: "a", name: "Synthetic", sector: "Store", role: "Operator", activeFrom: "2020-01-01" }];
    value.assignments = Array.from({ length: 7 }, (_, day) => ({ employeeId: "a", date: `2026-11-0${day + 2}`,
      ...([3, 6].includes(day) ? { kind: "OFF" as const } : { kind: "WORK" as const, shiftId: "day" }) }));
    value.demands = [];
    candidateDb.row.mockResolvedValue({ id: "w1", tenantId: "t1", branchCode: "02", branchName: "Synthetic", startDate: value.startDate, endDate: value.endDate, revision: 1, status: "DRAFT", updatedAt: new Date("2026-11-01") });
    candidateDb.revision.mockResolvedValue({ input: value, revision: 1, status: "DRAFT", createdAt: new Date("2026-11-01") }); candidateDb.peers.mockResolvedValue([]);
    candidateDb.solver.mockImplementation(async context => ({ status: "FEASIBLE", assignments: context.assignments, wallTimeSeconds: 1, message: "Synthetic processor" }));
    const real = await vi.importActual<typeof import("@/lib/escalas/service")>("@/lib/escalas/service");
    mocks.generate.mockImplementation(real.generateEscala);
    const first = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }));
    expect(first.status).toBe(200);
    const initial = await first.json();
    expect(initial.validation.valid).toBe(true); expect(initial.candidateReceipt.signature).toMatch(/^[a-f0-9]{64}$/);
    const second = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1, comparisonReference: { input: initial.proposalInput, receipt: initial.candidateReceipt } }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ comparison: { admission: "ADMITTED" }, validation: { valid: true } });
    const altered = structuredClone(initial.proposalInput); altered.shifts[0].segments[0].start++;
    candidateDb.solver.mockClear();
    const rejected = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1, comparisonReference: { input: altered, receipt: initial.candidateReceipt } }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: { code: "ESCALA_COMPARISON_REFERENCE_INVALID" } });
    expect(candidateDb.solver).not.toHaveBeenCalled();
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
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 1, expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    mocks.generate.mockRejectedValue(new EscalaSolverError("SOLVER_INVALID_INPUT"));
    const invalid = await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "SOLVER_INVALID_INPUT" } });
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
    mocks.rate.mockResolvedValue(Response.json({ error: "limit" }, { status: 429 }));
    expect((await POST(command({ action: "CREATE", input }))).status).toBe(429);
    expect(PATCH().headers.get("allow")).toBe("GET, POST, DELETE");
  });
});

it("uses a verified module company for successful query/create/save/generate, ignoring client scope attempts", async () => {
  mocks.session = null; mocks.module.mockResolvedValue({ id: "module-1", tenantId: "default-company", expiresAt: new Date("2030-01-01") });
  const actor = { userId: null, tenantId: "default-company", admin: false, moduleSessionId: "module-1" };
  const listing = await GET(new Request("http://localhost/api/escalas?tenantId=foreign"));
  expect(listing.status).toBe(200); expect(await listing.json()).toMatchObject({ canCreate: true }); expect(mocks.list).toHaveBeenLastCalledWith(actor);
  expect((await POST(command({ action: "CREATE", input }))).status).toBe(201); expect(mocks.create).toHaveBeenLastCalledWith(actor, input);
  expect((await POST(command({ action: "SAVE", id: "w1", expectedRevision: 1, input }))).status).toBe(200); expect(mocks.save).toHaveBeenLastCalledWith(actor, "w1", 1, input);
  expect((await POST(command({ action: "GENERATE", id: "w1", expectedRevision: 1 }))).status).toBe(200); expect(mocks.generate).toHaveBeenLastCalledWith(actor, "w1", 1, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
