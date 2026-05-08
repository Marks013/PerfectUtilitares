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
  jornadaExceptionPatchSchema,
  zodIssueDetails,
} from "@/lib/jornada/exception-schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function validateExceptionId(id: string) {
  return id.length >= 8 && id.length <= 64;
}

function prismaErrorResponse(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return jsonError(404, "EXCEPTION_NOT_FOUND", "Exceção não encontrada");
  }

  throw error;
}

const exceptionSelect = {
  id: true,
  userId: true,
  user: { select: { name: true, email: true } },
  nome: true,
  horariosOriginal: true,
  horariosNormalizado: true,
  sabadoOriginal: true,
  sabadoNormalizado: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function GET() {
  return methodNotAllowed(["PATCH", "DELETE"]);
}

export function POST() {
  return methodNotAllowed(["PATCH", "DELETE"]);
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
  if (!validateExceptionId(id)) {
    return jsonError(400, "INVALID_EXCEPTION_ID", "Identificador inválido");
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-excecoes-update",
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

  const contentLengthError = requireMaxContentLength(request, 4 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = jornadaExceptionPatchSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const exception = await prisma.jornadaException.update({
      where: { id },
      data: parsed.data,
      select: exceptionSelect,
    });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "UPDATE",
        entity: "JornadaException",
        entityId: exception.id,
        metadata: parsed.data,
      },
    });

    return NextResponse.json(exception);
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
  if (!validateExceptionId(id)) {
    return jsonError(400, "INVALID_EXCEPTION_ID", "Identificador inválido");
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-excecoes-delete",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  try {
    const exception = await prisma.jornadaException.update({
      where: { id },
      data: { active: false },
      select: exceptionSelect,
    });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "DEACTIVATE",
        entity: "JornadaException",
        entityId: exception.id,
        metadata: { id },
      },
    });

    return NextResponse.json(exception);
  } catch (error) {
    return prismaErrorResponse(error);
  }
}
