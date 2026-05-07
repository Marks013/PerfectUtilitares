import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { invitationAcceptSchema, zodIssueDetails } from "@/lib/users/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

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
    keyPrefix: "invitation-accept",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) {
    return contentTypeError;
  }

  const contentLengthError = requireMaxContentLength(request, 8 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = invitationAcceptSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      zodIssueDetails(parsed.error),
    );
  }

  const invitation = await prisma.userInvitation.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });

  if (!invitation || invitation.acceptedAt) {
    return jsonError(404, "INVITATION_NOT_FOUND", "Convite inválido");
  }

  if (invitation.expiresAt < new Date()) {
    return jsonError(410, "INVITATION_EXPIRED", "Convite expirado");
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          name: invitation.name,
          passwordHash: await hash(parsed.data.password, 12),
          role: invitation.role,
          isActive: true,
          canAccessJornada: invitation.canAccessJornada,
          canAccessFotos: invitation.canAccessFotos,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          tenantId: true,
        },
      });

      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId: createdUser.id,
          action: "ACCEPT_INVITATION",
          entity: "UserInvitation",
          entityId: invitation.id,
          metadata: {
            email: invitation.email,
            tenantId: invitation.tenantId,
            role: invitation.role,
          },
        },
      });

      return createdUser;
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(409, "USER_EMAIL_EXISTS", "Email já cadastrado");
    }

    throw error;
  }
}
