import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: { userId: "admin", tenantId: "t", admin: true }, policy: vi.fn(), user: vi.fn(),
  operators: vi.fn(), create: vi.fn(), target: vi.fn(), update: vi.fn(), revoke: vi.fn(), grants: vi.fn(),
  replace: vi.fn(), remove: vi.fn(), audit: vi.fn(), lock: vi.fn(), count: vi.fn(), modeUpdate: vi.fn(), modeCreate: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: async () => ({ ok: true, actor: mocks.actor }) }));
vi.mock("@/lib/prisma", () => {
  const db = { user: { findFirst: mocks.user }, escalaModuleAccessPolicy: { findUnique: mocks.policy, update: mocks.modeUpdate, create: mocks.modeCreate },
    escalaBranchAccess: { findMany: mocks.grants }, escalaOperator: { findMany: mocks.operators, findUnique: mocks.target, create: mocks.create, updateMany: mocks.update },
    escalaOperatorBranchGrant: { createMany: mocks.replace, deleteMany: mocks.remove }, escalaModuleSession: { updateMany: mocks.revoke },
    escalaWorkspace: { count: mocks.count }, escalaBranchPolicyVersion: { count: mocks.count }, auditLog: { create: mocks.audit }, $executeRaw: mocks.lock, $queryRaw: vi.fn() };
  return { prisma: { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) } };
});
import { administerEscalaOperators } from "./operator-admin-service";
import { GET, POST } from "../../app/api/escalas/access/admin/route";
const request = (data: unknown) => new Request("http://localhost/api/escalas/access/admin", { method: "POST",
  headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(data) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor = { userId: "admin", tenantId: "t", admin: true };
  mocks.user.mockResolvedValue({ id: "admin", tenantId: "t", status: "ACTIVE", role: "ADMIN" });
  mocks.policy.mockResolvedValue({ tenantId: "t", mode: "SCOPED", version: 1 }); mocks.count.mockResolvedValue(1);
  mocks.operators.mockResolvedValue([]); mocks.target.mockResolvedValue({ id: "o", tenantId: "t", permissionVersion: 2 });
  mocks.update.mockResolvedValue({ count: 1 }); mocks.create.mockResolvedValue({ id: "o" });
});
describe("administrative operator persistence and HTTP", () => {
  it("creates a normalized operator with explicit grants through a successful HTTP request", async () => {
    mocks.create.mockResolvedValue({ id: "o" });
    mocks.replace.mockImplementation(async ({ data }) => {
      mocks.operators.mockResolvedValue([{ id: "o", usernameNormalized: "maria", displayName: "Pessoa sintética",
        active: true, permissionVersion: 1, branchGrants: data }]);
      return { count: data.length };
    });
    const response = await POST(request({ action: "CREATE_OPERATOR", username: "  ＭＡＲＩＡ ", displayName: "Pessoa sintética", active: true,
      branchGrants: [{ branchCode: "002", active: true, capabilities: ["workspace.read"] }] }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ policy: { mode: "SCOPED", version: 1 }, operators: [{ id: "o", username: "maria", active: true }] });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { tenantId: "t", usernameNormalized: "maria", displayName: "Pessoa sintética", active: true },
      select: { id: true },
    });
    expect(mocks.replace).toHaveBeenCalledWith({
      data: [{ tenantId: "t", operatorId: "o", branchCode: "02", active: true, capabilities: ["workspace.read"] }],
    });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.replace.mock.invocationCallOrder[0]);
    expect((await GET()).status).toBe(200);
  });
  it.each(["UPDATE_OPERATOR", "REPLACE_BRANCH_GRANTS", "REVOKE_SESSIONS"])("applies %s with CAS and transactional session revocation", async action => {
    const command = { action, operatorId: "o", expectedPermissionVersion: 2,
      ...(action === "UPDATE_OPERATOR" ? { username: "Nome", displayName: "Pessoa", active: false } : {}),
      ...(action === "REPLACE_BRANCH_GRANTS" ? { branchGrants: [{ branchCode: "02", active: true, capabilities: ["workspace.read"] }] } : {}) };
    const response = await POST(request(command)); expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { tenantId: "t", id: "o", permissionVersion: 2 }, data: expect.objectContaining({ permissionVersion: { increment: 1 } }) });
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { tenantId: "t", operatorId: "o", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
  it("changes access mode without creating accounts or default grants", async () => {
    mocks.modeUpdate.mockImplementation(async () => { mocks.policy.mockResolvedValue({ tenantId: "t", mode: "ADMIN_ONLY", version: 2 }); });
    const response = await POST(request({ action: "SET_ACCESS_MODE", mode: "ADMIN_ONLY", expectedVersion: 1 }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ policy: { mode: "ADMIN_ONLY", version: 2 } });
    expect(mocks.modeUpdate).toHaveBeenCalledWith({ where: { tenantId: "t" }, data: { mode: "ADMIN_ONLY", version: { increment: 1 } } });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.replace).not.toHaveBeenCalled(); expect(mocks.revoke).toHaveBeenCalled();
  });
  it("rejects forged authority, foreign resources, unknown branch and CAS conflicts before mutation", async () => {
    await expect(administerEscalaOperators(mocks.actor, { action: "REVOKE_SESSIONS", operatorId: "o", expectedPermissionVersion: 1 })).rejects.toMatchObject({ status: 409 });
    mocks.target.mockResolvedValue(null);
    await expect(administerEscalaOperators(mocks.actor, { action: "REVOKE_SESSIONS", operatorId: "foreign", expectedPermissionVersion: 2 })).rejects.toMatchObject({ status: 404 });
    mocks.count.mockResolvedValue(0);
    expect((await POST(request({ action: "CREATE_OPERATOR", username: "O", displayName: "Pessoa", active: true,
      branchGrants: [{ branchCode: "foreign", active: true, capabilities: ["workspace.read"] }] }))).status).toBe(422);
    expect((await POST(request({ action: "CREATE_OPERATOR", username: "O", displayName: "Pessoa", active: true, branchGrants: [], tenantId: "foreign" }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("does not let an operator use administrative commands", async () => {
    mocks.actor = { userId: "operator", tenantId: "t", admin: false };
    mocks.user.mockResolvedValue({ id: "operator", tenantId: "t", status: "ACTIVE", role: "OPERATOR" }); mocks.grants.mockResolvedValue([]);
    expect((await GET()).status).toBe(403);
    expect((await POST(request({ action: "SET_ACCESS_MODE", mode: "SCOPED", expectedVersion: 1 }))).status).toBe(403);
    expect(mocks.modeUpdate).not.toHaveBeenCalled();
  });
});
