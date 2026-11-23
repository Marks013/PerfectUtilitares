import { readMultipartBody } from "@/lib/api/multipart";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed, readJsonBody, requireContentType, requireMaxContentLength, requireSameOrigin } from "@/lib/api/security";
import { requireEscalaCapability } from "@/lib/escalas/access";
import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { editEscalaWorkforce, importEscalaWorkforce, readEscalaWorkforceBranch } from "@/lib/escalas/global-workforce-service";
import { isImportSyncFileSizeAllowed } from "@/lib/escalas/import-sync-contracts";
import { escalaFailure, escalaJson } from "../http";

export const runtime = "nodejs";
const maxUploadBytes = 1024 * 1024;
const csvMime = new Set(["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel", "application/octet-stream", ""]);

export async function GET(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const query = new URL(request.url).searchParams.getAll("branchCode");
  if (query.length !== 1) return jsonError(400, "ESCALA_WORKFORCE_INVALID_BRANCH", "Informe exatamente uma filial.");
  try { return escalaJson(await readEscalaWorkforceBranch(guard.actor, query[0])); }
  catch (error) { return escalaFailure(error); }
}

async function readImport(request: Request) {
  const body = await readMultipartBody(request, maxUploadBytes);
  if (!body.ok) return body;
  const fields = [...body.data.keys()];
  const command = body.data.get("command"), file = body.data.get("file");
  if (fields.length !== 2 || !fields.includes("command") || !fields.includes("file") ||
    typeof command !== "string" || command.length > 48 * 1024) {
    return { ok: false as const, response: jsonError(400, "ESCALA_IMPORT_OPTIONS", "Envie somente um comando válido e um arquivo.") };
  }
  if (!(file instanceof File) || !isImportSyncFileSizeAllowed(file.size)) {
    return { ok: false as const, response: jsonError(400, "ESCALA_IMPORT_FILE", "Envie um CSV de até 512 KB.") };
  }
  if (!file.name.toLowerCase().endsWith(".csv") || !csvMime.has(file.type)) {
    return { ok: false as const, response: jsonError(415, "ESCALA_IMPORT_TYPE", "Envie o relatório em CSV.") };
  }
  let metadata: unknown;
  try { metadata = JSON.parse(command); }
  catch { return { ok: false as const, response: jsonError(400, "ESCALA_IMPORT_OPTIONS", "Não foi possível ler o comando.") }; }
  return { ok: true as const, data: { metadata, buffer: Buffer.from(await file.arrayBuffer()) } };
}

export async function POST(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentError = requireContentType(request, ["application/json", "multipart/form-data"]);
  if (contentError) return contentError;
  const upload = request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data");
  const sizeError = requireMaxContentLength(request, upload ? maxUploadBytes : 16 * 1024);
  if (sizeError) return sizeError;
  try {
    if (!upload) {
      const body = await readJsonBody(request);
      return body.ok ? escalaJson(await editEscalaWorkforce(guard.actor, body.data)) : body.response;
    }
    if (!guard.actor.admin) return jsonError(403, "ESCALA_ACTION_FORBIDDEN", "Somente administradores podem importar para a base global.");
    await requireEscalaCapability(guard.actor, "import.manage");
    const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-workforce-import", limit: 10, windowMs: 60_000 });
    if (limited) return limited;
    const body = await readImport(request);
    return body.ok ? escalaJson(await importEscalaWorkforce(guard.actor, body.data.metadata, body.data.buffer)) : body.response;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("CSV_")) {
      return jsonError(400, "ESCALA_IMPORT_CONTENT", "Não foi possível ler o CSV. Confira o relatório exportado.");
    }
    return escalaFailure(error);
  }
}

export function DELETE() { return methodNotAllowed(["GET", "POST"]); }
