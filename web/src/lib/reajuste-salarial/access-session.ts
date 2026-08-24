import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const REAJUSTE_ACCESS_COOKIE =
  "perfectutilitares.reajuste-salarial-access";
const DEFAULT_TTL_MINUTES = 480;
const MIN_COOKIE_SECRET_LENGTH = 32;
const REAJUSTE_STANDARD_OPERATOR = "Dp Planalto";

export type ReajusteModuleSessionContext = {
  id: string;
  tenantId: string;
  role: "STANDARD";
  operatorName: string;
  expiresAt: Date;
};

function cookieSecret() {
  const value = process.env.REAJUSTE_ACCESS_COOKIE_SECRET?.trim();
  if (!value || value.length < MIN_COOKIE_SECRET_LENGTH) {
    throw new Error(
      "REAJUSTE_ACCESS_COOKIE_SECRET is not configured securely",
    );
  }
  return value;
}

function sessionTtlMinutes() {
  const parsed = Number(process.env.REAJUSTE_ACCESS_SESSION_TTL_MINUTES);
  return Number.isInteger(parsed) && parsed >= 15 && parsed <= 24 * 60
    ? parsed
    : DEFAULT_TTL_MINUTES;
}

function signToken(token: string) {
  return createHmac("sha256", cookieSecret())
    .update(`reajuste-salarial:${token}`)
    .digest("base64url");
}

function tokenHash(token: string) {
  return createHash("sha256")
    .update(`reajuste-salarial:${token}`)
    .digest("hex");
}

export function encodeReajusteSessionCookie(token: string) {
  return `${token}.${signToken(token)}`;
}

export function decodeReajusteSessionCookie(
  value: string | null | undefined,
) {
  if (!value) return null;
  const [token, signature, extra] = value.split(".");
  if (extra || !token || !signature || token.length < 32) return null;

  const expected = Buffer.from(signToken(token));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }
  return token;
}

export function reajusteSessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: "/",
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export async function createReajusteModuleSession() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: process.env.DEFAULT_TENANT_SLUG?.trim() || "principal" },
    select: { id: true },
  });
  if (!tenant) throw new Error("Default tenant was not found");

  const now = new Date();
  const ttlMinutes = sessionTtlMinutes();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  const token = randomBytes(32).toString("base64url");
  const excessActiveSessions =
    await prisma.reajusteSalarialSession.findMany({
      where: {
        tenantId: tenant.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      skip: 19,
      take: 1_000,
      select: { id: true },
    });

  const session = await prisma.$transaction(async (tx) => {
    await tx.reajusteSalarialSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } },
        ],
      },
    });
    await tx.reajusteSalarialSession.deleteMany({
      where: { id: { in: excessActiveSessions.map(({ id }) => id) } },
    });
    const created = await tx.reajusteSalarialSession.create({
      data: {
        tenantId: tenant.id,
        tokenHash: tokenHash(token),
        operatorName: REAJUSTE_STANDARD_OPERATOR,
        expiresAt,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        action: "LOGIN",
        entity: "ReajusteSalarialSession",
        entityId: created.id,
        metadata: {
          accessChannel: "REAJUSTE_SALARIAL_MODULE_PASSWORD",
          accessLevel: "STANDARD",
          operatorName: REAJUSTE_STANDARD_OPERATOR,
        },
      },
    });
    return created;
  });

  return {
    id: session.id,
    value: encodeReajusteSessionCookie(token),
    expiresAt,
    maxAgeSeconds: ttlMinutes * 60,
    operatorName: REAJUSTE_STANDARD_OPERATOR,
    role: "STANDARD" as const,
  };
}

export async function verifyReajusteModuleSessionCookie(
  cookieValue: string | null | undefined,
): Promise<ReajusteModuleSessionContext | null> {
  let token: string | null;
  try {
    token = decodeReajusteSessionCookie(cookieValue);
  } catch {
    return null;
  }
  if (!token) return null;

  const session = await prisma.reajusteSalarialSession.findFirst({
    where: {
      tokenHash: tokenHash(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      tenantId: true,
      operatorName: true,
      expiresAt: true,
    },
  });
  return session ? { ...session, role: "STANDARD" } : null;
}

export async function getReajusteModuleSession() {
  const cookieStore = await cookies();
  return verifyReajusteModuleSessionCookie(
    cookieStore.get(REAJUSTE_ACCESS_COOKIE)?.value,
  );
}

export async function revokeReajusteModuleSessionCookie(
  cookieValue: string | null | undefined,
) {
  let token: string | null;
  try {
    token = decodeReajusteSessionCookie(cookieValue);
  } catch {
    return;
  }
  if (!token) return;

  await prisma.reajusteSalarialSession.updateMany({
    where: { tokenHash: tokenHash(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
