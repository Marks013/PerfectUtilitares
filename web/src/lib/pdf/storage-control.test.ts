import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitPdfOutput,
  discardPdfOutput,
  PdfStorageError,
  removePdfJobFiles,
  removePdfStorageKey,
  reservePdfOutput,
  resolvePdfStorageKey,
  sanitizeImageFileName,
  sanitizeOfficeFileName,
  writeImageUpload,
  writeOfficeOutput,
  writeOfficeUpload,
} from "@/lib/pdf/storage";

const originalStorageDirectory = process.env.PDF_STORAGE_DIR;
let temporaryDirectory: string | null = null;

async function useTemporaryStorage() {
  temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "perfect-pdf-storage-control-"),
  );
  process.env.PDF_STORAGE_DIR = temporaryDirectory;
  return temporaryDirectory;
}

function streamFrom(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

afterEach(async () => {
  if (originalStorageDirectory === undefined) {
    delete process.env.PDF_STORAGE_DIR;
  } else {
    process.env.PDF_STORAGE_DIR = originalStorageDirectory;
  }

  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = null;
  }
});

describe("PDF storage control paths", () => {
  it("rejects relative storage roots and traversal keys", async () => {
    process.env.PDF_STORAGE_DIR = "relative/storage";

    expect(() => resolvePdfStorageKey("job/file.pdf")).toThrow(PdfStorageError);

    const root = await useTemporaryStorage();

    expect(() => resolvePdfStorageKey("../escape.pdf")).toThrow(PdfStorageError);
    expect(resolvePdfStorageKey("job/file.pdf")).toBe(
      path.join(root, "job", "file.pdf"),
    );
  });

  it("normalizes image and Office names for their target formats", () => {
    expect(
      sanitizeImageFileName(
        encodeURIComponent("../Foto.PNG"),
        "image/jpeg",
      ),
    ).toBe("Foto.jpg");

    expect(
      sanitizeOfficeFileName(
        encodeURIComponent("../Relatorio.DOCX"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("Relatorio.xlsx");

    expect(() =>
      sanitizeImageFileName("%E0%A4%A", "image/png"),
    ).toThrow(PdfStorageError);
  });

  it("rejects missing image and Office upload streams", async () => {
    await expect(
      writeImageUpload(null, "job-image", "image/png"),
    ).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });

    await expect(
      writeOfficeUpload(
        null,
        "job-office",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });
  });

  it("stores a valid PNG upload with digest and size", async () => {
    const root = await useTemporaryStorage();
    const bytes = await sharp({
      create: {
        background: "white",
        channels: 3,
        height: 8,
        width: 8,
      },
    })
      .png()
      .toBuffer();

    const result = await writeImageUpload(
      streamFrom(bytes),
      "job-image",
      "image/png",
    );

    expect(result.storageKey).toMatch(
      /^job-image\/input\/[0-9a-f-]+\.png$/,
    );
    expect(result.sizeBytes).toBe(BigInt(bytes.byteLength));
    expect(result.sha256).toHaveLength(64);
    await expect(
      readFile(path.join(root, result.storageKey)),
    ).resolves.toEqual(bytes);
  });

  it("reserves and commits an atomic PDF output", async () => {
    await useTemporaryStorage();

    const reservation = await reservePdfOutput(
      "job-reserve",
      "../resultado.pdf",
    );
    const contents = Buffer.from("%PDF-1.7\nreserved output");

    await writeFile(reservation.temporaryPath, contents);

    const result = await commitPdfOutput(reservation);

    expect(result.originalName).toBe("resultado.pdf");
    expect(result.storageKey).toBe(reservation.storageKey);
    expect(result.sizeBytes).toBe(BigInt(contents.byteLength));
    expect(result.sha256).toHaveLength(64);
    await expect(readFile(reservation.finalPath)).resolves.toEqual(contents);
    await expect(stat(reservation.temporaryPath)).rejects.toThrow();
  });

  it("rejects an invalid reserved PDF and discards partial files", async () => {
    await useTemporaryStorage();

    const reservation = await reservePdfOutput(
      "job-invalid-reserve",
      "resultado.pdf",
    );

    await writeFile(reservation.temporaryPath, "not a pdf");

    await expect(commitPdfOutput(reservation)).rejects.toMatchObject({
      code: "INVALID_PDF",
    });

    await discardPdfOutput(reservation);

    await expect(stat(reservation.temporaryPath)).rejects.toThrow();
    await expect(stat(reservation.finalPath)).rejects.toThrow();
  });

  it("writes a valid XLSX output and normalizes its name", async () => {
    const root = await useTemporaryStorage();
    const contents = zipSync({
      "[Content_Types].xml": strToU8("<Types />"),
      "xl/workbook.xml": strToU8("<workbook />"),
    });

    const result = await writeOfficeOutput(
      "job-xlsx-output",
      "../relatorio.docx",
      "xlsx",
      contents,
    );

    expect(result.originalName).toBe("relatorio.xlsx");
    expect(result.sizeBytes).toBe(BigInt(contents.byteLength));
    expect(result.sha256).toHaveLength(64);
    await expect(
      readFile(path.join(root, result.storageKey)),
    ).resolves.toEqual(Buffer.from(contents));
  });

  it("removes individual storage keys and complete job directories", async () => {
    const root = await useTemporaryStorage();

    const singleFile = path.join(
      root,
      "job-clean",
      "output",
      "single.pdf",
    );
    await mkdir(path.dirname(singleFile), { recursive: true });
    await writeFile(singleFile, "%PDF-1.7");

    await removePdfStorageKey("job-clean/output/single.pdf");

    await expect(stat(singleFile)).rejects.toThrow();

    const remainingFile = path.join(
      root,
      "job-clean",
      "input",
      "remaining.pdf",
    );
    await mkdir(path.dirname(remainingFile), { recursive: true });
    await writeFile(remainingFile, "%PDF-1.7");

    await removePdfJobFiles("job-clean");

    await expect(stat(path.join(root, "job-clean"))).rejects.toThrow();
  });
});
