import * as Sentry from "@sentry/node";
import { removePdfJobFiles } from "@/lib/pdf/storage";
import { prisma } from "@/lib/prisma";

export async function cleanupExpiredPdfJobs(now = new Date()) {
  const expiredJobs = await prisma.pdfJob.findMany({
    where: {
      expiresAt: { lte: now },
      status: { not: "RUNNING" },
      OR: [
        { status: { not: "EXPIRED" } },
        { artifacts: { some: {} } },
        { inputBytes: { gt: BigInt(0) } },
        { outputBytes: { gt: BigInt(0) } },
      ],
    },
    orderBy: { expiresAt: "asc" },
    select: { id: true },
    take: 100,
  });
  let cleaned = 0;

  for (const job of expiredJobs) {
    const claimed = await prisma.pdfJob.updateMany({
      where: {
        expiresAt: { lte: now },
        id: job.id,
        status: { not: "RUNNING" },
      },
      data: {
        completedAt: now,
        errorCode: null,
        errorMessage: null,
        progress: 100,
        status: "EXPIRED",
      },
    });
    if (!claimed.count) continue;

    try {
      await removePdfJobFiles(job.id);
      await prisma.$transaction([
        prisma.pdfArtifact.deleteMany({ where: { jobId: job.id } }),
        prisma.pdfJob.update({
          where: { id: job.id },
          data: {
            inputBytes: BigInt(0),
            outputBytes: BigInt(0),
          },
        }),
      ]);
      cleaned += 1;
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
