import { prisma } from "@/lib/prisma";
import {
  assertResourceCapacity,
  ResourceCapacityError,
} from "@/lib/system/resource-capacity";

const GIB = 1024 ** 3;

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
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

export async function assertPdfQueueCapacity(job: {
  inputBytes: bigint;
  operation: string;
}) {
  await assertResourceCapacity({
    inputBytes: Number(job.inputBytes),
    multiplier: getPdfWorkingSetMultiplier(job.operation),
  });

  const maxActiveJobs = readPositiveInteger(
    process.env.PDF_MAX_ACTIVE_JOBS,
    12,
  );
  const maxActiveInputBytes = BigInt(
    readPositiveInteger(
      process.env.PDF_MAX_ACTIVE_INPUT_BYTES,
      4 * GIB,
    ),
  );
  const [activeJobs, activeBytes] = await Promise.all([
    prisma.pdfJob.count({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
    }),
    prisma.pdfJob.aggregate({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
      _sum: { inputBytes: true },
    }),
  ]);

  if (
    activeJobs >= maxActiveJobs ||
    (activeBytes._sum.inputBytes ?? 0n) + job.inputBytes >
      maxActiveInputBytes
  ) {
    throw new ResourceCapacityError(
      "PDF_QUEUE_CAPACITY_REACHED",
      "A fila de documentos está cheia por alguns instantes. Aguarde a conclusão dos trabalhos em andamento e tente novamente.",
    );
  }
}
