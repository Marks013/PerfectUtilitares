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
  mode: "success" as "success" | "error" | "failure",
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
        kill: vi.fn(),
        stderr: {
          setEncoding: vi.fn(),
          on: vi.fn(),
        },
        once: vi.fn((event: string, listener: (...values: never[]) => void) => {
          listeners.set(event, listener);
          if (event === "close") {
            queueMicrotask(() => {
              if (processMock.mode === "error") {
                listeners.get("error")?.(
                  Object.assign(new Error("missing"), { code: "ENOENT" }) as never,
                );
                return;
              }
              if (processMock.mode === "success") {
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
                  if (output) writeFileSync(output, Buffer.from("%PDF-1.7\n"));
                }
              }
              listener((processMock.mode === "success" ? 0 : 1) as never);
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
  processMock.mode = "success";
  vi.mocked(spawn).mockClear();
  vi.mocked(validateSemanticCandidate).mockReset().mockResolvedValue(undefined);
  delete process.env.PDF_COMPRESSION_DEEP_OPTIMIZATION;
  delete process.env.PDF_COMPRESSION_TOOL_TIMEOUT_MS;
});

afterEach(async () => {
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
