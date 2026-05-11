import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
import { userPatchSchema, zodIssueDetails } from "@/lib/users/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

function validateUserId(id: string) {
  return id.length >= 8 && id.length <= 64;
}

function prismaErrorResponse(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      return jsonError(
        404,
        "USER_NOT_FOUND",
        "Usuário não encontrado. Atualize a lista e tente novamente.",
      );
    }

    if (error.code === "P2002") {
      return jsonError(
        409,
        "USER_EMAIL_EXISTS",
        "Este e-mail já está cadastrado em outro usuário.",
      );
    }
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return jsonError(
      404,
      "TENANT_NOT_FOUND",
      "Empresa não encontrada. Selecione uma empresa cadastrada.",
    );
  }

  throw error;
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const { id } = await context.params;
  if (!validateUserId(id)) {
    return jsonError(
      400,
      "INVALID_USER_ID",
      "Usuário inválido. Atualize a lista e selecione o usuário novamente.",
    );
  }

  const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!user) {
    return jsonError(
      404,
      "USER_NOT_FOUND",
      "Usuário não encontrado. Atualize a lista e tente novamente.",
    );
  }

  return NextResponse.json(user);
}

export function POST() {
  return methodNotAllowed(["GET", "PATCH"]);
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const { id } = await context.params;
  if (!validateUserId(id)) {
    return jsonError(
      400,
      "INVALID_USER_ID",
      "Usuário inválido. Atualize a lista e selecione o usuário novamente.",
    );
  }

  if (id === guard.session.user.id) {
    return jsonError(
      400,
      "SELF_DELETE_BLOCKED",
      "Não é permitido alterar seu próprio usuário administrativo por esta tela.",
    );
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-users-update",
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

  const parsed = userPatchSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Revise os dados do usuário.",
      zodIssueDetails(parsed.error),
    );
  }

  if (
    id === guard.session.user.id &&
    (parsed.data.isActive === false || parsed.data.role === "OPERATOR")
  ) {
    return jsonError(
      400,
      "SELF_LOCKOUT_BLOCKED",
      "Não é permitido remover seu próprio acesso administrativo.",
    );
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: parsed.data,
      select: userSelect,
    });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: user.id,
        metadata: {
          email: user.email,
          tenantId: user.tenantId,
          role: user.role,
          isActive: user.isActive,
          canAccessJornada: user.canAccessJornada,
          canAccessFotos: user.canAccessFotos,
        },
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    return prismaErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const { id } = await context.params;
  if (!validateUserId(id)) {
    return jsonError(
      400,
      "INVALID_USER_ID",
      "Usuário inválido. Atualize a lista e selecione o usuário novamente.",
    );
  }

  if (id === guard.session.user.id) {
    return jsonError(
      400,
      "SELF_DELETE_BLOCKED",
      "Não é permitido excluir seu próprio usuário administrativo.",
    );
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "admin-users-delete",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: userSelect,
    });

    if (user.role === "ADMIN" && user.isActive) {
      const activeAdminCount = await prisma.user.count({
        where: { role: "ADMIN", isActive: true },
      });

      if (activeAdminCount <= 1) {
        return jsonError(
          400,
          "LAST_ADMIN_DELETE_BLOCKED",
          "Não é permitido excluir o último administrador ativo do sistema.",
        );
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "DELETE",
        entity: "User",
        entityId: user.id,
        metadata: {
          email: user.email,
          tenantId: user.tenantId,
          role: user.role,
        },
      },
    });

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ id });
  } catch (error) {
    return prismaErrorResponse(error);
  }
}
