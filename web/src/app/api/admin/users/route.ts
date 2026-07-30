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
  status: true,
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
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(users);
}

export function PATCH() {
  return methodNotAllowed(["GET"]);
}

export function DELETE() {
  return methodNotAllowed(["GET"]);
}

export function POST() {
  return methodNotAllowed(["GET"]);
}
