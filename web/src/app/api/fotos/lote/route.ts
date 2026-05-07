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
  buildPhotoZip,
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  PhotoProcessingError,
  processPhoto,
  type ProcessedPhoto,
} from "@/lib/photos/processor";
import {
  isUploadedFile,
  parsePhotoSettings,
  readPhotoInput,
  zodIssues,
} from "@/lib/photos/request";

export const runtime = "nodejs";

type BatchError = {
  fileName: string;
  message: string;
};

function batchErrorResponse(error: unknown) {
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
  return jsonError(500, "PHOTO_BATCH_FAILED", "Falha ao processar lote");
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
    keyPrefix: "photos:batch",
    limit: 10,
    windowMs: 60_000,
  });
  if (rateLimit) {
    return rateLimit;
  }

  const contentType = requireContentType(request, ["multipart/form-data"]);
  if (contentType) {
    return contentType;
  }

  const contentLength = requireMaxContentLength(request, MAX_BATCH_BYTES + 96_000);
  if (contentLength) {
    return contentLength;
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter(isUploadedFile);

    if (files.length === 0) {
      return jsonError(400, "PHOTOS_REQUIRED", "Envie ao menos uma foto");
    }

    if (files.length > MAX_BATCH_FILES) {
      return jsonError(
        400,
        "TOO_MANY_FILES",
        `Envie no máximo ${MAX_BATCH_FILES} fotos por lote`,
      );
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_BATCH_BYTES) {
      return jsonError(
        413,
        "BATCH_TOO_LARGE",
        `Lote acima do limite de ${Math.floor(MAX_BATCH_BYTES / 1024 / 1024)}MB`,
      );
    }

    const settings = parsePhotoSettings(formData);
    const processed: ProcessedPhoto[] = [];
    const errors: BatchError[] = [];

    for (const file of files) {
      try {
        processed.push(
          await processPhoto(await readPhotoInput(file), settings, undefined),
        );
      } catch (error) {
        errors.push({
          fileName: file.name,
          message:
            error instanceof Error
              ? error.message
              : "Falha desconhecida ao processar imagem",
        });
      }
    }

    if (processed.length === 0) {
      return jsonError(
        400,
        "NO_VALID_PHOTOS",
        "Nenhuma foto válida foi processada",
        errors,
      );
    }

    const zip = await buildPhotoZip(processed);

    await prisma.auditLog.create({
      data: {
        userId: guard.session.user.id,
        action: "PHOTO_3X4_BATCH_PROCESSED",
        entity: "Foto3x4",
        metadata: {
          total: files.length,
          imported: processed.length,
          errors: errors.length,
          width: settings.width,
          height: settings.height,
          format: settings.format,
          contrast: settings.contrast,
          brightness: settings.brightness,
          addBorder: settings.addBorder,
          replaceOriginal: settings.replaceOriginal,
          convertToJpg: settings.convertToJpg,
        },
      },
    });

    return new Response(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="fotos-3x4.zip"',
        "Content-Length": String(zip.byteLength),
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
        "X-Error-Count": String(errors.length),
        "X-Processed-Count": String(processed.length),
        "X-Total-Count": String(files.length),
      },
    });
  } catch (error) {
    return batchErrorResponse(error);
  }
}
