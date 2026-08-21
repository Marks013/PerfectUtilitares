import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { resolvePdfStorageKey } from "@/lib/pdf/storage";

export class PdfOfficeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    details?: string,
  ) {
    super(message, {
      cause: details ? new Error(details.slice(0, 8_000)) : undefined,
    });
    this.name = "PdfOfficeError";
  }
}

function runLibreOffice(args: string[], profileDirectory: string) {
  return new Promise<void>((resolve, reject) => {
    const binary = process.env.LIBREOFFICE_BIN || "soffice";
    const child = spawn(binary, args, {
      env: {
        ...process.env,
        HOME: profileDirectory,
        TMPDIR: profileDirectory,
      },
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new PdfOfficeError(
            "OFFICE_CONVERSION_TIMEOUT",
            "A conversão excedeu o tempo permitido.",
          ),
        ),
      );
    }, 180_000);

    child.stderr.on("data", (chunk: Buffer) => {
      if (errorOutput.length < 8_000) errorOutput += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      finish(() =>
        reject(
          error && "code" in error && error.code === "ENOENT"
            ? new PdfOfficeError(
                "OFFICE_TOOL_UNAVAILABLE",
                "O conversor de documentos não está instalado no servidor.",
              )
            : error,
        ),
      );
    });
    child.once("exit", (code) => {
      finish(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new PdfOfficeError(
            "OFFICE_CONVERSION_FAILED",
            "O documento não pôde ser convertido para PDF.",
            errorOutput.trim(),
          ),
        );
      });
    });
  });
}

export async function convertOfficeToPdf({
  jobId,
  onProgress,
  storageKey,
}: {
  jobId: string;
  onProgress?: (progress: number) => Promise<void> | void;
  storageKey: string;
}) {
  const workKey = `${jobId}/work/${randomUUID()}`;
  const workDirectory = resolvePdfStorageKey(workKey);
  const profileDirectory = path.join(workDirectory, "profile");
  const outputDirectory = path.join(workDirectory, "output");
  await mkdir(profileDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await onProgress?.(10);

  try {
    await onProgress?.(20);
    await runLibreOffice(
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outputDirectory,
        resolvePdfStorageKey(storageKey),
      ],
      profileDirectory,
    );
    await onProgress?.(70);
    const outputName = (await readdir(outputDirectory)).find((fileName) =>
      fileName.toLowerCase().endsWith(".pdf"),
    );
    if (!outputName) {
      throw new PdfOfficeError(
        "OFFICE_OUTPUT_MISSING",
        "A conversão não gerou um arquivo PDF.",
      );
    }
    const output = new Uint8Array(
      await readFile(path.join(outputDirectory, outputName)),
    );
    await onProgress?.(85);
    try {
      const document = await PDFDocument.load(output, { updateMetadata: false });
      if (!document.getPageCount()) throw new Error("PDF sem páginas");
    } catch (error) {
      throw new PdfOfficeError(
        "OFFICE_OUTPUT_INVALID",
        "A conversão gerou um PDF inválido ou vazio.",
        error instanceof Error ? error.message : String(error),
      );
    }
    await onProgress?.(95);
    return output;
  } finally {
    await rm(workDirectory, { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}
