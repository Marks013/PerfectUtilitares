import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import readXlsxFile from "read-excel-file/node";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { requireUnimedAccess } from "@/lib/unimed/access.server";
import {
  parsePayrollLoanRows,
  UnimedImportValidationError,
  UNIMED_IMPORT_LIMITS,
} from "@/lib/unimed/importer";
import { publishPayrollLoanImport } from "@/lib/unimed/payroll-loan-publisher";
import { UnimedPublishError } from "@/lib/unimed/publisher";
import { unimedCompetencySchema, zodIssueDetails } from "@/lib/unimed/schema";
import {
  UnimedXlsxSecurityError,
  validateUnimedXlsxArchive,
} from "@/lib/unimed/xlsx-security";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = UNIMED_IMPORT_LIMITS.maxFileBytes + 1024 * 1024;
const MAX_PAYROLL_LOAN_ROWS = 25_000;

function isUploadedFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value
  );
}

function publishErrorStatus(code: UnimedPublishError["code"]) {
  if (code === "IMPORT_IN_PROGRESS") return 409;
  if (code === "INVALID_ACTOR") return 403;
  return 422;
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("PUBLISH");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-payroll-loan-import",
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["multipart/form-data"]);
  if (contentTypeError) return contentTypeError;
  const contentLengthError = requireMaxContentLength(
    request,
    MAX_REQUEST_BYTES,
  );
  if (contentLengthError) return contentLengthError;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(
      400,
      "UNIMED_MULTIPART_INVALID",
      "Não foi possível ler o arquivo enviado.",
    );
  }
  const competency = unimedCompetencySchema.safeParse({
    year: Number(formData.get("year")),
    month: Number(formData.get("month")),
  });
  if (!competency.success) {
    return jsonError(
      400,
      "UNIMED_COMPETENCY_INVALID",
      "Informe uma competência válida.",
      zodIssueDetails(competency.error),
    );
  }

  const files = formData.getAll("payrollLoanFile");
  if (files.length !== 1 || !isUploadedFile(files[0]) || files[0].size === 0) {
    return jsonError(
      400,
      "UNIMED_PAYROLL_LOAN_FILE_REQUIRED",
      "Envie uma planilha XLSX de empréstimo consignado.",
    );
  }
  const file = files[0];
  if (
    !file.name.toLowerCase().endsWith(".xlsx") ||
    file.size > UNIMED_IMPORT_LIMITS.maxFileBytes
  ) {
    return jsonError(
      file.size > UNIMED_IMPORT_LIMITS.maxFileBytes ? 413 : 400,
      file.size > UNIMED_IMPORT_LIMITS.maxFileBytes
        ? "UNIMED_PAYROLL_LOAN_TOO_LARGE"
        : "UNIMED_PAYROLL_LOAN_FILE_INVALID",
      "O consignado deve ser um XLSX de até 10 MB.",
    );
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    validateUnimedXlsxArchive(bytes);
    const workbook = await readXlsxFile(bytes);
    const preferred = workbook.find(
      (sheet) => sheet.sheet.trim().toLocaleUpperCase("pt-BR") === "PLANILHA1",
    );
    const compatible = workbook.find(
      (sheet) => sheet.sheet.trim().toLocaleUpperCase("pt-BR") === "GERAL",
    );
    const sheet = preferred ?? compatible;
    if (!sheet) {
      return jsonError(
        400,
        "UNIMED_PAYROLL_LOAN_FILE_INVALID",
        "A planilha deve conter a aba Planilha1 ou uma aba GERAL completa.",
      );
    }
    if (sheet.data.length > MAX_PAYROLL_LOAN_ROWS) {
      return jsonError(
        413,
        "UNIMED_PAYROLL_LOAN_TOO_LARGE",
        "A planilha de consignado excede o limite seguro de linhas.",
      );
    }
    const loans = parsePayrollLoanRows(
      file.name,
      sheet.sheet,
      sheet.data,
      competency.data,
    );
    if (loans.rejectedCount > 0) {
      return jsonError(
        400,
        "UNIMED_PAYROLL_LOAN_FILE_INVALID",
        `${loans.rejectedCount} linha(s) do consignado precisam de correção.`,
        loans.diagnostics.slice(0, 25),
      );
    }
    const published = await publishPayrollLoanImport({
      tenantId: access.tenantId,
      moduleSessionId: access.moduleSessionId,
      year: competency.data.year,
      month: competency.data.month,
      loans,
    });
    const response = NextResponse.json(
      { import: published },
      { status: published.idempotent ? 200 : 201 },
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof UnimedXlsxSecurityError) {
      return jsonError(400, error.code, error.message);
    }
    if (error instanceof UnimedImportValidationError) {
      return jsonError(400, error.code, error.message);
    }
    if (error instanceof UnimedPublishError) {
      return jsonError(
        publishErrorStatus(error.code),
        error.code,
        error.message,
      );
    }
    const correlationId = crypto.randomUUID();
    console.error("Unexpected Unimed payroll loan import failure", {
      correlationId,
      errorType: error instanceof Error ? error.name : "UnknownError",
      databaseCode:
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : undefined,
    });
    return jsonError(
      503,
      "UNIMED_PAYROLL_LOAN_IMPORT_FAILED",
      `Não foi possível importar o consignado. Código: ${correlationId}`,
    );
  }
}
