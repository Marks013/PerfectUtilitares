import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), account: vi.fn() }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), requireSession: mocks.account }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("./operator-session-store", () => ({ getEscalaScopedModuleSession: mocks.session }));
import { requireEscalaAccess } from "./access.server";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.account.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) });
  mocks.session.mockResolvedValue(null);
});
describe("account precedence and scoped module admission", () => {
  it("denies direct calls without a resolved scoped session", async () => {
    const result = await requireEscalaAccess();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
  it("preserves authenticated account identity ahead of any module cookie", async () => {
    mocks.account.mockResolvedValue({ ok: true, session: { user: { id: "admin", tenantId: "t", status: "ACTIVE", role: "ADMIN" } } });
    expect(await requireEscalaAccess()).toEqual({ ok: true, actor: { userId: "admin", tenantId: "t", admin: true } });
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("uses only the server-resolved operator session and tenant", async () => {
    mocks.session.mockResolvedValue({ kind: "resolved", sessionId: "s", principal: { tenantId: "t", id: "o" } });
    expect(await requireEscalaAccess()).toEqual({ ok: true, actor: { userId: null, tenantId: "t", admin: false, moduleSessionId: "s" } });
  });
  it("does not bypass blocked accounts or an account without tenant", async () => {
    mocks.account.mockResolvedValue({ ok: false, response: Response.json({}, { status: 403 }) });
    expect((await requireEscalaAccess()).ok).toBe(false);
    expect(mocks.session).not.toHaveBeenCalled();
    mocks.account.mockResolvedValue({ ok: true, session: { user: { id: "u", role: "ADMIN", status: "ACTIVE" } } });
    const result = await requireEscalaAccess();
    if (result.ok) throw new Error("Unexpected access");
    expect(result.response.status).toBe(403);
  });
  it("reports storage failure without admitting legacy password access", async () => {
    mocks.session.mockRejectedValue(new Error("offline"));
    const result = await requireEscalaAccess();
    if (result.ok) throw new Error("Unexpected access");
    expect(result.response.status).toBe(503);
  });
});
