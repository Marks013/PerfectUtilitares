import { fromPrisma, type PgBoss } from "pg-boss";
import {
  getPdfQueueJobId,
  PDF_PROCESSING_QUEUE,
  PDF_RECOVERY_ATTEMPT,
} from "@/lib/pdf/queue";
import { prisma } from "@/lib/prisma";

const BATCH_SIZE = 50;
const SETTLEMENT_GRACE_MS = 2 * 60 * 1_000;
const MISSING_DELIVERY_GRACE_MS = 24 * 60 * 60 * 1_000;

export async function reconcileInterruptedPdfJobs(
  queue: Pick<PgBoss, "findJobs" | "send">,
  afterId: string | undefined,
  now = new Date(),
) {
  const settledBefore = new Date(now.getTime() - SETTLEMENT_GRACE_MS);
  const jobs = await prisma.pdfJob.findMany({
    where: {
      id: afterId ? { gt: afterId } : undefined,
      status: { in: ["QUEUED", "RUNNING"] },
      updatedAt: { lte: settledBefore },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      expiresAt: true,
      recoveryAttempt: true,
      principalKey: true,
      artifacts: { where: { kind: "INPUT" }, select: { id: true }, take: 1 },
    },
    take: BATCH_SIZE,
  });

  for (const job of jobs) {
    const [delivery] = await queue.findJobs<{ jobId: string }>(PDF_PROCESSING_QUEUE, {
      id: getPdfQueueJobId(job.id, job.recoveryAttempt),
    });
    if (delivery) {
      const terminal = delivery.state === "failed" ||
        delivery.state === "cancelled" || delivery.state === "completed";
      if (!terminal || !delivery.completedOn || delivery.completedOn > settledBefore) {
        continue;
      }
    } else if (now.getTime() - job.updatedAt.getTime() < MISSING_DELIVERY_GRACE_MS) {
      continue;
    }

    const snapshot = {
      id: job.id,
      status: job.status,
      updatedAt: job.updatedAt,
      recoveryAttempt: job.recoveryAttempt,
    };
    const tier = delivery?.groupTier;
    if (
      delivery?.state === "failed" &&
      delivery.data.jobId === job.id &&
      delivery.groupId === job.principalKey &&
      (tier === "public" || tier === "authenticated") &&
      job.status === "RUNNING" &&
      job.recoveryAttempt === 0 &&
      job.expiresAt > now &&
      job.artifacts.length > 0
    ) {
      const recoveryId = getPdfQueueJobId(job.id, PDF_RECOVERY_ATTEMPT);
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.pdfJob.updateMany({
          where: { ...snapshot, expiresAt: { gt: now } },
          data: {
            status: "QUEUED",
            recoveryAttempt: PDF_RECOVERY_ATTEMPT,
            startedAt: null,
            completedAt: null,
            errorCode: null,
            errorMessage: null,
            progress: 0,
          },
        });
        if (claimed.count !== 1) return;

        // A new queue ID isolates acknowledgments and failures from the old delivery.
        // Both mutations commit together or neither does.
        const published = await queue.send(
          PDF_PROCESSING_QUEUE,
          { jobId: job.id, recoveryAttempt: PDF_RECOVERY_ATTEMPT },
          {
            db: fromPrisma(tx),
            group: { id: job.principalKey, tier },
            id: recoveryId,
            retryLimit: 0,
          },
        );
        if (published !== recoveryId) throw new Error("PDF_RECOVERY_NOT_ENQUEUED");
      });
      continue;
    }

    // A concurrent progress update, claim or success invalidates this snapshot.
    // Keep inputs until their normal expiry; the old converter may still unwind.
    await prisma.pdfJob.updateMany({
      where: snapshot,
      data: {
        completedAt: now,
        errorCode: "PDF_PROCESSING_INTERRUPTED",
        errorMessage: "O processamento foi interrompido. Inicie um novo trabalho com o arquivo original.",
        status: "FAILED",
      },
    });
  }

  return jobs.length === BATCH_SIZE ? jobs.at(-1)?.id : undefined;
}
