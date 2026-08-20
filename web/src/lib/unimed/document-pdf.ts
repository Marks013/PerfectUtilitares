import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { UnimedDocumentKind } from "@/generated/prisma/client";
import { PDFDocument } from "pdf-lib";
import {
  createPdfDraftWithCapacity,
  reservePdfJobForQueue,
} from "@/lib/pdf/capacity";
import { getPdfJobExpiry } from "@/lib/pdf/constants";
import { enqueuePdfJob } from "@/lib/pdf/queue";
import {
  removePdfJobFiles,
  resolvePdfStorageKey,
  writeOfficeUpload,
} from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";
import { generateUnimedDocument } from "@/lib/unimed/documents";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_CONTENT_TYPE = "application/pdf";
const UNIMED_PDF_PRINCIPAL_PREFIX = "unimed-document:";

type GeneratedDocumentKind = Exclude<UnimedDocumentKind, "NONE">;

export type UnimedDocumentPdfJob = {
  id: string;
  progress: number;
  status: "QUEUED" | "RUNNING";
};

export type UnimedDocumentPdfResult =
  | { state: "NOT_FOUND" }
  | { state: "PENDING"; job: UnimedDocumentPdfJob }
  | { state: "FAILED" }
  | { state: "GONE" }
  | {
      state: "READY";
      bytes: Uint8Array;
      cleanupDeferred: boolean;
      contentType: typeof PDF_CONTENT_TYPE;
      fileName: string;
    };

export class UnimedDocumentPdfError extends Error {
  constructor(
    public readonly code:
      | "UNIMED_DOCUMENT_PDF_QUEUE_UNAVAILABLE"
      | "UNIMED_DOCUMENT_PDF_STORAGE_FAILED",
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UnimedDocumentPdfError";
  }
}

function principalKey(tenantId: string, moduleSessionId: string) {
  return `${UNIMED_PDF_PRINCIPAL_PREFIX}${tenantId}:${moduleSessionId}`;
}

function ownerSessionHash(tenantId: string, moduleSessionId: string) {
  return createHash("sha256")
    .update(principalKey(tenantId, moduleSessionId))
    .digest("hex");
}

function bytesToStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function removeJob(
  tenantId: string,
  moduleSessionId: string,
  jobId: string,
) {
  try {
    await removePdfJobFiles(jobId);
    await prisma.pdfJob.deleteMany({
      where: {
        id: jobId,
        principalKey: principalKey(tenantId, moduleSessionId),
        tenantId,
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function markFailedAndRemove(
  tenantId: string,
  moduleSessionId: string,
  jobId: string,
) {
  const failed = await prisma.pdfJob.updateMany({
    where: {
      id: jobId,
      principalKey: principalKey(tenantId, moduleSessionId),
      status: { in: ["DRAFT", "QUEUED"] },
      tenantId,
    },
    data: {
      completedAt: new Date(),
      errorCode: "UNIMED_DOCUMENT_PDF_QUEUE_UNAVAILABLE",
      errorMessage: "A conversão do documento não pôde ser iniciada.",
      status: "FAILED",
    },
  });
  if (failed.count === 1) {
    await removeJob(tenantId, moduleSessionId, jobId);
  }
  return failed.count === 1;
}

export async function queueUnimedDocumentPdf({
  beneficiaryId,
  dependentIds,
  documentKind,
  manualDependents,
  moduleSessionId,
  reasonCode,
  tenantId,
}: {
  beneficiaryId: string;
  dependentIds: string[];
  documentKind: GeneratedDocumentKind;
  manualDependents: Array<{ fullName: string; cpf: string }>;
  moduleSessionId: string;
  reasonCode: number;
  tenantId: string;
}): Promise<UnimedDocumentPdfJob> {
  const document = await generateUnimedDocument(
    tenantId,
    beneficiaryId,
    documentKind,
    { dependentIds, manualDependents, reasonCode },
  );
  const principal = principalKey(tenantId, moduleSessionId);
  const job = await createPdfDraftWithCapacity({
    expiresAt: getPdfJobExpiry(),
    isAuthenticated: true,
    operation: "WORD_TO_PDF",
    options: { documentKind, reasonCode, source: "UNIMED_DOCUMENT" },
    ownerSessionHash: ownerSessionHash(tenantId, moduleSessionId),
    principalKey: principal,
    tenantId,
    userId: null,
  });

  try {
    const upload = await writeOfficeUpload(
      bytesToStream(document.bytes),
      job.id,
      DOCX_CONTENT_TYPE,
    );
    await prisma.$transaction([
      prisma.pdfArtifact.create({
        data: {
          id: upload.artifactId,
          jobId: job.id,
          kind: "INPUT",
          mimeType: DOCX_CONTENT_TYPE,
          originalName: document.fileName,
          sha256: upload.sha256,
          sizeBytes: upload.sizeBytes,
          storageKey: upload.storageKey,
        },
      }),
      prisma.pdfJob.update({
        where: { id: job.id },
        data: { inputBytes: upload.sizeBytes },
      }),
    ]);

    const claimed = await reservePdfJobForQueue({
      isAuthenticated: true,
      jobId: job.id,
      principalKey: principal,
    });
    if (!claimed) {
      throw new UnimedDocumentPdfError(
        "UNIMED_DOCUMENT_PDF_QUEUE_UNAVAILABLE",
        503,
        "A conversão do documento não pôde ser iniciada. Tente novamente.",
      );
    }

    try {
      await enqueuePdfJob(job.id, { key: principal, tier: "authenticated" });
    } catch {
      const current = await prisma.pdfJob
        .findFirst({
          where: { id: job.id, principalKey: principal, tenantId },
          select: { progress: true, status: true },
        })
        .catch(() => null);
      if (current?.status === "RUNNING" || current?.status === "SUCCEEDED") {
        return {
          id: job.id,
          progress: current.progress,
          status: "RUNNING",
        };
      }
      throw new UnimedDocumentPdfError(
        "UNIMED_DOCUMENT_PDF_QUEUE_UNAVAILABLE",
        503,
        "A conversão do documento está temporariamente indisponível. Tente novamente.",
      );
    }

    return { id: job.id, progress: 0, status: "QUEUED" };
  } catch (error) {
    if (error instanceof UnimedDocumentPdfError) {
      await markFailedAndRemove(tenantId, moduleSessionId, job.id);
      throw error;
    }
    await markFailedAndRemove(tenantId, moduleSessionId, job.id);
    throw new UnimedDocumentPdfError(
      "UNIMED_DOCUMENT_PDF_STORAGE_FAILED",
      503,
      "Não foi possível preparar o documento para conversão. Tente novamente.",
    );
  }
}

export async function getUnimedDocumentPdf(
  tenantId: string,
  moduleSessionId: string,
  jobId: string,
): Promise<UnimedDocumentPdfResult> {
  const job = await prisma.pdfJob.findFirst({
    where: {
      id: jobId,
      operation: "WORD_TO_PDF",
      principalKey: principalKey(tenantId, moduleSessionId),
      tenantId,
    },
    select: {
      artifacts: {
        where: { kind: "OUTPUT" },
        orderBy: { createdAt: "asc" },
        select: {
          mimeType: true,
          originalName: true,
          sha256: true,
          sizeBytes: true,
          storageKey: true,
        },
      },
      expiresAt: true,
      id: true,
      progress: true,
      status: true,
    },
  });

  if (!job) return { state: "NOT_FOUND" };
  if (
    job.expiresAt <= new Date() &&
    (job.status === "DRAFT" || job.status === "QUEUED")
  ) {
    await removeJob(tenantId, moduleSessionId, job.id);
    return { state: "GONE" };
  }
  if (job.status === "DRAFT" || job.status === "QUEUED") {
    return {
      state: "PENDING",
      job: { id: job.id, progress: job.progress, status: "QUEUED" },
    };
  }
  if (job.status === "RUNNING") {
    return {
      state: "PENDING",
      job: { id: job.id, progress: job.progress, status: "RUNNING" },
    };
  }
  if (job.status === "FAILED") {
    await removeJob(tenantId, moduleSessionId, job.id);
    return { state: "FAILED" };
  }
  if (
    job.status === "CANCELLED" ||
    job.status === "EXPIRED" ||
    job.status !== "SUCCEEDED"
  ) {
    await removeJob(tenantId, moduleSessionId, job.id);
    return { state: "GONE" };
  }

  const output = job.artifacts.length === 1 ? job.artifacts[0] : null;
  if (!output || output.mimeType !== PDF_CONTENT_TYPE) {
    await removeJob(tenantId, moduleSessionId, job.id);
    return { state: "FAILED" };
  }

  try {
    const bytes = new Uint8Array(
      await readFile(resolvePdfStorageKey(output.storageKey)),
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.byteLength !== Number(output.sizeBytes) ||
      digest !== output.sha256 ||
      bytes.byteLength < 5 ||
      new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-"
    ) {
      throw new Error("invalid PDF artifact");
    }
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (!pdf.getPageCount()) throw new Error("empty PDF artifact");

    const cleanupDeferred = !(await removeJob(
      tenantId,
      moduleSessionId,
      job.id,
    ));
    return {
      state: "READY",
      bytes,
      cleanupDeferred,
      contentType: PDF_CONTENT_TYPE,
      fileName: output.originalName,
    };
  } catch {
    await removeJob(tenantId, moduleSessionId, job.id);
    return { state: "FAILED" };
  }
}
