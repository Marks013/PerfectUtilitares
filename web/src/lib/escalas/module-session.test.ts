import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const db = { escalaModuleSession: { findFirst: mocks.find, updateMany: mocks.update }, $executeRaw: mocks.lock };
  return { prisma: { $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) } };
});
import { decodeEscalaSessionCookie, encodeEscalaSessionCookie, EscalaSessionConfigurationError, hashEscalaSessionToken,
  escalaSessionCookieOptions, escalaSessionTtlMinutes, revokeEscalaModuleSessionCookie } from "./module-session";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "s".repeat(48));
  mocks.find.mockResolvedValue({ id: "session", tenantId: "t" }); mocks.update.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());
describe("scoped session cookie primitives and revocation", () => {
  it("uses its own signature namespace and rejects tampering and Unimed signatures", () => {
    const token = "x".repeat(43), cookie = encodeEscalaSessionCookie(token);
    expect(decodeEscalaSessionCookie(cookie)).toBe(token);
    expect(decodeEscalaSessionCookie(token + "." + createHmac("sha256", "s".repeat(48)).update(token).digest("base64url"))).toBeNull();
    for (const value of [null, "", "short.signature", cookie + ".extra", cookie.slice(0, -1) + "!", "y" + cookie.slice(1)])
      expect(decodeEscalaSessionCookie(value)).toBeNull();
  });
  it("revokes only the hashed token's tenant/session under the same transactional access lock", async () => {
    const token = "z".repeat(43); await revokeEscalaModuleSessionCookie(encodeEscalaSessionCookie(token));
    expect(mocks.find).toHaveBeenCalledWith({ where: { tokenHash: hashEscalaSessionToken(token) }, select: { id: true, tenantId: true } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "session", tenantId: "t", tokenHash: hashEscalaSessionToken(token), revokedAt: null },
      data: { revokedAt: expect.any(Date) } });
    expect(mocks.lock.mock.calls[0][1]).toBe("escala-access:t");
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
    expect(JSON.stringify(mocks.find.mock.calls)).not.toContain(token);
  });
  it("does not query malformed cookies or revoke a missing persisted session", async () => {
    await revokeEscalaModuleSessionCookie("bad"); expect(mocks.find).not.toHaveBeenCalled();
    mocks.find.mockResolvedValue(null); await revokeEscalaModuleSessionCookie(encodeEscalaSessionCookie("z".repeat(43)));
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("fails before persistence when signing becomes unavailable after cookie emission", async () => {
    const token = "A".repeat(43);
    const cookie = encodeEscalaSessionCookie(token);
    vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "short");
    expect(() => encodeEscalaSessionCookie(token)).toThrow("not configured securely");
    await expect(revokeEscalaModuleSessionCookie(cookie)).rejects.toBeInstanceOf(EscalaSessionConfigurationError);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("bounds session lifetime without changing any global configuration", () => {
    for (const minutes of [15, 480, 1440]) { vi.stubEnv("UNIMED_ACCESS_SESSION_TTL_MINUTES", String(minutes)); expect(escalaSessionTtlMinutes()).toBe(minutes); }
    for (const minutes of ["14", "1441", "", "not-a-number"]) { vi.stubEnv("UNIMED_ACCESS_SESSION_TTL_MINUTES", minutes); expect(escalaSessionTtlMinutes()).toBe(480); }
  });
  it("keeps the cookie HttpOnly, strict and secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(escalaSessionCookieOptions(60)).toEqual({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 60 });
  });
});
