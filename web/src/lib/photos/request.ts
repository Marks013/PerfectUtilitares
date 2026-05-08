import { z } from "zod";
import {
  PHOTO_DEFAULTS,
  cropAreaSchema,
  photoSettingsSchema,
  type CropArea,
  type PhotoSettings,
} from "@/lib/photos/schema";
import { PhotoProcessingError, type PhotoInput } from "@/lib/photos/processor";

export function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  );
}

export function parsePhotoSettings(formData: FormData): PhotoSettings {
  const parsed = photoSettingsSchema.parse({
    quality: formData.get("quality") ?? undefined,
    format: formData.get("format") ?? undefined,
    contrast: formData.get("contrast") ?? undefined,
    brightness: formData.get("brightness") ?? undefined,
    addBorder: formData.get("addBorder") ?? undefined,
    borderWidth: formData.get("borderWidth") ?? undefined,
    borderColor: formData.get("borderColor") ?? undefined,
  });

  return {
    ...parsed,
    width: PHOTO_DEFAULTS.width,
    height: PHOTO_DEFAULTS.height,
    replaceOriginal: true,
    convertToJpg: false,
  };
}

export function parseCropArea(formData: FormData): CropArea | undefined {
  const rawCrop = formData.get("crop");

  if (typeof rawCrop !== "string" || rawCrop.trim().length === 0) {
    return undefined;
  }

  try {
    return cropAreaSchema.parse(JSON.parse(rawCrop));
  } catch {
    throw new PhotoProcessingError("INVALID_CROP", "Área de corte inválida");
  }
}

export async function readPhotoInput(file: File): Promise<PhotoInput> {
  return {
    name: file.name,
    type: file.type,
    buffer: Buffer.from(await file.arrayBuffer()),
  };
}

export function zodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
