import { ZipArchive } from "archiver";
import { access } from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
import {
  enforceSharedRateLimit,
  jsonError,
  methodNotAllowed,
} from "@/lib/api/security";
import { getPdfOwnerContext, pdfJobAccessWhere } from "@/lib/pdf/access";
import {
  createAttachmentHeader,
  uniqueDownloadName,
} from "@/lib/pdf/downloads";
import {
  createPdfStorageReadStream,
  resolvePdfStorageKey,
} from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const owner = await getPdfOwnerContext();
  const rateLimitError = await enforceSharedRateLimit(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: "pdf-output-zip",
    authenticated: Boolean(owner.session),
  });
  if (rateLimitError) return rateLimitError;

  const { id } = await context.params;
  const job = await prisma.pdfJob.findFirst({
    where: { id, ...pdfJobAccessWhere(owner) },
    select: {
      id: true,
      status: true,
      artifacts: {
        where: { kind: "OUTPUT" },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!job) {
    return jsonError(404, "PDF_JOB_NOT_FOUND", "Trabalho PDF não encontrado.");
  }

  if (job.status !== "SUCCEEDED" || !job.artifacts.length) {
    return jsonError(
      409,
      "PDF_OUTPUT_NOT_READY",
      "Os arquivos ainda não estão prontos para download.",
    );
  }

  try {
    await Promise.all(
      job.artifacts.map((artifact) =>
        access(resolvePdfStorageKey(artifact.storageKey)),
      ),
    );
  } catch {
    return jsonError(
      410,
      "PDF_OUTPUT_EXPIRED",
      "Um ou mais arquivos não estão mais disponíveis para download.",
    );
  }

  const output = new PassThrough();
  const archive = new ZipArchive({
    zlib: { level: 6 },
  });
  const usedNames = new Set<string>();

  archive.on("error", (error: Error) => output.destroy(error));
  archive.pipe(output);

  for (const artifact of job.artifacts) {
    archive.append(createPdfStorageReadStream(artifact.storageKey), {
      name: uniqueDownloadName(artifact.originalName, usedNames),
    });
  }

  void archive.finalize();

  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": createAttachmentHeader(
        `documentos-${job.id.slice(-8)}.zip`,
      ),
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff",
      "X-Output-Count": String(job.artifacts.length),
    },
  });
}

export function POST() {
  return methodNotAllowed(["GET"]);
}

export function DELETE() {
  return methodNotAllowed(["GET"]);
}
