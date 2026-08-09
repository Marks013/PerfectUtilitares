import {
  parseAddressRows,
  parseBeneficiaryCsvFiles,
  parseInvoiceCsvFiles,
  UnimedImportValidationError,
  type UnimedImportFile,
} from "./importer";
import { digits, normalizeHeader, text, toIsoDate } from "./importer-shared";

export type UnimedWorkbookSheet = {
  sheet: string;
  data: unknown[][];
};

const REQUIRED_SHEETS = ["UNIMED", "FATURA", "ENDERECO"] as const;
const MAX_MASTER_ROWS = 250_000;

function workbookError(message: string): never {
  throw new UnimedImportValidationError(
    "UNIMED_MASTER_WORKBOOK_INVALID",
    `Planilha mestre: ${message} A competência anterior foi preservada.`,
  );
}

function sheetByName(sheets: UnimedWorkbookSheet[], expected: string) {
  return sheets.find((sheet) => normalizeHeader(sheet.sheet) === expected);
}

function headerIndex(header: unknown[]) {
  return new Map(
    header.map((value, position) => [normalizeHeader(value), position]),
  );
}

function valueAt(
  row: unknown[],
  indexes: Map<string, number>,
  name: string,
) {
  const position = indexes.get(name);
  return position === undefined ? undefined : row[position];
}

function csvValue(value: unknown) {
  const serialized =
    value instanceof Date
      ? `${String(value.getUTCDate()).padStart(2, "0")}/${String(
          value.getUTCMonth() + 1,
        ).padStart(2, "0")}/${value.getUTCFullYear()}`
      : value === null || value === undefined
        ? ""
        : String(value);
  return `"${serialized.replaceAll('"', '""')}"`;
}

function csvFile(name: string, header: unknown[], rows: unknown[][]) {
  const content = [header, ...rows]
    .map((row) => row.map(csvValue).join(";"))
    .join("\r\n");
  return {
    name: `${name}.csv`,
    bytes: Buffer.from(content, "utf8"),
  } satisfies UnimedImportFile;
}

function safeBranchCode(value: unknown, companyCnpj: unknown) {
  const candidate = normalizeHeader(value) || digits(companyCnpj) || "MATRIZ";
  return candidate.replace(/[^A-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function isBeneficiaryDataRow(
  row: unknown[],
  indexes: Map<string, number>,
) {
  const hasIdentity = Boolean(
    text(valueAt(row, indexes, "CODIGO")) ||
      text(valueAt(row, indexes, "MATRICULA")) ||
      digits(valueAt(row, indexes, "CPF")),
  );
  const name = text(valueAt(row, indexes, "NOME")) ?? "";
  const category = normalizeHeader(valueAt(row, indexes, "CATEGORIA"));
  return (
    hasIdentity ||
    (name.length >= 3 && ["TITULAR", "DEPENDENTE"].includes(category))
  );
}

function normalizeMasterBeneficiaryRow(
  row: unknown[],
  indexes: Map<string, number>,
) {
  const normalized = [...row];
  for (const column of ["DATA DE NASCIMENTO", "DATA DE INCLUSAO"]) {
    const position = indexes.get(column);
    if (position === undefined || typeof row[position] !== "number") continue;
    const isoDate = toIsoDate(row[position]);
    if (isoDate) normalized[position] = new Date(`${isoDate}T00:00:00.000Z`);
  }
  return normalized;
}

function groupBeneficiaries(rows: unknown[][]) {
  const header = rows[0] ?? [];
  const indexes = headerIndex(header);
  const locationIndex = indexes.get("LOCACAO");
  const cnpjIndex = indexes.get("CNPJ");
  const groups = new Map<string, unknown[][]>();

  for (const row of rows.slice(1)) {
    if (!isBeneficiaryDataRow(row, indexes)) continue;
    const branch = safeBranchCode(
      locationIndex === undefined ? undefined : row[locationIndex],
      cnpjIndex === undefined ? undefined : row[cnpjIndex],
    );
    const group = groups.get(branch) ?? [];
    group.push(normalizeMasterBeneficiaryRow(row, indexes));
    groups.set(branch, group);
  }

  if (groups.size === 0) workbookError("a aba Unimed não possui registros.");
  return {
    files: [...groups].map(([branch, group]) =>
      csvFile(branch, header, group),
    ),
    header,
    indexes,
    groups,
  };
}

function rememberUnique(
  map: Map<string, string | null>,
  key: string,
  branch: string,
) {
  if (!key) return;
  const existing = map.get(key);
  map.set(key, existing && existing !== branch ? null : branch);
}

function groupInvoices(
  invoiceRows: unknown[][],
  beneficiaryRows: unknown[][],
  beneficiaryGroups: Map<string, unknown[][]>,
) {
  const beneficiaryHeader = beneficiaryRows[0] ?? [];
  const beneficiaryIndexes = headerIndex(beneficiaryHeader);
  const byCpf = new Map<string, string | null>();
  const byRegistration = new Map<string, string | null>();
  const byName = new Map<string, string | null>();

  for (const [branch, rows] of beneficiaryGroups) {
    for (const row of rows) {
      rememberUnique(
        byCpf,
        digits(valueAt(row, beneficiaryIndexes, "CPF")),
        branch,
      );
      rememberUnique(
        byRegistration,
        normalizeHeader(valueAt(row, beneficiaryIndexes, "MATRICULA")),
        branch,
      );
      rememberUnique(
        byName,
        normalizeHeader(valueAt(row, beneficiaryIndexes, "NOME")),
        branch,
      );
    }
  }

  const header = invoiceRows[0] ?? [];
  const indexes = headerIndex(header);
  const groups = new Map<string, unknown[][]>();
  const onlyBranch = beneficiaryGroups.size === 1
    ? beneficiaryGroups.keys().next().value
    : undefined;

  for (const row of invoiceRows.slice(1)) {
    const branch =
      byCpf.get(digits(valueAt(row, indexes, "CPF"))) ??
      byRegistration.get(normalizeHeader(valueAt(row, indexes, "MATRICULA"))) ??
      byName.get(normalizeHeader(valueAt(row, indexes, "BENEFICIARIO"))) ??
      onlyBranch ??
      "SEM_FILIAL";
    const group = groups.get(branch) ?? [];
    group.push(row);
    groups.set(branch, group);
  }

  if (groups.size === 0) workbookError("a aba Fatura não possui registros.");
  return [...groups].map(([branch, rows]) => csvFile(branch, header, rows));
}

export function parseUnimedMasterWorkbook(
  fileName: string,
  sheets: UnimedWorkbookSheet[],
) {
  const normalizedNames = new Set(
    sheets.map((sheet) => normalizeHeader(sheet.sheet)),
  );
  const missing = REQUIRED_SHEETS.filter((name) => !normalizedNames.has(name));
  if (missing.length > 0) {
    workbookError(`faltam as abas obrigatórias: ${missing.join(", ")}.`);
  }

  const beneficiarySheet = sheetByName(sheets, "UNIMED");
  const invoiceSheet = sheetByName(sheets, "FATURA");
  const addressSheet = sheetByName(sheets, "ENDERECO");
  if (!beneficiarySheet || !invoiceSheet || !addressSheet) {
    workbookError("não foi possível localizar todas as abas obrigatórias.");
  }
  const totalRows =
    beneficiarySheet.data.length +
    invoiceSheet.data.length +
    addressSheet.data.length;
  if (totalRows > MAX_MASTER_ROWS) {
    workbookError("o total de linhas excede o limite seguro.");
  }

  const beneficiaryGroups = groupBeneficiaries(beneficiarySheet.data);
  const invoiceFiles = groupInvoices(
    invoiceSheet.data,
    beneficiarySheet.data,
    beneficiaryGroups.groups,
  );

  return {
    beneficiaries: parseBeneficiaryCsvFiles(beneficiaryGroups.files),
    invoiceItems: parseInvoiceCsvFiles(invoiceFiles),
    addresses: parseAddressRows(fileName, addressSheet.data),
  };
}
