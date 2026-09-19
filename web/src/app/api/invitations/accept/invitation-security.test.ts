import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getSecurityStamp } from "@/lib/auth/security-stamp";

const mocks = vi.hoisted(() => ({
  limited: vi.fn(),
  userFind: vi.fn(), userCreate: vi.fn(), userUpdate: vi.fn(),
  invitationFind: vi.fn(), invitationCreate: vi.fn(), invitationUpdate: vi.fn(), invitationDelete: vi.fn(),
  tenantFind: vi.fn(), audit: vi.fn(), lock: vi.fn(), transaction: vi.fn(),
  hash: vi.fn(), sendInvite: vi.fn(), sendReset: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("bcryptjs", () => ({ hash: mocks.hash }));
vi.mock("@/lib/api/security", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/security")>(),
  enforcePersistentRateLimit: mocks.limited,
  requireAdmin: async () => ({ ok: true, session: { user: { id: "admin-id" } } }),
}));
vi.mock("@/lib/email/resend", () => ({
  getAppUrl: () => "https://security.example.test",
  sendInvitationEmail: mocks.sendInvite,
  sendPasswordResetEmail: mocks.sendReset,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  user: { findUnique: mocks.userFind },
  tenant: { findUnique: mocks.tenantFind },
  userInvitation: { findUnique: mocks.invitationFind, create: mocks.invitationCreate, delete: mocks.invitationDelete },
  auditLog: { create: mocks.audit },
} }));

import { POST as accept } from "./route";
import { POST as invite } from "@/app/api/admin/invitations/route";
import { POST as recover } from "@/app/api/password-reset/request/route";

const user = {
  id: "user-id", tenantId: "tenant-id", email: "user@example.test", name: "Usuario Teste",
  role: "OPERATOR", status: "ACTIVE", passwordHash: "existing-hash", securityVersion: 1,
};
const invitation = {
  id: "invitation-id", tenantId: user.tenantId, email: user.email, name: user.name, role: user.role,
  purpose: "INVITATION", acceptedAt: null, expiresAt: new Date("2099-01-01"),
};
const tx = {
  $queryRaw: mocks.lock,
  user: { findUnique: mocks.userFind, create: mocks.userCreate, update: mocks.userUpdate },
  userInvitation: { updateMany: mocks.invitationUpdate },
  auditLog: { create: mocks.audit },
};
const credentials = { token: "a".repeat(48), password: "Replacement-Password-2026" };
function request(body: unknown = credentials, headers: Record<string, string> = {}) {
  return new Request("https://security.example.test/api/invitations/accept", {
    method: "POST", headers: { origin: "https://security.example.test", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function recoveryInvitation(overrides: Record<string, unknown> = {}) {
  return { ...invitation, purpose: "PASSWORD_RESET", resetUserId: user.id, resetStamp: getSecurityStamp(user), ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://security.example.test");
  vi.stubEnv("AUTH_URL", "https://security.example.test");
  vi.stubEnv("RESEND_API_KEY", "test-placeholder");
  vi.stubEnv("RESEND_FROM_EMAIL", "test@example.test");
  mocks.limited.mockResolvedValue(null);
  mocks.hash.mockResolvedValue("replacement-hash");
  mocks.invitationFind.mockResolvedValue(invitation);
  mocks.invitationCreate.mockImplementation(async ({ data }) => ({ ...invitation, ...data }));
  mocks.invitationUpdate.mockResolvedValue({ count: 1 });
  mocks.userFind.mockResolvedValue(null);
  mocks.userCreate.mockResolvedValue({ id: user.id, email: user.email });
  mocks.userUpdate.mockResolvedValue({ id: user.id, email: user.email });
  mocks.tenantFind.mockResolvedValue({ id: user.tenantId, name: "Empresa Teste" });
  mocks.transaction.mockImplementation(async (work: (client: typeof tx) => unknown) => work(tx));
});
afterEach(() => vi.unstubAllEnvs());

describe("invitation and recovery security boundaries", () => {
  it.each<{ body: unknown; headers: Record<string, string>; status: number }>([
    { body: "{", headers: {}, status: 400 },
    { body: { ...credentials, token: "short" }, headers: {}, status: 400 },
    { body: { ...credentials, password: "á".repeat(37) }, headers: {}, status: 400 },
    { body: credentials, headers: { "content-type": "text/plain" }, status: 415 },
    { body: credentials, headers: { "content-length": "9000" }, status: 413 },
  ])("rejects invalid input before token lookup: $status", async ({ body, headers, status }) => {
    expect((await accept(request(body, headers))).status).toBe(status);
    expect(mocks.invitationFind).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("honors the persistent rate limit before processing a token", async () => {
    mocks.limited.mockResolvedValueOnce(Response.json({ error: "limited" }, { status: 429 }));
    expect((await accept(request())).status).toBe(429);
    expect(mocks.invitationFind).not.toHaveBeenCalled();
  });

  it.each([
    { record: null, status: 404 },
    { record: { ...invitation, acceptedAt: new Date() }, status: 404 },
    { record: { ...invitation, expiresAt: new Date("2000-01-01") }, status: 410 },
  ])("rejects unusable tokens before hashing a new password: $status", async ({ record, status }) => {
    mocks.invitationFind.mockResolvedValueOnce(record);
    expect((await accept(request())).status).toBe(status);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("recovery changes only the password and consumes sibling links", async () => {
    mocks.invitationFind.mockResolvedValueOnce(recoveryInvitation());
    mocks.userFind.mockResolvedValueOnce(user);
    expect((await accept(request())).status).toBe(201);
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: user.id }, data: { passwordHash: "replacement-hash" },
    }));
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.invitationUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { acceptedAt: expect.any(Date) },
    });
    expect(mocks.invitationUpdate).toHaveBeenNthCalledWith(2, {
      where: { email: user.email, acceptedAt: null }, data: { acceptedAt: expect.any(Date) },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "RESET_PASSWORD" }) }));
  });

  it.each([
    null,
    { ...user, status: "BLOCKED" },
    { ...user, id: "different-user" },
    { ...user, securityVersion: 2 },
  ])("rejects recovery after deletion or a security change: %j", async (currentUser) => {
    mocks.invitationFind.mockResolvedValueOnce(recoveryInvitation());
    mocks.userFind.mockResolvedValueOnce(currentUser);
    expect((await accept(request())).status).toBe(410);
    expect(mocks.invitationUpdate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it.each(["existing-account", "unknown-purpose"])("prevents an invitation from overwriting accounts: %s", async (condition) => {
    if (condition === "existing-account") mocks.userFind.mockResolvedValueOnce(user);
    else mocks.invitationFind.mockResolvedValueOnce({ ...invitation, purpose: "UNKNOWN" });
    expect((await accept(request())).status).toBe(410);
    expect(mocks.invitationUpdate).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("does not write a user if another request already claimed the token", async () => {
    mocks.invitationUpdate.mockResolvedValueOnce({ count: 0 });
    expect((await accept(request())).status).toBe(410);
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns a conflict if concurrent account creation wins", async () => {
    mocks.userCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "test" }));
    const response = await accept(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "USER_EMAIL_EXISTS" } });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("propagates unexpected transaction failures", async () => {
    const error = new Error("Transaction unavailable");
    mocks.lock.mockRejectedValueOnce(error);
    await expect(accept(request())).rejects.toBe(error);
    expect(mocks.invitationUpdate).not.toHaveBeenCalled();
  });
});

describe("issuing invitation and password recovery links", () => {
  it("stores only the invitation token hash and delivers the matching link", async () => {
    const response = await invite(request({ tenantId: user.tenantId, email: user.email, name: user.name, role: user.role }));
    expect(response.status).toBe(201);
    const body = await response.json();
    const token = new URL(body.inviteUrl).pathname.slice("/convite/".length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.invitationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tokenHash: createHash("sha256").update(token).digest("hex"), invitedById: "admin-id" }),
    }));
    expect(mocks.sendInvite).toHaveBeenCalledWith(expect.objectContaining({ to: user.email, inviteUrl: body.inviteUrl }));
    expect(body).not.toHaveProperty("tokenHash");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "INVITE" }) }));
  });

  it("binds password recovery to the current account security state", async () => {
    mocks.userFind.mockResolvedValueOnce(user);
    const response = await recover(request({ email: user.email.toUpperCase() }));
    expect(await response.json()).toEqual({ ok: true });
    const { resetUrl } = mocks.sendReset.mock.calls[0][0];
    const token = new URL(resetUrl).pathname.slice("/convite/".length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.userFind).toHaveBeenCalledWith(expect.objectContaining({ where: { email: user.email } }));
    expect(mocks.invitationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      purpose: "PASSWORD_RESET", resetUserId: user.id, resetStamp: getSecurityStamp(user),
      tokenHash: createHash("sha256").update(token).digest("hex"),
    }) });
  });

  it.each([null, { ...user, status: "BLOCKED" }, { ...user, tenantId: null }])("conceals unavailable accounts without issuing recovery links: %j", async (currentUser) => {
    mocks.userFind.mockResolvedValueOnce(currentUser);
    expect(await (await recover(request({ email: user.email }))).json()).toEqual({ ok: true });
    expect(mocks.invitationCreate).not.toHaveBeenCalled();
    expect(mocks.sendReset).not.toHaveBeenCalled();
  });

  it.each(["invitation", "recovery"])("keeps delivery failure primary when cleanup also fails: %s", async (kind) => {
    const error = new Error("Delivery unavailable");
    mocks.invitationDelete.mockRejectedValueOnce(new Error("Cleanup unavailable"));
    if (kind === "recovery") {
      mocks.userFind.mockResolvedValueOnce(user);
      mocks.sendReset.mockRejectedValueOnce(error);
      await expect(recover(request({ email: user.email }))).rejects.toBe(error);
    } else {
      mocks.sendInvite.mockRejectedValueOnce(error);
      await expect(invite(request({ tenantId: user.tenantId, email: user.email, name: user.name }))).rejects.toBe(error);
    }
    expect(mocks.invitationDelete).toHaveBeenCalledWith({ where: { id: invitation.id } });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
