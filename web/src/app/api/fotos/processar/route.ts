import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import {
  enforceSharedRateLimit,
  getOptionalSession,
  jsonError,
  methodNotAllowed,
  requireContentType,
  requireMaxContentLength,
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
import { recordUserUsage } from "@/lib/usage/record";

export const runtime = "nodejs";

function processingErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "Revise as configurações da foto.",
      zodIssues(error),
    );
  }

  if (error instanceof PhotoProcessingError) {
    return jsonError(400, error.code, error.message);
  }

  Sentry.captureException(error);
  return jsonError(
    500,
    "PHOTO_PROCESSING_FAILED",
    "Não foi possível processar a foto. Tente novamente em instantes.",
  );
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const session = await getOptionalSession();
  const rateLimit = await enforceSharedRateLimit(request, {
    keyPrefix: "photos:single",
    limit: 15,
    windowMs: 60_000,
    dailyLimit: 60,
    authenticated: Boolean(session),
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
      return jsonError(
        400,
        "PHOTO_REQUIRED",
        "Selecione uma foto JPG, PNG ou WEBP para processar.",
      );
    }

    const settings = parsePhotoSettings(formData);
    const crop = parseCropArea(formData);
    const photo = await processPhoto(await readPhotoInput(file), settings, crop);

    if (session) {
      await prisma.auditLog.create({
        data: {
          userId: session.user.id,
          action: "PHOTO_3X4_PROCESSED",
          entity: "Foto3x4",
          metadata: {
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
    }
    await recordUserUsage({
      userId: session?.user.id,
      module: "FOTOS",
      operation: "PROCESSAR_INDIVIDUAL",
      inputBytes: file.size,
      outputBytes: photo.buffer.byteLength,
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
