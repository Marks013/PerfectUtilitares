import type { PgBoss } from "pg-boss";
import { getWorkQueue, stopWorkQueue } from "@/lib/jobs/queue";
import { createHash } from "node:crypto";
import type { PdfPrincipal } from "@/lib/pdf/access";

export const PDF_PROCESSING_QUEUE = "perfect-pdf-processing";
export const PDF_RECOVERY_ATTEMPT = 1;

const globalForPdfQueue = globalThis as unknown as {
  pdfQueuePromise?: Promise<PgBoss>;
};

async function startPdfQueue() {
  const boss = await getWorkQueue();
  if (!(await boss.getQueue(PDF_PROCESSING_QUEUE))) {
    await boss.createQueue(PDF_PROCESSING_QUEUE, {
      deleteAfterSeconds: 24 * 60 * 60,
      expireInSeconds: 20 * 60,
      heartbeatSeconds: 60,
      notify: true,
      retentionSeconds: 24 * 60 * 60,
      retryBackoff: true,
      retryDelay: 5,
      retryDelayMax: 60,
      retryLimit: 2,
    });
  }

  return boss;
}

export function getPdfQueue() {
  if (!globalForPdfQueue.pdfQueuePromise) {
    globalForPdfQueue.pdfQueuePromise = startPdfQueue().catch((error) => {
      globalForPdfQueue.pdfQueuePromise = undefined;
      throw error;
    });
  }

  return globalForPdfQueue.pdfQueuePromise;
}

export function getPdfQueueJobId(jobId: string, recoveryAttempt = 0) {
  const key = recoveryAttempt === 0
    ? `pdf-job:${jobId}`
    : `pdf-job:${jobId}:recovery:${recoveryAttempt}`;
  const hash = createHash("sha256").update(key).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

export async function enqueuePdfJob(jobId: string, principal: PdfPrincipal) {
  const boss = await getPdfQueue();
  return boss.send(
    PDF_PROCESSING_QUEUE,
    { jobId },
    {
      group: { id: principal.key, tier: principal.tier },
      id: getPdfQueueJobId(jobId),
      singletonKey: jobId,
      singletonSeconds: 24 * 60 * 60,
    },
  );
}

export async function stopPdfQueue() {
  globalForPdfQueue.pdfQueuePromise = undefined;
  await stopWorkQueue();
}
