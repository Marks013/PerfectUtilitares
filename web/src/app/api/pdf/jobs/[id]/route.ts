import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import {
  enforceSharedRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { getPdfOwnerContext, pdfJobAccessWhere } from "@/lib/pdf/access";
import { pdfJobUpdateSchema } from "@/lib/pdf/schema";
import { serializePdfJob } from "@/lib/pdf/serialization";
import { removePdfJobFiles } from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";
import { zodIssueDetails } from "@/lib/users/schema";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function validJobId(id: string) {
  return id.length >= 8 && id.length <= 64;
}

export async function GET(_request: Request, context: RouteContext) {
  const owner = await getPdfOwnerContext();

  const { id } = await context.params;
  if (!validJobId(id)) {
    return jsonError(400, "INVALID_JOB_ID", "Trabalho PDF inválido.");
  }

  const job = await prisma.pdfJob.findFirst({
    where: { id, ...pdfJobAccessWhere(owner) },
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
  });

  if (!job) {
    return jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
  }

  return NextResponse.json({ job: serializePdfJob(job) });
}

export async function DELETE(request: Request, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const owner = await getPdfOwnerContext();
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: "pdf-job-delete",
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

  const { id } = await context.params;
  if (!validJobId(id)) {
    return jsonError(400, "INVALID_JOB_ID", "Trabalho PDF inválido.");
  }

  const job = await prisma.pdfJob.findFirst({
    where: { id, ...pdfJobAccessWhere(owner) },
    select: { id: true, status: true },
  });

  if (!job) {
    return jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
  }

  if (job.status === "RUNNING") {
    return jsonError(
      409,
      "PDF_JOB_RUNNING",
      "Aguarde o processamento terminar antes de excluir este trabalho.",
    );
  }

  const expired = await prisma.pdfJob.updateMany({
    where: {
      id: job.id,
      status: { not: "RUNNING" },
      ...pdfJobAccessWhere(owner),
    },
    data: {
      completedAt: new Date(),
      status: "EXPIRED",
    },
  });

  if (!expired.count) {
    return jsonError(
      409,
      "PDF_JOB_RUNNING",
      "Aguarde o processamento terminar antes de excluir este trabalho.",
    );
  }

  try {
    await removePdfJobFiles(job.id);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { pdfJobDeleteCleanup: true, pdfJobId: job.id },
    });
    return jsonError(
      503,
      "PDF_STORAGE_CLEANUP_FAILED",
      "Não foi possível remover os arquivos agora. Tente novamente em instantes.",
    );
  }

  await prisma.pdfJob.deleteMany({
    where: { id: job.id, status: "EXPIRED" },
  });

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const lengthError = requireMaxContentLength(request, 2 * 1024 * 1024);
  if (lengthError) return lengthError;

  const owner = await getPdfOwnerContext();
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 60,
    windowMs: 60_000,
    keyPrefix: "pdf-job-update",
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

  const { id } = await context.params;
  if (!validJobId(id)) {
    return jsonError(400, "INVALID_JOB_ID", "Trabalho PDF inválido.");
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = pdfJobUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_PDF_MANIFEST",
      "Não foi possível salvar a organização das páginas.",
      zodIssueDetails(parsed.error),
    );
  }

  const currentJob = await prisma.pdfJob.findFirst({
    where: { id, ...pdfJobAccessWhere(owner) },
    select: {
      id: true,
      status: true,
      artifacts: {
        where: { kind: "INPUT" },
        select: { id: true },
      },
    },
  });

  if (!currentJob) {
    return jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
  }

  if (currentJob.status !== "DRAFT") {
    return jsonError(
      409,
      "PDF_JOB_LOCKED",
      "Este trabalho já foi enviado para processamento.",
    );
  }

  const artifactIds = new Set(
    currentJob.artifacts.map((artifact) => artifact.id),
  );
  const referencesUnknownArtifact = parsed.data.manifest.pages.some(
    (page) => !artifactIds.has(page.artifactId),
  );

  if (referencesUnknownArtifact) {
    return jsonError(
      400,
      "INVALID_PDF_PAGE_SOURCE",
      "Uma das páginas não pertence aos arquivos deste trabalho.",
    );
  }

  const pageIds = new Set(parsed.data.manifest.pages.map((page) => page.id));
  const referencesUnknownPage = parsed.data.annotations.some(
    (annotation) => !pageIds.has(annotation.pageId),
  );

  if (referencesUnknownPage) {
    return jsonError(
      400,
      "INVALID_PDF_ANNOTATION_PAGE",
      "Uma das marcações pertence a uma página que não está mais no documento.",
    );
  }

  const job = await prisma.pdfJob.update({
    where: { id: currentJob.id },
    data: { options: parsed.data },
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({ job: serializePdfJob(job) });
}

export function POST() {
  return methodNotAllowed(["GET", "PATCH", "DELETE"]);
}
