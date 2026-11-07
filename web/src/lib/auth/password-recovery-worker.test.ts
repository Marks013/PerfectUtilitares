import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgBoss } from "pg-boss";
import { processPasswordRecovery, readPasswordRecoverySecret, recoveryToken, registerPasswordRecoveryWorker } from "./password-recovery-worker";
import { PASSWORD_RECOVERY_TTL_MS, type RecoveryRequest } from "./password-recovery";

const mocks = vi.hoisted(() => ({ findUser: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), send: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser }, userInvitation: { upsert: mocks.upsert, deleteMany: mocks.deleteMany } } }));
vi.mock("@/lib/email/resend", () => ({ sendPasswordResetEmail: mocks.send }));

const now = new Date("2026-11-07T12:00:00.000Z");
const secret = Buffer.alloc(32, 31);
const request: RecoveryRequest = {
  version: 1, requestId: "10a27464-6836-4c27-b2f2-1841c6bec389", userId: "user-1", tenantId: "tenant-1",
  securityVersion: 1, resetStamp: "a".repeat(64), issuedAt: now.getTime() - 1_000,
  expiresAt: now.getTime() - 1_000 + PASSWORD_RECOVERY_TTL_MS,
  baseUrl: "https://app.example.test", from: "sender@example.test",
};
const user = { id: "user-1", tenantId: "tenant-1", status: "ACTIVE", securityVersion: 1, email: "user@example.test", name: "Original Name", role: "OPERATOR" };
const invitations = new Map<string, Record<string, unknown>>();

beforeEach(() => {
  vi.clearAllMocks(); invitations.clear();
  vi.stubEnv("APP_URL", request.baseUrl); vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("RESEND_FROM_EMAIL", request.from);
  mocks.findUser.mockResolvedValue({ ...user }); mocks.send.mockResolvedValue(undefined); mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.upsert.mockImplementation(async ({ where, create }) => {
    const existing = invitations.get(where.tokenHash);
    if (existing) return existing;
    const row = { id: "invitation-1", ...create, acceptedAt: null };
    invitations.set(where.tokenHash, row); return row;
  });
  mocks.readFile.mockResolvedValue(`${secret.toString("base64url")}\n`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("password recovery consumer", () => {
  it("stores only a hashed bearer token and uses stable delivery identity", async () => {
    await processPasswordRecovery(request, secret, now);
    const token = recoveryToken(request, secret);
    const hash = createHash("sha256").update(token).digest("hex");
    expect(invitations.get(hash)).toMatchObject({ resetUserId: user.id, resetStamp: request.resetStamp, tokenHash: hash, expiresAt: new Date(request.expiresAt), purpose: "PASSWORD_RESET" });
    expect(JSON.stringify(mocks.upsert.mock.calls)).not.toContain(token);
    expect(mocks.send).toHaveBeenCalledWith({ to: user.email, name: user.name, resetUrl: `${request.baseUrl}/convite/${token}`, from: request.from, idempotencyKey: `password-recovery/${request.requestId}` });
  });
  it("retries ambiguous failures with the same link, expiry and frozen email payload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.send.mockRejectedValueOnce(new Error("RESEND_DELIVERY_TRANSIENT"));
    await expect(processPasswordRecovery(request, secret, now)).rejects.toThrow("PASSWORD_RECOVERY_DELIVERY_RETRY");
    mocks.findUser.mockResolvedValueOnce({ ...user, name: "Cosmetic new name" });
    await processPasswordRecovery(request, secret, new Date(now.getTime() + 20_000));
    expect(invitations.size).toBe(1);
    expect(mocks.send.mock.calls[1]?.[0]).toEqual(mocks.send.mock.calls[0]?.[0]);
    expect(mocks.upsert.mock.calls[1]?.[0].update).toEqual({});
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
  it("does not resend a consumed token", async () => {
    await processPasswordRecovery(request, secret, now);
    const row = [...invitations.values()][0];
    if (!row) throw new Error("Expected persisted invitation");
    row.acceptedAt = now;
    mocks.send.mockClear();
    await processPasswordRecovery(request, secret, now);
    expect(invitations.size).toBe(1); expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([null, { ...user, status: "BLOCKED" }, { ...user, tenantId: "other" }, { ...user, securityVersion: 2 }])("preserves security invalidation: %j", async (found) => {
    mocks.findUser.mockResolvedValueOnce(found);
    await processPasswordRecovery(request, secret, now);
    expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([
    { ...request, expiresAt: request.expiresAt + 1 },
    { ...request, resetStamp: "invalid" },
    { ...request, version: 2 },
    { ...request, email: "injected@example.test" },
    { ...request, issuedAt: now.getTime() + 1, expiresAt: now.getTime() + 1 + PASSWORD_RECOVERY_TTL_MS },
  ])("ignores malformed or future payload without persistence", async (payload) => {
    await processPasswordRecovery(payload, secret, now);
    expect(mocks.findUser).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("does not recreate expired invitations or query accounts for null-user requests", async () => {
    await processPasswordRecovery(request, secret, new Date(request.expiresAt));
    await processPasswordRecovery({ ...request, userId: null, tenantId: null, securityVersion: null, resetStamp: null }, secret, now);
    expect(mocks.findUser).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects changed origins before creating a link", async () => {
    await expect(processPasswordRecovery({ ...request, baseUrl: "https://attacker.example.test" }, secret, now)).rejects.toThrow("CONFIGURATION_UNAVAILABLE");
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
  it("ends definitive refusals without invalidating a possibly delivered link or exposing personal logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.send.mockRejectedValueOnce(new Error("RESEND_DELIVERY_REJECTED"));
    await processPasswordRecovery(request, secret, now);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(invitations.size).toBe(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(user.email);
  });
  it("preserves an ambiguous delivery when the retry is definitively rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.send.mockRejectedValueOnce(new Error("RESEND_DELIVERY_TRANSIENT"));
    await expect(processPasswordRecovery(request, secret, now)).rejects.toThrow("DELIVERY_RETRY");
    const stored = [...invitations.values()][0];
    mocks.send.mockRejectedValueOnce(new Error("RESEND_DELIVERY_REJECTED"));
    await processPasswordRecovery(request, secret, now);
    expect([...invitations.values()][0]).toBe(stored);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe("recovery secret and worker registration", () => {
  it("reads only the dedicated canonical 32-byte secret", async () => {
    vi.stubEnv("PASSWORD_RECOVERY_SECRET_FILE", "/run/secrets/password_recovery_secret");
    await expect(readPasswordRecoverySecret()).resolves.toEqual(secret);
    expect(mocks.readFile).toHaveBeenCalledWith("/run/secrets/password_recovery_secret", "utf8");
  });
  it.each(["short", "!".repeat(43), `${"A".repeat(42)}B`])("rejects malformed dedicated secrets", async (encoded) => {
    vi.stubEnv("PASSWORD_RECOVERY_SECRET_FILE", "/run/secrets/test"); mocks.readFile.mockResolvedValueOnce(encoded);
    await expect(readPasswordRecoverySecret()).rejects.toThrow("SECRET_INVALID");
  });
  it("fails readiness instead of silently disabling recovery without a key", async () => {
    vi.stubEnv("PASSWORD_RECOVERY_SECRET_FILE", "");
    const boss = { work: vi.fn(), getQueue: vi.fn() };
    await expect(registerPasswordRecoveryWorker(boss as unknown as PgBoss)).rejects.toThrow("SECRET_REQUIRED");
    expect(boss.work).not.toHaveBeenCalled();
  });
  it("registers a bounded consumer on the supplied shared queue", async () => {
    vi.stubEnv("PASSWORD_RECOVERY_SECRET_FILE", "/run/secrets/test");
    const boss = { getQueue: vi.fn(async () => ({})), work: vi.fn(async () => "consumer") };
    await expect(registerPasswordRecoveryWorker(boss as unknown as PgBoss)).resolves.toBe("consumer");
    expect(boss.work).toHaveBeenCalledWith("perfect-password-recovery", expect.objectContaining({ localConcurrency: 1, batchSize: 1 }), expect.any(Function));
  });
});
