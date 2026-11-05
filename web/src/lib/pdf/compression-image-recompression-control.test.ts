import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfCompressionProfile } from "./compression-analyzer";
import {
  buildPreservingImageCandidates,
  optimizeMonochromeRasterCandidate,
} from "./compression-image-recompression";
import { validateSemanticCandidate } from "./compression-semantic";
import type { PdfCompressionEffectiveOptions } from "./compression-types";

const processMock = vi.hoisted(() => ({
  jpegBytes: 0,
  gsBytes: 0,
  optimizerBytes: 0,
  optimizerStarted: null as (() => void) | null,
  optimizerKills: 0,
  mode: "success" as "success" | "error" | "failure" | "hangOptimizer",
}));

vi.mock("./compression-semantic", () => ({
  validateSemanticCandidate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", async () => {
  const { writeFileSync } = await import("node:fs");
  return {
    spawn: vi.fn((executable: string, args: string[]) => {
      const listeners = new Map<string, (...values: never[]) => void>();
      const child = {
        kill: vi.fn(() => { if (executable === "ocrmypdf") processMock.optimizerKills += 1; }),
        stderr: {
          setEncoding: vi.fn(),
          on: vi.fn(),
        },
        once: vi.fn((event: string, listener: (...values: never[]) => void) => {
          listeners.set(event, listener);
          if (event === "close") {
            queueMicrotask(() => {
              if (executable === "ocrmypdf" && processMock.mode === "hangOptimizer") {
                processMock.optimizerStarted?.();
                return;
              }
              if (processMock.mode === "error") {
                listeners.get("error")?.(
                  Object.assign(new Error("missing"), { code: "ENOENT" }) as never,
                );
                return;
              }
              if (processMock.mode === "success" || processMock.mode === "hangOptimizer") {
                if (
                  executable === "python3" &&
                  args[0]?.endsWith("jpeg-xobject-resample.py") &&
                  processMock.jpegBytes > 0
                ) {
                  writeFileSync(args[2], Buffer.alloc(processMock.jpegBytes));
                } else {
                  const output = args
                    .find((argument) => argument.startsWith("-sOutputFile="))
                    ?.slice("-sOutputFile=".length);
                  const candidatePath = output ?? (executable === "qpdf" || executable === "ocrmypdf" ? args.at(-1) : undefined);
                  const size = executable === "gs" ? processMock.gsBytes :
                    executable === "ocrmypdf" ? processMock.optimizerBytes : 0;
                  if (candidatePath) writeFileSync(candidatePath, size > 0 ? Buffer.alloc(size) : Buffer.from("%PDF-1.7\n"));
                }
              }
              listener((processMock.mode === "success" || processMock.mode === "hangOptimizer" ? 0 : 1) as never);
            });
          }
          return child;
        }),
      };
      return child;
    }),
  };
});

function options(
  overrides: Partial<PdfCompressionEffectiveOptions> = {},
): PdfCompressionEffectiveOptions {
  return {
    quality: "BALANCED",
    method: "AUTO",
    dpi: 150,
    colorMode: "COLOR",
    imageQuality: 76,
    monochromeThreshold: 160,
    userOverrides: {
      method: false,
      dpi: false,
      colorMode: false,
      imageQuality: false,
      monochromeThreshold: false,
    },
    preserveTextLayer: true,
    allowSemanticLoss: false,
    ...overrides,
  };
}

function profile(
  overrides: Partial<PdfCompressionProfile> = {},
): PdfCompressionProfile {
  return {
    pageCount: 1,
    sampledPages: [1],
    contentKind: "SCANNED",
    colorMode: "COLOR",
    sourceDpi: null,
    minimumDpi: null,
    maximumDpi: null,
    fullPageImageRatio: 1,
    imageCoverageRatio: 1,
    imageCount: 1,
    hasSelectableText: false,
    hasOcrLayer: false,
    predominantImageEncoding: "JPEG",
    bitsPerComponent: 8,
    alreadyOptimized: false,
    optimizationClass: "RECOMPRESSIBLE_JPEG",
    ...overrides,
  };
}

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pdf-image-control-"));
  processMock.jpegBytes = 0;
  processMock.gsBytes = 0;
  processMock.optimizerBytes = 0;
  processMock.optimizerStarted = null;
  processMock.optimizerKills = 0;
  processMock.mode = "success";
  vi.mocked(spawn).mockClear();
  vi.mocked(validateSemanticCandidate).mockReset().mockResolvedValue(undefined);
  delete process.env.PDF_COMPRESSION_DEEP_OPTIMIZATION;
  delete process.env.PDF_COMPRESSION_TOOL_TIMEOUT_MS;
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

describe("PDF image recompression process control", () => {
  it.each([
    { colorMode: "COLOR", sourceDpi: 300, mode: "preserve" },
    { colorMode: "GRAYSCALE", sourceDpi: 150, mode: "grayscale" },
  ] as const)(
    "stops after a validated JPEG XObject candidate in $mode mode",
    async ({ colorMode, sourceDpi, mode }) => {
      const inputPath = join(directory, "input.pdf");
      await writeFile(inputPath, Buffer.alloc(1_000));
      processMock.jpegBytes = 850;

      const candidates = await buildPreservingImageCandidates({
        inputPath,
        baseOutputPath: join(directory, "candidate"),
        options: options({ colorMode }),
        profile: profile({
          contentKind: "SCANNED_OCR",
          hasOcrLayer: true,
          hasSelectableText: true,
          sourceDpi,
        }),
      });

      expect(candidates).toEqual([
        expect.objectContaining({
          kind: "JPEG_XOBJECT_RECOMPRESSION",
          visualTransform: true,
          lossy: true,
        }),
      ]);
      const [fastCandidate] = candidates;
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
        "python3",
        [
          expect.stringMatching(/jpeg-xobject-resample\.py$/),
          inputPath,
          fastCandidate?.path,
          "--target-dpi",
          "150",
          "--quality",
          "76",
          "--mode",
          mode,
        ],
      ]);
      expect(
        vi.mocked(validateSemanticCandidate).mock.calls[0]?.slice(0, 2),
      ).toEqual([inputPath, fastCandidate?.path]);
    },
  );

  it.each(["integrity failure", "insufficient savings"] as const)(
    "keeps the existing candidates after JPEG XObject %s",
    async (reason) => {
      const inputPath = join(directory, "input.pdf");
      await writeFile(inputPath, Buffer.alloc(1_000));
      processMock.jpegBytes = reason === "integrity failure" ? 800 : 980;
      if (reason === "integrity failure") {
        vi.mocked(validateSemanticCandidate).mockRejectedValueOnce(
          new Error("Rejected test candidate"),
        );
      }

      const candidates = await buildPreservingImageCandidates({
        inputPath,
        baseOutputPath: join(directory, "candidate"),
        options: options({ colorMode: "GRAYSCALE" }),
        profile: profile({ sourceDpi: 300 }),
      });

      const tools = vi.mocked(spawn).mock.calls.map(([tool]) => tool);
      expect(tools[0]).toBe("python3");
      expect(tools).toContain("qpdf");
      expect(tools).toContain("gs");
      expect(candidates.map(({ kind }) => kind)).not.toContain(
        "JPEG_XOBJECT_RECOMPRESSION",
      );
    },
  );

  it("bounds optional optimizer time and keeps the validated fallback", async () => {
    const inputPath = join(directory, "input.pdf");
    await writeFile(inputPath, Buffer.alloc(1_000));
    processMock.gsBytes = 950;
    processMock.mode = "hangOptimizer";
    const started = new Promise<void>((resolve) => { processMock.optimizerStarted = resolve; });
    vi.useFakeTimers();
    const pending = buildPreservingImageCandidates({
      inputPath, baseOutputPath: join(directory, "candidate"), options: options(),
      profile: profile({ sourceDpi: 300, predominantImageEncoding: "FLATE", hasSelectableText: true }),
    });
    await started;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(processMock.optimizerKills).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const candidates = await pending;
    expect(processMock.optimizerKills).toBe(1);
    expect(candidates.some(({ kind }) => kind === "GS_IMAGE_RECOMPRESSION")).toBe(true);
    expect(candidates.some(({ kind }) => kind === "GS_OCRMYPDF_DEEP")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains a growing GS intermediate when the final optimizer makes it smaller", async () => {
    const inputPath = join(directory, "input.pdf");
    await writeFile(inputPath, Buffer.alloc(1_000));
    processMock.gsBytes = 1_200;
    processMock.optimizerBytes = 500;
    const candidates = await buildPreservingImageCandidates({
      inputPath, baseOutputPath: join(directory, "candidate"), options: options(),
      profile: profile({ sourceDpi: 300, predominantImageEncoding: "FLATE", hasSelectableText: true }),
    });
    const optimized = candidates.find(({ kind }) => kind === "GS_OCRMYPDF_DEEP");
    expect(optimized).toBeDefined();
    expect(spawn).toHaveBeenCalledWith("ocrmypdf", expect.arrayContaining([
      join(directory, "candidate.gs-images.pdf"), join(directory, "candidate.deep-opt.pdf"),
    ]), expect.any(Object));
    expect(validateSemanticCandidate).toHaveBeenCalledWith(inputPath, optimized?.path);
  });

  it("does not repeat lossy optimization after a validated strong GS result", async () => {
    const inputPath = join(directory, "input.pdf");
    await writeFile(inputPath, Buffer.alloc(1_000));
    processMock.gsBytes = 500;
    const candidates = await buildPreservingImageCandidates({
      inputPath, baseOutputPath: join(directory, "candidate"), options: options(),
      profile: profile({ sourceDpi: 300, predominantImageEncoding: "FLATE", hasSelectableText: true }),
    });
    expect(candidates.some(({ kind }) => kind === "GS_IMAGE_RECOMPRESSION")).toBe(true);
    expect(vi.mocked(spawn).mock.calls.map(([tool]) => tool)).not.toContain("ocrmypdf");
  });

  it("does not render or extract semantics for a non-reducing candidate", async () => {
    const inputPath = join(directory, "input.pdf");
    await writeFile(inputPath, Buffer.from("%PDF-1.7\n"));
    const candidates = await buildPreservingImageCandidates({
      inputPath, baseOutputPath: join(directory, "candidate"),
      options: options(), profile: profile(),
    });
    expect(candidates).toEqual([]);
    expect(validateSemanticCandidate).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("reports visual integrity rejection instead of treating it as optimized input", async () => {
    const inputPath = join(directory, "input.pdf");
    await writeFile(inputPath, Buffer.alloc(1_000));
    const { PdfToolError } = await import("./compression-types");
    vi.mocked(validateSemanticCandidate).mockRejectedValueOnce(
      new PdfToolError("PDF_VISUAL_INTEGRITY_FAILED", "Visual content missing"),
    );
    const onIntegrityRejection = vi.fn();
    await buildPreservingImageCandidates({
      inputPath, baseOutputPath: join(directory, "candidate"),
      options: options(), profile: profile(), onIntegrityRejection,
    });
    expect(onIntegrityRejection).toHaveBeenCalledOnce();
  });

  it("creates a structural image candidate when qpdf succeeds", async () => {
    const inputPath = join(directory, "input.pdf");
    await writeFile(inputPath, Buffer.from("%PDF-1.7\ninput"));

    const candidates = await buildPreservingImageCandidates({
      inputPath,
      baseOutputPath: join(directory, "candidate"),
      options: options(),
      profile: profile(),
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        kind: "QPDF_IMAGE_OPTIMIZE",
        engine: "qpdf",
        visualTransform: false,
        lossy: true,
        notApplied: [],
      }),
    ]);
  });

  it("writes a monochrome raster candidate and validates its size", async () => {
    const inputPath = join(directory, "input.pdf");
    const outputPath = join(directory, "output.pdf");
    await writeFile(inputPath, Buffer.from("%PDF-1.7\ninput"));

    await expect(
      optimizeMonochromeRasterCandidate({
        inputPath,
        outputPath,
        options: options({ colorMode: "MONOCHROME" }),
      }),
    ).resolves.toBe(true);
    await expect(readFile(outputPath, "utf8")).resolves.toContain("%PDF-1.7");
  });

  it("returns false for unsupported color mode and tool failures", async () => {
    const inputPath = join(directory, "input.pdf");
    const outputPath = join(directory, "output.pdf");
    await writeFile(inputPath, Buffer.from("%PDF-1.7\ninput"));

    await expect(
      optimizeMonochromeRasterCandidate({
        inputPath,
        outputPath,
        options: options(),
      }),
    ).resolves.toBe(false);

    processMock.mode = "error";
    process.env.PDF_COMPRESSION_TOOL_TIMEOUT_MS = "invalid";
    await expect(
      optimizeMonochromeRasterCandidate({
        inputPath,
        outputPath,
        options: options({ colorMode: "MONOCHROME" }),
      }),
    ).resolves.toBe(false);

    processMock.mode = "failure";
    await expect(
      optimizeMonochromeRasterCandidate({
        inputPath,
        outputPath,
        options: options({ colorMode: "MONOCHROME" }),
      }),
    ).resolves.toBe(false);
  });
});
