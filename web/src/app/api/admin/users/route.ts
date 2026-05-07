import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
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
import { userCreateSchema, zodIssueDetails } from "@/lib/users/schema";
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
    keyPrefix: "admin-users-create",
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

  const contentLengthError = requireMaxContentLength(request, 16 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = userCreateSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const user = await prisma.user.create({
      data: {
        tenantId: parsed.data.tenantId,
        email: parsed.data.email,
        name: parsed.data.name,
        passwordHash: await hash(parsed.data.password, 12),
        role: parsed.data.role,
        isActive: parsed.data.isActive,
        canAccessJornada: parsed.data.canAccessJornada,
        canAccessFotos: parsed.data.canAccessFotos,
      },
      select: userSelect,
    });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "CREATE",
        entity: "User",
        entityId: user.id,
        metadata: {
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          tenantId: user.tenantId,
          canAccessJornada: user.canAccessJornada,
          canAccessFotos: user.canAccessFotos,
        },
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(409, "USER_EMAIL_EXISTS", "Email já cadastrado");
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
    return jsonError(404, "TENANT_NOT_FOUND", "Empresa não encontrada");
    }

    throw error;
  }
}
