import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(), lock: vi.fn(), operator: vi.fn(), policy: vi.fn(), list: vi.fn(), revoke: vi.fn(),
  create: vi.fn(), audit: vi.fn(), remove: vi.fn(), transaction: vi.fn(), commit: vi.fn(),
  accessLock: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { decodeEscalaSessionCookie } from "./module-session";
import { createEscalaScopedModuleSession } from "./operator-session-issuer";

const now = new Date("2026-12-01T12:00:00Z");
const grant = () => ({ tenantId: "tenant-a", operatorId: "operator-1", branchCode: "01", active: true, capabilities: ["workspace.read"] });
const operator = () => ({ id: "operator-1", tenantId: "tenant-a", usernameNormalized: "maria", active: true, permissionVersion: 3, branchGrants: [grant()] });
const policy = () => ({ tenantId: "tenant-a", mode: "SCOPED", version: 2 });
const noWrites = () => {
  expect(mocks.revoke).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "s".repeat(48));
  vi.stubEnv("UNIMED_ACCESS_SESSION_TTL_MINUTES", "480");
  vi.stubEnv("DEFAULT_TENANT_SLUG", " configured-company ");
  mocks.tenant.mockResolvedValue({ id: "tenant-a" });
  mocks.lock.mockResolvedValue([{ id: "operator-1" }]);
  mocks.operator.mockResolvedValue(operator()); mocks.policy.mockResolvedValue(policy());
  mocks.list.mockResolvedValue([]); mocks.revoke.mockResolvedValue({ count: 0 });
  mocks.create.mockResolvedValue({ id: "session-new" }); mocks.audit.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(async operation => {
    const result = await operation({
      tenant: { findUnique: mocks.tenant }, $queryRaw: mocks.lock, $executeRaw: mocks.accessLock,
      escalaOperator: { findUnique: mocks.operator }, escalaModuleAccessPolicy: { findUnique: mocks.policy },
      escalaModuleSession: { findMany: mocks.list, updateMany: mocks.revoke, create: mocks.create, deleteMany: mocks.remove },
      auditLog: { create: mocks.audit },
    });
    mocks.commit();
    return result;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("username-only scoped Escalas session issuance", () => {
  it("issues a real signed cookie with a hash, tenant-bound versions and ID-only audit", async () => {
    const result = await createEscalaScopedModuleSession("  ＭＡＲＩＡ ");
    expect(result).toMatchObject({ id: "session-new", expiresAt: new Date(now.getTime() + 480 * 60_000), maxAgeSeconds: 28_800 });
    const token = decodeEscalaSessionCookie(result?.value);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.tenant).toHaveBeenCalledWith({ where: { slug: "configured-company" }, select: { id: true } });
    expect(mocks.operator).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_id: { tenantId: "tenant-a", id: "operator-1" } } }));
    expect(mocks.policy).toHaveBeenCalledWith({ where: { tenantId: "tenant-a" }, select: { tenantId: true, mode: true, version: true } });
    expect(mocks.create).toHaveBeenCalledWith({ data: {
      tenantId: "tenant-a", operatorId: "operator-1", tokenHash: createHash("sha256").update(`escalas:${token}`).digest("hex"),
      permissionVersion: 3, accessPolicyVersion: 2, createdAt: now, expiresAt: result?.expiresAt,
    }, select: { id: true } });
    expect(mocks.audit).toHaveBeenCalledWith({ data: {
      action: "LOGIN", entity: "EscalaModuleSession", entityId: "session-new",
      metadata: { accessChannel: "ESCALAS_USERNAME_ONLY", tenantId: "tenant-a", operatorId: "operator-1", permissionVersion: 3, accessPolicyVersion: 2 },
    } });
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(token);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toMatch(/maria|username|tokenHash/);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 5_000 });
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("parameterizes the exact normalized name instead of interpolating it into SQL", async () => {
    mocks.lock.mockResolvedValueOnce([]);
    expect(await createEscalaScopedModuleSession("Maria' OR 1=1 --")).toBeNull();
    const [strings, ...parameters] = mocks.lock.mock.calls[0];
    expect(strings.join("?")).toMatch(/WHERE "tenantId" = \? AND "usernameNormalized" = \?\s+FOR UPDATE/);
    expect(strings.join("")).not.toContain("Maria");
    expect(parameters).toEqual(["tenant-a", "maria' or 1=1 --"]);
    noWrites();
  });

  it("awaits the operator lock and reads the profile and policy versions only after the wait", async () => {
    let release!: (rows: { id: string }[]) => void;
    let reached!: () => void;
    const acquired = new Promise<void>(resolve => { reached = resolve; });
    mocks.lock.mockImplementationOnce(() => { reached(); return new Promise(resolve => { release = resolve; }); });
    const pending = createEscalaScopedModuleSession("maria");
    await acquired;
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.operator).not.toHaveBeenCalled();
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.operator.mockResolvedValueOnce({ ...operator(), permissionVersion: 4 });
    mocks.policy.mockResolvedValueOnce({ ...policy(), version: 5 });
    release([{ id: "operator-1" }]);
    expect(await pending).not.toBeNull();
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ permissionVersion: 4, accessPolicyVersion: 5 });
    const order = [mocks.lock, mocks.operator, mocks.policy, mocks.list, mocks.revoke, mocks.create, mocks.audit];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].mock.invocationCallOrder[0]).toBeLessThan(order[i].mock.invocationCallOrder[0]);
  });

  it("keeps only 19 previous active sessions, revoking excess solely for this tenant and operator", async () => {
    const retained = Array.from({ length: 19 }, (_, i) => ({ id: `retained-${i}` }));
    mocks.list.mockResolvedValueOnce(retained);
    await createEscalaScopedModuleSession("maria");
    const active = { tenantId: "tenant-a", operatorId: "operator-1", revokedAt: null, expiresAt: { gt: now } };
    expect(mocks.list).toHaveBeenCalledWith({ where: active, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 19, select: { id: true } });
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { ...active, id: { notIn: retained.map(row => row.id) } }, data: { revokedAt: now } });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not contact storage for invalid names and never auto-creates an operator", async () => {
    for (const username of [undefined, null, "", " ", 1, { role: "ADMIN" }, "ana\u200b", "a".repeat(65)]) {
      expect(await createEscalaScopedModuleSession(username)).toBeNull();
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
    noWrites();
  });

  it("returns the same null result for missing tenant, unknown name or missing operator after locking", async () => {
    mocks.tenant.mockResolvedValueOnce(null);
    expect(await createEscalaScopedModuleSession("maria")).toBeNull();
    expect(mocks.lock).not.toHaveBeenCalled();
    mocks.lock.mockResolvedValueOnce([]);
    expect(await createEscalaScopedModuleSession("maria")).toBeNull();
    mocks.operator.mockResolvedValueOnce(null);
    expect(await createEscalaScopedModuleSession("maria")).toBeNull();
    noWrites();
  });

  it("rejects a renamed, inactive, mismatched or ambiguous operator after the lock", async () => {
    for (const value of [
      { ...operator(), active: false }, { ...operator(), usernameNormalized: "renamed" },
      { ...operator(), tenantId: "tenant-b" }, { ...operator(), id: "other-operator" },
    ]) {
      mocks.operator.mockResolvedValueOnce(value);
      expect(await createEscalaScopedModuleSession("maria")).toBeNull();
    }
    mocks.lock.mockResolvedValueOnce([{ id: "operator-1" }, { id: "operator-2" }]);
    expect(await createEscalaScopedModuleSession("maria")).toBeNull();
    noWrites();
  });

  it("requires a current SCOPED policy from the same tenant", async () => {
    for (const value of [null, { ...policy(), mode: "ADMIN_ONLY" }, { ...policy(), mode: "LEGACY" }, { ...policy(), mode: "unknown" }, { ...policy(), tenantId: "tenant-b" }]) {
      mocks.policy.mockResolvedValueOnce(value);
      expect(await createEscalaScopedModuleSession("maria")).toBeNull();
    }
    noWrites();
  });

  it("rejects invalid or out-of-range stored versions without coercion", async () => {
    for (const version of [0, -1, 1.5, 2_147_483_648, Number.NaN, Infinity, "3", null]) {
      mocks.operator.mockResolvedValueOnce({ ...operator(), permissionVersion: version });
      expect(await createEscalaScopedModuleSession("maria")).toBeNull();
      mocks.policy.mockResolvedValueOnce({ ...policy(), version });
      expect(await createEscalaScopedModuleSession("maria")).toBeNull();
    }
    noWrites();
  });

  it("requires a readable branch and rejects foreign or ambiguous grants", async () => {
    for (const branchGrants of [
      [], [{ ...grant(), active: false }], [{ ...grant(), capabilities: [] }],
      [{ ...grant(), capabilities: ["access.manage", "settings.manage"] }],
      [{ ...grant(), capabilities: ["schedule.generate"] }], [{ ...grant(), branchCode: " " }],
      [{ ...grant(), tenantId: "tenant-b" }], [{ ...grant(), operatorId: "operator-other" }],
      [grant(), { ...grant(), branchCode: "001" }],
    ]) {
      mocks.operator.mockResolvedValueOnce({ ...operator(), branchGrants });
      expect(await createEscalaScopedModuleSession("maria")).toBeNull();
    }
    noWrites();
  });

  it("treats ADMIN as an operational name and never copies a forged role or capabilities to the session", async () => {
    mocks.operator.mockResolvedValueOnce({ ...operator(), usernameNormalized: "admin", role: "ADMIN", branchGrants: [{ ...grant(), capabilities: ["workspace.read", "access.manage"] }] });
    expect(await createEscalaScopedModuleSession("ADMIN")).not.toBeNull();
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.operatorId).toBe("operator-1");
    expect(data).not.toHaveProperty("role");
    expect(data).not.toHaveProperty("capabilities");
    expect(data).not.toHaveProperty("userId");
  });

  it.each([["15", 900], ["1440", 86_400], ["invalid", 28_800]] as const)("preserves the existing TTL configuration %s", async (configured, seconds) => {
    vi.stubEnv("UNIMED_ACCESS_SESSION_TTL_MINUTES", configured);
    const result = await createEscalaScopedModuleSession("maria");
    expect(result?.maxAgeSeconds).toBe(seconds);
    expect(result?.expiresAt).toEqual(new Date(now.getTime() + Number(seconds) * 1000));
  });

  it("preserves the configured tenant fallback without searching a first tenant", async () => {
    vi.stubEnv("DEFAULT_TENANT_SLUG", " ");
    await createEscalaScopedModuleSession("maria");
    expect(mocks.tenant).toHaveBeenCalledWith({ where: { slug: "principal" }, select: { id: true } });
  });

  it("does not revoke or persist anything if signing configuration is unavailable", async () => {
    vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "");
    await expect(createEscalaScopedModuleSession("maria")).rejects.toThrow("Operational cookie secret is not configured securely");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    noWrites();
  });

  it.each(["tenant", "lock", "operator", "policy", "list", "revoke", "create", "audit"] as const)("propagates %s failure without returning a session or retrying the transaction", async step => {
    const failure = new Error(`synthetic ${step} failure`);
    mocks[step].mockRejectedValueOnce(failure);
    await expect(createEscalaScopedModuleSession("maria")).rejects.toBe(failure);
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.remove).not.toHaveBeenCalled();
    if (step === "create") expect(mocks.audit).not.toHaveBeenCalled();
  });
});
