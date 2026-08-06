import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildPdfFromImages } from "@/lib/pdf/images-to-pdf";

const originalStorageDirectory = process.env.PDF_STORAGE_DIR;
let temporaryDirectory: string | null = null;

afterEach(async () => {
  process.env.PDF_STORAGE_DIR = originalStorageDirectory;
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = null;
  }
});

async function createImage(storageKey: string, width: number, height: number) {
  if (!temporaryDirectory) {
    throw new Error("O diretório temporário do teste não foi inicializado.");
  }

  const filePath = path.join(temporaryDirectory, storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    await sharp({
      create: {
        background: "#35b7a5",
        channels: 3,
        height,
        width,
      },
    })
      .png()
      .toBuffer(),
  );
}

describe("images to PDF", () => {
  it("creates one A4 page per ordered image", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "perfect-pdf-"));
    process.env.PDF_STORAGE_DIR = temporaryDirectory;
    await createImage("job/input/portrait.png", 200, 400);
    await createImage("job/input/landscape.png", 400, 200);

    const bytes = await buildPdfFromImages({
      inputs: [
        {
          originalName: "portrait.png",
          storageKey: "job/input/portrait.png",
        },
        {
          originalName: "landscape.png",
          storageKey: "job/input/landscape.png",
        },
      ],
      margin: 24,
      pageSize: "A4",
    });
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(2);
    expect(document.getPage(0).getWidth()).toBeLessThan(
      document.getPage(0).getHeight(),
    );
    expect(document.getPage(1).getWidth()).toBeGreaterThan(
      document.getPage(1).getHeight(),
    );
  });
});
