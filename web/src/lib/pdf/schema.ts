import { z } from "zod";

export const pdfOperationSchema = z.enum([
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
  "PDF_TO_WORD",
  "PDF_TO_EXCEL",
  "WORD_TO_PDF",
  "EXCEL_TO_PDF",
]);

export const pdfJobCreateSchema = z.object({
  operation: pdfOperationSchema,
  options: z.record(z.string(), z.unknown()).optional(),
});

export const pdfCompressionOptionsSchema = z.object({
  quality: z.enum(["SCREEN", "BALANCED", "PRINT"]).default("BALANCED"),
});

export const pdfToJpgOptionsSchema = z.object({
  dpi: z.number().int().min(96).max(300).default(150),
  quality: z.number().int().min(40).max(100).default(82),
});

export const jpgToPdfOptionsSchema = z.object({
  margin: z.number().int().min(0).max(72).default(24),
  pageSize: z.enum(["A4", "IMAGE"]).default("A4"),
});

export const pdfCropSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const pdfPageInstructionSchema = z.object({
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

export const pdfTextAnnotationSchema = pdfAnnotationBaseSchema.extend({
  type: z.literal("TEXT"),
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema,
  text: z.string().trim().min(1).max(2_000),
  fontSize: z.number().min(8).max(96),
});

export const pdfAreaAnnotationSchema = pdfAnnotationBaseSchema
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

export const pdfDrawAnnotationSchema = pdfAnnotationBaseSchema.extend({
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

export const pdfAnnotationSchema = z.union([
  pdfTextAnnotationSchema,
  pdfAreaAnnotationSchema,
  pdfDrawAnnotationSchema,
]);

export const pdfAnnotationsSchema = z.array(pdfAnnotationSchema).max(5_000);

export const pdfJobUpdateSchema = z.object({
  manifest: pdfManifestSchema,
  annotations: pdfAnnotationsSchema.default([]),
});

export type PdfOperationValue = z.infer<typeof pdfOperationSchema>;
export type PdfManifest = z.infer<typeof pdfManifestSchema>;
export type PdfAnnotation = z.infer<typeof pdfAnnotationSchema>;
