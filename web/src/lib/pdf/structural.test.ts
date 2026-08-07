import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import type { PdfManifest } from "@/lib/pdf/schema";
import {
  buildStructuralPdf,
  PdfStructureError,
  splitStructuralPdf,
} from "@/lib/pdf/structural";

const originalStorageDirectory = process.env.PDF_STORAGE_DIR;
let temporaryDirectory: string | null = null;

afterEach(async () => {
  process.env.PDF_STORAGE_DIR = originalStorageDirectory;
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = null;
  }
});

async function createInput(
  storageKey: string,
  sizes: Array<[number, number]>,
) {
  const document = await PDFDocument.create();
  sizes.forEach(([width, height]) => {
    document.addPage([width, height]);
  });
  const bytes = await document.save();
  if (!temporaryDirectory) {
    throw new Error("O diretório temporário do teste não foi inicializado.");
  }

  const filePath = path.join(temporaryDirectory, storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

describe("structural PDF processing", () => {
  it("merges, reorders, duplicates and rotates pages", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    await createInput("job/input/a.pdf", [
      [100, 200],
      [200, 300],
    ]);
    await createInput("job/input/b.pdf", [[400, 500]]);

    const manifest: PdfManifest = {
      version: 1,
      pages: [
        {
          id: "page-b",
          artifactId: "artifact-b",
          sourcePage: 1,
          rotation: 90,
        },
        {
          id: "page-a-2",
          artifactId: "artifact-a",
          sourcePage: 2,
          rotation: 180,
        },
        {
          id: "page-a-copy",
          artifactId: "artifact-a",
          sourcePage: 2,
          rotation: 0,
        },
      ],
    };
    const progress: number[] = [];

    const result = await buildStructuralPdf({
      inputs: new Map([
        [
          "artifact-a",
          {
            id: "artifact-a",
            originalName: "a.pdf",
            storageKey: "job/input/a.pdf",
          },
        ],
        [
          "artifact-b",
          {
            id: "artifact-b",
            originalName: "b.pdf",
            storageKey: "job/input/b.pdf",
          },
        ],
      ]),
      manifest,
      onProgress(value) {
        progress.push(value);
      },
    });

    const output = await PDFDocument.load(result);
    expect(output.getPageCount()).toBe(3);
    expect(output.getPage(0).getSize()).toEqual({ width: 400, height: 500 });
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(output.getPage(1).getSize()).toEqual({ width: 200, height: 300 });
    expect(output.getPage(1).getRotation().angle).toBe(180);
    expect(output.getPage(2).getRotation().angle).toBe(0);
    expect(progress.at(-1)).toBe(88);
  });

  it("rejects a page outside the source document", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    await createInput("job/input/a.pdf", [[100, 200]]);

    await expect(
      buildStructuralPdf({
        inputs: new Map([
          [
            "artifact-a",
            {
              id: "artifact-a",
              originalName: "a.pdf",
              storageKey: "job/input/a.pdf",
            },
          ],
        ]),
        manifest: {
          version: 1,
          pages: [
            {
              id: "missing-page",
              artifactId: "artifact-a",
              sourcePage: 2,
              rotation: 0,
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(PdfStructureError);
  });

  it("splits pages into ordered one-page outputs", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    await createInput("job/input/a.pdf", [
      [100, 200],
      [300, 400],
    ]);
    const outputs: Array<{ index: number; size: { width: number; height: number } }> =
      [];

    await splitStructuralPdf({
      inputs: new Map([
        [
          "artifact-a",
          {
            id: "artifact-a",
            originalName: "a.pdf",
            storageKey: "job/input/a.pdf",
          },
        ],
      ]),
      manifest: {
        version: 1,
        pages: [
          {
            id: "second",
            artifactId: "artifact-a",
            sourcePage: 2,
            rotation: 0,
          },
          {
            id: "first",
            artifactId: "artifact-a",
            sourcePage: 1,
            rotation: 90,
          },
        ],
      },
      async onOutput(_instruction, bytes, index) {
        const output = await PDFDocument.load(bytes);
        expect(output.getPageCount()).toBe(1);
        outputs.push({ index, size: output.getPage(0).getSize() });
      },
    });

    expect(outputs.sort((a, b) => a.index - b.index)).toEqual([
      { index: 0, size: { width: 300, height: 400 } },
      { index: 1, size: { width: 100, height: 200 } },
    ]);
  });

  it("applies a crop box to the output page", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    await createInput("job/input/a.pdf", [[200, 300]]);

    const bytes = await buildStructuralPdf({
      inputs: new Map([
        [
          "artifact-a",
          {
            id: "artifact-a",
            originalName: "a.pdf",
            storageKey: "job/input/a.pdf",
          },
        ],
      ]),
      manifest: {
        version: 1,
        pages: [
          {
            id: "cropped",
            artifactId: "artifact-a",
            sourcePage: 1,
            rotation: 0,
            crop: { x: 20, y: 30, width: 160, height: 240 },
          },
        ],
      },
    });
    const document = await PDFDocument.load(bytes);

    expect(document.getPage(0).getCropBox()).toEqual({
      height: 240,
      width: 160,
      x: 20,
      y: 30,
    });
  });

  it("applies a crop relative to an existing CropBox origin", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    const source = await PDFDocument.create();
    const page = source.addPage([300, 400]);
    page.setCropBox(20, 30, 240, 320);
    const storageKey = "job/input/pre-cropped.pdf";
    const filePath = path.join(temporaryDirectory, storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, await source.save());

    const bytes = await buildStructuralPdf({
      inputs: new Map([
        [
          "artifact-a",
          {
            id: "artifact-a",
            originalName: "pre-cropped.pdf",
            storageKey,
          },
        ],
      ]),
      manifest: {
        version: 1,
        pages: [
          {
            id: "cropped-again",
            artifactId: "artifact-a",
            sourcePage: 1,
            rotation: 90,
            crop: { x: 10, y: 15, width: 200, height: 280 },
          },
        ],
      },
    });
    const result = await PDFDocument.load(bytes);

    expect(result.getPage(0).getRotation().angle).toBe(90);
    expect(result.getPage(0).getCropBox()).toEqual({
      height: 280,
      width: 200,
      x: 30,
      y: 45,
    });
  });
});
