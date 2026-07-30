import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import {
  enforceSharedRateLimit,
  jsonError,
  methodNotAllowed,
  requireSameOrigin,
} from "@/lib/api/security";
import { resourceCapacityErrorResponse } from "@/lib/api/resource-capacity";
import { getPdfOwnerContext, pdfJobAccessWhere } from "@/lib/pdf/access";
import { assertPdfQueueCapacity } from "@/lib/pdf/capacity";
import { enqueuePdfJob } from "@/lib/pdf/queue";
import {
  jpgToPdfOptionsSchema,
  pdfCompressionOptionsSchema,
  pdfManifestSchema,
} from "@/lib/pdf/schema";
import { serializePdfJob } from "@/lib/pdf/serialization";
import { prisma } from "@/lib/prisma";
import { recordUserUsage } from "@/lib/usage/record";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MANIFEST_OPERATIONS = new Set([
  "MERGE",
  "SPLIT",
  "ROTATE",
  "DELETE_PAGES",
  "EXTRACT_PAGES",
  "CROP",
  "ORGANIZE",
  "EDIT",
  "ANNOTATE",
  "PDF_TO_JPG",
]);

function readManifest(options: unknown) {
  if (!options || typeof options !== "object" || !("manifest" in options)) {
    return null;
  }

  const parsed = pdfManifestSchema.safeParse(
    (options as { manifest: unknown }).manifest,
  );
  return parsed.success ? parsed.data : null;
}

export async function POST(request: Request, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const owner = await getPdfOwnerContext();
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 10,
    windowMs: 60_000,
    keyPrefix: "pdf-job-queue",
    dailyLimit: 15,
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

  const { id } = await context.params;
  const job = await prisma.pdfJob.findFirst({
    where: { id, ...pdfJobAccessWhere(owner) },
    include: {
      artifacts: {
        where: { kind: "INPUT" },
        select: { id: true, mimeType: true },
      },
    },
  });

  if (!job) {
    return jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
  }

  if (job.status !== "DRAFT") {
    return jsonError(
      409,
      "PDF_JOB_ALREADY_QUEUED",
      "Este trabalho já foi enviado para processamento.",
    );
  }

  if (!job.artifacts.length) {
    return jsonError(
      400,
      "PDF_INPUT_REQUIRED",
      "Adicione ao menos um arquivo.",
    );
  }

  const expectedMimeType =
    job.operation === "JPG_TO_PDF"
      ? "image/"
      : job.operation === "WORD_TO_PDF"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : job.operation === "EXCEL_TO_PDF"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf";
  const invalidInputType = job.artifacts.some((artifact) =>
    expectedMimeType.endsWith("/")
      ? !artifact.mimeType.startsWith(expectedMimeType)
      : artifact.mimeType !== expectedMimeType,
  );
  if (invalidInputType) {
    return jsonError(
      400,
      "PDF_INPUT_TYPE_INVALID",
      "Um dos arquivos não corresponde ao formato esperado.",
    );
  }

  const manifest = readManifest(job.options);
  if (MANIFEST_OPERATIONS.has(job.operation) && !manifest) {
    return jsonError(
      400,
      "PDF_MANIFEST_REQUIRED",
      "Aguarde a organização das páginas ser salva antes de finalizar.",
    );
  }

  if (
    job.operation === "COMPRESS" &&
    !pdfCompressionOptionsSchema.safeParse(job.options ?? {}).success
  ) {
    return jsonError(
      400,
      "PDF_COMPRESSION_OPTIONS_INVALID",
      "Revise as opções selecionadas para compactação.",
    );
  }

  if (
    job.operation === "JPG_TO_PDF" &&
    !jpgToPdfOptionsSchema.safeParse(job.options ?? {}).success
  ) {
    return jsonError(
      400,
      "JPG_TO_PDF_OPTIONS_INVALID",
      "Revise as opções selecionadas para criar o PDF.",
    );
  }

  try {
    await assertPdfQueueCapacity(job);
  } catch (error) {
    const response = resourceCapacityErrorResponse(error);
    if (response) return response;
    throw error;
  }

  const claimed = await prisma.pdfJob.updateMany({
    where: { id: job.id, status: "DRAFT" },
    data: {
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      progress: 0,
      status: "QUEUED",
    },
  });

  if (claimed.count !== 1) {
    return jsonError(
      409,
      "PDF_JOB_ALREADY_QUEUED",
      "Este trabalho já foi enviado para processamento.",
    );
  }

  try {
    await enqueuePdfJob(job.id);
  } catch (error) {
    await prisma.pdfJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: {
        errorCode: "QUEUE_UNAVAILABLE",
        errorMessage:
          "O processamento está temporariamente indisponível. Tente novamente.",
        status: "DRAFT",
      },
    });
    Sentry.captureException(error, { tags: { pdfJobId: job.id } });
    return jsonError(
      503,
      "PDF_QUEUE_UNAVAILABLE",
      "O processamento está temporariamente indisponível. Tente novamente.",
    );
  }

  await prisma.auditLog.create({
    data: {
      action: "PDF_JOB_QUEUED",
      entity: "PdfJob",
      entityId: job.id,
      metadata: {
        operation: job.operation,
        pages: manifest?.pages.length ?? 0,
      },
      userId: owner.session?.user.id ?? null,
    },
  });
  await recordUserUsage({
    userId: owner.session?.user.id,
    module: "PDF",
    operation: job.operation,
    inputBytes: job.inputBytes,
  });

  const queuedJob = await prisma.pdfJob.findUniqueOrThrow({
    where: { id: job.id },
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json(
    { job: serializePdfJob(queuedJob) },
    { status: 202 },
  );
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export function DELETE() {
  return methodNotAllowed(["POST"]);
}
