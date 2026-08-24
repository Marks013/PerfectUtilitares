import { prisma } from "@/lib/prisma";

const MAX_CONCURRENT_REAJUSTE_JOBS = 2;
const REAJUSTE_LOCK_NAMESPACE = 1_381_059_925;
const LOCK_MAX_WAIT_MS = 5_000;
const LOCK_TIMEOUT_MS = 15 * 60_000;

export type ReajusteProcessingResult<T> =
  | { status: "acquired"; value: T }
  | { status: "busy" }
  | { status: "unavailable" };

export async function runWithReajusteProcessingSlot<T>(
  operation: () => Promise<T>,
): Promise<ReajusteProcessingResult<T>> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        for (let slot = 1; slot <= MAX_CONCURRENT_REAJUSTE_JOBS; slot += 1) {
          const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(
              ${REAJUSTE_LOCK_NAMESPACE},
              ${slot}
            ) AS "acquired"
          `;
          if (!lock?.acquired) continue;

          return { status: "acquired", value: await operation() } as const;
        }

        return { status: "busy" } as const;
      },
      { maxWait: LOCK_MAX_WAIT_MS, timeout: LOCK_TIMEOUT_MS },
    );
  } catch {
    return { status: "unavailable" };
  }
}
