import { PgBoss } from "pg-boss";
import type { PdfPrincipal } from "@/lib/pdf/access";

export const PDF_PROCESSING_QUEUE = "perfect-pdf-processing";

const globalForPdfQueue = globalThis as unknown as {
  pdfQueuePromise?: Promise<PgBoss>;
};

async function startPdfQueue() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não está configurada para a fila de PDFs.");
  }

  const boss = new PgBoss({
    connectionString,
    application_name: "perfect-utilitares-pdf",
    useListenNotify: true,
  });

  boss.on("error", (error) => {
    console.error("[pdf-queue]", error);
  });

  await boss.start();

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

export async function enqueuePdfJob(jobId: string, principal: PdfPrincipal) {
  const boss = await getPdfQueue();
  return boss.send(
    PDF_PROCESSING_QUEUE,
    { jobId },
    {
      group: { id: principal.key, tier: principal.tier },
      singletonKey: jobId,
    },
  );
}

export async function stopPdfQueue() {
  const queuePromise = globalForPdfQueue.pdfQueuePromise;
  globalForPdfQueue.pdfQueuePromise = undefined;
  if (!queuePromise) return;

  const boss = await queuePromise.catch(() => null);
  await boss?.stop({ graceful: true, timeout: 30_000 });
}
