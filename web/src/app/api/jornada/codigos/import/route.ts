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

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMPORT_EXTENSIONS = [".xlsx", ".csv", ".json"] as const;

function hasAcceptedExtension(fileName: string) {
  const lowerName = fileName.toLowerCase();
  return ACCEPTED_IMPORT_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension),
  );
}

async function parseMultipartRequest(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Envie um arquivo .xlsx, .csv ou .json no campo 'file'.");
  }

  if (!hasAcceptedExtension(file.name)) {
    throw new Error("Formato não suportado. Use .xlsx, .csv ou .json.");
  }

  if (file.size === 0) {
    throw new Error("O arquivo enviado está vazio.");
  }

  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("O arquivo ultrapassa o limite de 8MB.");
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

    const tooLarge = requireMaxContentLength(request, MAX_IMPORT_BYTES);
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
