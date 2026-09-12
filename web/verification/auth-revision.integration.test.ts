import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";
import type { NextAuthConfig } from "next-auth";

const harness = vi.hoisted(() => ({
  config: null as NextAuthConfig | null,
  session: null as { user: { id: string; role: string; status: string } } | null,
  resetUrl: "",
}));

// Capture the production callbacks; only the HTTP/session wrapper is synthetic.
vi.mock("next-auth", () => ({
  default: (config: NextAuthConfig) => {
    harness.config = config;
    return { auth: async () => harness.session, handlers: {}, signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("@/lib/email/resend", () => ({
  getAppUrl: () => "https://audit.invalid",
  sendPasswordResetEmail: async ({ resetUrl }: { resetUrl: string }) => {
    harness.resetUrl = resetUrl;
  },
}));

import { prisma } from "@/lib/prisma";
import { getSecurityStamp } from "@/lib/auth/security-stamp";
import { PATCH } from "@/app/api/account/route";
import { POST as requestReset } from "@/app/api/password-reset/request/route";
import { POST as acceptReset } from "@/app/api/invitations/accept/route";
import { updateUserWithAdminInvariant } from "@/lib/users/account-mutations";

function request(path: string, data: object, method = "POST") {
  return new Request(`https://audit.invalid${path}`, {
    method,
    headers: { origin: "https://audit.invalid", "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

async function current() {
  return prisma.user.findUniqueOrThrow({ where: { id: "revision-user" } });
}

async function refresh(stamp: string) {
  const callback = harness.config?.callbacks?.jwt;
  if (!callback) throw new Error("Production JWT callback not captured");
  return callback({
    token: { id: "revision-user", securityStamp: stamp },
    account: null,
    user: undefined,
  } as unknown as Parameters<typeof callback>[0]);
}

beforeEach(async () => {
  if (process.env.AUTH_REVISION_ISOLATED !== "1" ||
      new URL(process.env.DATABASE_URL ?? "https://invalid").pathname !== "/perfect_auth_audit") {
    throw new Error("Use auth-revision-check.mjs with its disposable database");
  }
  await prisma.auditLog.deleteMany();
  await prisma.userInvitation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.apiRateLimitBucket.deleteMany();
  await prisma.tenant.create({ data: { id: "revision-tenant", name: "Synthetic", slug: "revision" } });
  await prisma.user.create({
    data: {
      id: "revision-user", tenantId: "revision-tenant", email: "revision@example.invalid",
      name: "Synthetic Original", passwordHash: await hash("Original-synthetic-password", 4),
    },
  });
  harness.session = { user: { id: "revision-user", role: "OPERATOR", status: "ACTIVE" } };
  harness.resetUrl = "";
});
afterAll(async () => prisma.$disconnect());

describe("independent account security revision", () => {
  it("account PATCH name preserves a real database stamp and refreshes the JWT name", async () => {
    const before = await current();
    const stamp = getSecurityStamp(before);
    const response = await PATCH(request("/api/account", { name: "Synthetic Renamed" }, "PATCH"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, name: "Synthetic Renamed" });
    const after = await current();
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.securityVersion).toBe(0);
    expect(getSecurityStamp(after)).toBe(stamp);
    expect(await refresh(stamp)).toMatchObject({ id: before.id, name: "Synthetic Renamed" });
  });

  it("account password PATCH invalidates the old JWT even when the same password is chosen", async () => {
    const before = await current();
    const response = await PATCH(request("/api/account", {
      currentPassword: "Original-synthetic-password", newPassword: "Original-synthetic-password",
    }, "PATCH"));
    expect(response.status).toBe(200);
    expect((await current()).securityVersion).toBe(1);
    expect(await refresh(getSecurityStamp(before))).toBeNull();
  });

  it("admin block/unblock and role reversal never restore an old JWT", async () => {
    for (const [change, restore] of [
      [{ status: "BLOCKED" as const }, { status: "ACTIVE" as const }],
      [{ role: "ADMIN" as const }, { role: "OPERATOR" as const }],
    ]) {
      const before = await current();
      // The second administrator preserves the existing last-active-admin invariant.
      await prisma.user.upsert({ where: { id: "revision-admin" }, update: {}, create: {
        id: "revision-admin", name: "Synthetic Admin", email: "admin@example.invalid",
        role: "ADMIN", passwordHash: "synthetic-unused",
      } });
      expect((await updateUserWithAdminInvariant({ targetUserId: before.id, actorUserId: "revision-admin", data: change })).ok).toBe(true);
      expect(await refresh(getSecurityStamp(before))).toBeNull();
      expect((await updateUserWithAdminInvariant({ targetUserId: before.id, actorUserId: "revision-admin", data: restore })).ok).toBe(true);
      expect((await current()).securityVersion).toBe(before.securityVersion + 2);
      expect(await refresh(getSecurityStamp(before))).toBeNull();
    }
  });

  it("SQL changes, reversals, foreign-key cleanup, and attempted counter reset follow the same rule", async () => {
    const before = await current();
    await prisma.$executeRaw`UPDATE "User" SET "email" = 'other@example.invalid' WHERE "id" = 'revision-user'`;
    await prisma.$executeRaw`UPDATE "User" SET "email" = 'revision@example.invalid', "securityVersion" = 0 WHERE "id" = 'revision-user'`;
    expect((await current()).securityVersion).toBe(2);
    await prisma.$executeRaw`UPDATE "User" SET "securityVersion" = 0 WHERE "id" = 'revision-user'`;
    expect((await current()).securityVersion).toBe(2);
    await prisma.tenant.delete({ where: { id: "revision-tenant" } });
    expect((await current()).securityVersion).toBe(3);
    expect(await refresh(getSecurityStamp(before))).toBeNull();
  });

  it("unchanged security values preserve the revision and concurrent updates cannot lose increments", async () => {
    await prisma.user.update({ where: { id: "revision-user" }, data: { status: "ACTIVE", role: "OPERATOR" } });
    expect((await current()).securityVersion).toBe(0);
    await Promise.all(["one", "two"].map((value) => prisma.user.update({
      where: { id: "revision-user" }, data: { passwordHash: `synthetic-${value}` },
    })));
    expect((await current()).securityVersion).toBe(2);
  });

  it("new recovery link survives a name edit, resets the password, and rejects replay", async () => {
    const before = await current();
    expect((await requestReset(request("/api/password-reset/request", { email: before.email }))).status).toBe(200);
    const token = harness.resetUrl.split("/").at(-1);
    expect(token?.length).toBeGreaterThanOrEqual(32);
    expect((await PATCH(request("/api/account", { name: "Recovery Renamed" }, "PATCH"))).status).toBe(200);
    const body = { token, password: "Recovered-synthetic-password" };
    expect((await acceptReset(request("/api/invitations/accept", body))).status).toBe(201);
    expect((await current()).securityVersion).toBe(1);
    expect(await refresh(getSecurityStamp(before))).toBeNull();
    expect((await acceptReset(request("/api/invitations/accept", body))).status).toBe(404);
  });

  it("recovery link is invalidated after a security change and reversal", async () => {
    const before = await current();
    expect((await requestReset(request("/api/password-reset/request", { email: before.email }))).status).toBe(200);
    const token = harness.resetUrl.split("/").at(-1);
    await prisma.user.update({ where: { id: before.id }, data: { status: "BLOCKED" } });
    await prisma.user.update({ where: { id: before.id }, data: { status: "ACTIVE" } });
    expect((await acceptReset(request("/api/invitations/accept", { token, password: "Recovered-synthetic-password" }))).status).toBe(410);
    expect((await current()).passwordHash).toBe(before.passwordHash);
  });
});
