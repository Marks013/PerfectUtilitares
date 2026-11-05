import type { PgBoss } from "pg-boss";
import { getPdfQueueJobId, PDF_PROCESSING_QUEUE } from "@/lib/pdf/queue";
import { prisma } from "@/lib/prisma";

const BATCH_SIZE = 50;
const SETTLEMENT_GRACE_MS = 2 * 60 * 1_000;
const MISSING_DELIVERY_GRACE_MS = 24 * 60 * 60 * 1_000;

export async function reconcileInterruptedPdfJobs(
  queue: Pick<PgBoss, "findJobs">,
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
    select: { id: true, status: true, updatedAt: true },
    take: BATCH_SIZE,
  });

  for (const job of jobs) {
    const [delivery] = await queue.findJobs(PDF_PROCESSING_QUEUE, {
      id: getPdfQueueJobId(job.id),
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

    // A concurrent progress update, claim or success invalidates this snapshot.
    // Keep inputs until their normal expiry; the old converter may still unwind.
    await prisma.pdfJob.updateMany({
      where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
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
