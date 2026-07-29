import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireModuleAccess,
  requireSameOrigin,
} from "@/lib/api/security";
import { getPdfJobExpiry } from "@/lib/pdf/constants";
import { pdfJobCreateSchema } from "@/lib/pdf/schema";
import { serializePdfJob } from "@/lib/pdf/serialization";
import { prisma } from "@/lib/prisma";
import { zodIssueDetails } from "@/lib/users/schema";

export const runtime = "nodejs";

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const lengthError = requireMaxContentLength(request, 32 * 1024);
  if (lengthError) return lengthError;

  const rateLimitError = enforceRateLimit(request, {
    limit: 30,
    windowMs: 60_000,
    keyPrefix: "pdf-job-create",
  });
  if (rateLimitError) return rateLimitError;

  const guard = await requireModuleAccess("pdf");
  if (!guard.ok) return guard.response;

  if (!guard.session.user.tenantId) {
    return jsonError(
      409,
      "TENANT_REQUIRED",
      "Sua conta precisa estar vinculada a uma empresa para usar este módulo.",
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = pdfJobCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_PDF_JOB",
      "Revise a ferramenta e as opções selecionadas.",
      zodIssueDetails(parsed.error),
    );
  }

  const job = await prisma.pdfJob.create({
    data: {
      tenantId: guard.session.user.tenantId,
      userId: guard.session.user.id,
      operation: parsed.data.operation,
      options: parsed.data.options as Prisma.InputJsonValue | undefined,
      expiresAt: getPdfJobExpiry(),
    },
  });

  return NextResponse.json({ job: serializePdfJob(job) }, { status: 201 });
}

export function PUT() {
  return methodNotAllowed(["POST"]);
}

export function PATCH() {
  return methodNotAllowed(["POST"]);
}

export function DELETE() {
  return methodNotAllowed(["POST"]);
}
