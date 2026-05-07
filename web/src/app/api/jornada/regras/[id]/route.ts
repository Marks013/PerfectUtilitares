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
import { jornadaRulePatchSchema, zodIssueDetails } from "@/lib/jornada/rule-schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function validateRuleId(id: string) {
  return id.length >= 8 && id.length <= 64;
}

function prismaErrorResponse(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      return jsonError(404, "RULE_NOT_FOUND", "Regra não encontrada");
    }

    if (error.code === "P2002") {
      return jsonError(409, "RULE_NAME_EXISTS", "Já existe regra com este nome");
    }
  }

  throw error;
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireModuleAccess("jornada");
  if (!guard.ok) {
    return guard.response;
  }

  const { id } = await context.params;
  if (!validateRuleId(id)) {
    return jsonError(400, "INVALID_RULE_ID", "Identificador inválido");
  }

  const rule = await prisma.jornadaRule.findUnique({ where: { id } });
  if (!rule) {
    return jsonError(404, "RULE_NOT_FOUND", "Regra não encontrada");
  }

  return NextResponse.json(rule);
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
  if (!validateRuleId(id)) {
    return jsonError(400, "INVALID_RULE_ID", "Identificador inválido");
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-regra-update",
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

  const parsed = jornadaRulePatchSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Dados inválidos",
      zodIssueDetails(parsed.error),
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return jsonError(400, "EMPTY_UPDATE", "Informe ao menos um campo");
  }

  try {
    const rule = await prisma.jornadaRule.update({
      where: { id },
      data: parsed.data,
    });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "UPDATE",
        entity: "JornadaRule",
        entityId: rule.id,
        metadata: parsed.data,
      },
    });

    return NextResponse.json(rule);
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
  if (!validateRuleId(id)) {
    return jsonError(400, "INVALID_RULE_ID", "Identificador inválido");
  }

  const limited = enforceRateLimit(request, {
    keyPrefix: "jornada-regra-delete",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  try {
    const rule = await prisma.jornadaRule.update({
      where: { id },
      data: { active: false },
    });

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "DEACTIVATE",
        entity: "JornadaRule",
        entityId: rule.id,
        metadata: { id },
      },
    });

    return NextResponse.json(rule);
  } catch (error) {
    return prismaErrorResponse(error);
  }
}
