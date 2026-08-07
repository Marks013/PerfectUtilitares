import { createHash } from "node:crypto";

import {
  UnimedImportValidationError,
  addCompetenceMonths,
  canonicalCompetence,
  digits,
  isValidCnpj,
  isValidCpf,
  normalizeAddressHeader,
  normalizeHeader,
  parseBrazilianMoney,
  positiveInteger,
  rowError,
  rowWarning,
  text,
  toIsoDate,
  type ParsedAddress,
  type ParsedPayrollLoan,
  type ParsedUnimedSource,
  type UnimedImportDiagnostic,
} from "./importer-shared";

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
