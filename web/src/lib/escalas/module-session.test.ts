import { createHmac, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), list: vi.fn(), find: vi.fn(), remove: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn(), transaction: vi.fn(), cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: mocks.tenant }, escalaModuleSession: { findMany: mocks.list, findFirst: mocks.find, deleteMany: mocks.remove, create: mocks.create, updateMany: mocks.update }, $transaction: mocks.transaction } }));
import { createEscalaModuleSession, decodeEscalaSessionCookie, encodeEscalaSessionCookie, ESCALA_ACCESS_COOKIE, escalaSessionCookieOptions, getEscalaModuleSession, revokeEscalaModuleSessionCookie, verifyEscalaModuleSessionCookie } from "./module-session";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "s".repeat(48));
  vi.stubEnv("DEFAULT_TENANT_SLUG", "principal");
  vi.stubEnv("UNIMED_ACCESS_SESSION_TTL_MINUTES", "480");
  mocks.tenant.mockResolvedValue({ id: "company-default" }); mocks.list.mockResolvedValue([]); mocks.create.mockResolvedValue({ id: "module-1" }); mocks.remove.mockResolvedValue({ count: 0 }); mocks.update.mockResolvedValue({ count: 1 }); mocks.cookies.mockResolvedValue(new Map());
  mocks.transaction.mockImplementation(async operation => operation({ escalaModuleSession: { deleteMany: mocks.remove, create: mocks.create }, auditLog: { create: mocks.audit } }));
});
afterEach(() => vi.unstubAllEnvs());

describe("Escalas isolated operational session", () => {
  it("creates a scoped opaque session and records shared origin without inventing an individual", async () => {
    const before = Date.now(), session = await createEscalaModuleSession(), token = decodeEscalaSessionCookie(session.value);
    expect(session.maxAgeSeconds).toBe(28800); expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 28800_000);
    expect(mocks.tenant).toHaveBeenCalledWith({ where: { slug: "principal" }, select: { id: true } });
    expect(mocks.create).toHaveBeenCalledWith({ data: { tenantId: "company-default", tokenHash: createHash("sha256").update("escalas:" + token).digest("hex"), expiresAt: session.expiresAt }, select: { id: true } });
    expect(mocks.audit).toHaveBeenCalledWith({ data: { action: "LOGIN", entity: "EscalaModuleSession", entityId: "module-1", metadata: { accessChannel: "ESCALAS_MODULE_PASSWORD", tenantId: "company-default" } } });
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(token);
  });
  it("uses a separate signature namespace, rejects Unimed signatures and changed or malformed tokens", () => {
    const token = "x".repeat(43), cookie = encodeEscalaSessionCookie(token);
    expect(decodeEscalaSessionCookie(cookie)).toBe(token);
    expect(decodeEscalaSessionCookie(token + "." + createHmac("sha256", "s".repeat(48)).update(token).digest("base64url"))).toBeNull();
    for (const value of [null, "", "short.signature", cookie + ".extra", cookie.slice(0, -1) + "!", "y" + cookie.slice(1)]) expect(decodeEscalaSessionCookie(value)).toBeNull();
  });
  it("fails closed with missing secret and never queries the database for malformed cookies", async () => {
    vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "short");
    expect(() => encodeEscalaSessionCookie("x".repeat(43))).toThrow("not configured securely");
    expect(await verifyEscalaModuleSessionCookie("x".repeat(43) + ".signature")).toBeNull();
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("verifies only active non-revoked sessions in the current configured company", async () => {
    const session = { id: "s1", tenantId: "company-default", expiresAt: new Date(Date.now() + 60_000) };
    mocks.find.mockResolvedValue(session);
    const cookie = encodeEscalaSessionCookie("x".repeat(43));
    expect(await verifyEscalaModuleSessionCookie(cookie)).toEqual(session);
    expect(mocks.find).toHaveBeenCalledWith({ where: { tokenHash: expect.any(String), revokedAt: null, expiresAt: { gt: expect.any(Date) }, tenant: { slug: "principal" } }, select: { id: true, tenantId: true, expiresAt: true } });
    mocks.find.mockResolvedValue(null);
    expect(await verifyEscalaModuleSessionCookie(cookie)).toBeNull();
  });
  it("reads only its own cookie and revokes by a hash rather than a browser-supplied identity", async () => {
    const token = "z".repeat(43), cookie = encodeEscalaSessionCookie(token);
    mocks.cookies.mockResolvedValue(new Map([[ESCALA_ACCESS_COOKIE, { value: cookie }], ["perfectutilitares.unimed-access", { value: "foreign" }]]));
    mocks.find.mockResolvedValue({ id: "s1", tenantId: "company-default", expiresAt: new Date(Date.now() + 60_000) });
    expect(await getEscalaModuleSession()).toMatchObject({ id: "s1" });
    await revokeEscalaModuleSessionCookie(cookie);
    expect(mocks.update).toHaveBeenCalledWith({ where: { tokenHash: createHash("sha256").update("escalas:" + token).digest("hex"), revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    await revokeEscalaModuleSessionCookie("bad"); expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it("bounds lifetime and active sessions and never changes a company when none is configured", async () => {
    vi.stubEnv("UNIMED_ACCESS_SESSION_TTL_MINUTES", "999999"); mocks.list.mockResolvedValue([{ id: "old-session" }]);
    expect((await createEscalaModuleSession()).maxAgeSeconds).toBe(28800);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "company-default" }), skip: 19, take: 1000 }));
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: expect.arrayContaining([{ id: { in: ["old-session"] } }]) } }));
    mocks.tenant.mockResolvedValue(null); await expect(createEscalaModuleSession()).rejects.toThrow("tenant was not found");
  });
  it("sets protected same-site cookies and expiration", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(escalaSessionCookieOptions(60)).toEqual({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 60 });
    expect(escalaSessionCookieOptions(0).maxAge).toBe(0);
  });
});
