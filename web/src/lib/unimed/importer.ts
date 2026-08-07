import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";

export const UNIMED_IMPORT_LIMITS = {
  maxFiles: 50,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
} as const;

export class UnimedImportValidationError extends Error {
  constructor(
    readonly code:
      | "UNIMED_BENEFICIARY_FILES_INVALID"
      | "UNIMED_INVOICE_FILES_INVALID"
      | "UNIMED_ADDRESS_FILE_INVALID"
      | "UNIMED_PAYROLL_LOAN_FILE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "UnimedImportValidationError";
  }
}

type ImportSeverity = "ERROR" | "WARNING";

type UnimedImportDiagnostic = {
  file: string;
  row: number;
  severity: ImportSeverity;
  code: string;
  message: string;
};

export type UnimedImportFile = {
  name: string;
  bytes: Buffer;
};

export type ParsedBeneficiary = {
  sourceKey: string;
  branchCode: string;
  registration: string | null;
  fullName: string;
  cpf: string;
  rg?: string | null;
  birthDate: string;
  inclusionDate: string;
  category: "HOLDER" | "DEPENDENT";
  relationship: string | null;
  planName: string | null;
  accommodation: string | null;
  companyCnpj: string | null;
  address: {
    addressLine: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    postalCode: string | null;
    city: string | null;
    state: string | null;
    pis: string | null;
  };
};

export type ParsedInvoiceItem = {
  sourceKey: string;
  branchCode: string;
  contract: string | null;
  registration: string | null;
  cpf: string | null;
  card: string;
  beneficiaryName: string;
  holderName: string | null;
  relationship: string | null;
  category: "HOLDER" | "DEPENDENT";
  accommodation: string | null;
  itemCode: string | null;
  itemDescription: string;
  amount: number;
  planCode: string | null;
};

export type ParsedAddress = {
  registration: string | null;
  fullName: string;
  cpf: string | null;
  addressLine: string | null;
  number: string | null;
  district: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  pis: string | null;
};

export type ParsedPayrollLoan = {
  sourceKey: string;
  sourceRow: number;
  competence: string;
  cpfNormalized: string | null;
  registration: string | null;
  employeeName: string;
  contractNumber: string;
  installmentAmount: number;
  startCompetence: string;
  endCompetence: string;
  bankCode: string;
  bankName: string;
  totalInstallments: number | null;
  loanAmount: number | null;
  releasedAmount: number | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  companyCnpj: string | null;
};

export type ParsedUnimedSource<T> = {
  fileCount: number;
  checksum: string;
  rows: T[];
  rejectedCount: number;
  skippedCount: number;
  diagnostics: UnimedImportDiagnostic[];
};

const beneficiaryRequiredHeaders = [
  "CODIGO",
  "NOME",
  "MATRICULA",
  "CATEGORIA",
  "CPF",
  "DATA DE NASCIMENTO",
  "PLANO",
  "DATA DE INCLUSAO",
  "CNPJ",
] as const;

const invoiceRequiredHeaders = [
  "CONTRATO",
  "MATRICULA",
  "CPF",
  "CARTAO",
  "BENEFICIARIO",
  "TITULAR",
  "CATEGORIA",
  "ITEM",
  "VALOR",
  "PLANO",
] as const;

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeAddressHeader(value: unknown) {
  const normalized = normalizeHeader(value).replace(/[.\u00ba\u00b0]/g, "");
  return ["N", "NO", "NUMERO"].includes(normalized) ? "N" : normalized;
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function hasOnlyRepeatedDigits(value: string) {
  return /^(\d)\1+$/.test(value);
}

function checkDigit(base: string, weights: number[]) {
  const sum = base
    .split("")
    .reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(value: string) {
  const cpf = digits(value);
  if (cpf.length !== 11 || hasOnlyRepeatedDigits(cpf)) return false;
  const first = checkDigit(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(
    cpf.slice(0, 9) + first,
    [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return cpf.endsWith(`${first}${second}`);
}

export function isValidCnpj(value: string) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || hasOnlyRepeatedDigits(cnpj)) return false;
  const first = checkDigit(
    cnpj.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  const second = checkDigit(
    cnpj.slice(0, 12) + first,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return cnpj.endsWith(`${first}${second}`);
}

function toIsoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
    ? null
    : iso;
}

function canonicalCompetence(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const raw = String(value ?? "").trim();
  const isoMatch = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(raw);
  if (isoMatch) {
    const month = Number(isoMatch[2]);
    const year = Number(isoMatch[1]);
    return month >= 1 && month <= 12 && year >= 2000 && year <= 2200
      ? `${isoMatch[1]}-${isoMatch[2]}`
      : null;
  }
  const dateMatch = /^\d{2}\/(\d{2})\/(\d{4})$/.exec(raw);
  const match = dateMatch
    ? [dateMatch[0], dateMatch[1], dateMatch[2]]
    : /^(\d{2})\/(\d{4})$/.exec(raw);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2200) return null;
  return `${match[2]}-${match[1]}`;
}

function addCompetenceMonths(competence: string, months: number) {
  const [year, month] = competence.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function positiveInteger(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseBrazilianMoney(value: unknown) {
  const raw = String(value ?? "")
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s+/g, "");
  if (!raw) return null;

  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const padded = fraction.padEnd(3, "0");
  let cents = BigInt(whole) * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(negative ? -cents : cents) / 100;
}

function validateFiles(
  files: UnimedImportFile[],
  code: "UNIMED_BENEFICIARY_FILES_INVALID" | "UNIMED_INVOICE_FILES_INVALID",
  groupLabel: string,
) {
  if (files.length === 0 || files.length > UNIMED_IMPORT_LIMITS.maxFiles) {
    throw new UnimedImportValidationError(
      code,
      `${groupLabel}: envie de 1 a ${UNIMED_IMPORT_LIMITS.maxFiles} arquivos por importação.`,
    );
  }

  let totalBytes = 0;
  const names = new Set<string>();
  for (const file of files) {
    const safeName = file.name.trim();
    if (!safeName.toLowerCase().endsWith(".csv")) {
      throw new UnimedImportValidationError(
        code,
        `${groupLabel}: o arquivo ${safeName} não é um CSV.`,
      );
    }
    if (names.has(safeName.toLocaleLowerCase("pt-BR"))) {
      throw new UnimedImportValidationError(
        code,
        `${groupLabel}: o arquivo ${safeName} foi enviado mais de uma vez.`,
      );
    }
    names.add(safeName.toLocaleLowerCase("pt-BR"));
    if (file.bytes.byteLength > UNIMED_IMPORT_LIMITS.maxFileBytes) {
      throw new UnimedImportValidationError(
        code,
        `${groupLabel}: o arquivo ${safeName} excede o limite permitido.`,
      );
    }
    totalBytes += file.bytes.byteLength;
  }
  if (totalBytes > UNIMED_IMPORT_LIMITS.maxTotalBytes) {
    throw new UnimedImportValidationError(
      code,
      `${groupLabel}: o conjunto de arquivos excede o limite permitido.`,
    );
  }
}

function checksumFiles(files: UnimedImportFile[]) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(file.name);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function recordsFromCsv(
  file: UnimedImportFile,
  code: "UNIMED_BENEFICIARY_FILES_INVALID" | "UNIMED_INVOICE_FILES_INVALID",
  groupLabel: string,
) {
  let records: unknown[][];
  try {
    records = parse(file.bytes, {
      bom: true,
      delimiter: ";",
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as unknown[][];
  } catch {
    throw new UnimedImportValidationError(
      code,
      `${groupLabel}: o arquivo ${file.name} não pôde ser lido como CSV separado por ponto e vírgula.`,
    );
  }
  if (records.length === 0) {
    throw new UnimedImportValidationError(
      code,
      `${groupLabel}: o arquivo ${file.name} está vazio.`,
    );
  }

  const header = records[0].map(normalizeHeader);
  const index = new Map(header.map((name, position) => [name, position]));
  return {
    index,
    rows: records.slice(1),
    value(row: unknown[], name: string) {
      const position = index.get(name);
      return position === undefined ? undefined : row[position];
    },
  };
}

function requireHeaders(
  fileName: string,
  index: Map<string, number>,
  required: readonly string[],
  code: "UNIMED_BENEFICIARY_FILES_INVALID" | "UNIMED_INVOICE_FILES_INVALID",
  groupLabel: string,
) {
  const missing = required.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new UnimedImportValidationError(
      code,
      `${groupLabel}: o arquivo ${fileName} não possui as colunas obrigatórias: ${missing.join(", ")}. Confira se os CSVs de beneficiários e faturas foram selecionados nos campos corretos.`,
    );
  }
}

function branchCode(fileName: string) {
  return fileName
    .replace(/\.csv$/i, "")
    .trim()
    .toUpperCase();
}

function rowError(
  diagnostics: UnimedImportDiagnostic[],
  file: string,
  row: number,
  code: string,
  message: string,
) {
  diagnostics.push({ file, row, severity: "ERROR", code, message });
}

function rowWarning(
  diagnostics: UnimedImportDiagnostic[],
  file: string,
  row: number,
  code: string,
  message: string,
) {
  diagnostics.push({ file, row, severity: "WARNING", code, message });
}

export function parseBeneficiaryCsvFiles(
  files: UnimedImportFile[],
): ParsedUnimedSource<ParsedBeneficiary> {
  const code = "UNIMED_BENEFICIARY_FILES_INVALID" as const;
  const groupLabel = "Arquivos de beneficiários";
  validateFiles(files, code, groupLabel);
  const rows: ParsedBeneficiary[] = [];
  const diagnostics: UnimedImportDiagnostic[] = [];
  const sourceKeys = new Set<string>();
  let rejectedCount = 0;

  for (const file of files) {
    const csv = recordsFromCsv(file, code, groupLabel);
    requireHeaders(
      file.name,
      csv.index,
      beneficiaryRequiredHeaders,
      code,
      groupLabel,
    );

    for (const [offset, row] of csv.rows.entries()) {
      const rowNumber = offset + 2;
      const sourceKey = text(csv.value(row, "CODIGO"));
      const fullName = text(csv.value(row, "NOME"));
      const cpf = digits(csv.value(row, "CPF"));
      const birthDate = toIsoDate(csv.value(row, "DATA DE NASCIMENTO"));
      const inclusionDate = toIsoDate(csv.value(row, "DATA DE INCLUSAO"));
      const categoryValue = normalizeHeader(csv.value(row, "CATEGORIA"));
      const category =
        categoryValue === "TITULAR"
          ? "HOLDER"
          : categoryValue === "DEPENDENTE"
            ? "DEPENDENT"
            : null;

      const errorsBefore = diagnostics.length;
      if (!sourceKey) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "MISSING_SOURCE_KEY",
          "A linha não possui o código do beneficiário.",
        );
      } else if (sourceKeys.has(sourceKey)) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "DUPLICATE_SOURCE_KEY",
          "O código do beneficiário está duplicado no conjunto.",
        );
      }
      if (!fullName) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "MISSING_NAME",
          "A linha não possui o nome do beneficiário.",
        );
      }
      if (!isValidCpf(cpf)) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "INVALID_CPF",
          "A linha não possui um CPF válido.",
        );
      }
      const companyCnpj = text(csv.value(row, "CNPJ"))
        ? digits(csv.value(row, "CNPJ"))
        : null;
      if (companyCnpj && !isValidCnpj(companyCnpj)) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "INVALID_CNPJ",
          "A linha não possui um CNPJ válido.",
        );
      }
      if (!birthDate || !inclusionDate) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "INVALID_DATE",
          "A linha possui data de nascimento ou inclusão inválida.",
        );
      }
      if (!category) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "INVALID_CATEGORY",
          "A categoria deve ser Titular ou Dependente.",
        );
      }

      if (
        diagnostics.length !== errorsBefore ||
        !sourceKey ||
        !fullName ||
        !birthDate ||
        !inclusionDate ||
        !category
      ) {
        rejectedCount += 1;
        continue;
      }

      sourceKeys.add(sourceKey);
      rows.push({
        sourceKey,
        branchCode: branchCode(file.name),
        registration: text(csv.value(row, "MATRICULA")),
        fullName,
        cpf,
        rg: text(csv.value(row, "RG")),
        birthDate,
        inclusionDate,
        category,
        relationship: text(csv.value(row, "GRAU DE PARENTESCO")),
        planName: text(csv.value(row, "PLANO")),
        accommodation: text(csv.value(row, "ACOMODACAO")),
        companyCnpj,
        address: {
          addressLine: text(csv.value(row, "ENDERECO")),
          number: text(csv.value(row, "N° CASA")),
          complement: text(csv.value(row, "COMPLEMENTO")),
          district: text(csv.value(row, "BAIRRO")),
          postalCode: text(csv.value(row, "CEP"))
            ? digits(csv.value(row, "CEP"))
            : null,
          city: text(csv.value(row, "CIDADE")),
          state: text(csv.value(row, "ESTADO")),
          pis: text(csv.value(row, "PIS"))
            ? digits(csv.value(row, "PIS"))
            : null,
        },
      });
    }
  }

  if (rows.length === 0) {
    throw new UnimedImportValidationError(
      code,
      `${groupLabel}: nenhum registro válido foi encontrado. A fonte anterior foi preservada.`,
    );
  }

  return {
    fileCount: files.length,
    checksum: checksumFiles(files),
    rows,
    rejectedCount,
    skippedCount: 0,
    diagnostics,
  };
}

export function parseInvoiceCsvFiles(
  files: UnimedImportFile[],
): ParsedUnimedSource<ParsedInvoiceItem> {
  const code = "UNIMED_INVOICE_FILES_INVALID" as const;
  const groupLabel = "Arquivos de faturas";
  validateFiles(files, code, groupLabel);
  const rows: ParsedInvoiceItem[] = [];
  const diagnostics: UnimedImportDiagnostic[] = [];
  let rejectedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const csv = recordsFromCsv(file, code, groupLabel);
    requireHeaders(
      file.name,
      csv.index,
      invoiceRequiredHeaders,
      code,
      groupLabel,
    );

    for (const [offset, row] of csv.rows.entries()) {
      const rowNumber = offset + 2;
      const card = text(csv.value(row, "CARTAO"));
      const beneficiaryName = text(csv.value(row, "BENEFICIARIO"));
      const itemDescription = text(csv.value(row, "ITEM"));
      const cpf = text(csv.value(row, "CPF"))
        ? digits(csv.value(row, "CPF"))
        : null;

      if (!card && !beneficiaryName && itemDescription) {
        skippedCount += 1;
        continue;
      }

      const amount = parseBrazilianMoney(csv.value(row, "VALOR"));
      const categoryValue = normalizeHeader(csv.value(row, "CATEGORIA"));
      const category =
        categoryValue === "TITULAR"
          ? "HOLDER"
          : categoryValue === "DEPENDENTE"
            ? "DEPENDENT"
            : null;
      const errorsBefore = diagnostics.length;
      if (!card || !beneficiaryName || !itemDescription) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "INCOMPLETE_INVOICE_ITEM",
          "A linha não identifica cartão, beneficiário e item.",
        );
      }
      if (amount === null) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "INVALID_AMOUNT",
          "A linha possui um valor financeiro inválido.",
        );
      }
      if (!category) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "INVALID_CATEGORY",
          "A categoria deve ser Titular ou Dependente.",
        );
      }
      if (cpf && !isValidCpf(cpf)) {
        rowError(
          diagnostics,
          file.name,
          rowNumber,
          "INVALID_CPF",
          "A linha não possui um CPF válido.",
        );
      }

      if (
        diagnostics.length !== errorsBefore ||
        !card ||
        !beneficiaryName ||
        !itemDescription ||
        amount === null ||
        !category
      ) {
        rejectedCount += 1;
        continue;
      }

      rows.push({
        sourceKey: `${file.name}:${rowNumber}`,
        branchCode: branchCode(file.name),
        contract: text(csv.value(row, "CONTRATO")),
        registration: text(csv.value(row, "MATRICULA")),
        cpf,
        card,
        beneficiaryName,
        holderName: text(csv.value(row, "TITULAR")),
        relationship: text(csv.value(row, "PARENTESCO")),
        category,
        accommodation: text(csv.value(row, "ACOMODACAO")),
        itemCode: text(csv.value(row, "CODIGO")),
        itemDescription,
        amount,
        planCode: text(csv.value(row, "PLANO")),
      });
    }
  }

  if (rows.length === 0) {
    throw new UnimedImportValidationError(
      code,
      `${groupLabel}: nenhum registro válido foi encontrado. A fonte anterior foi preservada.`,
    );
  }

  return {
    fileCount: files.length,
    checksum: checksumFiles(files),
    rows,
    rejectedCount,
    skippedCount,
    diagnostics,
  };
}

export function parseAddressRows(
  workbookName: string,
  workbookRows: unknown[][],
): ParsedUnimedSource<ParsedAddress> {
  const expected = [
    "CADASTRO",
    "NOME",
    "CPF",
    "ENDERECO",
    "N",
    "BAIRRO",
    "CEP",
    "CIDADE",
    "UF",
    "PIS",
  ];
  const headerIndex = workbookRows.findIndex((row) => {
    const headers = new Set(row.map(normalizeAddressHeader));
    return expected.every((name) => headers.has(name));
  });
  if (headerIndex < 0) {
    throw new UnimedImportValidationError(
      "UNIMED_ADDRESS_FILE_INVALID",
      `A planilha ${workbookName} não possui o cabeçalho de endereços esperado.`,
    );
  }

  const header = workbookRows[headerIndex].map(normalizeAddressHeader);
  const index = new Map(header.map((name, position) => [name, position]));
  const value = (row: unknown[], name: string) => {
    const position = index.get(name);
    return position === undefined ? undefined : row[position];
  };
  const rows: ParsedAddress[] = [];
  const diagnostics: UnimedImportDiagnostic[] = [];
  const rejectedCount = 0;
  let skippedCount = 0;

  for (
    let offset = headerIndex + 1;
    offset < workbookRows.length;
    offset += 1
  ) {
    const row = workbookRows[offset];
    if (!row.some((cell) => text(cell))) continue;
    const fullName = text(value(row, "NOME"));
    if (!fullName) {
      skippedCount += 1;
      rowWarning(
        diagnostics,
        workbookName,
        offset + 1,
        "SKIPPED_ADDRESS_ROW",
        "A linha sem nome foi ignorada.",
      );
      continue;
    }

    const rawCpf = text(value(row, "CPF"));
    rows.push({
      registration: text(value(row, "CADASTRO")),
      fullName,
      cpf: rawCpf ? digits(rawCpf) : null,
      addressLine: text(value(row, "ENDERECO")),
      number: text(value(row, "N")),
      district: text(value(row, "BAIRRO")),
      postalCode: text(value(row, "CEP")) ? digits(value(row, "CEP")) : null,
      city: text(value(row, "CIDADE")),
      state: text(value(row, "UF")),
      pis: text(value(row, "PIS")) ? digits(value(row, "PIS")) : null,
    });
  }

  if (rows.length === 0) {
    throw new UnimedImportValidationError(
      "UNIMED_ADDRESS_FILE_INVALID",
      `A planilha ${workbookName} não possui registros válidos. A fonte anterior foi preservada.`,
    );
  }

  return {
    fileCount: 1,
    checksum: createHash("sha256")
      .update(JSON.stringify(workbookRows))
      .digest("hex"),
    rows,
    rejectedCount,
    skippedCount,
    diagnostics,
  };
}

const PAYROLL_LOAN_REQUIRED_HEADERS = [
  "IFCONCESSORA.CODIGO",
  "IFCONCESSORA.DESCRICAO",
  "CONTRATO",
  "CPF",
  "MATRICULA",
  "NOMETRABALHADOR",
  "COMPETENCIAINICIODESCONTO",
  "COMPETENCIAFIMDESCONTO",
  "TOTALPARCELAS",
  "VALORPARCELA",
  "COMPETENCIA",
] as const;

const PAYROLL_LOAN_GERAL_REQUIRED_HEADERS = [
  "NOME",
  "CPF",
  "VALOR",
  "PARCELA",
  "DATA INICIO",
  "DATA FIM",
  "COMPETENCIA",
  "EMPRESTIMO",
  "LIBERADO",
  "DESCRICAO",
  "CONTRATO",
] as const;

export type ParsedPayrollLoanSource = ParsedUnimedSource<ParsedPayrollLoan> & {
  sourceSheet: string;
};

export function parsePayrollLoanRows(
  workbookName: string,
  sourceSheet: string,
  workbookRows: unknown[][],
  expectedCompetence: { year: number; month: number },
): ParsedPayrollLoanSource {
  const headerIndex = workbookRows.slice(0, 50).findIndex((row) => {
    const headers = new Set(row.map(normalizeHeader));
    return (
      PAYROLL_LOAN_REQUIRED_HEADERS.every((name) => headers.has(name)) ||
      PAYROLL_LOAN_GERAL_REQUIRED_HEADERS.every((name) => headers.has(name))
    );
  });
  if (headerIndex < 0) {
    throw new UnimedImportValidationError(
      "UNIMED_PAYROLL_LOAN_FILE_INVALID",
      `A aba ${sourceSheet} de ${workbookName} não contém todos os campos seguros do consignado. Use preferencialmente o arquivo bruto com a aba Planilha1.`,
    );
  }

  const header = workbookRows[headerIndex].map(normalizeHeader);
  const index = new Map(header.map((name, position) => [name, position]));
  const value = (row: unknown[], name: string) => {
    const position = index.get(name);
    return position === undefined ? undefined : row[position];
  };
  const isGeralLayout = PAYROLL_LOAN_GERAL_REQUIRED_HEADERS.every((name) =>
    index.has(name),
  );
  const mappedValue = (row: unknown[], rawName: string, geralName: string) =>
    value(row, isGeralLayout ? geralName : rawName);
  const expected = `${expectedCompetence.year}-${String(expectedCompetence.month).padStart(2, "0")}`;
  const rows: ParsedPayrollLoan[] = [];
  const diagnostics: UnimedImportDiagnostic[] = [];
  const sourceKeys = new Set<string>();
  let rejectedCount = 0;
  let skippedCount = 0;

  for (
    let offset = headerIndex + 1;
    offset < workbookRows.length;
    offset += 1
  ) {
    const row = workbookRows[offset];
    const rowNumber = offset + 1;
    if (!row.some((cell) => text(cell))) continue;

    const employeeName = text(mappedValue(row, "NOMETRABALHADOR", "NOME"));
    const contractNumber = text(value(row, "CONTRATO"));
    const bankCode = text(mappedValue(row, "IFCONCESSORA.CODIGO", "CODIGO"));
    const bankName = text(
      mappedValue(row, "IFCONCESSORA.DESCRICAO", "DESCRICAO"),
    );
    const registration = isGeralLayout ? null : text(value(row, "MATRICULA"));
    const rawCpf = text(value(row, "CPF"));
    const cpfNormalized = rawCpf ? digits(rawCpf).padStart(11, "0") : null;
    const competence = isGeralLayout
      ? expected
      : canonicalCompetence(value(row, "COMPETENCIA"));
    const startCompetence = canonicalCompetence(
      mappedValue(row, "COMPETENCIAINICIODESCONTO", "COMPETENCIA"),
    );
    const rawEndCompetence = isGeralLayout
      ? null
      : canonicalCompetence(value(row, "COMPETENCIAFIMDESCONTO"));
    const installmentAmount = parseBrazilianMoney(
      mappedValue(row, "VALORPARCELA", "VALOR"),
    );
    const totalInstallments = positiveInteger(
      mappedValue(row, "TOTALPARCELAS", "PARCELA"),
    );
    const endCompetence =
      isGeralLayout && startCompetence && totalInstallments
        ? addCompetenceMonths(startCompetence, totalInstallments - 1)
        : rawEndCompetence;
    const companyCnpjRaw = isGeralLayout
      ? null
      : text(value(row, "NUMEROINSCRICAOESTABELECIMENTO"));
    const companyCnpj = companyCnpjRaw ? digits(companyCnpjRaw) : null;
    const errors: string[] = [];

    if (isGeralLayout && !contractNumber) {
      skippedCount += 1;
      continue;
    }

    if (!employeeName) errors.push("nome do trabalhador");
    if (!contractNumber) errors.push("número do contrato");
    if ((!isGeralLayout && !bankCode) || !bankName)
      errors.push("código e nome do banco");
    if (!cpfNormalized && !registration) errors.push("CPF ou matrícula");
    if (cpfNormalized && !isValidCpf(cpfNormalized)) errors.push("CPF válido");
    if (!isGeralLayout && typeof value(row, "MATRICULA") === "number") {
      errors.push("matrícula textual sem perda de zeros");
    }
    if (!competence || competence !== expected) {
      errors.push(
        `competência ${String(expectedCompetence.month).padStart(2, "0")}/${expectedCompetence.year}`,
      );
    }
    if (!startCompetence || !endCompetence) {
      errors.push("competências inicial e final válidas");
    } else if (startCompetence > endCompetence) {
      errors.push("competência inicial anterior ou igual à final");
    }
    if (installmentAmount === null || installmentAmount <= 0)
      errors.push("valor da parcela positivo");
    if (totalInstallments === null) errors.push("total de parcelas válido");
    if (companyCnpj && !isValidCnpj(companyCnpj))
      errors.push("CNPJ do estabelecimento válido");

    if (
      errors.length > 0 || !employeeName || !contractNumber || !competence ||
      installmentAmount === null || !startCompetence ||
      !endCompetence || !bankName
    ) {
      rejectedCount += 1;
      rowError(
        diagnostics,
        workbookName,
        rowNumber,
        "INVALID_PAYROLL_LOAN_ROW",
        `Revise: ${errors.join(", ")}.`,
      );
      continue;
    }
    const sourceKey = createHash("sha256")
      .update(cpfNormalized ?? "")
      .update("\0")
      .update(registration ?? "")
      .update("\0")
      .update(contractNumber)
      .update("\0")
      .update(bankCode ?? "NAO_INFORMADO")
      .update("\0")
      .update(competence)
      .digest("hex");
    if (sourceKeys.has(sourceKey)) {
      rejectedCount += 1;
      rowError(
        diagnostics,
        workbookName,
        rowNumber,
        "DUPLICATE_PAYROLL_LOAN",
        "Contrato duplicado para o mesmo colaborador, banco e competência.",
      );
      continue;
    }
    sourceKeys.add(sourceKey);

    const loanAmount = parseBrazilianMoney(
      mappedValue(row, "VALOREMPRESTIMO", "EMPRESTIMO"),
    );
    const releasedAmount = parseBrazilianMoney(
      mappedValue(row, "VALORLIBERADO", "LIBERADO"),
    );
    rows.push({
      sourceKey,
      sourceRow: rowNumber,
      competence,
      cpfNormalized,
      registration,
      employeeName,
      contractNumber,
      installmentAmount,
      startCompetence,
      endCompetence,
      bankCode: bankCode ?? "NAO_INFORMADO",
      bankName,
      totalInstallments,
      loanAmount,
      releasedAmount,
      contractStartDate: toIsoDate(
        mappedValue(row, "DATAINICIOCONTRATO", "DATA INICIO"),
      ),
      contractEndDate: toIsoDate(
        mappedValue(row, "DATAFIMCONTRATO", "DATA FIM"),
      ),
      companyCnpj,
    });
  }

  if (isGeralLayout && rows.length > 0) {
    rowWarning(
      diagnostics,
      workbookName,
      headerIndex + 1,
      "DERIVED_PAYROLL_LOAN_END_COMPETENCE",
      "No formato GERAL, a competência final foi derivada da competência inicial e da quantidade de parcelas. Para precisão integral, prefira o arquivo bruto Planilha1.",
    );
  }

  if (rows.length === 0 && rejectedCount === 0) {
    skippedCount += 1;
    rowWarning(
      diagnostics,
      workbookName,
      headerIndex + 1,
      "EMPTY_PAYROLL_LOAN_SHEET",
      "A aba de consignado não possui contratos.",
    );
  }

  const canonicalRows = [...rows].sort((left, right) =>
    left.sourceKey.localeCompare(right.sourceKey),
  );
  return {
    fileCount: 1,
    checksum: createHash("sha256")
      .update(
        JSON.stringify(
          canonicalRows.map((row) =>
            Object.fromEntries(
              Object.entries(row).filter(([name]) => name !== "sourceRow"),
            ),
          ),
        ),
      )
      .digest("hex"),
    rows,
    rejectedCount,
    skippedCount,
    diagnostics,
    sourceSheet,
  };
}
