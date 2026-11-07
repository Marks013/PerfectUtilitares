import { prisma } from "@/lib/prisma";

type CapacityFailure = "CANCELLED" | "TIMEOUT" | "BUSY" | "CAPACITY_UNAVAILABLE";
export type WorkbookCapacityErrors = {
  create: (code: CapacityFailure) => Error;
  owns: (error: unknown) => error is Error;
};
const LOCK_NAMESPACE = 1_179_796_819;
const PROCESSING_TIMEOUT_MS = 60_000;

export function assertWorkbookActive(signal: AbortSignal, errors: WorkbookCapacityErrors) {
  if (signal.aborted) {
    throw errors.owns(signal.reason) ? signal.reason : errors.create("CANCELLED");
  }
}

// Férias and Unimed share the same two database slots across app replicas.
export async function withWorkbookCapacity<T>(
  requestSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
  errors: WorkbookCapacityErrors,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(errors.create("CANCELLED"));
  requestSignal.addEventListener("abort", onAbort, { once: true });
  if (requestSignal.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(errors.create("TIMEOUT")), PROCESSING_TIMEOUT_MS);
  timer.unref();
  let operationError: unknown;
  let failedInOperation = false;
  let activeOperation: Promise<T> | undefined;
  try {
    assertWorkbookActive(controller.signal, errors);
    return await prisma.$transaction(async (tx) => {
      assertWorkbookActive(controller.signal, errors);
      for (let slot = 1; slot <= 2; slot += 1) {
        const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${LOCK_NAMESPACE}, ${slot}) AS "acquired"
        `;
        if (!lock?.acquired) continue;
        try {
          assertWorkbookActive(controller.signal, errors);
          activeOperation = operation(controller.signal);
          const result = await activeOperation;
          assertWorkbookActive(controller.signal, errors);
          return result;
        } catch (error) {
          failedInOperation = true;
          operationError = error;
          throw error;
        }
      }
      throw errors.create("BUSY");
    }, { maxWait: 5_000, timeout: 120_000 });
  } catch (error) {
    const hadOperationError = failedInOperation;
    const savedOperationError = operationError;
    // Stop and await CPU work before the capacity transaction can be reused.
    controller.abort(errors.create("CAPACITY_UNAVAILABLE"));
    await activeOperation?.catch(() => undefined);
    if (hadOperationError) throw savedOperationError;
    if (errors.owns(error)) throw error;
    throw errors.create("CAPACITY_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", onAbort);
  }
}
