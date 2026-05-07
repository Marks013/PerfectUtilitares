import { NextResponse } from "next/server";
import { parseCodigoImportBuffer, parseCodigoJson } from "@/lib/codigos/importer";
import { persistCodigoImport } from "@/lib/codigos/repository";
import {
  enforceRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireAdmin,
  requireSameOrigin,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function parseMultipartRequest(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Envie um arquivo no campo 'file'");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return parseCodigoImportBuffer(buffer, file.name);
}

async function parseJsonRequest(request: Request) {
  const json = await readJsonBody(request);
  if (!json.ok) {
    throw new Error("JSON inválido");
  }

  return parseCodigoJson(json.data);
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  try {
    const guard = await requireAdmin();
  if (!guard.ok) {
    return guard.response;
  }

  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const limited = enforceRateLimit(request, {
      keyPrefix: "codigos-import",
      limit: 12,
      windowMs: 60_000,
    });
    if (limited) {
      return limited;
    }

    const tooLarge = requireMaxContentLength(request, 8 * 1024 * 1024);
    if (tooLarge) {
      return tooLarge;
    }

    const contentType = request.headers.get("content-type") ?? "";
    const contentTypeError = requireContentType(request, [
      "application/json",
      "multipart/form-data",
    ]);
    if (contentTypeError) {
      return contentTypeError;
    }

    const parsed = contentType.includes("application/json")
      ? await parseJsonRequest(request)
      : await parseMultipartRequest(request);

    const result = await persistCodigoImport(prisma, parsed);

    return NextResponse.json({
      totalLido: result.totalLido,
      importados: result.importados,
      ignorados: result.ignorados,
      erros: result.erros,
    });
  } catch (error) {
    return jsonError(
      400,
      "CODIGO_IMPORT_FAILED",
      error instanceof Error
        ? error.message
        : "Erro inesperado ao importar códigos",
    );
  }
}
