import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST } from "./route";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), rate: vi.fn(), create: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: mocks.guard }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.rate }));
vi.mock("@/lib/escalas/shift-catalog/export", () => ({ createTurnoExportManifest: mocks.create }));

const actor = { userId: "u1", tenantId: "t1", admin: true };
const request = (body: unknown) => new Request("http://localhost/api/escalas/turnos/export/manifest", {
  method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, actor });
  mocks.rate.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ manifestId: "m1", expiresAt: "2026-11-13T12:00:00.000Z", month: 12, year: 2026, rowCount: 1, omissions: [], formats: ["TXT1", "TXT2"] });
});

describe("/api/escalas/turnos/export/manifest", () => {
  it("creates a manifest from an explicitly selected plan and employee reference", async () => {
    const response = await POST(request({ month: 12, year: 2026, selections: [{ workspaceId: "w1", revision: 3, employees: [{ employeeId: "e1", localShiftId: "s1" }] }] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ manifestId: "m1", rowCount: 1, formats: ["TXT1", "TXT2"] });
    expect(mocks.create).toHaveBeenCalledWith(actor, expect.objectContaining({ month: 12, year: 2026 }));
  });

  it("requires same-origin authenticated JSON", async () => {
    mocks.guard.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await POST(request({}))).status).toBe(401);
    const foreign = new Request("http://localhost/api/escalas/turnos/export/manifest", {
      method: "POST", headers: { origin: "https://foreign.test", "content-type": "application/json" }, body: JSON.stringify({}),
    });
    expect((await POST(foreign)).status).toBe(403);
  });

  it.each([{ name: "GET", handle: GET }, { name: "PATCH", handle: PATCH }, { name: "DELETE", handle: DELETE }])("rejects unsupported $name without invoking catalog operations", ({ handle }) => {
    const response = handle();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")?.split(",").map(method => method.trim())).toEqual(["POST"]);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
