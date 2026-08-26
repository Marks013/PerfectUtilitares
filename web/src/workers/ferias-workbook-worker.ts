import { parentPort, workerData } from "node:worker_threads";
import { FeriasError } from "@/lib/ferias/errors";
import { parseFeriasWorkbook, writeFeriasWorkbook } from "@/lib/ferias/workbook";

async function main() {
  if (!parentPort) throw new Error("Ferias workbook worker requires a parent port.");
  try {
    const buffer = Buffer.from(workerData.buffer);
    if (workerData.action === "parse") {
      parentPort.postMessage({ ok: true, value: await parseFeriasWorkbook(buffer) });
    } else if (workerData.action === "write") {
      const value = new Uint8Array(await writeFeriasWorkbook(buffer, workerData.rows));
      parentPort.postMessage({ ok: true, value }, [value.buffer]);
    } else {
      throw new Error("Unsupported workbook action.");
    }
  } catch (error) {
    parentPort.postMessage(error instanceof FeriasError
      ? { ok: false, code: error.code, message: error.message, status: error.status }
      : { ok: false, code: "FERIAS_WORKBOOK_INVALID", message: "Não foi possível ler esta planilha. Confira o formato e tente novamente.", status: 422 });
  } finally {
    parentPort.close();
  }
}

void main();
