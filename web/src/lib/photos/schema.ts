import { z } from "zod";

export const PHOTO_DEFAULTS = {
  width: 354,
  height: 472,
  quality: 92,
  format: "original",
  contrast: 1,
  brightness: 1,
  addBorder: false,
  borderWidth: 5,
  borderColor: "black",
  replaceOriginal: false,
  convertToJpg: false,
} as const;

export const photoOutputFormatSchema = z.enum(["jpeg", "png", "webp"]);
export const photoFormatSchema = z.enum(["original", "jpeg", "png", "webp"]);
export const photoBorderColorSchema = z.enum(["black", "white"]);

const booleanishSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const photoSettingsSchema = z.object({
  width: z.coerce.number().int().min(100).max(2400).default(PHOTO_DEFAULTS.width),
  height: z.coerce
    .number()
    .int()
    .min(100)
    .max(2400)
    .default(PHOTO_DEFAULTS.height),
  quality: z.coerce.number().int().min(40).max(100).default(PHOTO_DEFAULTS.quality),
  format: photoFormatSchema.default(PHOTO_DEFAULTS.format),
  contrast: z.coerce.number().min(0.1).max(3).default(PHOTO_DEFAULTS.contrast),
  brightness: z.coerce
    .number()
    .min(0.1)
    .max(3)
    .default(PHOTO_DEFAULTS.brightness),
  addBorder: booleanishSchema.default(PHOTO_DEFAULTS.addBorder),
  borderWidth: z.coerce
    .number()
    .int()
    .min(1)
    .max(80)
    .default(PHOTO_DEFAULTS.borderWidth),
  borderColor: photoBorderColorSchema.default(PHOTO_DEFAULTS.borderColor),
  replaceOriginal: booleanishSchema.default(PHOTO_DEFAULTS.replaceOriginal),
  convertToJpg: booleanishSchema.default(PHOTO_DEFAULTS.convertToJpg),
});

export const cropAreaSchema = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export type PhotoFormat = z.infer<typeof photoFormatSchema>;
export type PhotoOutputFormat = z.infer<typeof photoOutputFormatSchema>;
export type PhotoSettingsInput = z.input<typeof photoSettingsSchema>;
export type PhotoSettings = z.infer<typeof photoSettingsSchema>;
export type CropArea = z.infer<typeof cropAreaSchema>;

export const PHOTO_CONTENT_TYPES: Record<PhotoOutputFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
