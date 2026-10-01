import { SalaryAdjustmentError } from "./errors";
import { MAX_ROWS_PER_FILE } from "./limits";
import { parseMoneyCents } from "./money";
import { readPayrollWorkbookSheets } from "./ooxml-reader";
import type { Competency, ParsedPayrollFile, ParsedPayrollRow } from "./types";

type ParserContext = {
  competency: Competency;
  sourceFile: string;
  sourceSheet: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\u00a0/g, " ").trim() : "";
}

function comparable(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR");
}

function findLabel(row: unknown[], label: string) {
  return row.findIndex((cell) => comparable(cell) === label);
}

function valueAfter(row: unknown[], index: number) {
  for (let cursor = index + 1; cursor < row.length; cursor += 1) {
    const value = text(row[cursor]);
    if (value) return value;
  }
  return "";
}

function sheetLooksCompatible(rows: unknown[][]) {
  if (sheetLooksMonthly(rows)) return true;
  let hasAlias = false;
  let hasRegistration = false;
  let hasName = false;
  let hasNormalInss = false;
  for (const row of rows) {
    hasAlias ||= findLabel(row, "APELIDO:") >= 0;
    hasRegistration ||= findLabel(row, "CADASTRO") >= 0;
    hasName ||= findLabel(row, "NOME DO COLABORADOR") >= 0;
    hasNormalInss ||= findLabel(row, "INSS NORMAL") >= 0;
    if (hasAlias && hasRegistration && hasName && hasNormalInss) return true;
  }
  return false;
}

function sheetLooksMonthly(rows: unknown[][]) {
  return rows.some((row) => findLabel(row, "FOLHA DE PAGAMENTO") >= 0)
    && rows.some((row) => findLabel(row, "COLABORADOR:") >= 0);
}

function parseMonthlyPayrollRows(rows: unknown[][], context: ParserContext): ParsedPayrollRow[] {
  const parsed: ParsedPayrollRow[] = [];
  const registrations = new Set<string>();
  let branchAlias = "";
  let employee: Omit<ParsedPayrollRow, "baseCents"> | undefined;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const sourceRow = index + 1;
    const localIndex = findLabel(row, "LOCAL:");
    if (localIndex >= 0) {
      const alias = valueAfter(row, localIndex).replace(/^\d+\s+(?:-\s*)?/, "").trim();
      if (!alias || (employee && alias !== employee.branchAlias)) {
        structureError(context, "Local vazio ou alterado antes do fechamento do colaborador.", sourceRow);
      }
      branchAlias = alias;
      continue;
    }

    const employeeIndex = findLabel(row, "COLABORADOR:");
    if (employeeIndex >= 0) {
      if (employee) {
        structureError(context, "Colaborador sem fechamento de Base INSS Proc.", employee.sourceRow);
      }
      const match = /^(\d+)\s*-\s*(.+)$/.exec(valueAfter(row, employeeIndex));
      if (!branchAlias || !match) {
        structureError(context, "Local ou identificação do colaborador inválidos.", sourceRow);
      }
      const registration = match[1].replace(/^0+(?=\d)/, "");
      if (registrations.has(registration)) {
        throw new SalaryAdjustmentError(
          "REAJUSTE_REGISTRATION_DUPLICATE",
          `O cadastro ${registration} aparece mais de uma vez em ${context.sourceFile}.`,
          [{ file: context.sourceFile, sheet: context.sourceSheet, row: sourceRow, message: "Cadastro duplicado na competência." }],
        );
      }
      registrations.add(registration);
      employee = { ...context, sourceRow, branchAlias, registration, employeeName: match[2].trim() };
      continue;
    }

    const baseIndex = findLabel(row, "INSS PROC:");
    if (baseIndex >= 0) {
      if (!employee) {
        structureError(context, "Base INSS Proc sem colaborador correspondente.", sourceRow);
      }
      let baseCents: bigint;
      try {
        // The monthly closing base is distinct from salary, earnings and INSS withheld.
        baseCents = parseMoneyCents(row[baseIndex + 1]);
      } catch {
        structureError(context, "Base INSS Proc vazia ou inválida.", sourceRow);
      }
      parsed.push({ ...employee, baseCents });
      employee = undefined;
    }
  }
  if (employee) structureError(context, "Colaborador sem fechamento de Base INSS Proc.", employee.sourceRow);
  if (parsed.length === 0) structureError(context, "Nenhum colaborador válido foi encontrado.");
  return parsed;
}

function structureError(
  context: ParserContext,
  message: string,
  row?: number,
): never {
  throw new SalaryAdjustmentError(
    "REAJUSTE_STRUCTURE_INVALID",
    `A estrutura de ${context.sourceFile} não corresponde ao relatório de INSS ou à folha mensal esperados.`,
    [{ file: context.sourceFile, sheet: context.sourceSheet, row, message }],
  );
}

export function parsePayrollSheetRows(
  rows: unknown[][],
  context: ParserContext,
): ParsedPayrollRow[] {
  if (rows.length > MAX_ROWS_PER_FILE) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_ROW_LIMIT_EXCEEDED",
      `${context.sourceFile} excede o limite seguro de ${MAX_ROWS_PER_FILE.toLocaleString("pt-BR")} linhas.`,
      [],
      413,
    );
  }

  if (sheetLooksMonthly(rows)) return parseMonthlyPayrollRows(rows, context);

  const parsed: ParsedPayrollRow[] = [];
  const registrations = new Set<string>();
  let branchAlias = "";
  let normalGroupColumn = -1;
  let thirteenthGroupColumn = Number.POSITIVE_INFINITY;
  let registrationColumn = -1;
  let nameColumn = -1;
  let baseColumn = -1;
  let readingEmployees = false;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const sourceRow = index + 1;
    const filialIndex = findLabel(row, "FILIAL:");
    if (filialIndex >= 0) {
      branchAlias = "";
      normalGroupColumn = -1;
      thirteenthGroupColumn = Number.POSITIVE_INFINITY;
      registrationColumn = -1;
      nameColumn = -1;
      baseColumn = -1;
      readingEmployees = false;
      continue;
    }

    const aliasIndex = findLabel(row, "APELIDO:");
    if (aliasIndex >= 0) {
      branchAlias = valueAfter(row, aliasIndex);
      if (!branchAlias) {
        structureError(context, "O apelido da filial está vazio.", sourceRow);
      }
      continue;
    }

    const normalIndex = findLabel(row, "INSS NORMAL");
    if (normalIndex >= 0) {
      normalGroupColumn = normalIndex;
      const thirteenIndex = findLabel(row, "INSS 13º SALARIO");
      thirteenthGroupColumn =
        thirteenIndex >= 0 ? thirteenIndex : Number.POSITIVE_INFINITY;
      continue;
    }

    const rowRegistrationColumn = findLabel(row, "CADASTRO");
    const rowNameColumn = findLabel(row, "NOME DO COLABORADOR");
    if (rowRegistrationColumn >= 0 || rowNameColumn >= 0) {
      if (
        rowRegistrationColumn < 0 ||
        rowNameColumn < 0 ||
        !branchAlias ||
        normalGroupColumn < 0
      ) {
        structureError(context, "Cabeçalho de colaboradores incompleto.", sourceRow);
      }
      const baseColumns = row
        .map((cell, cellIndex) => ({ cellIndex, label: comparable(cell) }))
        .filter(
          ({ cellIndex, label }) =>
            label === "BASE" &&
            cellIndex >= normalGroupColumn &&
            cellIndex < thirteenthGroupColumn,
        );
      if (baseColumns.length !== 1) {
        structureError(
          context,
          "Não foi possível identificar uma única Base de INSS Normal.",
          sourceRow,
        );
      }
      registrationColumn = rowRegistrationColumn;
      nameColumn = rowNameColumn;
      baseColumn = baseColumns[0].cellIndex;
      readingEmployees = true;
      continue;
    }

    if (!readingEmployees) continue;
    const combined = row.map(comparable).filter(Boolean).join(" ");
    if (
      combined.includes("TOTAL COLABORADORES:") ||
      combined.includes("RESUMO DA FILIAL") ||
      combined.includes("RESUMO POR FAIXAS")
    ) {
      readingEmployees = false;
      continue;
    }

    const registrationValue = row[registrationColumn];
    if (registrationValue === null || registrationValue === undefined || registrationValue === "") {
      continue;
    }
    if (typeof registrationValue !== "string") {
      if (
        row[baseColumn] === null ||
        row[baseColumn] === undefined ||
        row[baseColumn] === ""
      ) {
        continue;
      }
      structureError(
        context,
        "O cadastro deve ser texto para preservar zeros à esquerda.",
        sourceRow,
      );
    }
    const rawRegistration = registrationValue.replace(/\s+/g, "").trim();
    if (!/^\d+$/.test(rawRegistration)) continue;
    const registration = rawRegistration.replace(/^0+(?=\d)/, "");
    const employeeName = text(row[nameColumn]);
    if (!employeeName) {
      structureError(context, "Colaborador sem nome.", sourceRow);
    }
    if (registrations.has(registration)) {
      throw new SalaryAdjustmentError(
        "REAJUSTE_REGISTRATION_DUPLICATE",
        `O cadastro ${registration} aparece mais de uma vez em ${context.sourceFile}.`,
        [{ file: context.sourceFile, sheet: context.sourceSheet, row: sourceRow, message: "Cadastro duplicado na competência." }],
      );
    }

    let baseCents: bigint;
    try {
      baseCents = parseMoneyCents(row[baseColumn]);
    } catch {
      structureError(context, "Base de INSS Normal vazia ou inválida.", sourceRow);
    }
    registrations.add(registration);
    parsed.push({
      ...context,
      sourceRow,
      branchAlias,
      registration,
      employeeName,
      baseCents,
    });
  }

  if (parsed.length === 0) {
    structureError(context, "Nenhum colaborador válido foi encontrado.");
  }
  return parsed;
}

export async function parseSalaryAdvanceWorkbook(
  bytes: Buffer,
  competency: Competency,
  sourceFile: string,
): Promise<ParsedPayrollFile> {
  let workbook: ReturnType<typeof readPayrollWorkbookSheets>;
  try {
    workbook = readPayrollWorkbookSheets(bytes);
  } catch {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      `${sourceFile} não pôde ser lido como uma planilha XLSX válida.`,
    );
  }

  const plan1 = workbook.find(
    (sheet) => comparable(sheet.sheet) === "PLAN1",
  );
  const compatible = workbook.filter((sheet) =>
    sheetLooksCompatible(sheet.data as unknown[][]),
  );
  const selected =
    plan1 && sheetLooksCompatible(plan1.data as unknown[][])
      ? plan1
      : compatible.length === 1
        ? compatible[0]
        : null;
  if (!selected || (!plan1 && compatible.length > 1)) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      compatible.length > 1
        ? `${sourceFile} possui mais de uma aba compatível; mantenha somente uma aba do relatório.`
        : `${sourceFile} não possui uma aba compatível com o relatório de INSS ou a folha mensal.`,
    );
  }

  return {
    competency,
    sourceFile,
    sourceSheet: selected.sheet,
    rows: parsePayrollSheetRows(selected.data as unknown[][], {
      competency,
      sourceFile,
      sourceSheet: selected.sheet,
    }),
  };
}
