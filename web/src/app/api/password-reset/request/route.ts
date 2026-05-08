import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  enforceRateLimit,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { normalizeEmail } from "@/lib/auth/email";
import { getAppUrl, sendPasswordResetEmail } from "@/lib/email/resend";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.string().email().max(254),
});

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "password-reset-request",
    limit: 8,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) {
    return contentTypeError;
  }

  const contentLengthError = requireMaxContentLength(request, 4 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = requestSchema.safeParse(json.data);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(parsed.data.email) },
    select: {
      tenantId: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      canAccessJornada: true,
      canAccessFotos: true,
    },
  });

  if (!user || !user.isActive || !user.tenantId) {
    return NextResponse.json({ ok: true });
  }

  const token = randomBytes(32).toString("base64url");
  const resetUrl = `${getAppUrl(request)}/convite/${token}`;
  const invitation = await prisma.userInvitation.create({
    data: {
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
      canAccessJornada: user.canAccessJornada,
      canAccessFotos: user.canAccessFotos,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
      });
    } catch (error) {
      await prisma.userInvitation
        .delete({ where: { id: invitation.id } })
        .catch(() => {});
      throw error;
    }
  }

  return NextResponse.json({ ok: true });
}
