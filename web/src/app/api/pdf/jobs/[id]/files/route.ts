import { NextResponse } from "next/server";
import {
  enforceSharedRateLimit,
  jsonError,
  methodNotAllowed,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { requireResourceCapacity } from "@/lib/api/resource-capacity";
import { getPdfOwnerContext, pdfJobAccessWhere } from "@/lib/pdf/access";
import {
  MAX_PDF_FILE_BYTES,
  MAX_PDF_JOB_BYTES,
  MAX_PDF_JOB_FILES,
} from "@/lib/pdf/constants";
import { serializePdfJob } from "@/lib/pdf/serialization";
import {
  PdfStorageError,
  removePdfStorageKey,
  sanitizePdfFileName,
  writePdfUpload,
} from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";
import { getRequestContentLength } from "@/lib/system/resource-capacity";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const PDF_INPUT_OPERATIONS = new Set([
  "COMPRESS",
  "MERGE",
  "SPLIT",
  "ROTATE",
  "DELETE_PAGES",
  "EXTRACT_PAGES",
  "ORGANIZE",
  "EDIT",
  "ANNOTATE",
  "CROP",
  "PDF_TO_JPG",
  "PDF_TO_WORD",
  "PDF_TO_EXCEL",
]);

export async function POST(request: Request, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const contentTypeError = requireContentType(request, ["application/pdf"]);
  if (contentTypeError) return contentTypeError;

  const lengthError = requireMaxContentLength(request, MAX_PDF_FILE_BYTES);
  if (lengthError) return lengthError;

  const capacityError = await requireResourceCapacity({
    inputBytes: getRequestContentLength(request),
    multiplier: 3,
  });
  if (capacityError) return capacityError;

  const owner = await getPdfOwnerContext();
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 30,
    windowMs: 60_000,
    keyPrefix: "pdf-file-upload",
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

  const { id } = await context.params;
  const job = await prisma.pdfJob.findFirst({
    where: { id, ...pdfJobAccessWhere(owner) },
    include: {
      _count: { select: { artifacts: true } },
    },
  });

  if (!job) {
    return jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
  }

  if (job.status !== "DRAFT" || !PDF_INPUT_OPERATIONS.has(job.operation)) {
    return jsonError(
      409,
      "PDF_JOB_LOCKED",
      "Este trabalho não aceita novos arquivos PDF.",
    );
  }

  if (job._count.artifacts >= MAX_PDF_JOB_FILES) {
    return jsonError(
      409,
      "PDF_FILE_LIMIT",
      `Este trabalho aceita até ${MAX_PDF_JOB_FILES} arquivos.`,
    );
  }

  let uploadedStorageKey: string | null = null;

  try {
    const originalName = sanitizePdfFileName(
      request.headers.get("x-file-name"),
    );
    const upload = await writePdfUpload(request.body, job.id);
    uploadedStorageKey = upload.storageKey;
    const nextInputBytes = job.inputBytes + upload.sizeBytes;

    if (nextInputBytes > BigInt(MAX_PDF_JOB_BYTES)) {
      await removePdfStorageKey(upload.storageKey);
      return jsonError(
        413,
        "PDF_JOB_TOO_LARGE",
        "O conjunto de arquivos ultrapassa o limite de 500 MB.",
      );
    }

    const updatedJob = await prisma.pdfJob.update({
      where: { id: job.id },
      data: {
        inputBytes: nextInputBytes,
        artifacts: {
          create: {
            id: upload.artifactId,
            kind: "INPUT",
            storageKey: upload.storageKey,
            originalName,
            mimeType: "application/pdf",
            sizeBytes: upload.sizeBytes,
            sha256: upload.sha256,
          },
        },
      },
      include: { artifacts: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json(
      {
        job: serializePdfJob(updatedJob),
        artifactId: upload.artifactId,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PdfStorageError) {
      const status = error.code === "FILE_TOO_LARGE" ? 413 : 400;
      return jsonError(status, error.code, error.message);
    }

    if (uploadedStorageKey) {
      await removePdfStorageKey(uploadedStorageKey).catch(() => undefined);
    }

    throw error;
  }
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export function DELETE() {
  return methodNotAllowed(["POST"]);
}
