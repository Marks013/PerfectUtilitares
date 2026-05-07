import { z } from "zod";
import {
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
  return photoSettingsSchema.parse({
    width: formData.get("width") ?? undefined,
    height: formData.get("height") ?? undefined,
    quality: formData.get("quality") ?? undefined,
    format: formData.get("format") ?? undefined,
    contrast: formData.get("contrast") ?? undefined,
    brightness: formData.get("brightness") ?? undefined,
    addBorder: formData.get("addBorder") ?? undefined,
    borderWidth: formData.get("borderWidth") ?? undefined,
    borderColor: formData.get("borderColor") ?? undefined,
    replaceOriginal: formData.get("replaceOriginal") ?? undefined,
    convertToJpg: formData.get("convertToJpg") ?? undefined,
  });
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
