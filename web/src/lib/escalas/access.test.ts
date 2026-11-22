import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ policy: vi.fn(), user: vi.fn(), grants: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaModuleAccessPolicy: { findUnique: db.policy }, user: { findFirst: db.user },
  escalaBranchAccess: { findMany: db.grants }, escalaModuleSession: { findFirst: db.session } } }));
import { allowedBranches, branchPermission, canCreateEscala, requireEscalaCapability, requireEscalaPermission, type EscalaActor } from "./access";
const admin: EscalaActor = { userId: "a", tenantId: "t", admin: true };
const operator = { userId: null, tenantId: "t", admin: false, moduleSessionId: "session" };
function session() {
  return { id: "session", tenantId: "t", operatorId: "o", permissionVersion: 1, accessPolicyVersion: 1,
    createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60000), revokedAt: null as Date | null,
    operator: { id: "o", tenantId: "t", active: true, permissionVersion: 1,
      branchGrants: [{ tenantId: "t", operatorId: "o", branchCode: "02", active: true,
        capabilities: ["workspace.read", "workspace.save", "schedule.generate", "shift.manage"] }] } };
}
beforeEach(() => {
  vi.resetAllMocks(); delete admin.accountSecurityVersion;
  db.policy.mockResolvedValue({ tenantId: "t", mode: "SCOPED", version: 1 });
  db.user.mockImplementation(async ({ where }) => where.tenantId === "t" && where.id === "a"
    ? { id: "a", tenantId: "t", status: "ACTIVE", role: "ADMIN", securityVersion: 1 } : null);
  db.session.mockResolvedValue(session()); db.grants.mockResolvedValue([]);
});
describe("current persisted authorization", () => {
  it("discovers creation from current authority rather than a module-cookie shortcut", async () => {
    expect(await canCreateEscala(admin)).toBe(true);
    expect(await canCreateEscala(operator)).toBe(false);
    const row = session(); row.operator.branchGrants[0].capabilities.push("workspace.create");
    db.session.mockResolvedValue(row);
    expect(await canCreateEscala(operator)).toBe(true);
    row.revokedAt = new Date();
    await expect(canCreateEscala(operator)).rejects.toMatchObject({ status: 401 });
    await expect(canCreateEscala({ userId: null, tenantId: "t", admin: false })).rejects.toMatchObject({ status: 401 });
  });
  it.each(["VIEWER", "PLANNER", "APPROVER"])("preserves current %s account branch scope and separate publication", async role => {
    const account: EscalaActor = { userId: "account", tenantId: "t", admin: false, accountSessionId: "login" };
    db.user.mockResolvedValue({ id: "account", tenantId: "t", role: "OPERATOR", status: "ACTIVE", securityVersion: 1 });
    db.grants.mockResolvedValue([{ tenantId: "t", userId: "account", branchCode: "007", role }]);
    expect(await canCreateEscala(account)).toBe(role !== "VIEWER");
    const permission = await branchPermission(account, "7");
    expect(permission).toEqual({ canEdit: role !== "VIEWER", canPublish: role === "APPROVER" });
    if (role === "VIEWER") expect(() => requireEscalaPermission(permission, "edit")).toThrow();
    else expect(() => requireEscalaPermission(permission, "edit")).not.toThrow();
    expect(db.grants).toHaveBeenCalledWith({ where: { tenantId: "t", userId: "account" }, select: { tenantId: true, userId: true, branchCode: true, role: true } });
    await expect(branchPermission(account, "08")).rejects.toMatchObject({ code: "ESCALA_BRANCH_FORBIDDEN" });
  });
  it("allows explicit generation without SAVE or APPLY and never grants administrative import by name", async () => {
    const row = session(); row.operator.branchGrants[0].capabilities = ["workspace.read", "schedule.generate", "import.manage", "access.manage"];
    db.session.mockResolvedValue(row);
    expect(await branchPermission(operator, "02")).toEqual({ canEdit: false, canPublish: false });
    await expect(requireEscalaCapability(operator, "schedule.generate", "02")).resolves.toBeDefined();
    for (const capability of ["workspace.save", "schedule.apply", "import.manage", "access.manage"] as const)
      await expect(requireEscalaCapability(operator, capability, "02")).rejects.toMatchObject({ status: 403 });
  });
  it.each(["foreign-tenant", "foreign-user", "empty"])("does not infer creation or branch access from %s account grants", async kind => {
    const account: EscalaActor = { userId: "account", tenantId: "t", admin: false };
    db.user.mockResolvedValue({ id: "account", tenantId: "t", role: "OPERATOR", status: "ACTIVE", securityVersion: 1 });
    db.grants.mockResolvedValue(kind === "empty" ? [] : [{ tenantId: kind === "foreign-tenant" ? "foreign" : "t",
      userId: kind === "foreign-user" ? "another" : "account", branchCode: "02", role: "PLANNER" }]);
    expect(await canCreateEscala(account)).toBe(false);
    await expect(branchPermission(account, "02")).rejects.toMatchObject({ code: "ESCALA_BRANCH_FORBIDDEN" });
  });
  it.each(["blocked", "demoted", "security-version"])("revalidates an account that becomes %s without using its operator cookie", async change => {
    const account: EscalaActor = { ...admin, accountSessionId: "login", moduleSessionId: "session" };
    await requireEscalaCapability(account, "settings.manage");
    db.user.mockResolvedValue({ id: "a", tenantId: "t", status: change === "blocked" ? "BLOCKED" : "ACTIVE",
      role: change === "demoted" ? "OPERATOR" : "ADMIN", securityVersion: change === "security-version" ? 2 : 1 });
    await expect(requireEscalaCapability(account, "settings.manage")).rejects.toMatchObject({ status: 403, code: "ESCALA_ACCESS_REQUIRED" });
    expect(db.session).not.toHaveBeenCalled();
  });
  it("keeps ADMIN_ONLY closed to general non-admin accounts without unioning a module session", async () => {
    const account: EscalaActor = { userId: "account", tenantId: "t", admin: false, moduleSessionId: "session" };
    db.user.mockResolvedValue({ id: "account", tenantId: "t", status: "ACTIVE", role: "OPERATOR", securityVersion: 1 });
    db.grants.mockResolvedValue([{ tenantId: "t", userId: "account", branchCode: "02", role: "APPROVER" }]);
    db.policy.mockResolvedValue({ tenantId: "t", mode: "ADMIN_ONLY", version: 1 });
    expect(await allowedBranches(account)).toEqual([]);
    expect(await canCreateEscala(account)).toBe(false);
    await expect(requireEscalaCapability(account, "schedule.generate", "02")).rejects.toMatchObject({ status: 403 });
    expect(db.session).not.toHaveBeenCalled();
  });
  it("fails closed when policy or grants are unavailable instead of returning a creation shortcut", async () => {
    db.policy.mockRejectedValueOnce(new Error("synthetic policy failure"));
    await expect(canCreateEscala(admin)).rejects.toThrow("synthetic policy failure");
    const account: EscalaActor = { userId: "account", tenantId: "t", admin: false };
    db.user.mockResolvedValue({ id: "account", tenantId: "t", status: "ACTIVE", role: "OPERATOR", securityVersion: 1 });
    db.grants.mockRejectedValueOnce(new Error("synthetic grant failure"));
    await expect(canCreateEscala(account)).rejects.toThrow("synthetic grant failure");
  });
  it("keeps the real administrator complete even in ADMIN_ONLY", async () => {
    db.policy.mockResolvedValue({ tenantId: "t", mode: "ADMIN_ONLY", version: 1 });
    await expect(requireEscalaCapability(admin, "settings.manage")).resolves.toBeDefined();
    expect(await allowedBranches(admin)).toBeNull();
  });
  it("scopes username access to explicit branches and denies administrative catalog definition", async () => {
    expect(await allowedBranches(operator)).toEqual(["02"]);
    expect(await allowedBranches(operator, "workspace.create")).toEqual([]);
    expect(await branchPermission(operator, "002")).toEqual({ canEdit: true, canPublish: false });
    await expect(requireEscalaCapability(operator, "settings.manage", "02")).rejects.toMatchObject({ status: 403 });
    await expect(branchPermission(operator, "03")).rejects.toMatchObject({ status: 403 });
  });
  it("allows a read-only nominal grant for branch 07 without opening branch 08", async () => {
    const row = session();
    row.operator.branchGrants[0].branchCode = "007";
    row.operator.branchGrants[0].capabilities = ["workspace.read"];
    db.session.mockResolvedValue(row);

    expect(await allowedBranches(operator)).toEqual(["07"]);
    expect(await branchPermission(operator, "07")).toEqual({ canEdit: false, canPublish: false });
    await expect(branchPermission(operator, "08")).rejects.toMatchObject({ status: 403, code: "ESCALA_BRANCH_FORBIDDEN" });
    await expect(requireEscalaCapability(operator, "access.manage", "07")).rejects.toMatchObject({ status: 403 });
  });
  it("does not trust caller admin or tenant fields", async () => {
    await expect(requireEscalaCapability({ ...admin, tenantId: "foreign" }, "access.manage")).rejects.toMatchObject({ status: 403 });
    db.user.mockResolvedValue({ id: "a", tenantId: "t", status: "ACTIVE", role: "OPERATOR" });
    await expect(requireEscalaCapability(admin, "access.manage")).rejects.toMatchObject({ status: 403 });
  });
  it.each(["revoked", "version", "expired", "legacy", "tenant", "inactive"])("rechecks %s state instead of trusting a previously admitted session", async kind => {
    const row = session();
    if (kind === "revoked") row.revokedAt = new Date();
    if (kind === "version") row.operator.permissionVersion = 2;
    if (kind === "expired") row.expiresAt = new Date(0);
    if (kind === "legacy") row.operatorId = null as never;
    if (kind === "tenant") row.operator.tenantId = "foreign";
    if (kind === "inactive") row.operator.active = false;
    db.session.mockResolvedValue(row);
    await expect(branchPermission(operator, "02")).rejects.toMatchObject({ status: 401 });
  });
  it("rejects canonical duplicate grants and ADMIN_ONLY without broad cookie fallback", async () => {
    const row = session(); row.operator.branchGrants.push({ ...row.operator.branchGrants[0], branchCode: "2" });
    db.session.mockResolvedValue(row);
    await expect(branchPermission(operator, "02")).rejects.toMatchObject({ status: 403 });
    db.policy.mockResolvedValue({ tenantId: "t", mode: "ADMIN_ONLY", version: 1 });
    await expect(allowedBranches(operator)).rejects.toMatchObject({ status: 401 });
  });
});
