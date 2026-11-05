import { spawn } from "node:child_process";
import { PdfToolError } from "./compression-types";

export function compressionToolTimeoutMs() {
  const configured = Number(
    process.env.PDF_COMPRESSION_TOOL_TIMEOUT_MS ?? 10 * 60 * 1000,
  );
  return Number.isFinite(configured) &&
    configured >= 30_000 &&
    configured <= 30 * 60 * 1000
    ? configured
    : 10 * 60 * 1000;
}

export function runCompressionTool(
  executable: string,
  args: string[],
  timeoutMs = compressionToolTimeoutMs(),
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let done = false;
    const finish = (callback: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      callback();
    };
    const terminateGroup = () => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* The task-owned process group may already have exited. */ }
    };
    // OCRmyPDF can start image optimizers. Bound descendants as well as the
    // launcher, including descendants holding stderr after the launcher exits.
    child.once("exit", terminateGroup);
    const timer = setTimeout(() => {
      terminateGroup();
      finish(() =>
        reject(
          new PdfToolError(
            "PDF_COMPRESSION_TIMEOUT",
            `${executable} excedeu o tempo permitido.`,
          ),
        ),
      );
    }, timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 32_000) stderr += chunk;
    });
    child.once("error", (error) =>
      finish(() =>
        reject(
          error && "code" in error && error.code === "ENOENT"
            ? new PdfToolError(
                "PDF_TOOL_UNAVAILABLE",
                `${executable} não está instalado no worker.`,
              )
            : error,
        ),
      ),
    );
    child.once("close", (code) =>
      finish(() =>
        code === 0
          ? resolve()
          : reject(
              new PdfToolError(
                "PDF_COMPRESSION_FAILED",
                `${executable} não conseguiu gerar um candidato válido.`,
                stderr,
              ),
            ),
      ),
    );
  });
}
