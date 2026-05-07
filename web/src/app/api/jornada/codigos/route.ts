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
  requireModuleAccess,
  requireSameOrigin,
} from "@/lib/api/security";
import { codigoJornadaSchema, zodIssueDetails } from "@/lib/codigos/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const guard = await requireModuleAccess("jornada");
  if (!guard.ok) {
    return guard.response;
  }

  const codigos = await prisma.codigoJornada.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return NextResponse.json(codigos);
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
    keyPrefix: "jornada-codigos-create",
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

  const parsed = codigoJornadaSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const codigo = await prisma.codigoJornada.create({
      data: {
        ...parsed.data,
        origem: "MANUAL",
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "CREATE",
        entity: "CodigoJornada",
        entityId: codigo.id,
        metadata: parsed.data,
      },
    });

    return NextResponse.json(codigo, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        409,
        "CODIGO_HORARIO_EXISTS",
        "Já existe código para estes horários",
      );
    }

    throw error;
  }
}
