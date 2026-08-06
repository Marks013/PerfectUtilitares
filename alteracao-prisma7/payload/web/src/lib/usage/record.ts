import * as Sentry from "@sentry/nextjs";
import type { UsageModule } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getUsageDate } from "@/lib/usage/period";

type RecordUsageInput = {
  userId?: string | null;
  module: UsageModule;
  operation: string;
  inputBytes?: number | bigint;
  outputBytes?: number | bigint;
  count?: number;
};

function nonNegativeBigInt(value: number | bigint | undefined) {
  if (typeof value === "bigint") return value > 0n ? value : 0n;
  if (!Number.isFinite(value) || !value || value < 0) return 0n;
  return BigInt(Math.trunc(value));
}

export async function recordUserUsage({
  userId,
  module,
  operation,
  inputBytes,
  outputBytes,
  count = 1,
}: RecordUsageInput) {
  if (!userId || count <= 0) return;

  const date = getUsageDate();
  const normalizedOperation = operation.trim().toUpperCase().slice(0, 80);
  if (!normalizedOperation) return;

  try {
    await prisma.userUsageDaily.upsert({
      where: {
        userId_date_module_operation: {
          userId,
          date,
          module,
          operation: normalizedOperation,
        },
      },
      create: {
        userId,
        date,
        module,
        operation: normalizedOperation,
        count,
        inputBytes: nonNegativeBigInt(inputBytes),
        outputBytes: nonNegativeBigInt(outputBytes),
      },
      update: {
        count: { increment: count },
        inputBytes: { increment: nonNegativeBigInt(inputBytes) },
        outputBytes: { increment: nonNegativeBigInt(outputBytes) },
      },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: "usage-metrics", module, operation: normalizedOperation },
    });
  }
}

