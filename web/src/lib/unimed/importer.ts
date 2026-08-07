import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";

import {
  UNIMED_IMPORT_LIMITS,
  UnimedImportValidationError,
  digits,
  isValidCnpj,
  isValidCpf,
  normalizeHeader,
  parseBrazilianMoney,
  rowError,
  text,
  toIsoDate,
  type ParsedBeneficiary,
  type ParsedInvoiceItem,
  type ParsedUnimedSource,
  type UnimedImportDiagnostic,
  type UnimedImportFile,
} from "./importer-shared";

export {
  UNIMED_IMPORT_LIMITS,
  UnimedImportValidationError,
  isValidCnpj,
  isValidCpf,
  parseBrazilianMoney,
};

export type {
  ParsedBeneficiary,
  ParsedInvoiceItem,
  ParsedUnimedSource,
  UnimedImportFile,
};

export type {
  ParsedAddress,
  ParsedPayrollLoan,
} from "./importer-shared";

export {
  parseAddressRows,
  parsePayrollLoanRows,
} from "./importer-workbook";

export type {
  ParsedPayrollLoanSource,
} from "./importer-workbook";

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
