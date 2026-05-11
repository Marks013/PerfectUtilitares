import { z } from "zod";

export const PHOTO_DEFAULTS = {
  width: 354,
  height: 472,
  quality: 92,
  format: "jpeg",
  contrast: 1,
  brightness: 1,
  addBorder: false,
  borderWidth: 5,
  borderColor: "black",
  replaceOriginal: true,
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
  width: z.coerce
    .number()
    .int("A largura precisa ser um número inteiro.")
    .min(100, "A largura mínima é 100px.")
    .max(2400, "A largura máxima é 2400px.")
    .default(PHOTO_DEFAULTS.width),
  height: z.coerce
    .number()
    .int("A altura precisa ser um número inteiro.")
    .min(100, "A altura mínima é 100px.")
    .max(2400, "A altura máxima é 2400px.")
    .default(PHOTO_DEFAULTS.height),
  quality: z.coerce
    .number()
    .int("A qualidade precisa ser um número inteiro.")
    .min(40, "A qualidade mínima é 40.")
    .max(100, "A qualidade máxima é 100.")
    .default(PHOTO_DEFAULTS.quality),
  format: photoFormatSchema.default(PHOTO_DEFAULTS.format),
  contrast: z.coerce
    .number()
    .min(0.1, "O contraste mínimo é 0.1.")
    .max(3, "O contraste máximo é 3.")
    .default(PHOTO_DEFAULTS.contrast),
  brightness: z.coerce
    .number()
    .min(0.1, "O brilho mínimo é 0.1.")
    .max(3, "O brilho máximo é 3.")
    .default(PHOTO_DEFAULTS.brightness),
  addBorder: booleanishSchema.default(PHOTO_DEFAULTS.addBorder),
  borderWidth: z.coerce
    .number()
    .int("A espessura da borda precisa ser um número inteiro.")
    .min(1, "A borda mínima é 1px.")
    .max(80, "A borda máxima é 80px.")
    .default(PHOTO_DEFAULTS.borderWidth),
  borderColor: photoBorderColorSchema.default(PHOTO_DEFAULTS.borderColor),
  replaceOriginal: booleanishSchema.default(PHOTO_DEFAULTS.replaceOriginal),
  convertToJpg: booleanishSchema.default(PHOTO_DEFAULTS.convertToJpg),
});

export const cropAreaSchema = z.object({
  x: z
    .number()
    .finite("A posição X do recorte é inválida.")
    .min(0, "A posição X do recorte não pode ser negativa."),
  y: z
    .number()
    .finite("A posição Y do recorte é inválida.")
    .min(0, "A posição Y do recorte não pode ser negativa."),
  width: z
    .number()
    .finite("A largura do recorte é inválida.")
    .positive("A largura do recorte deve ser maior que zero."),
  height: z
    .number()
    .finite("A altura do recorte é inválida.")
    .positive("A altura do recorte deve ser maior que zero."),
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
