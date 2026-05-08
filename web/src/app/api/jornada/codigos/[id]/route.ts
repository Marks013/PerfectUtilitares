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
import {
  codigoJornadaPatchSchema,
  zodIssueDetails,
} from "@/lib/codigos/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function validateCodigoId(id: string) {
  return id.length >= 8 && id.length <= 64;
}

function prismaErrorResponse(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      return jsonError(404, "CODIGO_NOT_FOUND", "Código não encontrado");
    }

    if (error.code === "P2002") {
      return jsonError(
        409,
        "CODIGO_HORARIO_EXISTS",
        "Já existe código para estes horários",
      );
    }
  }

  throw error;
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const { id } = await context.params;
  if (!validateCodigoId(id)) {
    return jsonError(400, "INVALID_CODIGO_ID", "Identificador inválido");
  }

  const codigo = await prisma.codigoJornada.findUnique({ where: { id } });
  if (!codigo) {
    return jsonError(404, "CODIGO_NOT_FOUND", "Código não encontrado");
  }

  return NextResponse.json(codigo);
}

export function POST() {
  return methodNotAllowed(["GET", "PATCH", "DELETE"]);
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
  if (!validateCodigoId(id)) {
    return jsonError(400, "INVALID_CODIGO_ID", "Identificador inválido");
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-codigo-update",
    limit: 40,
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

  const parsed = codigoJornadaPatchSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const codigo = await prisma.codigoJornada.update({
      where: { id },
      data: {
        ...parsed.data,
        origem: "MANUAL",
        linha: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "UPDATE",
        entity: "CodigoJornada",
        entityId: codigo.id,
        metadata: parsed.data,
      },
    });

    return NextResponse.json(codigo);
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
  if (!validateCodigoId(id)) {
    return jsonError(400, "INVALID_CODIGO_ID", "Identificador inválido");
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-codigo-delete",
    limit: 40,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  try {
    const codigo = await prisma.codigoJornada.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "DELETE",
        entity: "CodigoJornada",
        entityId: codigo.id,
        metadata: {
          codigo: codigo.codigo,
          horariosNormalizado: codigo.horariosNormalizado,
        },
      },
    });

    return NextResponse.json({ id: codigo.id });
  } catch (error) {
    return prismaErrorResponse(error);
  }
}
