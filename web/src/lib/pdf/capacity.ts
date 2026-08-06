import type { PdfOperation, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertResourceCapacity,
  ResourceCapacityError,
} from "@/lib/system/resource-capacity";

const GIB = 1024 ** 3;
const ACTIVE_STATUSES = ["QUEUED", "RUNNING"] as const;
const OPEN_STATUSES = ["DRAFT", "QUEUED", "RUNNING"] as const;

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getQueueLimits() {
  return {
    maxActiveInputBytes: BigInt(
      readPositiveInteger(process.env.PDF_MAX_ACTIVE_INPUT_BYTES, 4 * GIB),
    ),
    maxActiveJobs: readPositiveInteger(process.env.PDF_MAX_ACTIVE_JOBS, 12),
    maxPublicActiveJobs: readPositiveInteger(
      process.env.PDF_MAX_PUBLIC_ACTIVE_JOBS,
      2,
    ),
  };
}

export class PdfPublicCapacityError extends Error {
  readonly code = "PDF_ACTIVE_JOB_LIMIT";

  constructor(public readonly limit: number) {
    super(
      `Você já tem ${limit} trabalhos PDF em andamento. Finalize um deles ou aguarde um pouquinho. Ao entrar na sua conta, a franquia pública deixa de se aplicar.`,
    );
    this.name = "PdfPublicCapacityError";
  }
}

async function acquireAdmissionLock(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lock"
  `;
}

export async function acquirePdfJobLock(
  tx: Prisma.TransactionClient,
  jobId: string,
) {
  await acquireAdmissionLock(tx, `pdf:job:${jobId}`);
}

export function getPdfWorkingSetMultiplier(operation: string) {
  if (operation === "COMPRESS" || operation === "PDF_TO_JPG") return 8;
  if (operation === "JPG_TO_PDF") return 6;
  if (
    operation === "PDF_TO_WORD" ||
    operation === "PDF_TO_EXCEL" ||
    operation === "WORD_TO_PDF" ||
    operation === "EXCEL_TO_PDF"
  ) {
    return 5;
  }
  return 3;
}

type CreatePdfDraftRequest = {
  expiresAt: Date;
  isAuthenticated: boolean;
  operation: PdfOperation;
  options?: Prisma.InputJsonValue;
  ownerSessionHash: string | null;
  principalKey: string;
  tenantId: string | null;
  userId: string | null;
};

export async function createPdfDraftWithCapacity(
  request: CreatePdfDraftRequest,
) {
  const limits = getQueueLimits();

  return prisma.$transaction(
    async (tx) => {
      await acquireAdmissionLock(tx, `pdf:principal:${request.principalKey}`);

      if (!request.isAuthenticated) {
        const openJobs = await tx.pdfJob.count({
          where: {
            expiresAt: { gt: new Date() },
            principalKey: request.principalKey,
            status: { in: [...OPEN_STATUSES] },
          },
        });
        if (openJobs >= limits.maxPublicActiveJobs) {
          throw new PdfPublicCapacityError(limits.maxPublicActiveJobs);
        }
      }

      return tx.pdfJob.create({
        data: {
          expiresAt: request.expiresAt,
          operation: request.operation,
          options: request.options,
          ownerSessionHash: request.ownerSessionHash,
          principalKey: request.principalKey,
          tenantId: request.tenantId,
          userId: request.userId,
        },
      });
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

export async function reservePdfJobForQueue(request: {
  isAuthenticated: boolean;
  jobId: string;
  principalKey: string;
}) {
  const job = await prisma.pdfJob.findUnique({
    where: { id: request.jobId },
    select: { inputBytes: true, operation: true },
  });
  if (!job) return false;

  await assertResourceCapacity({
    inputBytes: Number(job.inputBytes),
    multiplier: getPdfWorkingSetMultiplier(job.operation),
  });

  const limits = getQueueLimits();
  return prisma.$transaction(
    async (tx) => {
      await acquireAdmissionLock(tx, "pdf:admission:global");
      await acquireAdmissionLock(tx, `pdf:principal:${request.principalKey}`);
      await acquirePdfJobLock(tx, request.jobId);

      const current = await tx.pdfJob.findUnique({
        where: { id: request.jobId },
        select: { inputBytes: true, status: true },
      });
      if (!current || current.status !== "DRAFT") return false;

      const [activeJobs, activeBytes, principalActiveJobs] = await Promise.all([
        tx.pdfJob.count({
          where: { status: { in: [...ACTIVE_STATUSES] } },
        }),
        tx.pdfJob.aggregate({
          where: { status: { in: [...ACTIVE_STATUSES] } },
          _sum: { inputBytes: true },
        }),
        request.isAuthenticated
          ? Promise.resolve(0)
          : tx.pdfJob.count({
              where: {
                principalKey: request.principalKey,
                status: { in: [...ACTIVE_STATUSES] },
              },
            }),
      ]);

      if (
        !request.isAuthenticated &&
        principalActiveJobs >= limits.maxPublicActiveJobs
      ) {
        throw new PdfPublicCapacityError(limits.maxPublicActiveJobs);
      }

      if (
        activeJobs >= limits.maxActiveJobs ||
        (activeBytes._sum.inputBytes ?? 0n) + current.inputBytes >
          limits.maxActiveInputBytes
      ) {
        throw new ResourceCapacityError(
          "PDF_QUEUE_CAPACITY_REACHED",
          "A fila de documentos está cheia por alguns instantes. Aguarde a conclusão dos trabalhos em andamento e tente novamente.",
        );
      }

      const claimed = await tx.pdfJob.updateMany({
        where: { id: request.jobId, status: "DRAFT" },
        data: {
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          progress: 0,
          status: "QUEUED",
        },
      });
      return claimed.count === 1;
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}
