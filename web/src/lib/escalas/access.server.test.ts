import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), account: vi.fn(), grant: vi.fn() }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), requireSession: mocks.account }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/module-session", () => ({ getEscalaModuleSession: mocks.session }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaBranchAccess: { findUnique: mocks.grant, findMany: mocks.grant } } }));
import { requireEscalaAccess } from "./access.server";
import { allowedBranches, branchPermission, requireEscalaPermission } from "./access";
beforeEach(() => { vi.resetAllMocks(); mocks.account.mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) }); mocks.session.mockResolvedValue(null); });
describe("Escalas account or isolated module guard", () => {
  it("denies direct calls without either session", async () => {
    const guard = await requireEscalaAccess(); expect(guard.ok).toBe(false);
    if (!guard.ok) { expect(guard.response.status).toBe(401); expect(await guard.response.json()).toMatchObject({ error: { code: "ESCALA_ACCESS_REQUIRED" } }); }
  });
  it("preserves authenticated account scope and branch grants", async () => {
    mocks.account.mockResolvedValue({ ok: true, session: { user: { id: "person-1", tenantId: "other-company", status: "ACTIVE", role: "OPERATOR" } } });
    const guard = await requireEscalaAccess(); expect(guard).toEqual({ ok: true, actor: { userId: "person-1", tenantId: "other-company", admin: false } });
    expect(mocks.session).not.toHaveBeenCalled();
    mocks.grant.mockResolvedValue(null); if (guard.ok) await expect(branchPermission(guard.actor, "07")).rejects.toThrow("não possui acesso");
  });
  it("grants only draft operation across the server-selected company without inventing an account", async () => {
    mocks.session.mockResolvedValue({ id: "module-1", tenantId: "company-default", expiresAt: new Date(Date.now() + 60000) });
    const guard = await requireEscalaAccess(); expect(guard).toEqual({ ok: true, actor: { userId: null, tenantId: "company-default", admin: false, moduleSessionId: "module-1" } });
    if (!guard.ok) throw new Error("Expected module access");
    const permission = await branchPermission(guard.actor, "07");
    expect(permission).toEqual({ canEdit: true, canPublish: false }); expect(await allowedBranches(guard.actor)).toBeNull();
    expect(() => requireEscalaPermission(permission, "publish")).toThrow("não possui permissão");
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("does not bypass blocked accounts or accounts with no company", async () => {
    mocks.account.mockResolvedValue({ ok: false, response: Response.json({}, { status: 403 }) });
    expect((await requireEscalaAccess()).ok).toBe(false); expect(mocks.session).not.toHaveBeenCalled();
    mocks.account.mockResolvedValue({ ok: true, session: { user: { id: "u", status: "ACTIVE", role: "ADMIN" } } });
    const guard = await requireEscalaAccess(); if (guard.ok) throw new Error("Unexpected access"); expect(guard.response.status).toBe(403);
  });
  it("fails closed while session storage is unavailable", async () => {
    mocks.session.mockRejectedValue(new Error("offline")); const guard = await requireEscalaAccess();
    if (guard.ok) throw new Error("Unexpected access"); expect(guard.response.status).toBe(503);
  });
});
