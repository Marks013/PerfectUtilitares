import { NextResponse } from "next/server";
import { readMultipartBody } from "@/lib/api/multipart";
import { requireResourceCapacity } from "@/lib/api/resource-capacity";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireAdmin,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { type CodigoImportParseResult, parseCodigoImportBuffer, parseCodigoJson } from "@/lib/codigos/importer";
import { persistCodigoImport } from "@/lib/codigos/repository";
import { prisma } from "@/lib/prisma";
import { getRequestContentLength } from "@/lib/system/resource-capacity";

export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMPORT_EXTENSIONS = [".xlsx", ".csv", ".json"] as const;

type ImportInput =
  | { ok: true; parse: () => Promise<CodigoImportParseResult> }
  | { ok: false; response: NextResponse };

async function readImportInput(request: Request, isJson: boolean): Promise<ImportInput> {
  if (isJson) {
    const body = await readJsonBody(request);
    if (!body.ok) return body;
    return { ok: true, parse: async () => parseCodigoJson(body.data) };
  }

  const body = await readMultipartBody(request, MAX_IMPORT_BYTES);
  if (!body.ok) return body;
  const file = body.data.get("file");

  if (!(file instanceof File)) {
    return { ok: false, response: jsonError(400, "CODIGO_IMPORT_FAILED", "Envie um arquivo .xlsx, .csv ou .json no campo 'file'.") };
  }

  const fileName = file.name.toLowerCase();
  if (!ACCEPTED_IMPORT_EXTENSIONS.some((extension) => fileName.endsWith(extension))) {
    return { ok: false, response: jsonError(400, "CODIGO_IMPORT_FAILED", "Formato não suportado. Use .xlsx, .csv ou .json.") };
  }
  if (file.size === 0) {
    return { ok: false, response: jsonError(400, "CODIGO_IMPORT_FAILED", "O arquivo enviado está vazio.") };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, response: jsonError(413, "PAYLOAD_TOO_LARGE", "O arquivo ultrapassa o limite de 8MB.") };
  }

  return {
    ok: true,
    parse: async () => parseCodigoImportBuffer(Buffer.from(await file.arrayBuffer()), file.name),
  };
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

    const limited = await enforcePersistentRateLimit(request, {
      keyPrefix: "codigos-import",
      limit: 12,
      windowMs: 60_000,
    });
    if (limited) {
      return limited;
    }

    const contentTypeError = requireContentType(request, [
      "application/json",
      "multipart/form-data",
    ]);
    if (contentTypeError) return contentTypeError;

    const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const isJson = mediaType === "application/json";
    const tooLarge = requireMaxContentLength(request, MAX_IMPORT_BYTES);
    if (tooLarge) return tooLarge;

    const capacityError = await requireResourceCapacity({
      inputBytes: getRequestContentLength(request) || MAX_IMPORT_BYTES,
      multiplier: 2,
    });
    if (capacityError) return capacityError;

    const input = await readImportInput(request, isJson);
    if (!input.ok) return input.response;

    let parsed: CodigoImportParseResult;
    try {
      parsed = await input.parse();
    } catch {
      return jsonError(400, "CODIGO_IMPORT_FAILED", "Não foi possível ler os códigos. Confira o formato e o conteúdo e tente novamente.");
    }

    const result = await persistCodigoImport(prisma, parsed);

    return NextResponse.json({
      totalLido: result.totalLido,
      importados: result.importados,
      ignorados: result.ignorados,
      erros: result.erros,
    });
  } catch {
    return jsonError(
      500,
      "CODIGO_IMPORT_FAILED",
      "Não foi possível concluir a importação. Tente novamente mais tarde.",
    );
  }
}
