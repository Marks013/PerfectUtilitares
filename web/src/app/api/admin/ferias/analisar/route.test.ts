import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), origin: vi.fn(), rate: vi.fn(), capacity: vi.fn(), worker: vi.fn(), analyze: vi.fn(), capture: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mocks.capture }));
vi.mock("@/lib/api/security", () => ({
  requireAdmin: mocks.admin, requireSameOrigin: mocks.origin, enforcePersistentRateLimit: mocks.rate,
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } }),
  methodNotAllowed: () => new Response(null, { status: 405 }),
}));
vi.mock("@/lib/api/resource-capacity", () => ({ requireResourceCapacity: mocks.capacity }));
vi.mock("@/lib/ferias/processing", () => ({
  withFeriasProcessing: (signal: AbortSignal, operation: (signal: AbortSignal) => Promise<unknown>) => operation(signal),
  assertFeriasActive: (signal: AbortSignal) => signal.throwIfAborted(),
  runFeriasWorkbook: mocks.worker,
}));
vi.mock("@/lib/ferias/service", () => ({ analyzeFerias: mocks.analyze }));

import { GET, POST } from "./route";

function request() {
  const body = new FormData();
  body.set("file", new File(["source bytes"], "ferias.xlsx"));
  body.set("choices", '[{"row":4,"holderId":"holder-1"}]');
  return new Request("https://example.test/api/admin/ferias/analisar", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ ok: true, session: { user: { id: "admin-1", tenantId: "tenant-1" } } });
  mocks.origin.mockReturnValue(null);
  mocks.rate.mockResolvedValue(null);
  mocks.capacity.mockResolvedValue(null);
  mocks.worker.mockResolvedValue({ rows: [{ row: 4 }], competency: "2026-09" });
  mocks.analyze.mockResolvedValue({ revision: "a".repeat(64), canExport: false, rows: [{ row: 4 }], sources: [{ name: "Unimed", ready: false }] });
});

describe("POST /api/admin/ferias/analisar", () => {
  it("parses actual multipart and returns partial analysis directly for the authenticated tenant", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canExport: false, sources: [{ ready: false }] });
    expect(mocks.analyze).toHaveBeenCalledWith("tenant-1", [{ row: 4 }], "2026-09", [{ row: 4, holderId: "holder-1" }], expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(mocks.rate).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ keyPrefix: "ferias:tenant-1:admin-1" }));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects unauthorized and cross-origin requests before processing", async () => {
    mocks.admin.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request())).status).toBe(403);
    mocks.origin.mockReturnValueOnce(new Response(null, { status: 403 }));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("honors persistent rate and resource guards", async () => {
    mocks.rate.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await POST(request())).status).toBe(429);
    mocks.capacity.mockResolvedValueOnce(new Response(null, { status: 507 }));
    expect((await POST(request())).status).toBe(507);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("never sends raw exception payloads to the response or Sentry", async () => {
    mocks.analyze.mockRejectedValueOnce(new Error("private employee name and cpf"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private employee");
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain("private employee");
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it("rejects GET", () => { expect(GET().status).toBe(405); });
});
