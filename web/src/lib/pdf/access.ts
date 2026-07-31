import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { auth, type AppSession } from "@/auth";
import { getRateLimitKey } from "@/lib/api/rate-limit";

const PDF_OWNER_COOKIE = "perfectutilitares.pdf-owner";
const DEFAULT_OWNER_TTL_MINUTES = 120;

export type PdfOwnerContext = {
  session: AppSession | null;
  ownerSessionHash: string | null;
};

export type PdfPrincipal = {
  key: string;
  tier: "authenticated" | "public";
};

function getOwnerTtlMinutes() {
  const parsed = Number(process.env.PDF_ANONYMOUS_SESSION_TTL_MINUTES);
  if (!Number.isInteger(parsed) || parsed < 30 || parsed > 24 * 60) {
    return DEFAULT_OWNER_TTL_MINUTES;
  }
  return parsed;
}

function hashOwnerToken(token: string) {
  const secret =
    process.env.AUTH_SECRET ??
    "dev-only-change-this-secret-before-production-deploy";
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function getPdfOwnerContext(options?: {
  createAnonymous?: boolean;
}): Promise<PdfOwnerContext> {
  const [sessionValue, cookieStore] = await Promise.all([auth(), cookies()]);
  const session =
    sessionValue?.user.status !== "ACTIVE"
      ? null
      : (sessionValue as AppSession | null);
  let token = cookieStore.get(PDF_OWNER_COOKIE)?.value ?? null;

  if (!session && !token && options?.createAnonymous) {
    token = randomBytes(32).toString("base64url");
    const ttlMinutes = getOwnerTtlMinutes();
    cookieStore.set(PDF_OWNER_COOKIE, token, {
      httpOnly: true,
      maxAge: ttlMinutes * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return {
    session,
    ownerSessionHash: token ? hashOwnerToken(token) : null,
  };
}

export function pdfJobAccessWhere(
  owner: PdfOwnerContext,
): Prisma.PdfJobWhereInput {
  if (owner.session?.user.role === "ADMIN") {
    return {};
  }

  const ownership: Prisma.PdfJobWhereInput[] = [];
  if (owner.session) {
    ownership.push({ userId: owner.session.user.id });
  }
  if (owner.ownerSessionHash) {
    ownership.push({ ownerSessionHash: owner.ownerSessionHash });
  }

  return ownership.length > 0
    ? { OR: ownership }
    : { ownerSessionHash: "__missing_owner__" };
}

export function getPdfPrincipal(
  owner: PdfOwnerContext,
  headers: Headers,
): PdfPrincipal {
  if (owner.session) {
    return {
      key: `user:${hashOwnerToken(owner.session.user.id)}`,
      tier: "authenticated",
    };
  }

  return {
    key: getRateLimitKey("ip", headers),
    tier: "public",
  };
}
