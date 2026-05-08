import { NextResponse } from "next/server";
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
  jornadaExceptionSchema,
  zodIssueDetails,
} from "@/lib/jornada/exception-schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

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

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const exceptions = await prisma.jornadaException.findMany({
    select: exceptionSelect,
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return NextResponse.json(exceptions);
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
    keyPrefix: "jornada-excecoes-create",
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

  const contentLengthError = requireMaxContentLength(request, 12 * 1024);
  if (contentLengthError) {
    return contentLengthError;
  }

  const json = await readJsonBody(request);
  if (!json.ok) {
    return json.response;
  }

  const parsed = jornadaExceptionSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      zodIssueDetails(parsed.error),
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return jsonError(404, "USER_NOT_FOUND", "Usuário ativo não encontrado");
  }

  const duplicate = await prisma.jornadaException.findFirst({
    where: {
      userId: parsed.data.userId,
      horariosNormalizado: parsed.data.horariosNormalizado,
      sabadoNormalizado: parsed.data.sabadoNormalizado,
      active: true,
    },
    select: { id: true },
  });
  if (duplicate) {
    return jsonError(
      409,
      "EXCEPTION_EXISTS",
      "Já existe exceção ativa para este usuário e horário",
    );
  }

  const exception = await prisma.jornadaException.create({
    data: {
      userId: parsed.data.userId,
      nome: parsed.data.nome,
      horariosOriginal: parsed.data.horarios,
      horariosNormalizado: parsed.data.horariosNormalizado,
      sabadoOriginal: parsed.data.sabadoHorarios || null,
      sabadoNormalizado: parsed.data.sabadoNormalizado,
      active: parsed.data.active,
      createdById: guard.session.user.id,
    },
    select: exceptionSelect,
  });

  await prisma.auditLog.create({
    data: {
      userId: guard.session.user.id,
      action: "CREATE",
      entity: "JornadaException",
      entityId: exception.id,
      metadata: {
        userId: exception.userId,
        horariosNormalizado: exception.horariosNormalizado,
        sabadoNormalizado: exception.sabadoNormalizado,
      },
    },
  });

  return NextResponse.json(exception, { status: 201 });
}

