import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), list: vi.fn(), administer: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: mocks.guard }));
vi.mock("@/lib/escalas/operator-admin-service", () => ({ listEscalaOperators: mocks.list, administerEscalaOperators: mocks.administer }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: async () => null }));
import { GET, POST, DELETE } from "./route";
const actor = { userId: "admin", tenantId: "t", admin: true };
const dto = { policy: { mode: "ADMIN_ONLY", version: 1 }, operators: [] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.guard.mockResolvedValue({ ok: true, actor }); mocks.list.mockResolvedValue(dto); mocks.administer.mockResolvedValue(dto);
});
describe("administration HTTP transport", () => {
  it("delivers a private successful list and forwards a bounded same-origin command to the real service boundary", async () => {
    const listed = await GET(); expect(listed.status).toBe(200); expect(await listed.json()).toEqual(dto);
    const data = { action: "REVOKE_SESSIONS", operatorId: "o", expectedPermissionVersion: 2 };
    const response = await POST(new Request("http://localhost/api/escalas/access/admin", { method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(data) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(dto);
    expect(mocks.administer).toHaveBeenCalledWith(actor, data);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not execute a command across origins or without an admitted identity", async () => {
    const request = new Request("http://localhost/api/escalas/access/admin", { method: "POST",
      headers: { origin: "https://foreign.invalid", "content-type": "application/json" }, body: "{}" });
    expect((await POST(request)).status).toBe(403); expect(mocks.administer).not.toHaveBeenCalled();
    mocks.guard.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) });
    expect((await GET()).status).toBe(401); expect(DELETE().status).toBe(405);
  });
});
