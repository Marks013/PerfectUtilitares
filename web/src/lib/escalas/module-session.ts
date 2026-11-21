import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { lockEscalaAccess } from "./access";

export const ESCALA_ACCESS_COOKIE = "perfectutilitares.escalas-access";

export class EscalaSessionConfigurationError extends Error {
  constructor() {
    super("Operational cookie secret is not configured securely");
    this.name = "EscalaSessionConfigurationError";
  }
}

export function escalaModuleTenantSlug() { return process.env.DEFAULT_TENANT_SLUG?.trim() || "principal"; }
function cookieSecret() {
  const secret = process.env.UNIMED_ACCESS_COOKIE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new EscalaSessionConfigurationError();
  return secret;
}
export function escalaSessionTtlMinutes() {
  const value = Number(process.env.UNIMED_ACCESS_SESSION_TTL_MINUTES);
  return Number.isInteger(value) && value >= 15 && value <= 1440 ? value : 480;
}
function signature(token: string) { return createHmac("sha256", cookieSecret()).update("escalas:" + token).digest("base64url"); }
export function hashEscalaSessionToken(token: string) { return createHash("sha256").update("escalas:" + token).digest("hex"); }

export function encodeEscalaSessionCookie(token: string) { return token + "." + signature(token); }
export function decodeEscalaSessionCookie(value: string | null | undefined) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [token, signed] = parts;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  // A 32-byte HMAC uses 43 unpadded Base64url characters with two zero bits at the end.
  if (!signed || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(signed)) return null;
  const expected = Buffer.from(signature(token)), received = Buffer.from(signed);
  return expected.length === received.length && timingSafeEqual(expected, received) ? token : null;
}
export function escalaSessionCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge };
}

export async function revokeEscalaModuleSessionCookie(value: string | null | undefined) {
  let token: string | null;
  try { token = decodeEscalaSessionCookie(value); }
  catch (error) {
    if (error instanceof EscalaSessionConfigurationError) throw error;
    return;
  }
  if (!token) return;
  const tokenHash = hashEscalaSessionToken(token);
  await prisma.$transaction(async tx => {
    const session = await tx.escalaModuleSession.findFirst({ where: { tokenHash }, select: { id: true, tenantId: true } });
    if (!session) return;
    await lockEscalaAccess(tx, session.tenantId);
    await tx.escalaModuleSession.updateMany({ where: { id: session.id, tenantId: session.tenantId, tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}
