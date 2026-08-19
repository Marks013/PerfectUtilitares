// PERFECT_PDF_FULL32_V2_2
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, rgb } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateSemanticCandidate } from "./compression-semantic";

const temporaryDirectories: string[] = [];
const originalRenderer = process.env.PDF_RENDERER;

async function tempPaths() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "perfect-pdf-semantic-"),
  );
  temporaryDirectories.push(directory);
  return {
    source: path.join(directory, "source.pdf"),
    candidate: path.join(directory, "candidate.pdf"),
  };
}

beforeEach(() => {
  process.env.PDF_RENDERER = "pdfjs";
});

afterEach(async () => {
  process.env.PDF_RENDERER = originalRenderer;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("validateSemanticCandidate", () => {
  it("aceita uma cópia semanticamente equivalente", async () => {
    const files = await tempPaths();
    const document = await PDFDocument.create();
    document.setTitle("Documento íntegro");
    const page = document.addPage([400, 500]);
    page.drawText("Conteúdo pesquisável", { x: 40, y: 420, size: 18 });
    page.drawRectangle({
      x: 40,
      y: 300,
      width: 200,
      height: 80,
      color: rgb(0.5, 0.5, 0.5),
    });
    await writeFile(files.source, await document.save());
    await writeFile(files.candidate, await readFile(files.source));

    await expect(
      validateSemanticCandidate(files.source, files.candidate),
    ).resolves.toBeUndefined();
  });

  it("rejeita perda de camada textual mesmo quando o texto é invisível", async () => {
    const files = await tempPaths();

    const source = await PDFDocument.create();
    const sourcePage = source.addPage([400, 500]);
    sourcePage.drawRectangle({
      x: 0,
      y: 0,
      width: 400,
      height: 500,
      color: rgb(1, 1, 1),
    });
    sourcePage.drawText("OCR PESQUISÁVEL", {
      x: 40,
      y: 400,
      size: 16,
      opacity: 0,
    });
    await writeFile(files.source, await source.save());

    const candidate = await PDFDocument.create();
    const candidatePage = candidate.addPage([400, 500]);
    candidatePage.drawRectangle({
      x: 0,
      y: 0,
      width: 400,
      height: 500,
      color: rgb(1, 1, 1),
    });
    await writeFile(files.candidate, await candidate.save());

    await expect(
      validateSemanticCandidate(files.source, files.candidate),
    ).rejects.toMatchObject({ code: "PDF_SEMANTIC_INTEGRITY_FAILED" });
  });

  it("rejeita perda de formulário mesmo com a página preservada", async () => {
    const files = await tempPaths();
    const source = await PDFDocument.create();
    const page = source.addPage([400, 500]);
    const form = source.getForm();
    const field = form.createTextField("nome");
    field.setText("Samuel");
    field.addToPage(page, {
      x: 40,
      y: 400,
      width: 180,
      height: 24,
    });
    await writeFile(files.source, await source.save());

    const candidate = await PDFDocument.load(await readFile(files.source), {
      updateMetadata: false,
    });
    candidate.catalog.delete(PDFName.of("AcroForm"));
    await writeFile(files.candidate, await candidate.save());

    await expect(
      validateSemanticCandidate(files.source, files.candidate),
    ).rejects.toMatchObject({ code: "PDF_SEMANTIC_INTEGRITY_FAILED" });
  });

  it("rejeita alteração de metadata documental", async () => {
    const files = await tempPaths();
    const source = await PDFDocument.create();
    source.setTitle("Título original");
    source.addPage([400, 500]);
    await writeFile(files.source, await source.save());

    const candidate = await PDFDocument.load(await readFile(files.source), {
      updateMetadata: false,
    });
    candidate.setTitle("Título alterado");
    await writeFile(files.candidate, await candidate.save());

    await expect(
      validateSemanticCandidate(files.source, files.candidate),
    ).rejects.toMatchObject({ code: "PDF_SEMANTIC_INTEGRITY_FAILED" });
  });
});
