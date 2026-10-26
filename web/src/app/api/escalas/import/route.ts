import { z } from "zod";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed, requireContentType, requireMaxContentLength, requireSameOrigin, requireSession } from "@/lib/api/security";
import { readMultipartBody } from "@/lib/api/multipart";
import { branchPermission, escalaActor, requireEscalaPermission } from "@/lib/escalas/access";
import { ESCALA_IMPORT_TEMPLATE, previewEscalaImport } from "@/lib/escalas/import";
import { XlsxSecurityError } from "@/lib/spreadsheets/xlsx-security";
import { escalaFailure, escalaJson } from "../http";

export const runtime = "nodejs";
const options = z.object({ branchCode: z.string().trim().min(1).max(60), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}), defaultWeeklyHours: z.coerce.number().refine((value): value is 40 | 42 | 44 => [40, 42, 44].includes(value)) });

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  try {
    escalaActor(guard.session);
    return new Response(`\uFEFF${ESCALA_IMPORT_TEMPLATE}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="modelo-escalas.csv"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" } });
  } catch (error) { return escalaFailure(error); }
}

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentError = requireContentType(request, ["multipart/form-data"]) ?? requireMaxContentLength(request, 1024 * 1024);
  if (contentError) return contentError;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-import", limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readMultipartBody(request, 1024 * 1024);
  if (!body.ok) return body.response;
  const parsed = options.safeParse({ branchCode: body.data.get("branchCode"), startDate: body.data.get("startDate"), defaultWeeklyHours: body.data.get("defaultWeeklyHours") ?? 42 });
  if (!parsed.success) return jsonError(400, "ESCALA_IMPORT_OPTIONS", "Informe filial, início do período e carga semanal válidos.");
  const file = body.data.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 512 * 1024) return jsonError(400, "ESCALA_IMPORT_FILE", "Envie um arquivo CSV ou XLSX de até 512 KB.");
  const extension = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : file.name.toLowerCase().endsWith(".csv") ? "csv" : null;
  const mimeTypes = extension === "xlsx" ? ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", ""] : ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel", "application/octet-stream", ""];
  if (!extension || !mimeTypes.includes(file.type)) return jsonError(415, "ESCALA_IMPORT_TYPE", "O arquivo deve ser CSV ou XLSX, com conteúdo compatível.");
  try {
    const actor = escalaActor(guard.session);
    requireEscalaPermission(await branchPermission(actor, parsed.data.branchCode), "edit");
    const preview = await previewEscalaImport(Buffer.from(await file.arrayBuffer()), extension, parsed.data);
    return escalaJson({ preview });
  } catch (error) {
    if (error instanceof XlsxSecurityError) return jsonError(400, error.code, error.message);
    if (error instanceof TypeError || error instanceof SyntaxError || (error && typeof error === "object" && "code" in error && String(error.code).startsWith("CSV_"))) return jsonError(400, "ESCALA_IMPORT_CONTENT", "Não foi possível ler o arquivo. Confira o formato e use o modelo de importação.");
    return escalaFailure(error);
  }
}
export function DELETE() { return methodNotAllowed(["GET", "POST"]); }
