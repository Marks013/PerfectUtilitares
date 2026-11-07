import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import { addAbortListener } from "node:events";

const pdfExecution = new AsyncLocalStorage<AbortSignal | undefined>();

export function runWithPdfAbortSignal<T>(
  signal: AbortSignal | undefined,
  task: () => T,
): T {
  return pdfExecution.run(signal, task);
}

export function getPdfExecutionAbortSignal() {
  return pdfExecution.getStore();
}

export function throwIfPdfExecutionAborted() {
  pdfExecution.getStore()?.throwIfAborted();
}

export function terminatePdfProcess(child: ChildProcess, detached = false) {
  try {
    if (detached && child.pid && process.platform !== "win32") {
      process.kill(-child.pid, "SIGKILL");
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    // The process or its group may have exited already.
  }
}

export function bindPdfProcessAbort(child: ChildProcess, detached = false) {
  const signal = pdfExecution.getStore();
  if (!signal) return undefined;

  const subscription = addAbortListener(signal, () => terminatePdfProcess(child, detached));
  const dispose = () => subscription[Symbol.dispose]();
  child.once("exit", dispose);
  child.once("close", dispose);
  return signal;
}
