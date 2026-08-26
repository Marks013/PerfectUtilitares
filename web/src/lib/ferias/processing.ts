import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { FeriasInputRow } from "@/lib/ferias/workbook";
import { FeriasError } from "@/lib/ferias/errors";
import { prisma } from "@/lib/prisma";

const LOCK_NAMESPACE = 1_179_796_819;
const PROCESSING_TIMEOUT_MS = 60_000;
const WORKER_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type FeriasWorkbookOutputRow = {
  row: number;
  highlight: boolean;
  days: number;
  unimedText: string;
  loanText: string;
};

type WorkbookInput =
  | { action: "parse"; buffer: Buffer }
  | {
      action: "write";
      buffer: Buffer;
      rows: FeriasWorkbookOutputRow[];
    };

type ParsedWorkbook = { rows: FeriasInputRow[]; competency: string };
type WorkerReply =
  | { ok: true; value: ParsedWorkbook | Uint8Array }
  | { ok: false; code: string; message: string; status: number };

function cancelled() {
  return new FeriasError(
    "FERIAS_CANCELLED",
    "A solicitação foi cancelada. Seus arquivos não foram alterados.",
    499,
  );
}

function timedOut() {
  return new FeriasError(
    "FERIAS_TIMEOUT",
    "A planilha levou mais tempo que o permitido. Confira o arquivo e tente novamente.",
    504,
  );
}

export function assertFeriasActive(signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason instanceof FeriasError ? signal.reason : cancelled();
  }
}

export async function withFeriasProcessing<T>(
  requestSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(cancelled());
  requestSignal.addEventListener("abort", onAbort, { once: true });
  if (requestSignal.aborted) onAbort();
  const timer = setTimeout(() => controller.abort(timedOut()), PROCESSING_TIMEOUT_MS);
  timer.unref();
  let operationError: unknown;
  let failedInOperation = false;
  let activeOperation: Promise<T> | undefined;
  try {
    assertFeriasActive(controller.signal);
    return await prisma.$transaction(
      async (tx) => {
        assertFeriasActive(controller.signal);
        for (let slot = 1; slot <= 2; slot += 1) {
          const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
            SELECT pg_try_advisory_xact_lock(${LOCK_NAMESPACE}, ${slot}) AS "acquired"
          `;
          if (!lock?.acquired) continue;
          try {
            assertFeriasActive(controller.signal);
            activeOperation = operation(controller.signal);
            const result = await activeOperation;
            assertFeriasActive(controller.signal);
            return result;
          } catch (error) {
            failedInOperation = true;
            operationError = error;
            throw error;
          }
        }
        throw new FeriasError(
          "FERIAS_BUSY",
          "Há duas planilhas em processamento. Aguarde alguns instantes e tente novamente.",
          503,
        );
      },
      // The operation aborts first; worker termination finishes before releasing its slot.
      { maxWait: 5_000, timeout: 120_000 },
    );
  } catch (error) {
    // Also stop outstanding work if the database connection loses its transaction.
    const hadOperationError = failedInOperation;
    const savedOperationError = operationError;
    controller.abort(new FeriasError("FERIAS_CAPACITY_UNAVAILABLE", "O processamento foi interrompido. Tente novamente em instantes.", 503));
    await activeOperation?.catch(() => undefined);
    if (hadOperationError) throw savedOperationError;
    if (error instanceof FeriasError) throw error;
    throw new FeriasError(
      "FERIAS_CAPACITY_UNAVAILABLE",
      "Não foi possível iniciar o processamento agora. Tente novamente em instantes.",
      503,
    );
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", onAbort);
  }
}

export function runFeriasWorkbook(
  input: { action: "parse"; buffer: Buffer },
  signal: AbortSignal,
): Promise<ParsedWorkbook>;
export function runFeriasWorkbook(
  input: { action: "write"; buffer: Buffer; rows: FeriasWorkbookOutputRow[] },
  signal: AbortSignal,
): Promise<Buffer>;
export async function runFeriasWorkbook(
  input: WorkbookInput,
  signal: AbortSignal,
): Promise<ParsedWorkbook | Buffer> {
  assertFeriasActive(signal);
  const bytes = new Uint8Array(input.buffer);
  const worker = new Worker(join(process.cwd(), "dist/ferias-workbook-worker.cjs"), {
    workerData: { ...input, buffer: bytes },
    transferList: [bytes.buffer],
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 8 },
    // Workers must not inherit the production database, tokens or observability secrets.
    env: { NODE_ENV: process.env.NODE_ENV ?? "production", TZ: "UTC" },
    execArgv: [],
    stdout: true,
    stderr: true,
  });
  worker.stdout?.resume();
  worker.stderr?.resume();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      onAbort = () => {
        try {
          assertFeriasActive(signal);
        } catch (error) {
          reject(error);
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => reject(timedOut()), WORKER_TIMEOUT_MS);
      timer.unref();
      worker.once("message", resolve);
      worker.once("error", () => reject(new FeriasError(
        "FERIAS_WORKER_FAILED", "Não foi possível processar esta planilha com segurança.", 422,
      )));
      worker.once("exit", () => reject(new FeriasError(
        "FERIAS_WORKER_EXITED", "O processamento da planilha foi interrompido. Tente novamente.", 422,
      )));
      if (signal.aborted) onAbort();
    });
    assertFeriasActive(signal);
    if (!reply.ok) throw new FeriasError(reply.code, reply.message, reply.status);
    if (input.action === "write") {
      if (!(reply.value instanceof Uint8Array) || reply.value.byteLength > MAX_OUTPUT_BYTES) {
        throw new FeriasError("FERIAS_OUTPUT_INVALID", "A planilha gerada ultrapassou os limites permitidos.", 422);
      }
      return Buffer.from(reply.value);
    }
    return reply.value as ParsedWorkbook;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    // Await, rather than fire-and-forget: no CPU work survives the capacity transaction.
    await worker.terminate();
  }
}
