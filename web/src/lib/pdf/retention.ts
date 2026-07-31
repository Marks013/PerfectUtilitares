import * as Sentry from "@sentry/node";
import {
  removePdfJobFiles,
  removePdfStorageKey,
} from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";

const PDF_STALE_RUNNING_JOB_HOURS = 6;

export async function cleanupCompletedPdfJobInputs(jobId: string) {
  const job = await prisma.pdfJob.findFirst({
    where: { id: jobId, status: "SUCCEEDED" },
    select: {
      artifacts: {
        where: { kind: { in: ["INPUT", "PREVIEW"] } },
        select: { id: true, kind: true, storageKey: true, sizeBytes: true },
      },
    },
  });
  if (!job) return { removed: 0 };

  const removals = await Promise.allSettled(
    job.artifacts.map((artifact) =>
      removePdfStorageKey(artifact.storageKey),
    ),
  );
  const removedArtifactIds: string[] = [];
  let remainingInputBytes = BigInt(0);

  removals.forEach((result, index) => {
    const artifact = job.artifacts[index];
    if (!artifact) return;

    if (result.status === "rejected") {
      if (artifact.kind === "INPUT") {
        remainingInputBytes += artifact.sizeBytes;
      }
      Sentry.captureException(result.reason, {
        tags: {
          pdfArtifactId: artifact.id,
          pdfInputCleanup: true,
          pdfJobId: jobId,
        },
      });
      return;
    }

    removedArtifactIds.push(artifact.id);
  });

  await prisma.$transaction([
    prisma.pdfArtifact.deleteMany({
      where: {
        id: { in: removedArtifactIds },
        jobId,
        kind: { in: ["INPUT", "PREVIEW"] },
      },
    }),
    prisma.pdfJob.updateMany({
      where: { id: jobId, status: "SUCCEEDED" },
      data: { inputBytes: remainingInputBytes },
    }),
  ]);

  return { removed: removedArtifactIds.length };
}

export async function cleanupExpiredPdfJobs(now = new Date()) {
  const staleRunningBefore = new Date(
    now.getTime() - PDF_STALE_RUNNING_JOB_HOURS * 60 * 60 * 1_000,
  );
  const expiredJobs = await prisma.pdfJob.findMany({
    where: {
      OR: [
        {
          expiresAt: { lte: now },
          status: { not: "RUNNING" },
        },
        {
          startedAt: { lte: staleRunningBefore },
          status: "RUNNING",
          updatedAt: { lte: staleRunningBefore },
        },
      ],
    },
    orderBy: { expiresAt: "asc" },
    select: { id: true, status: true },
    take: 100,
  });
  let cleaned = 0;

  for (const job of expiredJobs) {
    if (job.status === "RUNNING") {
      const claimed = await prisma.pdfJob.updateMany({
        where: {
          id: job.id,
          startedAt: { lte: staleRunningBefore },
          status: "RUNNING",
          updatedAt: { lte: staleRunningBefore },
        },
        data: {
          completedAt: now,
          errorCode: "PDF_JOB_STALE",
          errorMessage: "O processamento foi interrompido e os arquivos expiraram.",
          status: "EXPIRED",
        },
      });
      if (!claimed.count) continue;
    } else if (job.status !== "EXPIRED") {
      const claimed = await prisma.pdfJob.updateMany({
        where: {
          expiresAt: { lte: now },
          id: job.id,
          status: { notIn: ["RUNNING", "EXPIRED"] },
        },
        data: {
          completedAt: now,
          status: "EXPIRED",
        },
      });
      if (!claimed.count) continue;
    }

    try {
      await removePdfJobFiles(job.id);
      const deleted = await prisma.pdfJob.deleteMany({
        where: { id: job.id, status: "EXPIRED" },
      });
      cleaned += deleted.count;
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          pdfJobId: job.id,
          pdfRetentionCleanup: true,
        },
      });
    }
  }

  return { cleaned, scanned: expiredJobs.length };
}
