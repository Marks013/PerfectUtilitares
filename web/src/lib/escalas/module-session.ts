import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const ESCALA_ACCESS_COOKIE = "perfectutilitares.escalas-access";
export type EscalaModuleSessionContext = { id: string; tenantId: string; expiresAt: Date };

function tenantSlug() { return process.env.DEFAULT_TENANT_SLUG?.trim() || "principal"; }
function cookieSecret() {
  const secret = process.env.UNIMED_ACCESS_COOKIE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Operational cookie secret is not configured securely");
  return secret;
}
function ttlMinutes() {
  const value = Number(process.env.UNIMED_ACCESS_SESSION_TTL_MINUTES);
  return Number.isInteger(value) && value >= 15 && value <= 1440 ? value : 480;
}
function signature(token: string) { return createHmac("sha256", cookieSecret()).update("escalas:" + token).digest("base64url"); }
function tokenHash(token: string) { return createHash("sha256").update("escalas:" + token).digest("hex"); }

export function encodeEscalaSessionCookie(token: string) { return token + "." + signature(token); }
export function decodeEscalaSessionCookie(value: string | null | undefined) {
  if (!value) return null;
  const [token, signed, extra] = value.split(".");
  if (extra || !token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !signed) return null;
  const expected = Buffer.from(signature(token)), received = Buffer.from(signed);
  return expected.length === received.length && timingSafeEqual(expected, received) ? token : null;
}
export function escalaSessionCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge };
}

export async function createEscalaModuleSession() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug() }, select: { id: true } });
  if (!tenant) throw new Error("Operational tenant was not found");
  const now = new Date(), ttl = ttlMinutes(), expiresAt = new Date(now.getTime() + ttl * 60_000);
  const token = randomBytes(32).toString("base64url");
  const excess = await prisma.escalaModuleSession.findMany({
    where: { tenantId: tenant.id, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" }, skip: 19, take: 1000, select: { id: true },
  });
  const session = await prisma.$transaction(async tx => {
    await tx.escalaModuleSession.deleteMany({ where: { OR: [
      { expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 86_400_000) } },
      { id: { in: excess.map(item => item.id) } },
    ] } });
    const created = await tx.escalaModuleSession.create({ data: { tenantId: tenant.id, tokenHash: tokenHash(token), expiresAt }, select: { id: true } });
    await tx.auditLog.create({ data: { action: "LOGIN", entity: "EscalaModuleSession", entityId: created.id,
      metadata: { accessChannel: "ESCALAS_MODULE_PASSWORD", tenantId: tenant.id } } });
    return created;
  });
  return { id: session.id, value: encodeEscalaSessionCookie(token), expiresAt, maxAgeSeconds: ttl * 60 };
}

export async function verifyEscalaModuleSessionCookie(value: string | null | undefined): Promise<EscalaModuleSessionContext | null> {
  let token: string | null;
  try { token = decodeEscalaSessionCookie(value); } catch { return null; }
  if (!token) return null;
  return prisma.escalaModuleSession.findFirst({ where: {
    tokenHash: tokenHash(token), revokedAt: null, expiresAt: { gt: new Date() }, tenant: { slug: tenantSlug() },
  }, select: { id: true, tenantId: true, expiresAt: true } });
}
export async function getEscalaModuleSession() {
  const jar = await cookies();
  return verifyEscalaModuleSessionCookie(jar.get(ESCALA_ACCESS_COOKIE)?.value);
}
export async function revokeEscalaModuleSessionCookie(value: string | null | undefined) {
  let token: string | null;
  try { token = decodeEscalaSessionCookie(value); } catch { return; }
  if (!token) return;
  await prisma.escalaModuleSession.updateMany({ where: { tokenHash: tokenHash(token), revokedAt: null }, data: { revokedAt: new Date() } });
}
