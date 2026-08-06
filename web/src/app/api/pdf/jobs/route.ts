import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import {
  enforceSharedRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { getPdfOwnerContext, getPdfPrincipal } from "@/lib/pdf/access";
import {
  createPdfDraftWithCapacity,
  PdfPublicCapacityError,
} from "@/lib/pdf/capacity";
import { getPdfJobExpiry } from "@/lib/pdf/constants";
import { pdfJobCreateSchema } from "@/lib/pdf/schema";
import { serializePdfJob } from "@/lib/pdf/serialization";
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

  const owner = await getPdfOwnerContext({ createAnonymous: true });
  const principal = getPdfPrincipal(owner, request.headers);
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 30,
    windowMs: 60_000,
    keyPrefix: "pdf-job-create",
    dailyLimit: 20,
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

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

  try {
    const job = await createPdfDraftWithCapacity({
      tenantId: owner.session?.user.tenantId ?? null,
      userId: owner.session?.user.id ?? null,
      ownerSessionHash: owner.session ? null : owner.ownerSessionHash,
      principalKey: principal.key,
      isAuthenticated: principal.tier === "authenticated",
      operation: parsed.data.operation,
      options: parsed.data.options as Prisma.InputJsonValue | undefined,
      expiresAt: getPdfJobExpiry(),
    });

    return NextResponse.json({ job: serializePdfJob(job) }, { status: 201 });
  } catch (error) {
    if (error instanceof PdfPublicCapacityError) {
      return jsonError(429, error.code, error.message, {
        action: {
          href: "/login",
          label: "Entrar na conta",
        },
      });
    }
    throw error;
  }
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
