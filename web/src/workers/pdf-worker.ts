import * as Sentry from "@sentry/node";
import { constants as fsConstants } from "node:fs";
import { access, rename, writeFile } from "node:fs/promises";
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
const readWorkerLimit = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8
    ? parsed
    : fallback;
};
const workOptions = {
  batchSize: 1,
  groupConcurrency: {
    default: 1,
    tiers: {
      authenticated: readWorkerLimit(
        process.env.PDF_WORKER_AUTHENTICATED_GROUP_CONCURRENCY,
        2,
      ),
      public: 1,
    },
  },
  heartbeatRefreshSeconds: 20,
  includeMetadata: true,
  localConcurrency: readWorkerLimit(process.env.PDF_WORKER_CONCURRENCY, 2),
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
const heartbeatPath =
  process.env.PDF_WORKER_HEARTBEAT_PATH ??
  "/tmp/perfect-pdf-worker-heartbeat";
let heartbeatPromise: Promise<void> | null = null;

function refreshWorkerHeartbeat() {
  if (heartbeatPromise) return heartbeatPromise;
  heartbeatPromise = (async () => {
    await prisma.$queryRaw`SELECT 1`;
    await access(
      process.env.PDF_STORAGE_DIR ?? "/data/pdf-jobs",
      fsConstants.R_OK | fsConstants.W_OK,
    );
    const temporaryPath = `${heartbeatPath}.${process.pid}.tmp`;
    await writeFile(
      temporaryPath,
      JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() }),
      "utf8",
    );
    await rename(temporaryPath, heartbeatPath);
  })()
    .catch((error) => {
      Sentry.captureException(error, { tags: { pdfWorkerHeartbeat: true } });
    })
    .finally(() => {
      heartbeatPromise = null;
    });
  return heartbeatPromise;
}

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
await refreshWorkerHeartbeat();
const heartbeatTimer = setInterval(
  () => void refreshWorkerHeartbeat(),
  15_000,
);
heartbeatTimer.unref();
const retentionTimer = setInterval(
  () => void runRetentionCleanup(),
  5 * 60 * 1_000,
);
retentionTimer.unref();

async function shutdown(signal: string) {
  console.info(`[pdf-worker] encerrando por ${signal}`);
  clearInterval(heartbeatTimer);
  clearInterval(retentionTimer);
  await heartbeatPromise;
  await cleanupPromise;
  await stopPdfQueue();
  await prisma.$disconnect();
  await Sentry.close(2_000);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.info("[pdf-worker] pronto para processar documentos");
