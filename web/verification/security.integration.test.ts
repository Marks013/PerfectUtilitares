import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { hash, compare } from "bcryptjs";

const state = vi.hoisted(() => ({ config: null as any, session: null as any, resetUrl: "" }));
vi.mock("next-auth", () => ({ default: (config: any) => {
  state.config = config;
  return { auth: async () => state.session, handlers: {}, signIn: vi.fn(), signOut: vi.fn() };
} }));
vi.mock("@/lib/email/resend", () => ({
  getAppUrl: () => "https://audit.invalid",
  sendPasswordResetEmail: async ({ resetUrl }: { resetUrl: string }) => { state.resetUrl = resetUrl; },
  sendInvitationEmail: vi.fn(),
}));
import { prisma } from "@/lib/prisma";
import { POST as accept } from "@/app/api/invitations/accept/route";
import { POST as recover } from "@/app/api/password-reset/request/route";
import { PATCH as account } from "@/app/api/account/route";
import { POST as invite } from "@/app/api/admin/invitations/route";
import { getSecurityStamp } from "@/lib/auth/security-stamp";
import { fitsBcryptPassword } from "@/lib/auth/password";
import "@/auth";

let tenantId: string;
let user: any;
const password = "Audit-Password-2026";
function request(data: unknown, method = "POST", ip = "192.0.2.10") {
  return new Request("https://audit.invalid/api/check", { method, headers: {
    origin: "https://audit.invalid", "content-type": "application/json", "x-real-ip": ip,
  }, body: JSON.stringify(data) });
}
async function resetToken() {
  const response = await recover(request({ email: user.email }));
  expect(response.status).toBe(200);
  return state.resetUrl.split("/").at(-1)!;
}
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("perfect_audit")) throw new Error("Disposable audit database required");
  tenantId = (await prisma.tenant.create({ data: { name: "Audit", slug: "audit-security" } })).id;
  user = await prisma.user.create({ data: { tenantId, email: "audit@example.invalid", name: "Audit", passwordHash: await hash(password, 12), role: "ADMIN" } });
  state.session = { user: { id: user.id, tenantId, role: "ADMIN", status: "ACTIVE" } };
});
afterAll(async () => { await prisma.$disconnect(); });

test("new passwords enforce 72 UTF-8 bytes while legacy login remains compatible", async () => {
  expect(fitsBcryptPassword("a".repeat(72))).toBe(true);
  expect(fitsBcryptPassword("á".repeat(36))).toBe(true);
  expect(fitsBcryptPassword("á".repeat(36) + "A")).toBe(false);
  const response = await account(request({ currentPassword: password, newPassword: "á".repeat(36) + "A" }, "PATCH"));
  expect(response.status).toBe(400);
});

test("credential entrypoint limits direct attempts before bcrypt", async () => {
  const provider = state.config.providers[0];
  const authorize = provider.options?.authorize ?? provider.authorize;
  const req = request({}, "POST", "192.0.2.20");
  for (let i = 0; i < 8; i++) expect(await authorize({ email: user.email, password }, req)).toBeTruthy();
  expect(await authorize({ email: user.email, password }, req)).toBeNull();
});

test("recovery cannot undo a role/status change and does not alter permissions", async () => {
  const token = await resetToken();
  await prisma.user.update({ where: { id: user.id }, data: { role: "OPERATOR", status: "BLOCKED" } });
  expect((await accept(request({ token, password: "Replacement-2026" }))).status).toBe(410);
  const blocked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(blocked.status).toBe("BLOCKED");
  expect(blocked.role).toBe("OPERATOR");
  expect(await compare(password, blocked.passwordHash)).toBe(true);
  user = await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN", status: "ACTIVE" } });
});

test("recovery succeeds once under concurrency and invalidates sibling links and JWT", async () => {
  const first = await resetToken();
  const second = await resetToken();
  const original = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const token = { id: user.id, securityStamp: getSecurityStamp(original) };
  expect(await state.config.callbacks.jwt({ token })).toBeTruthy();
  const responses = await Promise.all([
    accept(request({ token: first, password: "Replacement-2026" })),
    accept(request({ token: first, password: "Other-Password-2026" })),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 410]);
  expect([404, 410]).toContain((await accept(request({ token: second, password }))).status);
  const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect([original.role, original.tenantId, original.status]).toEqual([current.role, current.tenantId, current.status]);
  expect(await state.config.callbacks.jwt({ token })).toBeNull();
  expect(await state.config.callbacks.jwt({ token: { id: user.id } })).toBeNull();
});

test("account password change succeeds and revokes its previous JWT", async () => {
  const current = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(password, 12) } });
  const token = { id: user.id, securityStamp: getSecurityStamp(current) };
  expect((await account(request({ currentPassword: password, newPassword: "Changed-Password-2026" }, "PATCH"))).status).toBe(200);
  expect(await state.config.callbacks.jwt({ token })).toBeNull();
});

test("new invitations create an account but cannot overwrite an existing account", async () => {
  const response = await invite(request({ tenantId, email: "new@example.invalid", name: "New audit user", role: "OPERATOR" }));
  expect(response.status).toBe(201);
  const invitation = await response.json();
  const token = invitation.inviteUrl.split("/").at(-1);
  expect((await accept(request({ token, password }))).status).toBe(201);
  expect((await invite(request({ tenantId, email: user.email, name: "Overwrite", role: "OPERATOR" }))).status).toBe(409);
  expect(await prisma.userInvitation.count({ where: { tokenHash: createHash("sha256").update(token).digest("hex"), acceptedAt: { not: null } } })).toBe(1);
});
