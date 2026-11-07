import { describe, expect, it } from "vitest";
import { isNonRetryablePdfError } from "./retry-policy";

describe("PDF retry policy", () => {
  it.each([
    "PDF_TOOL_TIMEOUT", "PDF_COMPRESSION_TIMEOUT", "PDF_RENDER_TIMEOUT",
    "OFFICE_CONVERSION_TIMEOUT", "EAGAIN", "ENOSPC", "ECONNRESET",
    "PDF_WORKER_UNAVAILABLE", "PDF_PROCESSING_FAILED",
  ])("allows recovery from transient or unclassified failure %s", (code) => {
    expect(isNonRetryablePdfError(code)).toBe(false);
  });

  it.each([
    "INPUT_REQUIRED", "INVALID_DOCUMENT", "INVALID_PAGE_SOURCE", "INVALID_MANIFEST",
    "PDF_PAGE_LIMIT_EXCEEDED", "PDF_PAGE_RENDER_LIMIT_EXCEEDED", "PDF_RENDER_BATCH_TOO_LARGE",
    "PDF_TOOL_UNAVAILABLE", "PDF_WORKER_VERSION_MISMATCH", "PDF_SEMANTIC_INTEGRITY_FAILED",
    "OFFICE_TOOL_UNAVAILABLE", "OPERATION_NOT_READY",
  ])("does not retry an unchanged deterministic failure %s", (code) => {
    expect(isNonRetryablePdfError(code)).toBe(true);
  });
});
