import * as Sentry from "@sentry/node";
import { prisma } from "@/lib/prisma";
import { processPdfJob } from "@/lib/pdf/processor";
import {
  getPdfQueue,
  PDF_PROCESSING_QUEUE,
  stopPdfQueue,
} from "@/lib/pdf/queue";
import { getPdfJobExpiry } from "@/lib/pdf/constants";
import {
  cleanupCompletedPdfJobInputs,
  cleanupExpiredPdfJobs,
} from "@/lib/pdf/retention";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  sendDefaultPii: false,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
});

const boss = await getPdfQueue();
const workOptions = {
  batchSize: 1,
  includeMetadata: true,
  pollingIntervalSeconds: 2,
} as const;

await boss.work<{ jobId: string }, void, typeof workOptions>(
  PDF_PROCESSING_QUEUE,
  workOptions,
  async ([job]) => {
    if (!job) return;

    try {
      await processPdfJob(job.data.jobId);
    } catch (error) {
      const willRetry = job.retryCount < job.retryLimit;
      await prisma.pdfJob.updateMany({
        where: {
          id: job.data.jobId,
          status: { notIn: ["CANCELLED", "EXPIRED", "SUCCEEDED"] },
        },
        data: {
          completedAt: willRetry ? null : new Date(),
          errorCode: "PDF_PROCESSING_FAILED",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Não foi possível concluir o processamento do PDF.",
          status: willRetry ? "QUEUED" : "FAILED",
        },
      });
      Sentry.captureException(error, {
        tags: {
          pdfJobId: job.data.jobId,
          queueRetry: job.retryCount,
        },
      });
      await Sentry.flush(2_000);
      throw error;
    }

    try {
      await prisma.pdfJob.updateMany({
        where: { id: job.data.jobId, status: "SUCCEEDED" },
        data: { expiresAt: getPdfJobExpiry() },
      });
      await cleanupCompletedPdfJobInputs(job.data.jobId);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          pdfInputCleanup: true,
          pdfJobId: job.data.jobId,
        },
      });
    }
  },
);

let cleanupPromise: Promise<unknown> | null = null;
function runRetentionCleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = cleanupExpiredPdfJobs()
    .catch((error) => {
      Sentry.captureException(error, {
        tags: { pdfRetentionCleanup: true },
      });
    })
    .finally(() => {
      cleanupPromise = null;
    });
  return cleanupPromise;
}

void runRetentionCleanup();
const retentionTimer = setInterval(
  () => void runRetentionCleanup(),
  5 * 60 * 1_000,
);
retentionTimer.unref();

async function shutdown(signal: string) {
  console.info(`[pdf-worker] encerrando por ${signal}`);
  clearInterval(retentionTimer);
  await cleanupPromise;
  await stopPdfQueue();
  await prisma.$disconnect();
  await Sentry.close(2_000);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.info("[pdf-worker] pronto para processar documentos");
