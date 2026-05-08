import { NextResponse } from "next/server";
import {
  methodNotAllowed,
  requireAdmin,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const userSelect = {
  id: true,
  tenantId: true,
  tenant: { select: { id: true, name: true, slug: true } },
  email: true,
  name: true,
  role: true,
  isActive: true,
  canAccessJornada: true,
  canAccessFotos: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 200,
  });

  return NextResponse.json(users);
}

export function PATCH() {
  return methodNotAllowed(["GET"]);
}

export function DELETE() {
  return methodNotAllowed(["GET"]);
}

export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  return methodNotAllowed(["GET"]);
}
