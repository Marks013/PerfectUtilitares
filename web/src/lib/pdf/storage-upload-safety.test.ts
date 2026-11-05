import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeImageUpload, writeOfficeUpload, writePdfUpload } from "./storage";

const officeMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "perfect-upload-safety-"));
  vi.stubEnv("PDF_STORAGE_DIR", directory);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(directory, { force: true, recursive: true });
});

const uploaders = [
  { format: "PDF", code: "INVALID_PDF", upload: (body: ReadableStream<Uint8Array>) => writePdfUpload(body, "job-invalid") },
  { format: "image", code: "INVALID_IMAGE", upload: (body: ReadableStream<Uint8Array>) => writeImageUpload(body, "job-invalid", "image/png") },
  { format: "Office", code: "INVALID_DOCUMENT", upload: (body: ReadableStream<Uint8Array>) => writeOfficeUpload(body, "job-invalid", officeMime) },
];

describe("upload stream safety", () => {
  it.each(uploaders)("stops a stalled $format body after 30 seconds", async ({ upload }) => {
    vi.useFakeTimers();
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull() { notifyStarted(); },
      cancel,
    }, { highWaterMark: 0 });
    const result = upload(stream);
    const rejected = expect(result).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
      message: "O envio ficou parado ou demorou demais. Confira a conexão e envie o arquivo novamente.",
    });
    await started;
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await expect(readdir(path.join(directory, "job-invalid", "input"))).resolves.toEqual([]);
  });

  it("does not let regular small chunks reset the five-minute total budget", async () => {
    vi.useFakeTimers();
    const deferredPull = () => {
      let resolve!: (controller: ReadableStreamDefaultController<Uint8Array>) => void;
      const promise = new Promise<ReadableStreamDefaultController<Uint8Array>>((done) => { resolve = done; });
      return { promise, resolve };
    };
    let nextPull = deferredPull();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { nextPull.resolve(controller); },
      cancel,
    }, { highWaterMark: 0 });
    const result = writePdfUpload(stream, "job-drip");
    const rejected = expect(result).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    for (let index = 0; index < 14; index += 1) {
      const controller = await nextPull.promise;
      nextPull = deferredPull();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(settled).toBe(false);
      controller.enqueue(strToU8(index === 0 ? "%PDF-1.7\n" : "x"));
    }
    await nextPull.promise;
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await expect(readdir(path.join(directory, "job-drip", "input"))).resolves.toEqual([]);
  });

  it.each(uploaders)("rejects a bad $format header without waiting for the rest or a stalled cancel", async ({ code, upload }) => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(strToU8("not a supported file"));
      },
      cancel,
    }, { highWaterMark: 0 });

    await expect(upload(stream)).rejects.toMatchObject({ code });
    expect(pulls).toBe(1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    await expect(readdir(path.join(directory, "job-invalid", "input"))).resolves.toEqual([]);
  }, 1_000);

  it.each(uploaders)("preserves the $format error when the source rejects cancellation", async ({ code, upload }) => {
    const cancel = vi.fn(async () => { throw new Error("source cancellation failed"); });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(strToU8("not a supported file")); },
      cancel,
    });
    await expect(upload(stream)).rejects.toMatchObject({ code });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    await expect(readdir(path.join(directory, "job-invalid", "input"))).resolves.toEqual([]);
  });

  it("stores complete real PDF, PNG and Office files across split headers without cancelling them", async () => {
    vi.useFakeTimers();
    const pdf = await PDFDocument.create();
    pdf.addPage([120, 160]).drawText("Upload completo", { x: 5, y: 100, size: 10 });
    const pdfBytes = await pdf.save();
    const pngBytes = await sharp({ create: { background: "white", channels: 3, width: 12, height: 9 } }).png().toBuffer();
    const documentXml = strToU8('<document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><body><p><r><t>Upload completo</t></r></p></body></document>');
    const officeBytes = zipSync({
      "[Content_Types].xml": strToU8("<Types />"),
      "word/document.xml": documentXml,
    });
    const cases = [
      { bytes: pdfBytes, upload: (body: ReadableStream<Uint8Array>) => writePdfUpload(body, "job-pdf", pdfBytes.length) },
      { bytes: pngBytes, upload: (body: ReadableStream<Uint8Array>) => writeImageUpload(body, "job-image", "image/png", pngBytes.length) },
      { bytes: officeBytes, upload: (body: ReadableStream<Uint8Array>) => writeOfficeUpload(body, "job-office", officeMime, officeBytes.length) },
    ];
    const stored: Buffer[] = [];
    for (const { bytes, upload } of cases) {
      let offset = 0;
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === bytes.length) { controller.close(); return; }
          const next = Math.min(offset + 3, bytes.length);
          controller.enqueue(bytes.subarray(offset, next));
          offset = next;
        },
        cancel,
      });
      const result = await upload(stream);
      const contents = await readFile(path.join(directory, result.storageKey));
      expect(contents).toEqual(Buffer.from(bytes));
      expect(result.sizeBytes).toBe(BigInt(bytes.length));
      expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(cancel).not.toHaveBeenCalled();
      expect(stream.locked).toBe(false);
      stored.push(contents);
    }
    expect((await PDFDocument.load(stored[0])).getPageCount()).toBe(1);
    expect(await sharp(stored[1]).metadata()).toMatchObject({ format: "png", width: 12, height: 9 });
    expect(unzipSync(stored[2])["word/document.xml"]).toEqual(documentXml);
    expect(vi.getTimerCount()).toBe(0);
  });
});
