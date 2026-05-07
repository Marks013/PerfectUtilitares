import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  requireContentType,
  requireMaxContentLength,
  requireModuleAccess,
  requireSameOrigin,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";
import {
  MAX_IMAGE_BYTES,
  PhotoProcessingError,
  processPhoto,
} from "@/lib/photos/processor";
import {
  isUploadedFile,
  parseCropArea,
  parsePhotoSettings,
  readPhotoInput,
  zodIssues,
} from "@/lib/photos/request";

export const runtime = "nodejs";

function processingErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Configurações inválidas",
      zodIssues(error),
    );
  }

  if (error instanceof PhotoProcessingError) {
    return jsonError(400, error.code, error.message);
  }

  Sentry.captureException(error);
  return jsonError(500, "PHOTO_PROCESSING_FAILED", "Falha ao processar foto");
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const guard = await requireModuleAccess("fotos");
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const rateLimit = enforceRateLimit(request, {
    keyPrefix: "photos:single",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimit) {
    return rateLimit;
  }

  const contentType = requireContentType(request, ["multipart/form-data"]);
  if (contentType) {
    return contentType;
  }

  const contentLength = requireMaxContentLength(request, MAX_IMAGE_BYTES + 64_000);
  if (contentLength) {
    return contentLength;
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!isUploadedFile(file)) {
      return jsonError(400, "PHOTO_REQUIRED", "Envie uma foto");
    }

    const settings = parsePhotoSettings(formData);
    const crop = parseCropArea(formData);
    const photo = await processPhoto(await readPhotoInput(file), settings, crop);

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "PHOTO_3X4_PROCESSED",
        entity: "Foto3x4",
        metadata: {
          fileName: file.name,
          output: photo.fileName,
          width: photo.width,
          height: photo.height,
          format: settings.format,
          contrast: settings.contrast,
          brightness: settings.brightness,
          addBorder: settings.addBorder,
          replaceOriginal: settings.replaceOriginal,
          convertToJpg: settings.convertToJpg,
        },
      },
    });

    return new Response(new Uint8Array(photo.buffer), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${photo.fileName}"`,
        "Content-Length": String(photo.buffer.byteLength),
        "Content-Type": photo.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return processingErrorResponse(error);
  }
}
