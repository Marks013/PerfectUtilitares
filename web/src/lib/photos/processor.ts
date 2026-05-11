import JSZip from "jszip";
import sharp from "sharp";
import {
  PHOTO_CONTENT_TYPES,
  type CropArea,
  type PhotoOutputFormat,
  type PhotoSettings,
} from "@/lib/photos/schema";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_BATCH_BYTES = 40 * 1024 * 1024;
export const MAX_BATCH_FILES = 30;

const MAX_INPUT_PIXELS = 48_000_000;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME_OUTPUT_FORMATS: Record<string, PhotoOutputFormat> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};
const OUTPUT_EXTENSIONS: Record<PhotoOutputFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

export type PhotoInput = {
  name: string;
  type: string;
  buffer: Buffer;
};

export type ProcessedPhoto = {
  fileName: string;
  contentType: string;
  buffer: Buffer;
  width: number;
  height: number;
};

export class PhotoProcessingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PhotoProcessingError";
    this.code = code;
  }
}

export function isAcceptedImageType(type: string) {
  return ACCEPTED_IMAGE_TYPES.has(type);
}

function getOriginalExtension(name: string, format: PhotoOutputFormat) {
  const extension = name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  const compatibleExtensions =
    format === "jpeg" ? ["jpg", "jpeg"] : [OUTPUT_EXTENSIONS[format]];

  if (extension && compatibleExtensions.includes(extension)) {
    return extension;
  }

  return OUTPUT_EXTENSIONS[format];
}

function resolvePhotoOutput(input: PhotoInput, settings: PhotoSettings) {
  if (settings.convertToJpg) {
    return { format: "jpeg" as const, extension: "jpg" };
  }

  if (settings.format === "original") {
    const format = MIME_OUTPUT_FORMATS[input.type];
    if (!format) {
      throw new PhotoProcessingError(
        "INVALID_IMAGE_TYPE",
        "Formato de imagem não aceito. Envie uma foto em JPG, PNG ou WEBP.",
      );
    }

    return { format, extension: getOriginalExtension(input.name, format) };
  }

  return {
    format: settings.format,
    extension: OUTPUT_EXTENSIONS[settings.format],
  };
}

export function sanitizePhotoFileName(
  name: string,
  extension: string,
  replaceOriginal = false,
) {
  const base = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const safeBase = base || "foto";
  const safeExtension = extension.replace(/^\./, "");

  return replaceOriginal
    ? `${safeBase}.${safeExtension}`
    : `${safeBase}_editado.${safeExtension}`;
}

function validateInput(input: PhotoInput) {
  if (!isAcceptedImageType(input.type)) {
    throw new PhotoProcessingError(
      "INVALID_IMAGE_TYPE",
      "Formato de imagem não aceito. Envie uma foto em JPG, PNG ou WEBP.",
    );
  }

  if (input.buffer.byteLength === 0) {
    throw new PhotoProcessingError(
      "EMPTY_IMAGE",
      "O arquivo enviado está vazio. Selecione uma foto válida.",
    );
  }

  if (input.buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new PhotoProcessingError(
      "IMAGE_TOO_LARGE",
      `A imagem ultrapassa o limite de ${Math.floor(
        MAX_IMAGE_BYTES / 1024 / 1024,
      )}MB. Reduza o arquivo ou selecione outra foto.`,
    );
  }
}

function clampCrop(crop: CropArea, width: number, height: number) {
  const left = Math.max(0, Math.min(Math.round(crop.x), width - 1));
  const top = Math.max(0, Math.min(Math.round(crop.y), height - 1));
  const cropWidth = Math.max(
    1,
    Math.min(Math.round(crop.width), width - left),
  );
  const cropHeight = Math.max(
    1,
    Math.min(Math.round(crop.height), height - top),
  );

  return { left, top, width: cropWidth, height: cropHeight };
}

async function normalizeInput(input: PhotoInput) {
  try {
    return await sharp(input.buffer, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new PhotoProcessingError(
      "INVALID_IMAGE",
      "Não foi possível ler a imagem. Verifique se o arquivo não está corrompido e está em JPG, PNG ou WEBP.",
    );
  }
}

export async function processPhoto(
  input: PhotoInput,
  settings: PhotoSettings,
  crop?: CropArea,
): Promise<ProcessedPhoto> {
  validateInput(input);
  const output = resolvePhotoOutput(input, settings);

  const normalized = await normalizeInput(input);
  let pipeline = sharp(normalized.data, {
    animated: false,
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  });

  if (crop) {
    pipeline = pipeline.extract(
      clampCrop(crop, normalized.info.width, normalized.info.height),
    );
  }

  pipeline = pipeline.resize(settings.width, settings.height, {
    fit: "cover",
    position: crop ? "center" : sharp.strategy.attention,
    withoutEnlargement: false,
  });

  if (settings.contrast !== 1 || settings.brightness !== 1) {
    pipeline = pipeline.modulate({ brightness: settings.brightness }).linear(
      settings.contrast,
      128 * (1 - settings.contrast),
    );
  }

  if (settings.addBorder) {
    pipeline = pipeline.extend({
      top: settings.borderWidth,
      bottom: settings.borderWidth,
      left: settings.borderWidth,
      right: settings.borderWidth,
      background: settings.borderColor,
    });
  }

  if (output.format === "png") {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else if (output.format === "webp") {
    pipeline = pipeline.webp({ quality: settings.quality });
  } else {
    pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({
      mozjpeg: true,
      quality: settings.quality,
    });
  }

  return {
    fileName: sanitizePhotoFileName(
      input.name,
      output.extension,
      settings.replaceOriginal,
    ),
    contentType: PHOTO_CONTENT_TYPES[output.format],
    buffer: await pipeline.toBuffer(),
    width: settings.addBorder
      ? settings.width + settings.borderWidth * 2
      : settings.width,
    height: settings.addBorder
      ? settings.height + settings.borderWidth * 2
      : settings.height,
  };
}

export async function buildPhotoZip(photos: ProcessedPhoto[]) {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  photos.forEach((photo) => {
    const uniqueName = getUniqueZipName(photo.fileName, usedNames);
    zip.file(uniqueName, photo.buffer);
  });

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function getUniqueZipName(fileName: string, usedNames: Set<string>) {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }

  const extensionMatch = fileName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  const base = extension ? fileName.slice(0, -extension.length) : fileName;
  let suffix = 2;

  while (usedNames.has(`${base}-${suffix}${extension}`)) {
    suffix += 1;
  }

  const uniqueName = `${base}-${suffix}${extension}`;
  usedNames.add(uniqueName);
  return uniqueName;
}
