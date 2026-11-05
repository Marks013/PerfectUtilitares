import { ZipArchive } from "archiver";
import { stat } from "node:fs/promises";
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
import { resolvePdfStorageKey } from "@/lib/pdf/storage";
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
        select: { originalName: true, storageKey: true },
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

  const files = await Promise.all(
    job.artifacts.map(async (artifact) => {
      const path = resolvePdfStorageKey(artifact.storageKey);
      const stats = await stat(path);
      if (!stats.isFile()) throw new Error("Artefato não é um arquivo.");
      return { path, stats, originalName: artifact.originalName };
    }),
  ).catch(() => null);
  if (!files) {
    return jsonError(
      410,
      "PDF_OUTPUT_EXPIRED",
      "Um ou mais arquivos não estão mais disponíveis para download.",
    );
  }

  const output = new PassThrough();
  const archive = new ZipArchive({
    // Os PDFs normalmente já contêm streams compactados.
    zlib: { level: 1 },
  });
  const usedNames = new Set<string>();

  const fail = (error: Error) => output.destroy(error);
  archive.on("error", fail);
  archive.on("warning", fail);
  output.once("close", () => {
    if (!output.readableEnded) archive.abort();
  });
  archive.pipe(output);

  for (const file of files) {
    archive.file(file.path, {
      name: uniqueDownloadName(file.originalName, usedNames),
      stats: file.stats,
    });
  }

  void archive.finalize().catch(fail);

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
