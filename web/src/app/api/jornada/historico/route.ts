import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  methodNotAllowed,
  requireModuleAccess,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

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
