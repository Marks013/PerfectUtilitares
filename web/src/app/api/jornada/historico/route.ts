import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  methodNotAllowed,
  requireModuleAccess,
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
  return methodNotAllowed(["GET"]);
}
