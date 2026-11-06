import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateSemanticCandidate } from "./compression-semantic";
import { runWithPdfAbortSignal } from "./execution-abort";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: mocks.readFile,
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: mocks.getDocument,
}));

beforeEach(async () => {
  vi.resetAllMocks();
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  mocks.readFile.mockResolvedValue(Buffer.from(await pdf.save()));
});

describe("semantic PDF validation cancellation", () => {
  it("stops during source extraction and preserves the abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("Job cancelled");
    const page = {
      cleanup: vi.fn(),
      getAnnotations: vi.fn(async () => []),
      getTextContent: vi.fn(async () => {
        controller.abort(reason);
        return { items: [] };
      }),
    };
    const getPage = vi.fn(async () => page);
    const getOutline = vi.fn(async () => []);
    const destroy = vi.fn(async () => {
      throw new Error("Cleanup failed");
    });
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ getOutline, getPage, numPages: 2 }),
      destroy,
    });

    await expect(
      runWithPdfAbortSignal(controller.signal, () =>
        validateSemanticCandidate("source.pdf", "candidate.pdf", { visual: false }),
      ),
    ).rejects.toBe(reason);

    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(getPage).toHaveBeenCalledExactlyOnceWith(1);
    expect(getOutline).not.toHaveBeenCalled();
    expect(mocks.getDocument).toHaveBeenCalledOnce();
  });

  it("destroys the loading task when PDF.js rejects the document", async () => {
    const reason = new Error("PDF.js could not read the document");
    const destroy = vi.fn(async () => undefined);
    mocks.getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(reason),
      destroy,
    }));

    await expect(
      validateSemanticCandidate("source.pdf", "candidate.pdf", { visual: false }),
    ).rejects.toBe(reason);

    expect(destroy).toHaveBeenCalledOnce();
    expect(mocks.getDocument).toHaveBeenCalledOnce();
  });
});
