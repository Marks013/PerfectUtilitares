import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderPdfPagesToJpeg } from "@/lib/pdf/render";

const originalStorageDirectory = process.env.PDF_STORAGE_DIR;
const originalPdfRenderer = process.env.PDF_RENDERER;
let temporaryDirectory: string | null = null;

afterEach(async () => {
  process.env.PDF_STORAGE_DIR = originalStorageDirectory;
  process.env.PDF_RENDERER = originalPdfRenderer;
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = null;
  }
});

describe("PDF page rendering", () => {
  beforeEach(() => {
    if (process.env.PDF_POPPLER_PATH) {
      delete process.env.PDF_RENDERER;
    } else {
      process.env.PDF_RENDERER = "pdfjs";
    }
  });

  it("renders a rotated page as JPEG", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    const document = await PDFDocument.create();
    document.addPage([100, 200]);
    const storageKey = "job/input/source.pdf";
    const filePath = path.join(temporaryDirectory, storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, await document.save());
    let output: Uint8Array | null = null;

    await renderPdfPagesToJpeg({
      dpi: 144,
      inputs: new Map([
        [
          "artifact-a",
          {
            id: "artifact-a",
            originalName: "source.pdf",
            storageKey,
          },
        ],
      ]),
      manifest: {
        version: 1,
        pages: [
          {
            id: "page-a",
            artifactId: "artifact-a",
            sourcePage: 1,
            rotation: 90,
          },
        ],
      },
      onOutput(_instruction, bytes) {
        output = bytes;
      },
    });

    expect(output).not.toBeNull();
    const metadata = await sharp(output!).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(400);
    expect(metadata.height).toBe(200);
  });
});
