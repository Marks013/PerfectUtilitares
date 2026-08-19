import { z } from "zod";
import { PDF_COMPRESSION_PRESETS } from "./compression-policy";
import { NO_PDF_COMPRESSION_OVERRIDES } from "./compression-types";
// PERFECT_PDF_FULL32_V2_2

const pdfOperationSchema = z.enum([
  "COMPRESS",
  "MERGE",
  "SPLIT",
  "ROTATE",
  "DELETE_PAGES",
  "EXTRACT_PAGES",
  "ORGANIZE",
  "EDIT",
  "ANNOTATE",
  "CROP",
  "PDF_TO_JPG",
  "JPG_TO_PDF",
  "WORD_TO_PDF",
  "EXCEL_TO_PDF",
]);

export const pdfJobCreateSchema = z.object({
  operation: pdfOperationSchema,
  options: z.record(z.string(), z.unknown()).optional(),
});

export const pdfCompressionOptionsSchema = z
  .object({
    quality: z
      .enum(["SOURCE", "CUSTOM", "SCREEN", "BALANCED", "PRINT"])
      .default("BALANCED"),
    method: z.enum(["AUTO", "LOSSLESS", "RASTER"]).optional(),
    dpi: z.number().int().min(72).max(300).optional(),
    colorMode: z
      .enum(["KEEP_DETECTED", "COLOR", "GRAYSCALE", "MONOCHROME"])
      .optional(),
    imageQuality: z.number().int().min(35).max(95).optional(),
    monochromeThreshold: z.number().int().min(64).max(224).optional(),
    userOverrides: z
      .object({
        method: z.boolean().default(false),
        dpi: z.boolean().default(false),
        colorMode: z.boolean().default(false),
        imageQuality: z.boolean().default(false),
        monochromeThreshold: z.boolean().default(false),
      })
      .optional(),
    preserveTextLayer: z.boolean().default(true),
    allowSemanticLoss: z.boolean().default(false),
    sourceRevision: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((options, context) => {
    if (options.quality !== "SOURCE" && options.quality !== "CUSTOM") return;
    const requiredFields = [
      "method",
      "dpi",
      "colorMode",
      "imageQuality",
      "monochromeThreshold",
    ] as const;
    for (const field of requiredFields) {
      if (options[field] === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Informe a configuração calculada para o documento.",
        });
      }
    }
  })
  .transform((options) => {
    const preset =
      options.quality === "SCREEN" ||
      options.quality === "BALANCED" ||
      options.quality === "PRINT"
        ? PDF_COMPRESSION_PRESETS[options.quality]
        : PDF_COMPRESSION_PRESETS.BALANCED;
    return {
      quality: options.quality,
      method: options.method ?? preset.method,
      dpi: options.dpi ?? preset.dpi,
      colorMode: options.colorMode ?? preset.colorMode,
      imageQuality: options.imageQuality ?? preset.imageQuality,
      monochromeThreshold:
        options.monochromeThreshold ?? preset.monochromeThreshold,
      userOverrides: {
        ...NO_PDF_COMPRESSION_OVERRIDES,
        ...(options.userOverrides ?? {}),
      },
      preserveTextLayer: options.preserveTextLayer,
      allowSemanticLoss: options.allowSemanticLoss,
      sourceRevision: options.sourceRevision,
    };
  });

export const pdfToJpgOptionsSchema = z.object({
  dpi: z.number().int().min(96).max(300).default(150),
  quality: z.number().int().min(40).max(100).default(82),
});

export const jpgToPdfOptionsSchema = z.object({
  margin: z.number().int().min(0).max(72).default(24),
  pageSize: z.enum(["A4", "IMAGE"]).default("A4"),
});

const pdfCropSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});

const pdfPageInstructionSchema = z.object({
  id: z.string().min(1).max(100),
  artifactId: z.string().min(8).max(64),
  sourcePage: z.number().int().min(1).max(10_000),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
  crop: pdfCropSchema.optional(),
});

export const pdfManifestSchema = z.object({
  version: z.literal(1),
  pages: z.array(pdfPageInstructionSchema).min(1).max(1_000),
});

const normalizedCoordinateSchema = z.number().min(0).max(1);
const annotationColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Use uma cor hexadecimal válida.");

const pdfAnnotationBaseSchema = z.object({
  id: z.string().min(1).max(100),
  pageId: z.string().min(1).max(100),
  color: annotationColorSchema,
});

const pdfTextAnnotationSchema = pdfAnnotationBaseSchema.extend({
  type: z.literal("TEXT"),
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema,
  text: z.string().trim().min(1).max(2_000),
  fontSize: z.number().min(8).max(96),
});

const pdfAreaAnnotationSchema = pdfAnnotationBaseSchema
  .extend({
    type: z.enum(["HIGHLIGHT", "RECTANGLE"]),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    opacity: z.number().min(0.05).max(1),
  })
  .refine((annotation) => annotation.x + annotation.width <= 1, {
    message: "A marcação ultrapassa a largura da página.",
    path: ["width"],
  })
  .refine((annotation) => annotation.y + annotation.height <= 1, {
    message: "A marcação ultrapassa a altura da página.",
    path: ["height"],
  });

const pdfDrawAnnotationSchema = pdfAnnotationBaseSchema.extend({
  type: z.literal("DRAW"),
  points: z
    .array(
      z.object({
        x: normalizedCoordinateSchema,
        y: normalizedCoordinateSchema,
      }),
    )
    .min(2)
    .max(2_000),
  width: z.number().min(1).max(24),
  opacity: z.number().min(0.05).max(1),
});

const pdfAnnotationSchema = z.union([
  pdfTextAnnotationSchema,
  pdfAreaAnnotationSchema,
  pdfDrawAnnotationSchema,
]);

export const pdfAnnotationsSchema = z.array(pdfAnnotationSchema).max(5_000);

export const pdfJobUpdateSchema = z.object({
  manifest: pdfManifestSchema,
  annotations: pdfAnnotationsSchema.default([]),
});

export type PdfManifest = z.infer<typeof pdfManifestSchema>;
export type PdfAnnotation = z.infer<typeof pdfAnnotationSchema>;
