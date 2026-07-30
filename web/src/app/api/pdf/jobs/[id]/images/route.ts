import { NextResponse } from "next/server";
import sharp, { type Metadata } from "sharp";
import {
  enforceSharedRateLimit,
  jsonError,
  methodNotAllowed,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { getPdfOwnerContext, pdfJobAccessWhere } from "@/lib/pdf/access";
import {
  MAX_PDF_IMAGE_BYTES,
  MAX_PDF_JOB_BYTES,
  MAX_PDF_JOB_FILES,
} from "@/lib/pdf/constants";
import { serializePdfJob } from "@/lib/pdf/serialization";
import {
  PdfStorageError,
  removePdfStorageKey,
  resolvePdfStorageKey,
  sanitizeImageFileName,
  writeImageUpload,
} from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const contentTypeError = requireContentType(request, [
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  if (contentTypeError) return contentTypeError;

  const lengthError = requireMaxContentLength(request, MAX_PDF_IMAGE_BYTES);
  if (lengthError) return lengthError;

  const owner = await getPdfOwnerContext();
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 30,
    windowMs: 60_000,
    keyPrefix: "pdf-image-upload",
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

  const { id } = await context.params;
  const job = await prisma.pdfJob.findFirst({
    where: { id, ...pdfJobAccessWhere(owner) },
    include: { _count: { select: { artifacts: true } } },
  });
  if (!job) {
    return jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
  }
  if (job.operation !== "JPG_TO_PDF" || job.status !== "DRAFT") {
    return jsonError(
      409,
      "PDF_JOB_LOCKED",
      "Este trabalho não aceita novas imagens.",
    );
  }
  if (job._count.artifacts >= MAX_PDF_JOB_FILES) {
    return jsonError(
      409,
      "PDF_FILE_LIMIT",
      `Este trabalho aceita até ${MAX_PDF_JOB_FILES} imagens.`,
    );
  }

  const mimeType = request.headers
    .get("content-type")
    ?.split(";", 1)[0] as ImageMimeType;
  let storageKey: string | null = null;

  try {
    const originalName = sanitizeImageFileName(
      request.headers.get("x-file-name"),
      mimeType,
    );
    const upload = await writeImageUpload(request.body, job.id, mimeType);
    storageKey = upload.storageKey;
    let metadata: Metadata;
    try {
      metadata = await sharp(resolvePdfStorageKey(upload.storageKey), {
        limitInputPixels: 100_000_000,
      }).metadata();
    } catch {
      throw new PdfStorageError(
        "INVALID_IMAGE",
        "A imagem está corrompida ou usa um formato incompatível.",
      );
    }
    const expectedFormat = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
    }[mimeType];
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height
    ) {
      await removePdfStorageKey(upload.storageKey);
      return jsonError(
        400,
        "INVALID_IMAGE",
        "A imagem está corrompida ou usa um formato incompatível.",
      );
    }
    const nextInputBytes = job.inputBytes + upload.sizeBytes;
    if (nextInputBytes > BigInt(MAX_PDF_JOB_BYTES)) {
      await removePdfStorageKey(upload.storageKey);
      return jsonError(
        413,
        "PDF_JOB_TOO_LARGE",
        "O conjunto de imagens ultrapassa o limite de 500 MB.",
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
    if (storageKey) {
      await removePdfStorageKey(storageKey).catch(() => undefined);
    }
    if (error instanceof PdfStorageError) {
      return jsonError(
        error.code === "FILE_TOO_LARGE" ? 413 : 400,
        error.code,
        error.message,
      );
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
