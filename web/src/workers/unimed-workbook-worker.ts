import { parentPort, workerData } from "node:worker_threads";
import { serialize } from "node:v8";
import { readSheet } from "read-excel-file/node";
import { validateUnimedXlsxArchive } from "@/lib/unimed/xlsx-security";

async function main() {
  if (!parentPort) throw new Error("Unimed workbook worker requires a parent port.");
  try {
    if (!(workerData?.buffer instanceof Uint8Array) || workerData.buffer.byteLength > 10 * 1024 * 1024) {
      throw new Error("Invalid workbook input.");
    }
    const bytes = Buffer.from(workerData.buffer.buffer, workerData.buffer.byteOffset, workerData.buffer.byteLength);
    validateUnimedXlsxArchive(bytes);
    // Only the first worksheet is part of the address import contract.
    const rows = await readSheet(bytes, 1);
    if (!rows.length || rows.length > 100_000) {
      throw new Error("Workbook output exceeds its safe resource budget.");
    }
    if (serialize(rows).byteLength > 32 * 1024 * 1024) {
      parentPort.postMessage({ ok: false, code: "OUTPUT_TOO_LARGE" });
      return;
    }
    parentPort.postMessage({ ok: true, rows });
  } catch {
    // Archive paths, XML, cells and parser internals must not enter logs or responses.
    parentPort.postMessage({ ok: false });
  } finally {
    parentPort.close();
  }
}
void main();
