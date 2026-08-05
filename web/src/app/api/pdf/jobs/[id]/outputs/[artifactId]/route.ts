import { access } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  enforceSharedRateLimit,
  jsonError,
  methodNotAllowed,
} from "@/lib/api/security";
import { getPdfOwnerContext, pdfJobAccessWhere } from "@/lib/pdf/access";
import { createAttachmentHeader } from "@/lib/pdf/downloads";
import {
  createPdfStorageReadStream,
  resolvePdfStorageKey,
} from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ artifactId: string; id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const owner = await getPdfOwnerContext();
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 60,
    windowMs: 60_000,
    keyPrefix: "pdf-output-download",
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

  const { artifactId, id } = await context.params;
  const artifact = await prisma.pdfArtifact.findFirst({
    where: {
      id: artifactId,
      job: { id, ...pdfJobAccessWhere(owner) },
      kind: "OUTPUT",
    },
  });

  if (!artifact) {
    return jsonError(
      404,
      "PDF_OUTPUT_NOT_FOUND",
      "O arquivo solicitado não está disponível.",
    );
  }

  try {
    await access(resolvePdfStorageKey(artifact.storageKey));
  } catch {
    return jsonError(
      410,
      "PDF_OUTPUT_EXPIRED",
      "Este arquivo não está mais disponível para download.",
    );
  }

  const stream = createPdfStorageReadStream(artifact.storageKey);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": createAttachmentHeader(artifact.originalName),
      "Content-Length": artifact.sizeBytes.toString(),
      "Content-Type": artifact.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function POST() {
  return methodNotAllowed(["GET"]);
}

export function DELETE() {
  return methodNotAllowed(["GET"]);
}
