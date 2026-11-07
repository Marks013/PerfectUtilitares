import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { Row } from "read-excel-file/node";
import { assertWorkbookActive, withWorkbookCapacity, type WorkbookCapacityErrors } from "@/lib/spreadsheets/workbook-capacity";

export class UnimedWorkbookError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message); this.name = "UnimedWorkbookError";
  }
}
const errors: WorkbookCapacityErrors = {
  owns: (error): error is UnimedWorkbookError => error instanceof UnimedWorkbookError,
  create: (code) => {
    const detail = {
      CANCELLED: [499, "A importação foi cancelada. A base anterior foi preservada."],
      TIMEOUT: [504, "A planilha levou mais tempo que o permitido. Retire linhas e colunas vazias, exporte novamente e tente outra vez; a base anterior foi preservada."],
      BUSY: [503, "Há duas planilhas em processamento. Aguarde alguns instantes e tente novamente."],
      CAPACITY_UNAVAILABLE: [503, "Não foi possível processar a planilha agora. Tente novamente em instantes."],
    }[code];
    return new UnimedWorkbookError(`UNIMED_WORKBOOK_${code}`, String(detail[1]), Number(detail[0]));
  },
};
function invalidWorkbook() {
  return new UnimedWorkbookError("UNIMED_ADDRESS_FILE_INVALID", "A base de endereços não pôde ser lida como XLSX dentro dos limites seguros. Confira o arquivo e tente novamente; a base anterior foi preservada.", 400);
}
function unavailableWorkbook() {
  return new UnimedWorkbookError("UNIMED_WORKBOOK_UNAVAILABLE", "O processamento de planilhas está indisponível no servidor. Tente novamente em instantes; a base anterior foi preservada.", 503);
}
function oversizedWorkbook() {
  return new UnimedWorkbookError("UNIMED_WORKBOOK_TOO_LARGE", "O conteúdo da planilha ocupa mais memória que o processamento seguro permite. Retire colunas não utilizadas e exporte um XLSX mais enxuto; a base anterior foi preservada.", 413);
}

type WorkerReply = { ok: true; rows: Row[] } | { ok: false; code?: "OUTPUT_TOO_LARGE" };

export async function readAddressWorkbook(bytes: Buffer, requestSignal: AbortSignal): Promise<Row[]> {
  if (bytes.byteLength > 10 * 1024 * 1024) {
    throw new UnimedWorkbookError("UNIMED_WORKBOOK_TOO_LARGE", "A planilha excede o limite de 10 MiB por arquivo. A base anterior foi preservada.", 413);
  }
  return withWorkbookCapacity(requestSignal, async (signal) => {
    assertWorkbookActive(signal, errors);
    const input = new Uint8Array(bytes);
    const worker = new Worker(join(process.cwd(), "dist/unimed-workbook-worker.cjs"), {
      workerData: { buffer: input },
      transferList: [input.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 8 },
      env: { NODE_ENV: process.env.NODE_ENV ?? "production", TZ: "UTC" },
      execArgv: [], stdout: true, stderr: true,
    });
    worker.stdout?.resume(); worker.stderr?.resume();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const reply = await new Promise<WorkerReply>((resolve, reject) => {
        onAbort = () => { try { assertWorkbookActive(signal, errors); } catch (error) { reject(error); } };
        signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => reject(errors.create("TIMEOUT")), 30_000);
        timer.unref();
        worker.once("message", resolve);
        worker.once("error", (error: Error & { code?: string }) => reject(
          error.code === "ERR_WORKER_OUT_OF_MEMORY" ? oversizedWorkbook() : unavailableWorkbook()));
        worker.once("exit", () => reject(unavailableWorkbook()));
        if (signal.aborted) onAbort();
      });
      assertWorkbookActive(signal, errors);
      if (!reply?.ok && reply?.code === "OUTPUT_TOO_LARGE") {
        throw oversizedWorkbook();
      }
      if (!reply?.ok) throw invalidWorkbook();
      if (!Array.isArray(reply.rows) || reply.rows.length === 0 || reply.rows.length > 100_000) {
        throw invalidWorkbook();
      }
      return reply.rows;
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
      // No parser survives cancellation, timeout or release of its shared slot.
      await worker.terminate();
    }
  }, errors);
}
