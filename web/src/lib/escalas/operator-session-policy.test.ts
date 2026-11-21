import { describe, expect, it } from "vitest";
import { decideEscalaPermission, selectEscalaPrincipal, type EscalaPrincipal } from "./permissions";
import { resolveEscalaOperatorSession } from "./operator-session-policy";
import { resolveEscalaPermissionScope } from "./permission-scope";

function fixture() {
  return {
    tenantId: "tenant-a", now: new Date("2026-11-13T12:00:00Z"),
    policy: { tenantId: "tenant-a", mode: "SCOPED", version: 3 },
    session: { id: "session-a", tenantId: "tenant-a", operatorId: "person-a", permissionVersion: 7, accessPolicyVersion: 3,
      createdAt: new Date("2026-11-13T11:00:00Z"), expiresAt: new Date("2026-11-13T13:00:00Z"), revokedAt: null as Date | null },
    operator: { id: "person-a", tenantId: "tenant-a", active: true, permissionVersion: 7,
      branchGrants: [{ tenantId: "tenant-a", operatorId: "person-a", branchCode: "01", active: true,
        capabilities: ["workspace.read", "workspace.save", "export.schedule.pdf"] }] },
  };
}
function denied(input: Parameters<typeof resolveEscalaOperatorSession>[0], reason: string) {
  expect(resolveEscalaOperatorSession(input)).toEqual({ kind: "denied", reason });
}

describe("canonical operator session state, independent of cookie and database adapters", () => {
  it("resolves a current session to a non-administrative principal and effective branch scope", () => {
    const result = resolveEscalaOperatorSession(fixture());
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("Expected current session");
    expect(result).toMatchObject({ sessionId: "session-a", permissionVersion: 7, accessPolicyVersion: 3,
      expiresAtMs: Date.parse("2026-11-13T13:00:00Z"), principal: { kind: "operator", id: "person-a", tenantId: "tenant-a" } });
    const context = { principal: result.principal, tenantId: "tenant-a", mode: "SCOPED" };
    expect(resolveEscalaPermissionScope(context, "workspace.save")).toEqual({ kind: "branches", tenantId: "tenant-a", branchCodes: ["01"] });
    expect(resolveEscalaPermissionScope(context, "import.manage")).toEqual({ kind: "none" });
    expect(decideEscalaPermission({ ...context, branchCode: "02" }, "workspace.read").allowed).toBe(false);
  });

  it("fails closed without a canonical tenant, valid clock or current access policy", () => {
    const input = fixture();
    for (const tenantId of ["", " tenant-a "]) denied({ ...input, tenantId }, "INVALID_CONTEXT");
    denied({ ...input, now: new Date(Number.NaN) }, "INVALID_CONTEXT");
    denied({ ...input, policy: null }, "INVALID_CONTEXT");
    for (const version of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      denied({ ...input, policy: { ...input.policy, version } }, "INVALID_CONTEXT");
    }
  });

  it("never restores username access in ADMIN_ONLY, LEGACY or an unknown mode", () => {
    const input = fixture();
    for (const mode of ["ADMIN_ONLY", "LEGACY", "", "scoped", "UNKNOWN"]) {
      denied({ ...input, policy: { ...input.policy, mode } }, "SCOPED_ACCESS_REQUIRED");
    }
  });

  it("binds policy, session and operator independently to the canonical tenant", () => {
    const input = fixture();
    denied({ ...input, policy: { ...input.policy, tenantId: "tenant-b" } }, "TENANT_FORBIDDEN");
    denied({ ...input, session: { ...input.session, tenantId: "tenant-b" } }, "TENANT_FORBIDDEN");
    denied({ ...input, operator: { ...input.operator, tenantId: "tenant-b" } }, "TENANT_FORBIDDEN");
  });

  it("rejects missing and legacy unbound sessions without inferring an operator", () => {
    const input = fixture();
    denied({ ...input, session: null }, "SESSION_REQUIRED");
    denied({ ...input, session: { ...input.session, operatorId: null } }, "INVALID_SESSION");
    denied({ ...input, session: { ...input.session, id: "" } }, "INVALID_SESSION");
    denied({ ...input, session: { ...input.session, operatorId: " person-a " } }, "INVALID_SESSION");
  });

  it("rejects any revoked record, even if the revocation date is future or malformed", () => {
    const input = fixture();
    for (const revokedAt of [new Date("2026-11-13T11:30:00Z"), new Date("2026-11-14T12:00:00Z"), new Date(Number.NaN)]) {
      denied({ ...input, session: { ...input.session, revokedAt } }, "SESSION_REVOKED");
    }
  });

  it("expires exactly at the deadline without extending the stored lifetime", () => {
    const input = fixture();
    expect(resolveEscalaOperatorSession({ ...input, now: new Date(input.session.expiresAt.getTime() - 1) }).kind).toBe("resolved");
    denied({ ...input, now: input.session.expiresAt }, "SESSION_EXPIRED");
    denied({ ...input, now: new Date(input.session.expiresAt.getTime() + 1) }, "SESSION_EXPIRED");
  });

  it("rejects invalid, inverted and future-created session timestamps", () => {
    const input = fixture();
    for (const session of [
      { ...input.session, createdAt: new Date(Number.NaN) }, { ...input.session, expiresAt: new Date(Number.NaN) },
      { ...input.session, createdAt: new Date(input.now.getTime() + 1) },
      { ...input.session, expiresAt: input.session.createdAt },
    ]) denied({ ...input, session }, "INVALID_SESSION");
  });

  it("requires the exact active operator referenced by the session", () => {
    const input = fixture();
    denied({ ...input, operator: null }, "IDENTITY_REQUIRED");
    denied({ ...input, operator: { ...input.operator, id: "person-b" } }, "IDENTITY_REQUIRED");
    denied({ ...input, operator: { ...input.operator, active: false } }, "INACTIVE_IDENTITY");
  });

  it("invalidates prior sessions when either operator permissions or access policy changes", () => {
    const input = fixture();
    expect(resolveEscalaOperatorSession(input).kind).toBe("resolved");
    denied({ ...input, operator: { ...input.operator, permissionVersion: 8 } }, "VERSION_MISMATCH");
    denied({ ...input, policy: { ...input.policy, version: 4 } }, "VERSION_MISMATCH");
    denied({ ...input, session: { ...input.session, permissionVersion: 8 } }, "VERSION_MISMATCH");
    denied({ ...input, session: { ...input.session, accessPolicyVersion: 4 } }, "VERSION_MISMATCH");
  });

  it("rejects legacy, fractional and invalid version values", () => {
    const input = fixture();
    for (const version of [null, 0, -1, 7.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      denied({ ...input, session: { ...input.session, permissionVersion: version } }, "VERSION_MISMATCH");
      denied({ ...input, session: { ...input.session, accessPolicyVersion: version } }, "VERSION_MISMATCH");
    }
    denied({ ...input, operator: { ...input.operator, permissionVersion: Number.NaN } }, "VERSION_MISMATCH");
  });

  it("copies a frozen grant snapshot but uses freshly supplied grants on the next resolution", () => {
    const input = fixture();
    const result = resolveEscalaOperatorSession(input);
    if (result.kind !== "resolved") throw new Error("Expected current session");
    input.operator.branchGrants[0].capabilities.push("import.manage");
    input.operator.branchGrants[0].active = false;
    expect(result.principal.branchGrants[0].capabilities).not.toContain("import.manage");
    expect(Object.isFrozen(result.principal.branchGrants[0].capabilities)).toBe(true);
    expect(Object.isFrozen(result.principal.branchGrants[0])).toBe(true);
    expect(Object.isFrozen(result.principal)).toBe(true);
    const current = resolveEscalaOperatorSession(input);
    if (current.kind !== "resolved") throw new Error("Expected identity with revoked branch grant");
    expect(resolveEscalaPermissionScope({ principal: current.principal, tenantId: "tenant-a", mode: "SCOPED" }, "workspace.read")).toEqual({ kind: "none" });
  });

  it("does not convert names or injected roles into administrative identity", () => {
    const input = fixture();
    const operator = { ...input.operator, displayName: "ADMIN", usernameNormalized: "admin", role: "ADMIN" };
    const result = resolveEscalaOperatorSession({ ...input, operator });
    if (result.kind !== "resolved") throw new Error("Expected operator identity");
    expect(result.principal).not.toHaveProperty("role");
    expect(decideEscalaPermission({ principal: result.principal, tenantId: "tenant-a", branchCode: "01", mode: "SCOPED" }, "access.manage").allowed).toBe(false);
  });

  it("does not override account precedence when composed with the existing identity selector", () => {
    const result = resolveEscalaOperatorSession(fixture());
    if (result.kind !== "resolved") throw new Error("Expected operator identity");
    const blocked: EscalaPrincipal = { kind: "account", id: "account-a", tenantId: "tenant-a", status: "BLOCKED", role: "ADMIN", branchGrants: [] };
    const principal = selectEscalaPrincipal(blocked, result.principal);
    expect(principal).toBe(blocked);
    expect(resolveEscalaPermissionScope({ principal, tenantId: "tenant-a", mode: "SCOPED" }, "workspace.read")).toEqual({ kind: "none" });
  });
});
