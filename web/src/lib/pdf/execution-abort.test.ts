import { describe, expect, it } from "vitest";
import { runCompressionTool } from "./compression-process";
import {
  runWithPdfAbortSignal,
  throwIfPdfExecutionAborted,
} from "./execution-abort";

describe("PDF execution abort", () => {
  it("refuses a new command after the attempt is aborted", async () => {
    const reason = new Error("attempt expired");
    const signal = AbortSignal.abort(reason);

    expect(() => runWithPdfAbortSignal(signal, throwIfPdfExecutionAborted)).toThrow(reason);
    await expect(runWithPdfAbortSignal(signal, () =>
      runCompressionTool("/nonexistent/pdf-converter", []),
    )).rejects.toBe(reason);
  });

  it("cancels a real command without aborting a concurrent execution", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const reason = new Error("queue lost");
    const cancelled = runWithPdfAbortSignal(first.signal, () =>
      runCompressionTool(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], 2_000),
    );
    const healthy = runWithPdfAbortSignal(second.signal, () =>
      runCompressionTool(process.execPath, ["-e", "setTimeout(() => {}, 50)"], 2_000),
    );
    first.abort(reason);
    await expect(cancelled).rejects.toBe(reason);
    await expect(healthy).resolves.toBeUndefined();
    expect(second.signal.aborted).toBe(false);
  });
});
