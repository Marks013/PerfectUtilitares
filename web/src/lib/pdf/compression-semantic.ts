// PERFECT_PDF_FULL32_V2_2
// PERFECT_PDF_ADAPTIVE_V4_2
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFName,
  type PDFPage,
} from "pdf-lib";
import sharp from "sharp";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { renderPdfPageToPng } from "@/lib/pdf/render";
import { PdfToolError } from "./compression-types";

type SemanticFingerprint = {
  text: string;
  outline: unknown;
  metadata: Record<string, string>;
  catalog: Record<string, boolean>;
  annotations: unknown[][];
  formFields: string[];
};

type PageBox = ReturnType<PDFPage["getMediaBox"]>;

type PdfJsDestinationResolver = {
  getDestination(name: string): Promise<unknown>;
  getPageIndex(reference: unknown): Promise<number>;
};

function normalized(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function pdfName(value: string) {
  return PDFName.of(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function simpleValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(simpleValue);
  const object = record(value);
  if (!object) return null;
  if (typeof object.name === "string") return object.name;
  return null;
}

async function normalizeDestination(
  resolver: PdfJsDestinationResolver,
  value: unknown,
) {
  let destination = value;
  if (typeof destination === "string") {
    try {
      destination = await resolver.getDestination(destination);
    } catch {
      return { named: destination, unresolved: true };
    }
  }
  if (!Array.isArray(destination) || destination.length === 0) return null;

  const pageReference = destination[0];
  let pageIndex: number | null = null;
  if (typeof pageReference === "number") {
    pageIndex = pageReference;
  } else if (pageReference && typeof pageReference === "object") {
    try {
      pageIndex = await resolver.getPageIndex(pageReference);
    } catch {
      pageIndex = null;
    }
  }

  return {
    pageIndex,
    kind: simpleValue(destination[1]),
    parameters: destination.slice(2).map(simpleValue),
  };
}

async function normalizeOutline(
  resolver: PdfJsDestinationResolver,
  value: unknown,
): Promise<unknown[]> {
  if (!Array.isArray(value)) return [];
  const result: unknown[] = [];
  for (const rawEntry of value) {
    const entry = record(rawEntry);
    if (!entry) continue;
    result.push({
      title:
        typeof entry.title === "string" ? normalized(entry.title) : "",
      url: typeof entry.url === "string" ? entry.url : null,
      unsafeUrl:
        typeof entry.unsafeUrl === "string" ? entry.unsafeUrl : null,
      destination: await normalizeDestination(resolver, entry.dest),
      items: await normalizeOutline(resolver, entry.items),
    });
  }
  return result;
}

function normalizedRect(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.map((item) =>
    typeof item === "number" ? Math.round(item * 1000) / 1000 : simpleValue(item),
  );
}

async function normalizeAnnotations(
  resolver: PdfJsDestinationResolver,
  annotations: unknown,
) {
  if (!Array.isArray(annotations)) return [];
  const normalizedAnnotations: unknown[] = [];
  for (const rawAnnotation of annotations) {
    const annotation = record(rawAnnotation);
    if (!annotation) continue;
    normalizedAnnotations.push({
      subtype:
        typeof annotation.subtype === "string" ? annotation.subtype : "",
      annotationType:
        typeof annotation.annotationType === "number"
          ? annotation.annotationType
          : null,
      url: typeof annotation.url === "string" ? annotation.url : null,
      unsafeUrl:
        typeof annotation.unsafeUrl === "string"
          ? annotation.unsafeUrl
          : null,
      contents:
        typeof annotation.contents === "string"
          ? normalized(annotation.contents)
          : "",
      fieldName:
        typeof annotation.fieldName === "string"
          ? annotation.fieldName
          : null,
      fieldValue: simpleValue(annotation.fieldValue),
      buttonValue: simpleValue(annotation.buttonValue),
      checkBox: simpleValue(annotation.checkBox),
      radioButton: simpleValue(annotation.radioButton),
      rect: normalizedRect(annotation.rect),
      destination: await normalizeDestination(
        resolver,
        annotation.dest ?? annotation.destination,
      ),
    });
  }
  return normalizedAnnotations.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

async function pdfJsFingerprint(path: string) {
  const bytes = new Uint8Array(await readFile(path));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
  const document = await loadingTask.promise;
  const resolver =
    document as unknown as PdfJsDestinationResolver;
  const text: string[] = [];
  const annotations: unknown[][] = [];
  try {
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      try {
        const [content, pageAnnotations] = await Promise.all([
          page.getTextContent(),
          page.getAnnotations({ intent: "display" }),
        ]);
        text.push(
          normalized(
            content.items
              .map((item) =>
                "str" in item && typeof item.str === "string" ? item.str : "",
              )
              .join(" "),
          ),
        );
        annotations.push(
          await normalizeAnnotations(resolver, pageAnnotations),
        );
      } finally {
        page.cleanup();
      }
    }
    return {
      text: text.join("\n"),
      outline: await normalizeOutline(resolver, await document.getOutline()),
      annotations,
    };
  } finally {
    await loadingTask.destroy();
  }
}

function metadataFingerprint(pdf: PDFDocument) {
  return {
    title: pdf.getTitle() ?? "",
    author: pdf.getAuthor() ?? "",
    subject: pdf.getSubject() ?? "",
    keywords: pdf.getKeywords() ?? "",
  };
}

function catalogFingerprint(pdf: PDFDocument) {
  const keys = [
    "Outlines",
    "Names",
    "AcroForm",
    "StructTreeRoot",
    "Metadata",
    "PageLabels",
  ];
  return Object.fromEntries(
    keys.map((key) => [key, pdf.catalog.has(pdfName(key))]),
  );
}

function formFieldFingerprint(pdf: PDFDocument) {
  try {
    return pdf
      .getForm()
      .getFields()
      .map((field) => `${field.getName()}:${field.constructor.name}`)
      .sort();
  } catch {
    return [];
  }
}

function box(
  page: PDFPage,
  kind: "media" | "crop" | "bleed" | "trim" | "art",
) {
  if (kind === "media") return page.getMediaBox();
  if (kind === "crop") return page.getCropBox();
  if (kind === "bleed") return page.getBleedBox();
  if (kind === "trim") return page.getTrimBox();
  return page.getArtBox();
}

function sameBox(left: PageBox, right: PageBox) {
  return (["x", "y", "width", "height"] as const).every(
    (key) => Math.abs(left[key] - right[key]) < 0.01,
  );
}

async function validateGeometry(inputPath: string, candidatePath: string) {
  const [source, candidate] = await Promise.all([
    PDFDocument.load(await readFile(inputPath), { updateMetadata: false }),
    PDFDocument.load(await readFile(candidatePath), { updateMetadata: false }),
  ]);
  if (source.getPageCount() !== candidate.getPageCount()) {
    throw new PdfToolError(
      "PDF_SEMANTIC_INTEGRITY_FAILED",
      "A compactação alterou a quantidade de páginas.",
    );
  }
  const kinds = ["media", "crop", "bleed", "trim", "art"] as const;
  for (let index = 0; index < source.getPageCount(); index += 1) {
    const sourcePage = source.getPage(index);
    const candidatePage = candidate.getPage(index);
    if (
      sourcePage.getRotation().angle !== candidatePage.getRotation().angle ||
      !kinds.every((kind) =>
        sameBox(box(sourcePage, kind), box(candidatePage, kind)),
      )
    ) {
      throw new PdfToolError(
        "PDF_SEMANTIC_INTEGRITY_FAILED",
        "A compactação alterou geometria/rotação das páginas.",
      );
    }
  }
}

function samplePages(pageCount: number) {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  return [
    1,
    Math.round(pageCount * 0.25),
    Math.round(pageCount * 0.5),
    Math.round(pageCount * 0.75),
    pageCount,
  ].filter((page, index, pages) => pages.indexOf(page) === index);
}

const VISUAL_SAMPLE_SIZE = 384;
const VISUAL_DARK_THRESHOLD = 248;
const VISUAL_POSITION_TOLERANCE_PX = 2;

async function normalizedVisual(bytes: Buffer) {
  return sharp(bytes, { failOn: "error" })
    .flatten({ background: "#FFFFFF" })
    .grayscale()
    .resize(VISUAL_SAMPLE_SIZE, VISUAL_SAMPLE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();
}

function nearbyDarkMask(candidate: Buffer) {
  const mask = new Uint8Array(candidate.length);
  for (let index = 0; index < candidate.length; index += 1) {
    if ((candidate[index] ?? 255) > VISUAL_DARK_THRESHOLD) continue;
    const x = index % VISUAL_SAMPLE_SIZE;
    const y = Math.floor(index / VISUAL_SAMPLE_SIZE);
    for (
      let row = Math.max(0, y - VISUAL_POSITION_TOLERANCE_PX);
      row <= Math.min(VISUAL_SAMPLE_SIZE - 1, y + VISUAL_POSITION_TOLERANCE_PX);
      row += 1
    ) {
      for (
        let column = Math.max(0, x - VISUAL_POSITION_TOLERANCE_PX);
        column <= Math.min(
          VISUAL_SAMPLE_SIZE - 1,
          x + VISUAL_POSITION_TOLERANCE_PX,
        );
        column += 1
      ) {
        mask[row * VISUAL_SAMPLE_SIZE + column] = 1;
      }
    }
  }
  return mask;
}

async function validateLossyVisual(inputPath: string, candidatePath: string) {
  const sourcePdf = await PDFDocument.load(await readFile(inputPath), {
    updateMetadata: false,
  });
  for (const pageNumber of samplePages(sourcePdf.getPageCount())) {
    const [sourcePng, candidatePng] = await Promise.all([
      renderPdfPageToPng({ inputPath, pageNumber, dpi: 96 }),
      renderPdfPageToPng({
        inputPath: candidatePath,
        pageNumber,
        dpi: 96,
      }),
    ]);
    const [source, candidate] = await Promise.all([
      normalizedVisual(sourcePng),
      normalizedVisual(candidatePng),
    ]);
    if (source.length !== candidate.length) {
      throw new PdfToolError(
        "PDF_VISUAL_INTEGRITY_FAILED",
        "O candidato alterou as dimensões visuais.",
      );
    }
    const candidateDarkNearby = nearbyDarkMask(candidate);
    let absoluteError = 0;
    let darkSource = 0;
    let missingDark = 0;
    for (let index = 0; index < source.length; index += 1) {
      const left = source[index] ?? 255;
      const right = candidate[index] ?? 255;
      absoluteError += Math.abs(left - right);
      if (left < 220) {
        darkSource += 1;
        if (!candidateDarkNearby[index]) missingDark += 1;
      }
    }
    const meanError = absoluteError / Math.max(1, source.length);
    const missingRatio = darkSource > 0 ? missingDark / darkSource : 0;
    if (meanError > 24 || missingRatio > 0.025) {
      throw new PdfToolError(
        "PDF_VISUAL_INTEGRITY_FAILED",
        "A recompressão alterou excessivamente o conteúdo visual.",
      );
    }
  }
}

async function fingerprint(path: string): Promise<SemanticFingerprint> {
  const pdf = await PDFDocument.load(await readFile(path), {
    updateMetadata: false,
  });
  const pdfjs = await pdfJsFingerprint(path);
  return {
    text: pdfjs.text,
    outline: pdfjs.outline,
    metadata: metadataFingerprint(pdf),
    catalog: catalogFingerprint(pdf),
    annotations: pdfjs.annotations,
    formFields: formFieldFingerprint(pdf),
  };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Validação para candidatos lossy preservadores.
 * Não exige pixels idênticos, mas exige geometria, conteúdo visual suficiente
 * e estruturas semânticas equivalentes.
 */
export async function validateSemanticCandidate(
  inputPath: string,
  candidatePath: string,
  options: { visual?: boolean } = {},
) {
  await validateGeometry(inputPath, candidatePath);
  if (options.visual !== false) {
    await validateLossyVisual(inputPath, candidatePath);
  }

  // Sequencial de propósito: PDFs podem ter até 100 MB e dois fingerprints
  // simultâneos elevam desnecessariamente o pico de memória do worker.
  const source = await fingerprint(inputPath);
  const candidate = await fingerprint(candidatePath);

  if (source.text && source.text !== candidate.text) {
    throw new PdfToolError(
      "PDF_SEMANTIC_INTEGRITY_FAILED",
      "A compactação alterou a camada textual/OCR e foi descartada.",
    );
  }
  if (!sameJson(source.outline, candidate.outline)) {
    throw new PdfToolError(
      "PDF_SEMANTIC_INTEGRITY_FAILED",
      "A compactação alterou bookmarks/destinos e foi descartada.",
    );
  }
  if (!sameJson(source.catalog, candidate.catalog)) {
    throw new PdfToolError(
      "PDF_SEMANTIC_INTEGRITY_FAILED",
      "A compactação alterou estruturas do catálogo e foi descartada.",
    );
  }
  if (!sameJson(source.annotations, candidate.annotations)) {
    throw new PdfToolError(
      "PDF_SEMANTIC_INTEGRITY_FAILED",
      "A compactação alterou links/anotações/widgets e foi descartada.",
    );
  }
  if (!sameJson(source.formFields, candidate.formFields)) {
    throw new PdfToolError(
      "PDF_SEMANTIC_INTEGRITY_FAILED",
      "A compactação alterou campos de formulário e foi descartada.",
    );
  }
  if (!sameJson(source.metadata, candidate.metadata)) {
    throw new PdfToolError(
      "PDF_SEMANTIC_INTEGRITY_FAILED",
      "A compactação alterou metadados documentais e foi descartada.",
    );
  }
}
