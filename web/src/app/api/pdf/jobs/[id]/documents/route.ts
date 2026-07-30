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
  OFFICE_FORMATS,
  PdfStorageError,
  removePdfStorageKey,
  sanitizeOfficeFileName,
  writeOfficeUpload,
} from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";
import { getRequestContentLength } from "@/lib/system/resource-capacity";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MIME_TYPES = Object.keys(OFFICE_FORMATS) as Array<
  keyof typeof OFFICE_FORMATS
>;

export async function POST(request: Request, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const contentTypeError = requireContentType(request, MIME_TYPES);
  if (contentTypeError) return contentTypeError;

  const lengthError = requireMaxContentLength(request, MAX_PDF_FILE_BYTES);
  if (lengthError) return lengthError;

  const capacityError = await requireResourceCapacity({
    inputBytes: getRequestContentLength(request),
    multiplier: 5,
  });
  if (capacityError) return capacityError;

  const owner = await getPdfOwnerContext();
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 30,
    windowMs: 60_000,
    keyPrefix: "pdf-office-upload",
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

  const mimeType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim() as keyof typeof OFFICE_FORMATS;
  const { id } = await context.params;
  const job = await prisma.pdfJob.findFirst({
    where: { id, ...pdfJobAccessWhere(owner) },
    include: { _count: { select: { artifacts: true } } },
  });

  if (!job) {
    return jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
  }
  if (job.status !== "DRAFT") {
    return jsonError(
      409,
      "PDF_JOB_LOCKED",
      "Este trabalho já foi enviado para processamento.",
    );
  }
  const expectedMimeType =
    job.operation === "WORD_TO_PDF"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : job.operation === "EXCEL_TO_PDF"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : null;
  if (!expectedMimeType || mimeType !== expectedMimeType) {
    return jsonError(
      400,
      "OFFICE_FORMAT_NOT_ALLOWED",
      "O formato enviado não corresponde à ferramenta selecionada.",
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
    const originalName = sanitizeOfficeFileName(
      request.headers.get("x-file-name"),
      mimeType,
    );
    const upload = await writeOfficeUpload(request.body, job.id, mimeType);
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
            mimeType,
            originalName,
            sha256: upload.sha256,
            sizeBytes: upload.sizeBytes,
            storageKey: upload.storageKey,
          },
        },
      },
      include: { artifacts: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json(
      {
        artifactId: upload.artifactId,
        job: serializePdfJob(updatedJob),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PdfStorageError) {
      return jsonError(
        error.code === "FILE_TOO_LARGE" ? 413 : 400,
        error.code,
        error.message,
      );
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
