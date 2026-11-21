import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), transaction: vi.fn(), cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { encodeEscalaSessionCookie, ESCALA_ACCESS_COOKIE, EscalaSessionConfigurationError } from "./module-session";
import { getEscalaScopedModuleSession, verifyEscalaScopedSessionCookie } from "./operator-session-store";

const now = new Date("2026-12-01T12:00:00Z");
const token = Buffer.alloc(32, 7).toString("base64url");
function row() {
  return {
    id: "session-1", tenantId: "tenant-a", operatorId: "operator-1", permissionVersion: 3, accessPolicyVersion: 2,
    createdAt: new Date(now.getTime() - 60_000), expiresAt: new Date(now.getTime() + 60_000), revokedAt: null,
    tenant: { id: "tenant-a", escalaModuleAccessPolicy: { tenantId: "tenant-a", mode: "SCOPED", version: 2 } },
    operator: { id: "operator-1", tenantId: "tenant-a", active: true, permissionVersion: 3, branchGrants: [
      { tenantId: "tenant-a", operatorId: "operator-1", branchCode: "01", active: true, capabilities: ["workspace.read"] },
    ] },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "s".repeat(48));
  vi.stubEnv("DEFAULT_TENANT_SLUG", " configured-company ");
  mocks.find.mockResolvedValue(row());
  mocks.cookies.mockResolvedValue(new Map());
  mocks.transaction.mockImplementation(async operation => operation({ escalaModuleSession: { findFirst: mocks.find } }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("persisted scoped Escalas session adapter", () => {
  it("verifies a real signed cookie and resolves current persisted identity and grants", async () => {
    const result = await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token));
    expect(result).toEqual({
      kind: "resolved", principal: { kind: "operator", id: "operator-1", tenantId: "tenant-a", active: true, branchGrants: row().operator.branchGrants },
      sessionId: "session-1", permissionVersion: 3, accessPolicyVersion: 2, expiresAtMs: now.getTime() + 60_000,
    });
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: {
      tokenHash: createHash("sha256").update(`escalas:${token}`).digest("hex"), tenant: { slug: "configured-company" },
    } }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 5_000 });
    expect(JSON.stringify(mocks.find.mock.calls)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("selects only access metadata, excluding names, passwords and token hashes from results", async () => {
    await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token));
    const selection = mocks.find.mock.calls[0][0].select;
    expect(selection.tokenHash).toBeUndefined();
    expect(selection.operator.select.usernameNormalized).toBeUndefined();
    expect(selection.operator.select.displayName).toBeUndefined();
    expect(selection.operator.select.branchGrants.select).toEqual({ tenantId: true, operatorId: true, branchCode: true, active: true, capabilities: true });
    expect(selection.tenant.select).toEqual({ id: true, escalaModuleAccessPolicy: { select: { tenantId: true, mode: true, version: true } } });
  });

  it("does not query storage for absent, malformed, forged or another module's cookie", async () => {
    const foreignSignature = createHmac("sha256", "s".repeat(48)).update(`unimed:${token}`).digest("base64url");
    for (const cookie of [undefined, null, "", token, "bad.signature", `${token}.${foreignSignature}`, `${encodeEscalaSessionCookie(token)}.extra`]) {
      expect(await verifyEscalaScopedSessionCookie(cookie)).toBeNull();
    }
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed before storage when cookie configuration cannot verify integrity", async () => {
    const value = encodeEscalaSessionCookie(token);
    vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "");
    await expect(verifyEscalaScopedSessionCookie(value)).rejects.toBeInstanceOf(EscalaSessionConfigurationError);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("denies an unknown record and does not reinterpret an old password session as an operator", async () => {
    mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...row(), operatorId: null, operator: null, permissionVersion: null, accessPolicyVersion: null });
    expect(await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token))).toBeNull();
    expect(await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token))).toBeNull();
  });

  it("denies inactive, revoked, expired and future-created records", async () => {
    for (const record of [
      { ...row(), operator: { ...row().operator, active: false } },
      { ...row(), revokedAt: new Date(now.getTime() - 1) },
      { ...row(), expiresAt: now },
      { ...row(), createdAt: new Date(now.getTime() + 1) },
    ]) {
      mocks.find.mockResolvedValueOnce(record);
      expect(await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token))).toBeNull();
    }
  });

  it("denies absent, legacy and administrative-only module modes", async () => {
    for (const policy of [null, { ...row().tenant.escalaModuleAccessPolicy, mode: "ADMIN_ONLY" }, { ...row().tenant.escalaModuleAccessPolicy, mode: "LEGACY" }, { ...row().tenant.escalaModuleAccessPolicy, mode: "unknown" }]) {
      mocks.find.mockResolvedValueOnce({ ...row(), tenant: { id: "tenant-a", escalaModuleAccessPolicy: policy } });
      expect(await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token))).toBeNull();
    }
  });

  it("reads current versions again on each call so a previously accepted session can be revoked", async () => {
    const value = encodeEscalaSessionCookie(token);
    expect(await verifyEscalaScopedSessionCookie(value)).not.toBeNull();
    mocks.find.mockResolvedValueOnce({ ...row(), operator: { ...row().operator, permissionVersion: 4 } });
    expect(await verifyEscalaScopedSessionCookie(value)).toBeNull();
    mocks.find.mockResolvedValueOnce({ ...row(), tenant: { id: "tenant-a", escalaModuleAccessPolicy: { ...row().tenant.escalaModuleAccessPolicy, version: 3 } } });
    expect(await verifyEscalaScopedSessionCookie(value)).toBeNull();
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });

  it("checks expiry after awaiting storage, including a session that expires during the query", async () => {
    mocks.find.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(now.getTime() + 60_000));
      return row();
    });
    expect(await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token))).toBeNull();
  });

  it("rejects mismatched tenant, operator and grant ownership without returning foreign metadata", async () => {
    for (const record of [
      { ...row(), tenantId: "tenant-b" },
      { ...row(), operator: { ...row().operator, tenantId: "tenant-b" } },
      { ...row(), operator: { ...row().operator, id: "operator-other" } },
      { ...row(), tenant: { id: "tenant-b", escalaModuleAccessPolicy: row().tenant.escalaModuleAccessPolicy } },
      { ...row(), operator: { ...row().operator, branchGrants: [{ ...row().operator.branchGrants[0], tenantId: "tenant-b" }] } },
      { ...row(), operator: { ...row().operator, branchGrants: [{ ...row().operator.branchGrants[0], operatorId: "operator-other" }] } },
    ]) {
      mocks.find.mockResolvedValueOnce(record);
      expect(await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token))).toBeNull();
    }
  });

  it("uses an explicit configured tenant or the existing principal slug, never a first-tenant query", async () => {
    vi.stubEnv("DEFAULT_TENANT_SLUG", "  ");
    await verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token));
    expect(mocks.find.mock.calls[0][0].where.tenant).toEqual({ slug: "principal" });
  });

  it("reads only the Escalas cookie from the request cookie store", async () => {
    const get = vi.fn(() => ({ value: encodeEscalaSessionCookie(token) }));
    mocks.cookies.mockResolvedValueOnce({ get });
    expect(await getEscalaScopedModuleSession()).toMatchObject({ kind: "resolved", sessionId: "session-1" });
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(ESCALA_ACCESS_COOKIE);
  });

  it("propagates a database outage for the HTTP layer to handle instead of authorizing or using legacy access", async () => {
    const unavailable = new Error("synthetic database unavailable");
    mocks.find.mockRejectedValueOnce(unavailable);
    await expect(verifyEscalaScopedSessionCookie(encodeEscalaSessionCookie(token))).rejects.toBe(unavailable);
  });
});
