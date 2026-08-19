import type { PdfArtifact, PdfJob } from "@/generated/prisma/client";

type JobWithArtifacts = PdfJob & { artifacts?: PdfArtifact[] };

export function serializePdfJob(job: JobWithArtifacts) {
  return {
    id: job.id,
    operation: job.operation,
    status: job.status,
    progress: job.progress,
    options: job.options,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    inputBytes: job.inputBytes.toString(),
    outputBytes: job.outputBytes.toString(),
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    artifacts: job.artifacts?.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      originalName: artifact.originalName,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes.toString(),
      pageCount: artifact.pageCount,
      metadata: artifact.metadata,
      createdAt: artifact.createdAt,
    })),
  };
}
