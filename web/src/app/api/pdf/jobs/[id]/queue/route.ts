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
import {
  PdfPublicCapacityError,
  reservePdfJobForQueue,
} from "@/lib/pdf/capacity";
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

async function currentJobResponse(jobId: string, status = 202) {
  const current = await prisma.pdfJob.findUnique({
    where: { id: jobId },
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
  });
  return current
    ? NextResponse.json({ job: serializePdfJob(current) }, { status })
    : jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
}

async function ensurePdfJobPublished(
  job: { id: string; principalKey: string },
  tier: "authenticated" | "public",
) {
  try {
    await enqueuePdfJob(job.id, { key: job.principalKey, tier });
    await prisma.pdfJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { errorCode: null, errorMessage: null },
    });
    return null;
  } catch (error) {
    await prisma.pdfJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: {
        errorCode: "QUEUE_UNAVAILABLE",
        errorMessage:
          "O processamento está temporariamente indisponível. Tente novamente.",
      },
    });
    Sentry.captureException(error, { tags: { pdfJobId: job.id } });
    return jsonError(
      503,
      "PDF_QUEUE_UNAVAILABLE",
      "O processamento está temporariamente indisponível. Tente novamente.",
    );
  }
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

  if (["QUEUED", "RUNNING", "SUCCEEDED"].includes(job.status)) {
    if (job.status === "QUEUED") {
      const publishError = await ensurePdfJobPublished(
        job,
        owner.session ? "authenticated" : "public",
      );
      if (publishError) return publishError;
    }
    return currentJobResponse(job.id, job.status === "SUCCEEDED" ? 200 : 202);
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

  let claimed = false;
  try {
    claimed = await reservePdfJobForQueue({
      isAuthenticated: Boolean(owner.session),
      jobId: job.id,
      principalKey: job.principalKey,
    });
  } catch (error) {
    if (error instanceof PdfPublicCapacityError) {
      return jsonError(429, error.code, error.message, {
        action: { href: "/login", label: "Entrar na conta" },
      });
    }
    const response = resourceCapacityErrorResponse(error);
    if (response) return response;
    throw error;
  }

  if (!claimed) {
    const current = await prisma.pdfJob.findUnique({
      where: { id: job.id },
      select: { status: true },
    });
    if (
      current &&
      ["QUEUED", "RUNNING", "SUCCEEDED"].includes(current.status)
    ) {
      if (current.status === "QUEUED") {
        const publishError = await ensurePdfJobPublished(
          job,
          owner.session ? "authenticated" : "public",
        );
        if (publishError) return publishError;
      }
      return currentJobResponse(
        job.id,
        current.status === "SUCCEEDED" ? 200 : 202,
      );
    }
    return jsonError(
      409,
      "PDF_JOB_ALREADY_QUEUED",
      "Este trabalho já foi enviado para processamento.",
    );
  }

  const publishError = await ensurePdfJobPublished(
    job,
    owner.session ? "authenticated" : "public",
  );
  if (publishError) return publishError;

  const sideEffects = await Promise.allSettled([
    prisma.auditLog.create({
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
    }),
    recordUserUsage({
      userId: owner.session?.user.id,
      module: "PDF",
      operation: job.operation,
      inputBytes: job.inputBytes,
    }),
  ]);
  sideEffects.forEach((result, index) => {
    if (result.status !== "rejected") return;
    Sentry.captureException(result.reason, {
      tags: {
        pdfJobId: job.id,
        pdfQueueSideEffect: index === 0 ? "audit" : "usage",
      },
    });
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
