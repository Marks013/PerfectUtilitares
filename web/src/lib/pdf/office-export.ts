import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { PdfOfficeError } from "./office";
import { resolvePdfStorageKey } from "./storage";

const EXPORT_MESSAGES: Record<string, string> = {
  PDF_OFFICE_PAGE_LIMIT: "Converta PDFs com até 100 páginas. Divida o documento e tente novamente.",
  PDF_OFFICE_PAGE_TOO_LARGE: "Uma página é grande demais para converter. Recorte ou reduza suas dimensões.",
  PDF_OFFICE_PAGE_TOO_COMPLEX: "Uma página contém elementos demais. Divida ou simplifique o PDF.",
  PDF_OFFICE_OCR_FAILED: "Não foi possível reconhecer o texto digitalizado. Envie uma digitalização mais nítida ou menos páginas.",
  PDF_OFFICE_OCR_NO_TEXT: "Não foi possível identificar texto em uma página digitalizada. Confira a nitidez do PDF.",
  PDF_OFFICE_OUTPUT_TOO_LARGE: "O documento convertido ultrapassou 100 MB. Divida o PDF e tente novamente.",
  PDF_OFFICE_RESOURCE_LIMIT: "O PDF ultrapassou os recursos disponíveis para conversão. Divida o documento e tente novamente.",
  PDF_OFFICE_CONVERSION_FAILED: "Não foi possível reconstruir este PDF. Confira se ele abre normalmente e tente converter menos páginas.",
};

export async function convertPdfToOffice({
  jobId, storageKey, extension, onProgress, timeoutMs = 480_000,
}: {
  jobId: string;
  storageKey: string;
  extension: "docx" | "xlsx";
  onProgress?: (progress: number) => Promise<void> | void;
  timeoutMs?: number;
}) {
  const workDirectory = resolvePdfStorageKey(`${jobId}/work/${randomUUID()}`);
  await mkdir(workDirectory, { recursive: true, mode: 0o700 });
  const outputPath = path.join(workDirectory, `converted.${extension}`);
  let progressTask = Promise.resolve();
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.PDF_OFFICE_PYTHON || "/opt/pdf-office/bin/python3", [
        process.env.PDF_OFFICE_SCRIPT || path.resolve("src/lib/pdf/office-export.py"),
        resolvePdfStorageKey(storageKey), outputPath, extension,
      ], {
        shell: false, detached: process.platform !== "win32", windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", OMP_THREAD_LIMIT: "1", TMPDIR: workDirectory,
          XDG_CACHE_HOME: path.join(workDirectory, "cache") },
      });
      let errorCode = "PDF_OFFICE_CONVERSION_FAILED";
      let pending = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const terminateGroup = () => {
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch { /* The process may already have exited. */ }
      };
      // Internal OCR timeouts may leave descendants after the converter exits.
      // Keep them in the same group and terminate them before close/cleanup.
      child.once("exit", terminateGroup);
      const timer = setTimeout(() => {
        terminateGroup();
        // Wait for close before deleting its work directory.
        errorCode = "OFFICE_CONVERSION_TIMEOUT";
      }, Math.max(1, timeoutMs));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        pending = (pending + chunk).slice(-4096);
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as { progress?: number; error?: string };
            if (event.error && Object.hasOwn(EXPORT_MESSAGES, event.error)) errorCode = event.error;
            if (typeof event.progress === "number" && Number.isFinite(event.progress)) {
              const progress = Math.max(0, Math.min(95, event.progress));
              progressTask = progressTask.then(() => onProgress?.(progress)).catch(() => undefined);
            }
          } catch { /* Ignore non-protocol output without logging PDF contents. */ }
        }
      });
      child.once("error", () => finish(new PdfOfficeError("OFFICE_TOOL_UNAVAILABLE", "O conversor de documentos está indisponível. Tente novamente mais tarde.")));
      child.once("close", (code) => {
        if (code === 0 && errorCode !== "OFFICE_CONVERSION_TIMEOUT") return finish();
        finish(new PdfOfficeError(errorCode, errorCode === "OFFICE_CONVERSION_TIMEOUT"
          ? "A conversão excedeu o tempo permitido. Divida o PDF ou envie menos arquivos."
          : EXPORT_MESSAGES[errorCode] ?? EXPORT_MESSAGES.PDF_OFFICE_CONVERSION_FAILED));
      });
    });
    await progressTask;
    const outputStat = await stat(outputPath).catch(() => {
      throw new PdfOfficeError("OFFICE_OUTPUT_MISSING", "A conversão não gerou o documento esperado. Tente novamente com menos páginas.");
    });
    if (!outputStat.size || outputStat.size > 100 * 1024 * 1024) {
      throw new PdfOfficeError("PDF_OFFICE_OUTPUT_TOO_LARGE", EXPORT_MESSAGES.PDF_OFFICE_OUTPUT_TOO_LARGE);
    }
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await progressTask;
    await rm(workDirectory, { recursive: true, force: true });
  }
}
