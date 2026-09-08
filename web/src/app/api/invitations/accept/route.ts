import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { hash } from "bcryptjs";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { invitationAcceptSchema, zodIssueDetails } from "@/lib/users/schema";
import { prisma } from "@/lib/prisma";
import { getSecurityStamp } from "@/lib/auth/security-stamp";

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

  const limited = await enforcePersistentRateLimit(request, {
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
      "Revise a senha do convite.",
      zodIssueDetails(parsed.error),
    );
  }

  const invitation = await prisma.userInvitation.findUnique({
    where: { tokenHash: hashToken(parsed.data.token) },
  });

  if (!invitation || invitation.acceptedAt) {
    return jsonError(
      404,
      "INVITATION_NOT_FOUND",
      "Convite inválido ou já utilizado. Solicite um novo convite ao administrador.",
    );
  }

  if (invitation.expiresAt <= new Date()) {
    return jsonError(
      410,
      "INVITATION_EXPIRED",
      "Convite expirado. Solicite um novo convite ao administrador.",
    );
  }

  try {
    const passwordHash = await hash(parsed.data.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      // Always lock the account before token rows, including concurrent sibling links.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "email" = ${invitation.email} FOR UPDATE`;
      const existingUser = await tx.user.findUnique({
        where: { email: invitation.email },
      });
      const isRecovery = invitation.purpose === "PASSWORD_RESET";
      if (isRecovery && (!existingUser || existingUser.status !== "ACTIVE" ||
        existingUser.id !== invitation.resetUserId ||
        getSecurityStamp(existingUser) !== invitation.resetStamp)) {
        throw new Error("RECOVERY_INVALIDATED");
      }
      if (!isRecovery && (invitation.purpose !== "INVITATION" || existingUser)) {
        throw new Error("INVITATION_ACCOUNT_EXISTS");
      }

      const claimed = await tx.userInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("TOKEN_ALREADY_USED");

      const createdUser = isRecovery && existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              passwordHash,
            },
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              tenantId: true,
            },
          })
        : await tx.user.create({
            data: {
              tenantId: invitation.tenantId,
              email: invitation.email,
              name: invitation.name,
              passwordHash,
              role: invitation.role,
              status: "ACTIVE",
            },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          tenantId: true,
        },
          });

      await tx.userInvitation.updateMany({
        where: { email: invitation.email, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId: createdUser.id,
          action: isRecovery ? "RESET_PASSWORD" : "ACCEPT_INVITATION",
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
    if (error instanceof Error && ["RECOVERY_INVALIDATED", "TOKEN_ALREADY_USED", "INVITATION_ACCOUNT_EXISTS"].includes(error.message)) {
      return jsonError(410, "TOKEN_INVALIDATED", "Link inválido, utilizado ou invalidado por uma alteração na conta. Solicite um novo link.");
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        409,
        "USER_EMAIL_EXISTS",
        "Este e-mail já está cadastrado. Use a recuperação de senha ou solicite apoio do administrador.",
      );
    }

    throw error;
  }
}
