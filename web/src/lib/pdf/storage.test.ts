import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  PdfStorageError,
  readPdfStorageFile,
  sanitizePdfFileName,
  writeOfficeUpload,
  writePdfOutput,
  writePdfUpload,
} from "@/lib/pdf/storage";

const originalStorageDirectory = process.env.PDF_STORAGE_DIR;
let temporaryDirectory: string | null = null;

afterEach(async () => {
  process.env.PDF_STORAGE_DIR = originalStorageDirectory;
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = null;
  }
});

describe("pdf storage", () => {
  it("normalizes the uploaded file name without accepting paths", () => {
    expect(sanitizePdfFileName(encodeURIComponent("../Folha.pdf"))).toBe(
      "Folha.pdf",
    );
    expect(() => sanitizePdfFileName(null)).toThrow(PdfStorageError);
  });

  it("streams a valid PDF and calculates its digest", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    const bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 6));
        controller.enqueue(bytes.subarray(6));
        controller.close();
      },
    });

    const result = await writePdfUpload(stream, "job-valid-123");
    const stored = await readFile(
      path.join(temporaryDirectory, result.storageKey),
      "utf8",
    );

    expect(stored).toBe("%PDF-1.7\n%%EOF");
    expect(result.sizeBytes).toBe(BigInt(bytes.length));
    expect(result.sha256).toHaveLength(64);
  });

  it("removes an incomplete non-PDF upload", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("not a pdf"));
        controller.close();
      },
    });

    await expect(writePdfUpload(stream, "job-invalid-123")).rejects.toMatchObject(
      { code: "INVALID_PDF" },
    );
  });

  it("writes output atomically with a safe name and digest", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    const bytes = new TextEncoder().encode("%PDF-1.7\noutput\n%%EOF");

    const output = await writePdfOutput(
      "job-output-123",
      "../documento final.pdf",
      bytes,
    );

    expect(output.originalName).toBe("documento final.pdf");
    expect(output.sizeBytes).toBe(BigInt(bytes.byteLength));
    expect(output.sha256).toHaveLength(64);
    await expect(readPdfStorageFile(output.storageKey)).resolves.toEqual(
      Buffer.from(bytes),
    );
  });

  it("accepts only Office ZIP containers with required document parts", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    const createStream = (bytes: Uint8Array) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    const validDocx = zipSync({
      "[Content_Types].xml": strToU8("<Types />"),
      "word/document.xml": strToU8("<document />"),
    });
    const genericZip = zipSync({
      "unrelated.txt": strToU8("not an Office document"),
    });
    const mimeType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    await expect(
      writeOfficeUpload(createStream(validDocx), "job-office-valid", mimeType),
    ).resolves.toMatchObject({ sizeBytes: BigInt(validDocx.byteLength) });
    await expect(
      writeOfficeUpload(
        createStream(genericZip),
        "job-office-invalid",
        mimeType,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
  });
});
