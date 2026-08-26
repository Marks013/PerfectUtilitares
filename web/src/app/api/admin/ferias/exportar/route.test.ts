import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ worker: vi.fn(), analyze: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));
vi.mock("@/lib/api/security", () => ({
  requireAdmin: async () => ({ ok: true, session: { user: { id: "admin-1", tenantId: "tenant-1" } } }),
  requireSameOrigin: () => null,
  enforcePersistentRateLimit: async () => null,
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
  methodNotAllowed: () => new Response(null, { status: 405 }),
}));
vi.mock("@/lib/api/resource-capacity", () => ({ requireResourceCapacity: async () => null }));
vi.mock("@/lib/ferias/processing", () => ({
  withFeriasProcessing: (signal: AbortSignal, operation: (signal: AbortSignal) => Promise<unknown>) => operation(signal),
  assertFeriasActive: (signal: AbortSignal) => signal.throwIfAborted(),
  runFeriasWorkbook: mocks.worker,
}));
vi.mock("@/lib/ferias/service", () => ({ analyzeFerias: mocks.analyze }));

import { GET, POST } from "./route";

function request(revision = "a".repeat(64)) {
  const body = new FormData();
  body.set("file", new File(["source bytes"], "untrusted-name.xlsx"));
  body.set("revision", revision);
  return new Request("https://example.test/api/admin/ferias/exportar", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.worker.mockImplementation(async (input) => input.action === "parse" ? { rows: [{ row: 4 }], competency: "2026-09" } : Buffer.from([80, 75, 3, 4]));
  mocks.analyze.mockResolvedValue({ revision: "a".repeat(64), canExport: true, rows: [{ row: 4, days: 30, highlight: false, unimedText: "", loanText: "" }] });
});

describe("POST /api/admin/ferias/exportar", () => {
  it("recomputes from the source and exports exact worker bytes with private download headers", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([80, 75, 3, 4]));
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="FERIAS-09-2026-CONFERIDO.xlsx"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(mocks.analyze).toHaveBeenCalledWith("tenant-1", [{ row: 4 }], "2026-09", [], expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(mocks.worker).toHaveBeenCalledTimes(2);
  });

  it("blocks an outdated revision before creating any output", async () => {
    const response = await POST(request("b".repeat(64)));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "FERIAS_SOURCE_CHANGED" } });
    expect(mocks.worker).toHaveBeenCalledTimes(1);
  });

  it("blocks missing source or identity issues rather than exporting silent blanks", async () => {
    mocks.analyze.mockResolvedValueOnce({ revision: "a".repeat(64), canExport: false, rows: [] });
    expect((await POST(request())).status).toBe(422);
    expect(mocks.worker).toHaveBeenCalledTimes(1);
  });

  it("requires a revision and rejects GET", async () => {
    expect((await POST(request("invalid"))).status).toBe(400);
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(GET().status).toBe(405);
  });
});
