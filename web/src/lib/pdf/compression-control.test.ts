import { beforeEach, describe, expect, it, vi } from "vitest";
// PERFECT_PDF_FULL32_V2_2

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  copyFile: vi.fn(),
  discard: vi.fn(),
  ensure: vi.fn(),
  pdfCreate: vi.fn(),
  pdfLoad: vi.fn(),
  readFile: vi.fn(),
  render: vi.fn(),
  reserve: vi.fn(),
  resolve: vi.fn(),
  rm: vi.fn(),
  sharp: vi.fn(),
  spawn: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("node:fs/promises", () => ({
  copyFile: mocks.copyFile,
  readFile: mocks.readFile,
  rm: mocks.rm,
  stat: mocks.stat,
  writeFile: mocks.writeFile,
}));

vi.mock("pdf-lib", () => ({
  degrees: (angle: number) => ({ angle }),
  PDFDocument: {
    create: mocks.pdfCreate,
    load: mocks.pdfLoad,
  },
}));

vi.mock("sharp", () => ({
  default: mocks.sharp,
}));

vi.mock("@/lib/pdf/render", () => ({
  renderPdfPageToPng: mocks.render,
  renderPdfPagesToPng: mocks.render,
}));

vi.mock("@/lib/pdf/server-runtime", () => ({
  ensureServerLocalStorage: mocks.ensure,
}));
vi.mock("@/lib/pdf/compression-analyzer", () => ({
  analyzePdfCompressionProfile: vi.fn().mockResolvedValue({
    pageCount: 1,
    sampledPages: [1],
    contentKind: "SCANNED",
    colorMode: "COLOR",
    sourceDpi: 300,
    minimumDpi: 300,
    maximumDpi: 300,
    fullPageImageRatio: 1,
    imageCoverageRatio: 1,
    imageCount: 1,
    hasSelectableText: false,
    hasOcrLayer: false,
    predominantImageEncoding: "JPEG",
    bitsPerComponent: 8,
    alreadyOptimized: false,
    optimizationClass: "OVERSIZED_SCAN",
  }),
}));
vi.mock("@/lib/pdf/compression-semantic", () => ({
  validateSemanticCandidate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/pdf/storage", () => ({
  commitPdfOutput: mocks.commit,
  discardPdfOutput: mocks.discard,
  reservePdfOutput: mocks.reserve,
  resolvePdfStorageKey: mocks.resolve,
}));

import {
  compressPdfFile,
  type PdfCompressionEffectiveOptions,
  rasterizePdfForCompression,
} from "@/lib/pdf/compression";

function compressionOptions(
  method: PdfCompressionEffectiveOptions["method"],
): PdfCompressionEffectiveOptions {
  return {
    quality: "BALANCED",
    method,
    dpi: 96,
    colorMode: "COLOR",
    imageQuality: 72,
    monochromeThreshold: 160,
    userOverrides: {
      method: true,
      dpi: true,
      colorMode: true,
      imageQuality: true,
      monochromeThreshold: true,
    },
    preserveTextLayer: false,
    allowSemanticLoss: true,
  };
}

function pdfPage(width = 595, height = 842) {
  const box = { x: 0, y: 0, width, height };

  return {
    getArtBox: () => box,
    getBleedBox: () => box,
    getCropBox: () => box,
    getMediaBox: () => box,
    getRotation: () => ({ angle: 0 }),
    getTrimBox: () => box,
  };
}

function pdfDocument(pages: ReturnType<typeof pdfPage>[]) {
  return {
    getPage: (index: number) => pages[index],
    getPageCount: () => pages.length,
  };
}

function mockQpdfClose(code: number) {
  mocks.spawn.mockImplementationOnce(() => {
    const child = {
      kill: vi.fn(),
      stderr: {
        on: vi.fn(),
        setEncoding: vi.fn(),
      },
      once: vi.fn(),
    };

    child.once.mockImplementation(
      (event: string, callback: (value: unknown) => void) => {
        if (event === "close") {
          queueMicrotask(() => callback(code));
        }
        return child;
      },
    );

    return child;
  });
}

function mockQpdfUnavailable() {
  const error = Object.assign(new Error("qpdf unavailable"), {
    code: "ENOENT",
  });

  mocks.spawn.mockImplementationOnce(() => {
    const child = {
      kill: vi.fn(),
      stderr: {
        on: vi.fn(),
        setEncoding: vi.fn(),
      },
      once: vi.fn(),
    };

    child.once.mockImplementation(
      (event: string, callback: (value: unknown) => void) => {
        if (event === "error") {
          queueMicrotask(() => callback(error));
        }
        return child;
      },
    );

    return child;
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.reserve.mockResolvedValue({
    temporaryPath: "/tmp/output.partial",
  });
  mocks.resolve.mockReturnValue("/tmp/input.pdf");
  mocks.commit.mockResolvedValue({
    artifactId: "output-1",
    originalName: "compressed.pdf",
    sha256: "abc123",
    sizeBytes: 100n,
    storageKey: "jobs/job-1/compressed.pdf",
  });
  mocks.discard.mockResolvedValue(undefined);

  mocks.copyFile.mockResolvedValue(undefined);
  mocks.readFile.mockResolvedValue(Buffer.from("%PDF-1.7"));
  mocks.rm.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.pdfCreate.mockResolvedValue({});
});

describe("PDF compression control paths", () => {
  it("commits the smallest valid lossless candidate", async () => {
    mockQpdfClose(0);

    mocks.pdfLoad.mockResolvedValue(pdfDocument([]));
    mocks.stat.mockImplementation(async (filePath: string) => ({
      size: filePath === "/tmp/input.pdf" ? 200 : 100,
    }));

    const onProgress = vi.fn();

    const result = await compressPdfFile({
      inputStorageKey: "jobs/job-1/input.pdf",
      jobId: "job-1",
      onProgress,
      options: compressionOptions("LOSSLESS"),
      outputName: "compressed.pdf",
    });

    expect(mocks.spawn).toHaveBeenCalledWith(
      "qpdf",
      expect.any(Array),
      expect.objectContaining({
        shell: false,
      }),
    );
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "/tmp/output.partial.structural.pdf",
      "/tmp/output.partial",
    );
    expect(onProgress).toHaveBeenCalledWith(95);
    expect(onProgress).toHaveBeenCalledWith(100);
    expect(mocks.commit).toHaveBeenCalledWith({
      temporaryPath: "/tmp/output.partial",
    });
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({
      artifactId: "output-1",
      sizeBytes: 100n,
    });
  });

  it("reports no valid candidate when qpdf is unavailable in lossless mode", async () => {
    mockQpdfUnavailable();

    await expect(
      compressPdfFile({
        inputStorageKey: "jobs/job-1/input.pdf",
        jobId: "job-1",
        options: compressionOptions("LOSSLESS"),
        outputName: "compressed.pdf",
      }),
    ).rejects.toMatchObject({
      code: "PDF_COMPRESSION_NO_VALID_CANDIDATE",
    });

    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.discard).toHaveBeenCalledWith({
      temporaryPath: "/tmp/output.partial",
    });
    expect(mocks.rm).toHaveBeenCalledTimes(6);
  });

  it("discards the reservation when raster compression exceeds the render limit", async () => {
    mocks.pdfLoad.mockResolvedValue(
      pdfDocument([pdfPage(10_000, 10_000)]),
    );

    await expect(
      compressPdfFile({
        inputStorageKey: "jobs/job-1/input.pdf",
        jobId: "job-1",
        options: compressionOptions("RASTER"),
        outputName: "compressed.pdf",
      }),
    ).rejects.toMatchObject({
      code: "PDF_PAGE_RENDER_LIMIT_EXCEEDED",
    });

    expect(mocks.ensure).toHaveBeenCalledOnce();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.discard).toHaveBeenCalledWith({
      temporaryPath: "/tmp/output.partial",
    });
    expect(mocks.rm).toHaveBeenCalledTimes(6);
  });

  it("rejects raster compression above the thousand-page safety limit", async () => {
    const pages = Array.from({ length: 1_001 }, () => pdfPage());
    mocks.pdfLoad.mockResolvedValue(pdfDocument(pages));

    await expect(
      rasterizePdfForCompression({
        inputPath: "/tmp/input.pdf",
        options: compressionOptions("RASTER"),
        outputPath: "/tmp/output.pdf",
      }),
    ).rejects.toMatchObject({
      code: "PDF_PAGE_LIMIT_EXCEEDED",
    });

    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("wraps an unexpected raster rendering failure with a stable error code", async () => {
    mocks.pdfLoad.mockResolvedValue(pdfDocument([pdfPage()]));
    mocks.render.mockRejectedValueOnce(new Error("renderer exploded"));

    await expect(
      rasterizePdfForCompression({
        inputPath: "/tmp/input.pdf",
        options: compressionOptions("RASTER"),
        outputPath: "/tmp/output.pdf",
      }),
    ).rejects.toMatchObject({
      code: "PDF_RASTER_COMPRESSION_FAILED",
      message: "Não foi possível recomprimir as páginas do PDF.",
    });

    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
