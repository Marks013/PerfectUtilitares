import { NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireAdmin,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { getAppUrl, sendInvitationEmail } from "@/lib/email/resend";
import { invitationCreateSchema, zodIssueDetails } from "@/lib/users/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const invitations = await prisma.userInvitation.findMany({
    include: {
      tenant: { select: { name: true, slug: true } },
      invitedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(invitations);
}

export function PATCH() {
  return methodNotAllowed(["GET", "POST"]);
}

export function DELETE() {
  return methodNotAllowed(["GET", "POST"]);
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-invitations-create",
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) {
    return contentTypeError;
  }

  const contentLengthError = requireMaxContentLength(request, 16 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = invitationCreateSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      zodIssueDetails(parsed.error),
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: parsed.data.tenantId },
  });

  if (!tenant) {
    return jsonError(404, "TENANT_NOT_FOUND", "Tenant não encontrado");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const inviteUrl = `${getAppUrl(request)}/convite/${token}`;
  const invitation = await prisma.userInvitation.create({
    data: {
      ...parsed.data,
      invitedById: guard.session.user.id,
      tokenHash: hashToken(token),
      expiresAt,
    },
    include: { tenant: { select: { name: true, slug: true } } },
  });

  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    try {
      await sendInvitationEmail({
        to: parsed.data.email,
        name: parsed.data.name,
        tenantName: tenant.name,
        inviteUrl,
      });
    } catch (error) {
      await prisma.userInvitation
        .delete({ where: { id: invitation.id } })
        .catch(() => {});
      throw error;
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: guard.session.user.id,
      action: "INVITE",
      entity: "UserInvitation",
      entityId: invitation.id,
      metadata: {
        email: invitation.email,
        tenantId: invitation.tenantId,
        role: invitation.role,
      },
    },
  });

  return NextResponse.json({ ...invitation, inviteUrl }, { status: 201 });
}
