import * as Sentry from "@sentry/node";
import { constants as fsConstants } from "node:fs";
import { access, rename, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { processPdfJob } from "@/lib/pdf/processor";
import { runWithPdfAbortSignal } from "@/lib/pdf/execution-abort";
import { guardPdfExecution } from "@/lib/pdf/execution-guard";
import {
  getPdfQueue,
  getPdfQueueJobId,
  PDF_PROCESSING_QUEUE,
  PDF_RECOVERY_ATTEMPT,
  stopPdfQueue,
} from "@/lib/pdf/queue";
import { reconcileInterruptedPdfJobs } from "@/lib/pdf/interrupted-jobs";
import {
  currentPdfCompressionProtocolRevision,
  currentPdfCompressionRevision,
  pdfWorkerHeartbeatPath,
} from "@/lib/pdf/compression-worker-revision";
import {
  cleanupCompletedPdfJobInputs,
  cleanupExpiredPdfJobs,
} from "@/lib/pdf/retention";
import { isEventsEnabled } from "@/lib/presence/feature";
import { logPdfWorkerFailure } from "@/workers/pdf-worker-observability";
import {
  beforeSendScrubber,
  sentryDataCollection,
  sentrySampleRate,
  validatedSentryDsn,
} from "@/sentry.shared";
// PERFECT_PDF_FULL32_V2_2

const sentryDsn = validatedSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

Sentry.init({
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  environment: process.env.NODE_ENV ?? "development",
  dataCollection: sentryDataCollection,
  tracesSampleRate: sentrySampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
  beforeSend: beforeSendScrubber,
});

const boss = await getPdfQueue();
const nonRetryableConversionErrors = new Set([
  "PDF_OFFICE_PAGE_LIMIT",
  "PDF_OFFICE_PAGE_TOO_LARGE",
  "PDF_OFFICE_PAGE_TOO_COMPLEX",
  "PDF_OFFICE_OCR_NO_TEXT",
  "PDF_OFFICE_OUTPUT_TOO_LARGE",
  "PDF_OFFICE_BATCH_LIMIT",
  "PDF_IMAGE_TOO_LARGE",
  "INVALID_IMAGE_OPTIONS",
]);
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

await boss.work<{ jobId: string; recoveryAttempt?: number }, void, typeof workOptions>(
  PDF_PROCESSING_QUEUE,
  workOptions,
  async ([job]) => {
    if (!job) return;
    const recoveryAttempt = job.data.recoveryAttempt ?? 0;
    if (recoveryAttempt !== 0 && recoveryAttempt !== PDF_RECOVERY_ATTEMPT) return;
    if (job.id !== getPdfQueueJobId(job.data.jobId, recoveryAttempt)) return;
    const delivery = { id: job.data.jobId, recoveryAttempt };

    // Queue delivery is at-least-once. Claim the database row before touching
    // inputs so a delayed or duplicated message cannot reprocess a finished job.
    const startedAt = new Date();
    const claimed = await prisma.pdfJob.updateMany({
      where: {
        ...delivery,
        status: "QUEUED",
        ...(recoveryAttempt > 0 ? { expiresAt: { gt: startedAt } } : {}),
      },
      data: {
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        progress: 1,
        startedAt,
        status: "RUNNING",
      },
    });
    if (claimed.count !== 1) {
      const current = await prisma.pdfJob.findUnique({
        where: delivery,
        select: { status: true },
      });
      // Let the original delivery settle before the reconciler can recover it.
      // A message from a previous delivery must not claim the recovered job.
      if (current?.status === "RUNNING") {
        throw new Error("PDF_PROCESSING_ALREADY_RUNNING");
      }
      return;
    }

    const attempt = { ...delivery, startedAt };
    const guard = guardPdfExecution(async () => Boolean(await prisma.pdfJob.findUnique({
      where: { ...attempt, status: { in: ["RUNNING", "SUCCEEDED"] } },
      select: { id: true },
    })), job.signal);
    let invalidCompletedOutput = false;
    let completedSuccessfully = false;
    try {
      await runWithPdfAbortSignal(guard.signal, () => processPdfJob(attempt, guard.signal));
      const completed = await prisma.pdfJob.findUnique({
        where: attempt,
        select: {
          status: true,
          artifacts: {
            where: { kind: "OUTPUT" },
            select: { sha256: true, sizeBytes: true },
          },
        },
      });
      const hasInvalidOutput = completed?.artifacts.some(
        (artifact) => artifact.sizeBytes <= 0n || !artifact.sha256,
      );
      if (
        completed?.status === "SUCCEEDED" &&
        (!completed.artifacts.length || hasInvalidOutput)
      ) {
        invalidCompletedOutput = true;
        throw new Error(
          "O processamento terminou sem gerar um arquivo válido. Tente novamente; se o problema persistir, use o PDF original e informe o suporte.",
        );
      }
      completedSuccessfully = completed?.status === "SUCCEEDED";
    } catch (error) {
      // The queue already owns settlement when this delivery is aborted.
      // A late converter must not put the application job back in QUEUED.
      if (guard.signal.aborted) throw error;

      const errorCode = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code : "PDF_PROCESSING_FAILED";
      const nonRetryable = nonRetryableConversionErrors.has(errorCode);
      const willRetry = !nonRetryable && job.retryCount < job.retryLimit;
      await prisma.pdfJob.updateMany({
        where: {
          ...attempt,
          status: invalidCompletedOutput ? "SUCCEEDED" : "RUNNING",
        },
        data: {
          completedAt: willRetry ? null : new Date(),
          errorCode,
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
      // Acknowledge the queue delivery; the user-facing job remains FAILED.
      if (nonRetryable) return;
      throw error;
    } finally {
      guard.stop();
    }

    if (!completedSuccessfully) return;
    try {
      await cleanupCompletedPdfJobInputs(job.data.jobId);
    } catch (error) {
      logPdfWorkerFailure("pdf_worker_input_cleanup_failed");
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
let presenceMaintenancePromise: Promise<unknown> | null = null;
let lastPresenceCleanupAt = 0;
const heartbeatPath = pdfWorkerHeartbeatPath();
let heartbeatPromise: Promise<void> | null = null;
let heartbeatConfirmed = false;

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
      JSON.stringify({
        pid: process.pid,
        updatedAt: new Date().toISOString(),
        revision: currentPdfCompressionRevision(),
        protocolRevision: currentPdfCompressionProtocolRevision(),
      }),
      "utf8",
    );
    await rename(temporaryPath, heartbeatPath);
    heartbeatConfirmed = true;
  })()
    .catch((error) => {
      heartbeatConfirmed = false;
      logPdfWorkerFailure("pdf_worker_heartbeat_failed");
      Sentry.captureException(error, { tags: { pdfWorkerHeartbeat: true } });
    })
    .finally(() => {
      heartbeatPromise = null;
    });
  return heartbeatPromise;
}

let reconciliationCursor: string | undefined;

function runRetentionCleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = cleanupExpiredPdfJobs()
    .then(async () => {
      reconciliationCursor = await reconcileInterruptedPdfJobs(boss, reconciliationCursor);
    })
    .catch((error) => {
      logPdfWorkerFailure("pdf_worker_retention_failed");
      Sentry.captureException(error, {
        tags: { pdfRetentionCleanup: true },
      });
    })
    .finally(() => {
      cleanupPromise = null;
    });
  return cleanupPromise;
}

function runPresenceMaintenance() {
  if (!isEventsEnabled()) return Promise.resolve();
  if (presenceMaintenancePromise) return presenceMaintenancePromise;
  const baseUrl = process.env.APP_URL;
  if (!baseUrl) return Promise.resolve();

  presenceMaintenancePromise = (async () => {
    const { processDuePresenceReminders, retryDuePresenceDeliveries } = await import("@/lib/presence/delivery");
    const { cleanupPresenceData } = await import("@/lib/presence/retention");
    const now = new Date();
    await processDuePresenceReminders({ baseUrl, now });
    await retryDuePresenceDeliveries({ baseUrl, now });
    if (now.getTime() - lastPresenceCleanupAt >= 60 * 60 * 1_000) {
      await cleanupPresenceData(now);
      lastPresenceCleanupAt = now.getTime();
    }
  })()
    .catch((error) => {
      logPdfWorkerFailure("pdf_worker_presence_maintenance_failed");
      Sentry.captureException(error, {
        tags: { presenceMaintenance: true },
      });
    })
    .finally(() => {
      presenceMaintenancePromise = null;
    });
  return presenceMaintenancePromise;
}

void runRetentionCleanup();
if (isEventsEnabled()) void runPresenceMaintenance();
await refreshWorkerHeartbeat();
const heartbeatTimer = setInterval(() => void refreshWorkerHeartbeat(), 15_000);
heartbeatTimer.unref();
const retentionTimer = setInterval(
  () => void runRetentionCleanup(),
  5 * 60 * 1_000,
);
retentionTimer.unref();
const presenceMaintenanceTimer = isEventsEnabled() ? setInterval(
  () => void runPresenceMaintenance(),
  60_000,
) : null;
presenceMaintenanceTimer?.unref();

async function shutdown(signal: string) {
  console.info(`[pdf-worker] encerrando por ${signal}`);
  clearInterval(heartbeatTimer);
  clearInterval(retentionTimer);
  if (presenceMaintenanceTimer) clearInterval(presenceMaintenanceTimer);
  await heartbeatPromise;
  await cleanupPromise;
  await presenceMaintenancePromise;
  await stopPdfQueue();
  await prisma.$disconnect();
  await Sentry.close(2_000);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

if (heartbeatConfirmed) {
  console.info("[pdf-worker] pronto para processar documentos");
}
