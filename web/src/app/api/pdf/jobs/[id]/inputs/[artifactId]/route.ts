import { access } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  requireModuleAccess,
} from "@/lib/api/security";
import { pdfJobAccessWhere } from "@/lib/pdf/access";
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
  const rateLimitError = enforceRateLimit(request, {
    limit: 90,
    windowMs: 60_000,
    keyPrefix: "pdf-input-read",
  });
  if (rateLimitError) return rateLimitError;

  const guard = await requireModuleAccess("pdf");
  if (!guard.ok) return guard.response;

  const { artifactId, id } = await context.params;
  const artifact = await prisma.pdfArtifact.findFirst({
    where: {
      id: artifactId,
      job: { id, ...pdfJobAccessWhere(guard.session) },
      kind: "INPUT",
    },
  });

  if (!artifact) {
    return jsonError(
      404,
      "PDF_INPUT_NOT_FOUND",
      "O arquivo original não está disponível.",
    );
  }

  try {
    await access(resolvePdfStorageKey(artifact.storageKey));
  } catch {
    return jsonError(
      410,
      "PDF_INPUT_EXPIRED",
      "Este arquivo original não está mais disponível.",
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
