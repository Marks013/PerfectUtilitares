import { requireEscalaAccess } from "@/lib/escalas/access.server";
import { z } from "zod";
import { enforcePersistentRateLimit, jsonError, methodNotAllowed, requireContentType, requireMaxContentLength, requireSameOrigin } from "@/lib/api/security";
import { readMultipartBody } from "@/lib/api/multipart";
import { branchPermission, requireEscalaPermission } from "@/lib/escalas/access";
import { isAbsenceImportDate, previewFphi105Import } from "@/lib/escalas/fphi105";
import { ESCALA_IMPORT_TEMPLATE, previewEscalaImport } from "@/lib/escalas/import";
import { XlsxSecurityError } from "@/lib/spreadsheets/xlsx-security";
import { escalaFailure, escalaJson } from "../http";

export const runtime = "nodejs";
const options = z.object({ branchCode: z.string().trim().min(1).max(60), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}), defaultWeeklyHours: z.coerce.number().refine((value): value is 40 | 42 | 44 => [40, 42, 44].includes(value)) });

const absenceOptions = z.object({
  branchCode: z.string().trim().min(1).max(60),
  startDate: z.string().refine(isAbsenceImportDate),
  endDate: z.string().refine(isAbsenceImportDate),
  visibleMonth: z.string().regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/).optional(),
  employees: z.array(z.object({ id: z.string().trim().min(1).max(120), registration: z.string().trim().min(1).max(60) }).strict()).min(1).max(250),
}).refine((value) => value.endDate >= value.startDate && Date.parse(value.endDate) - Date.parse(value.startDate) <= 41 * 86_400_000);

export async function GET() {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  try {
    return new Response(`\uFEFF${ESCALA_IMPORT_TEMPLATE}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="modelo-escalas.csv"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" } });
  } catch (error) { return escalaFailure(error); }
}

export async function POST(request: Request) {
  const guard = await requireEscalaAccess();
  if (!guard.ok) return guard.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentError = requireContentType(request, ["multipart/form-data"]) ?? requireMaxContentLength(request, 1024 * 1024);
  if (contentError) return contentError;
  const limited = await enforcePersistentRateLimit(request, { keyPrefix: "escalas-import", limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readMultipartBody(request, 1024 * 1024);
  if (!body.ok) return body.response;
  const purpose = body.data.get("purpose") ?? "EMPLOYEES";
  if (purpose !== "EMPLOYEES" && purpose !== "ABSENCES") return jsonError(400, "ESCALA_IMPORT_OPTIONS", "Selecione uma importação de equipe ou afastamentos.");
  let employees: unknown;
  if (purpose === "ABSENCES") {
    const value = body.data.get("employees");
    if (typeof value !== "string" || value.length > 50_000) return jsonError(400, "ESCALA_ABSENCE_OPTIONS", "Selecione uma equipe válida para conferir os afastamentos.");
    try { employees = JSON.parse(value); } catch { return jsonError(400, "ESCALA_ABSENCE_OPTIONS", "Selecione uma equipe válida para conferir os afastamentos."); }
  }
  const absences = purpose === "ABSENCES" ? absenceOptions.safeParse({ branchCode: body.data.get("branchCode"), startDate: body.data.get("startDate"), endDate: body.data.get("endDate"), visibleMonth: body.data.get("visibleMonth") ?? undefined, employees }) : null;
  if (absences && !absences.success) return jsonError(400, "ESCALA_ABSENCE_OPTIONS", "Informe uma equipe e um período de até 42 dias válidos.");
  const parsed = options.safeParse({ branchCode: body.data.get("branchCode"), startDate: body.data.get("startDate"), defaultWeeklyHours: body.data.get("defaultWeeklyHours") ?? 42 });
  if (!parsed.success && !absences?.success) return jsonError(400, "ESCALA_IMPORT_OPTIONS", "Informe filial, início do período e carga semanal válidos.");
  const file = body.data.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > 512 * 1024) return jsonError(400, "ESCALA_IMPORT_FILE", "Envie um arquivo CSV ou XLSX de até 512 KB.");
  const extension = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : file.name.toLowerCase().endsWith(".csv") ? "csv" : null;
  const mimeTypes = extension === "xlsx" ? ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream", ""] : ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel", "application/octet-stream", ""];
  if (!extension || !mimeTypes.includes(file.type)) return jsonError(415, "ESCALA_IMPORT_TYPE", "O arquivo deve ser CSV ou XLSX, com conteúdo compatível.");
  if (purpose === "ABSENCES" && extension !== "csv") return jsonError(415, "ESCALA_IMPORT_TYPE", "Envie o relatório FPHI105 em CSV.");
  try {
    const actor = guard.actor;
    const branchCode = absences?.success ? absences.data.branchCode : parsed.success ? parsed.data.branchCode : "";
    requireEscalaPermission(await branchPermission(actor, branchCode), "edit");
    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = absences?.success ? previewFphi105Import(buffer, absences.data) : parsed.success ? await previewEscalaImport(buffer, extension, parsed.data) : null;
    return escalaJson({ preview });
  } catch (error) {
    if (error instanceof XlsxSecurityError) return jsonError(400, error.code, error.message);
    if (error instanceof TypeError || error instanceof SyntaxError || (error && typeof error === "object" && "code" in error && String(error.code).startsWith("CSV_"))) return jsonError(400, "ESCALA_IMPORT_CONTENT", "Não foi possível ler o arquivo. Confira o formato e use o modelo de importação.");
    return escalaFailure(error);
  }
}
export function DELETE() { return methodNotAllowed(["GET", "POST"]); }
