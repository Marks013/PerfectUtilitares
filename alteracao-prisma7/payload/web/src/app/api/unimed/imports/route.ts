import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
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
  parseAddressRows,
  parseBeneficiaryCsvFiles,
  parseInvoiceCsvFiles,
  UnimedImportValidationError,
  UNIMED_IMPORT_LIMITS,
  type UnimedImportFile,
} from "@/lib/unimed/importer";
import {
  publishUnimedImport,
  UnimedPublishError,
} from "@/lib/unimed/publisher";
import { unimedCompetencySchema, zodIssueDetails } from "@/lib/unimed/schema";
import {
  UnimedXlsxSecurityError,
  validateUnimedXlsxArchive,
} from "@/lib/unimed/xlsx-security";

export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES =
  UNIMED_IMPORT_LIMITS.maxTotalBytes + MAX_MULTIPART_OVERHEAD_BYTES;
const MAX_ADDRESS_ROWS = 100_000;

async function readAddressWorkbook(bytes: Buffer, fileName: string) {
  try {
    validateUnimedXlsxArchive(bytes);
    return await readXlsxFile(bytes);
  } catch (error) {
    if (error instanceof UnimedXlsxSecurityError) {
      throw new UnimedImportValidationError(
        "UNIMED_ADDRESS_FILE_INVALID",
        error.message,
      );
    }
    throw new UnimedImportValidationError(
      "UNIMED_ADDRESS_FILE_INVALID",
      `Base de endereços: a planilha ${fileName} não pôde ser lida como XLSX.`,
    );
  }
}
const MAX_PARSED_ROWS = 250_000;

function isUploadedFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  );
}

function optionalFiles(entries: FormDataEntryValue[]): File[] | null {
  if (entries.some((entry) => !isUploadedFile(entry) || entry.size === 0)) {
    return null;
  }

  return entries as File[];
}

function publishErrorStatus(code: UnimedPublishError["code"]) {
  if (code === "IMPORT_IN_PROGRESS") return 409;
  if (code === "INVALID_ACTOR") return 403;
  return 422;
}

function publishErrorMessage(code: UnimedPublishError["code"]) {
  switch (code) {
    case "IMPORT_IN_PROGRESS":
      return "Este conjunto de arquivos já está sendo processado.";
    case "INVALID_ACTOR":
      return "Seu acesso não permite publicar esta importação.";
    case "MISSING_BRANCH":
      return "A importação possui registros sem uma loja válida.";
    default:
      return "A importação contém registros inválidos e não foi publicada.";
  }
}

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const access = await requireUnimedAccess("PUBLISH");
  if (!access.ok) {
    return access.response;
  }

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-import-publish",
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  const contentTypeError = requireContentType(request, ["multipart/form-data"]);
  if (contentTypeError) {
    return contentTypeError;
  }

  const contentLengthError = requireMaxContentLength(
    request,
    MAX_REQUEST_BYTES,
  );
  if (contentLengthError) {
    return contentLengthError;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(
      400,
      "UNIMED_MULTIPART_INVALID",
      "Não foi possível ler os arquivos enviados.",
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

  const beneficiaryFiles = optionalFiles(formData.getAll("beneficiaryFiles"));
  const invoiceFiles = optionalFiles(formData.getAll("invoiceFiles"));
  const addressEntries = formData.getAll("addressFile");
  if (
    !beneficiaryFiles ||
    !invoiceFiles ||
    addressEntries.length > 1 ||
    addressEntries.some(
      (entry) => !isUploadedFile(entry) || entry.size === 0,
    ) ||
    (beneficiaryFiles.length === 0 &&
      invoiceFiles.length === 0 &&
      addressEntries.length === 0)
  ) {
    return jsonError(
      400,
      "UNIMED_FILES_REQUIRED",
      "Envie ao menos uma fonte válida: beneficiários, faturas ou endereços.",
    );
  }

  const addressFile = addressEntries[0] as File | undefined;
  const csvFileCount = beneficiaryFiles.length + invoiceFiles.length;
  const allFiles = [
    ...beneficiaryFiles,
    ...invoiceFiles,
    ...(addressFile ? [addressFile] : []),
  ];
  const totalBytes = allFiles.reduce((total, file) => total + file.size, 0);
  if (
    csvFileCount > UNIMED_IMPORT_LIMITS.maxFiles ||
    allFiles.some((file) => file.size > UNIMED_IMPORT_LIMITS.maxFileBytes) ||
    totalBytes > UNIMED_IMPORT_LIMITS.maxTotalBytes
  ) {
    return jsonError(
      413,
      "UNIMED_IMPORT_TOO_LARGE",
      "O conjunto de arquivos excede o limite seguro da importação.",
    );
  }

  if (addressFile && !addressFile.name.toLowerCase().endsWith(".xlsx")) {
    return jsonError(
      400,
      "UNIMED_ADDRESS_FILE_INVALID",
      "A base de endereços deve ser uma planilha XLSX.",
    );
  }

  try {
    const [beneficiaryInputs, invoiceInputs, addressBytes] = await Promise.all([
      Promise.all(
        beneficiaryFiles.map(async (file): Promise<UnimedImportFile> => ({
          name: file.name,
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      ),
      Promise.all(
        invoiceFiles.map(async (file): Promise<UnimedImportFile> => ({
          name: file.name,
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      ),
      addressFile
        ? addressFile.arrayBuffer().then(Buffer.from)
        : Promise.resolve(null),
    ]);

    const beneficiaries = beneficiaryInputs.length
      ? parseBeneficiaryCsvFiles(beneficiaryInputs)
      : undefined;
    const invoiceItems = invoiceInputs.length
      ? parseInvoiceCsvFiles(invoiceInputs)
      : undefined;
    let addresses: ReturnType<typeof parseAddressRows> | undefined;
    if (addressFile && addressBytes) {
      const workbook = await readAddressWorkbook(
        addressBytes,
        addressFile.name,
      );
      const addressSheet = workbook[0];
      if (!addressSheet || addressSheet.data.length > MAX_ADDRESS_ROWS) {
        return jsonError(
          400,
          "UNIMED_ADDRESS_FILE_INVALID",
          "A base de endereços está vazia ou excede o limite de linhas.",
        );
      }
      addresses = parseAddressRows(addressFile.name, addressSheet.data);
    }
    const parsedRows =
      (beneficiaries?.rows.length ?? 0) +
      (invoiceItems?.rows.length ?? 0) +
      (addresses?.rows.length ?? 0);
    if (parsedRows > MAX_PARSED_ROWS) {
      return jsonError(
        413,
        "UNIMED_IMPORT_TOO_LARGE",
        "A importação excede o limite seguro de registros.",
      );
    }

    const published = await publishUnimedImport({
      tenantId: access.tenantId,
      moduleSessionId: access.moduleSessionId,
      year: competency.data.year,
      month: competency.data.month,
      beneficiaries,
      invoiceItems,
      addresses,
    });
    const response = NextResponse.json(
      { import: published },
      { status: published.idempotent ? 200 : 201 },
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof UnimedPublishError) {
      return jsonError(
        publishErrorStatus(error.code),
        error.code,
        publishErrorMessage(error.code),
      );
    }

    if (error instanceof UnimedImportValidationError) {
      return jsonError(400, error.code, error.message);
    }

    const correlationId = crypto.randomUUID();
    console.error("Unexpected Unimed import failure", {
      correlationId,
      errorType: error instanceof Error ? error.name : "UnknownError",
      databaseCode:
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : undefined,
    });
    return jsonError(
      503,
      "UNIMED_IMPORT_FAILED",
      `Não foi possível concluir a importação. Tente novamente. Código: ${correlationId}`,
    );
  }
}
