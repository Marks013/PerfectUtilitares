import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  requireAdmin,
  requireModuleAccess,
  requireSameOrigin,
  requireSession,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const HISTORY_RETENTION_DAYS = 30;

export async function GET(request: Request) {
  const guard = await requireModuleAccess("jornada");
  if (!guard.ok) {
    return guard.response;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-historico",
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const where =
    guard.session.user.role === "ADMIN"
      ? {}
      : { userId: guard.session.user.id };
  const retentionLimit = new Date(
    Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.jornadaValidation.deleteMany({
    where: { createdAt: { lt: retentionLimit } },
  });

  const historico = await prisma.jornadaValidation.findMany({
    where,
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(historico);
}

export function POST() {
  return methodNotAllowed(["GET", "DELETE"]);
}

export async function DELETE(request: Request) {
  const sessionGuard = await requireSession();
  if (!sessionGuard.ok) {
    return sessionGuard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-historico-delete",
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "mine";
  const userId = sessionGuard.session.user.id;

  if (scope === "all") {
    const adminGuard = await requireAdmin();
    if (!adminGuard.ok) {
      return adminGuard.response;
    }

    const result = await prisma.jornadaValidation.deleteMany({});
    await prisma.auditLog.create({
      data: {
        userId,
        action: "DELETE_ALL",
        entity: "JornadaValidation",
        entityId: null,
        metadata: { deletedCount: result.count },
      },
    });

    return NextResponse.json({ ok: true, deletedCount: result.count });
  }

  if (scope !== "mine") {
    return jsonError(
      400,
      "INVALID_SCOPE",
      "Escopo permitido: mine ou all",
    );
  }

  const result = await prisma.jornadaValidation.deleteMany({
    where: { userId },
  });
  await prisma.auditLog.create({
    data: {
      userId,
      action: "DELETE_OWN",
      entity: "JornadaValidation",
      entityId: userId,
      metadata: { deletedCount: result.count },
    },
  });

  return NextResponse.json({ ok: true, deletedCount: result.count });
}
