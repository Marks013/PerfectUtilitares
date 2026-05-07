import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  requireSameOrigin,
  requireSession,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export function GET() {
  return methodNotAllowed(["DELETE"]);
}

export async function DELETE(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "account-delete",
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const userId = guard.session.user.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, tenantId: true, role: true },
  });

  if (!user) {
    return jsonError(404, "USER_NOT_FOUND", "Usuário não encontrado");
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "SELF_DELETE",
      entity: "User",
      entityId: user.id,
      metadata: {
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
      },
    },
  });

  await prisma.user.delete({ where: { id: userId } });

  return NextResponse.json({ ok: true });
}
