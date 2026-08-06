import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import type { UnimedAccessLevel } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const UNIMED_ACCESS_COOKIE = "perfectutilitares.unimed-access";
const DEFAULT_TTL_MINUTES = 480;
const MIN_COOKIE_SECRET_LENGTH = 32;

export type UnimedModuleRole = "STANDARD" | "ADMIN";

export type UnimedModuleSessionContext = {
  id: string;
  tenantId: string;
  level: UnimedAccessLevel;
  role: UnimedModuleRole;
  operatorName: string;
  expiresAt: Date;
};

function cookieSecret() {
  const value = process.env.UNIMED_ACCESS_COOKIE_SECRET?.trim();
  if (!value || value.length < MIN_COOKIE_SECRET_LENGTH) {
    throw new Error("UNIMED_ACCESS_COOKIE_SECRET is not configured securely");
  }
  return value;
}

function getUnimedAccessTtlMinutes() {
  const parsed = Number(process.env.UNIMED_ACCESS_SESSION_TTL_MINUTES);
  return Number.isInteger(parsed) && parsed >= 15 && parsed <= 24 * 60
    ? parsed
    : DEFAULT_TTL_MINUTES;
}

function signToken(token: string) {
  return createHmac("sha256", cookieSecret()).update(token).digest("base64url");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function encodeUnimedSessionCookie(token: string) {
  return `${token}.${signToken(token)}`;
}

export function decodeUnimedSessionCookie(value: string | null | undefined) {
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

export function unimedSessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: "/",
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export async function createUnimedModuleSession(
  role: UnimedModuleRole,
  operatorName: string,
) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: process.env.DEFAULT_TENANT_SLUG?.trim() || "principal" },
    select: { id: true },
  });
  if (!tenant) {
    throw new Error("Default tenant was not found");
  }

  const now = new Date();
  const ttlMinutes = getUnimedAccessTtlMinutes();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  const token = randomBytes(32).toString("base64url");
  const level: UnimedAccessLevel = role === "ADMIN" ? "ADMIN" : "OPERATOR";
  const normalizedOperatorName = operatorName.trim().replace(/\s+/g, " ");
  const excessActiveSessions = await prisma.unimedModuleSession.findMany({
    where: {
      tenantId: tenant.id,
      level,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    skip: 19,
    take: 1_000,
    select: { id: true },
  });

  const session = await prisma.$transaction(async (tx) => {
    await tx.unimedModuleSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          {
            revokedAt: {
              lt: new Date(now.getTime() - 24 * 60 * 60_000),
            },
          },
        ],
      },
    });
    await tx.unimedModuleSession.deleteMany({
      where: { id: { in: excessActiveSessions.map((session) => session.id) } },
    });
    const created = await tx.unimedModuleSession.create({
      data: {
        tenantId: tenant.id,
        tokenHash: tokenHash(token),
        level,
        operatorName: normalizedOperatorName,
        expiresAt,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        action: "LOGIN",
        entity: "UnimedModuleSession",
        entityId: created.id,
        metadata: {
          accessChannel: "UNIMED_MODULE_PASSWORD",
          accessLevel: level,
          operatorName: normalizedOperatorName,
        },
      },
    });
    return created;
  });

  return {
    id: session.id,
    value: encodeUnimedSessionCookie(token),
    expiresAt,
    maxAgeSeconds: ttlMinutes * 60,
    operatorName: normalizedOperatorName,
    role,
  };
}

export async function verifyUnimedModuleSessionCookie(
  cookieValue: string | null | undefined,
): Promise<UnimedModuleSessionContext | null> {
  let token: string | null;
  try {
    token = decodeUnimedSessionCookie(cookieValue);
  } catch {
    return null;
  }
  if (!token) return null;

  const session = await prisma.unimedModuleSession.findFirst({
    where: {
      tokenHash: tokenHash(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      tenantId: true,
      level: true,
      operatorName: true,
      expiresAt: true,
    },
  });
  if (!session) return null;

  return {
    ...session,
    role: session.level === "ADMIN" ? "ADMIN" : "STANDARD",
  };
}

export async function getUnimedModuleSession() {
  const cookieStore = await cookies();
  return verifyUnimedModuleSessionCookie(
    cookieStore.get(UNIMED_ACCESS_COOKIE)?.value,
  );
}

export async function revokeUnimedModuleSessionCookie(
  cookieValue: string | null | undefined,
) {
  let token: string | null;
  try {
    token = decodeUnimedSessionCookie(cookieValue);
  } catch {
    return;
  }
  if (!token) return;
  await prisma.unimedModuleSession.updateMany({
    where: { tokenHash: tokenHash(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
