import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName, StandardFonts, setTextRenderingMode, TextRenderingMode } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfCompressionProfile } from "./compression-analyzer";
import { buildPreservingImageCandidates } from "./compression-image-recompression";
import { runCompressionTool } from "./compression-process";
import type { PdfCompressionEffectiveOptions } from "./compression-types";
import { runWithPdfAbortSignal } from "./execution-abort";

const behavior = vi.hoisted(() => ({ removeText: false }));

vi.mock("./compression-process", () => ({
  compressionToolTimeoutMs: () => 30_000,
  runCompressionTool: vi.fn(async (executable: string, args: string[]) => {
    if (executable !== "gs") throw new Error("No optional candidate in this fixture");
    const inputPath = args.at(-1);
    const outputPath = args.find(arg => arg.startsWith("-sOutputFile="))?.slice("-sOutputFile=".length);
    if (!inputPath || !outputPath) throw new Error("Missing Ghostscript paths");
    const { readFile, writeFile } = await import("node:fs/promises");
    if (behavior.removeText) {
      const { PDFDocument } = await import("pdf-lib");
      const replacement = await PDFDocument.create();
      replacement.addPage([400, 500]);
      await writeFile(outputPath, await replacement.save());
    } else {
      await writeFile(outputPath, await readFile(inputPath));
    }
  }),
}));

const options: PdfCompressionEffectiveOptions = {
  quality: "BALANCED", method: "AUTO", dpi: 150, colorMode: "GRAYSCALE",
  imageQuality: 72, monochromeThreshold: 160, preserveTextLayer: true, allowSemanticLoss: false,
  userOverrides: { method: false, dpi: false, colorMode: true, imageQuality: false, monochromeThreshold: false },
};
const profile: PdfCompressionProfile = {
  pageCount: 1, sampledPages: [1], contentKind: "SCANNED_OCR", colorMode: "COLOR",
  sourceDpi: 300, minimumDpi: 300, maximumDpi: 300, fullPageImageRatio: 1,
  imageCoverageRatio: 1, imageCount: 1, hasSelectableText: true, hasOcrLayer: true,
  predominantImageEncoding: "FLATE", bitsPerComponent: 8, alreadyOptimized: false,
  optimizationClass: "OVERSIZED_SCAN",
};

let directory = "";
async function sourcePdf(withXmp: boolean) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText("PRESERVE THE OCR MARKER", { x: 20, y: 20, size: 10, font: await pdf.embedFont(StandardFonts.Helvetica) });
  if (withXmp) {
    const stream = pdf.context.stream(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
      { Type: "Metadata", Subtype: "XML" },
    );
    pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(stream));
  }
  const inputPath = join(directory, "source.pdf");
  await writeFile(inputPath, await pdf.save());
  return inputPath;
}
function build(inputPath: string, onIntegrityRejection?: () => void) {
  return buildPreservingImageCandidates({ inputPath, baseOutputPath: join(directory, "candidate"), options, profile, onIntegrityRejection });
}
function gsArgs() {
  return vi.mocked(runCompressionTool).mock.calls.find(([tool]) => tool === "gs")?.[1];
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pdf-xmp-candidate-"));
  behavior.removeText = false;
  vi.clearAllMocks();
  vi.stubEnv("PDF_COMPRESSION_DEEP_OPTIMIZATION", "false");
  vi.stubEnv("PDF_RENDERER", "pdfjs");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("Ghostscript preserves the source XMP contract", () => {
  it.each([false, true])("omits synthesized XMP only when source XMP is absent: %s", async withXmp => {
    const inputPath = await sourcePdf(withXmp);
    const original = await readFile(inputPath);
    const rejected = vi.fn();
    const candidates = await build(inputPath, rejected);
    const candidate = candidates.find(item => item.kind === "GS_IMAGE_RECOMPRESSION");
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("Expected the fully validated Ghostscript candidate");
    const args = gsArgs();
    expect(args).toBeDefined();
    expect(args?.includes("-dOmitXMP=true")).toBe(!withXmp);
    const result = await PDFDocument.load(await readFile(candidate.path), { updateMetadata: false });
    expect(result.catalog.has(PDFName.of("Metadata"))).toBe(withXmp);
    expect(rejected).not.toHaveBeenCalled();
    expect(await readFile(inputPath)).toEqual(original);
  });

  it("still discards real OCR loss through the unchanged semantic validator", async () => {
    const inputPath = await sourcePdf(false);
    behavior.removeText = true;
    const rejected = vi.fn();
    const candidates = await build(inputPath, rejected);
    expect(gsArgs()).toContain("-dOmitXMP=true");
    expect(candidates).toEqual([]);
    expect(rejected).toHaveBeenCalledOnce();
    await expect(access(join(directory, "candidate.gs-images.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["missing", "malformed"])("does not run Ghostscript when source parsing fails: %s", async state => {
    const inputPath = join(directory, "source.pdf");
    if (state === "malformed") await writeFile(inputPath, "not a PDF");
    expect(await build(inputPath)).toEqual([]);
    expect(gsArgs()).toBeUndefined();
  });

  it("honors cancellation while reading the source catalog before starting Ghostscript", async () => {
    const inputPath = await sourcePdf(false);
    const controller = new AbortController();
    const reason = new Error("Cancelled during catalog read");
    const load = PDFDocument.load.bind(PDFDocument);
    vi.spyOn(PDFDocument, "load").mockImplementationOnce(async (...args) => {
      const source = await load(...args);
      controller.abort(reason);
      return source;
    });
    await expect(runWithPdfAbortSignal(controller.signal, () => build(inputPath))).rejects.toBe(reason);
    expect(gsArgs()).toBeUndefined();
  });
});
