import { canonicalBranchAlias } from "./branches";
import { SalaryAdjustmentError } from "./errors";
import { MAX_ROWS_PER_FILE } from "./limits";
import { parseMoneyCents } from "./money";
import { readPayrollWorkbookSheets } from "./ooxml-reader";
import type {
  ParsedSalaryRevisionEmployee,
  ParsedSalaryRevisionFile,
} from "./salary-revision-types";

type ParserContext = {
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

function registration(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const digits = value.replace(/\s+/g, "");
  if (!/^\d+$/.test(digits)) return null;
  return digits.replace(/^0+(?=\d)/, "");
}

function sheetLooksCompatible(rows: unknown[][]) {
  return rows.some(
    (row) =>
      findLabel(row, "CADASTRO") >= 0 &&
      findLabel(row, "NOME") >= 0 &&
      findLabel(row, "ADMISSAO") >= 0 &&
      findLabel(row, "CARGO") >= 0 &&
      findLabel(row, "SALARIO") >= 0,
  );
}

function structureError(
  context: ParserContext,
  message: string,
  row?: number,
): never {
  throw new SalaryAdjustmentError(
    "REAJUSTE_STRUCTURE_INVALID",
    `A estrutura de ${context.sourceFile} não corresponde ao relatório FPRE131 esperado.`,
    [{ file: context.sourceFile, sheet: context.sourceSheet, row, message }],
  );
}

export function parseFpre131SheetRows(
  rows: unknown[][],
  context: ParserContext,
): ParsedSalaryRevisionEmployee[] {
  if (rows.length > MAX_ROWS_PER_FILE) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_ROW_LIMIT_EXCEEDED",
      `${context.sourceFile} excede o limite seguro de ${MAX_ROWS_PER_FILE.toLocaleString("pt-BR")} linhas.`,
      [],
      413,
    );
  }

  const employees: ParsedSalaryRevisionEmployee[] = [];
  const registrations = new Set<string>();
  let branchAlias = "";
  let registrationColumn = -1;
  let nameColumn = -1;
  let roleColumn = -1;
  let salaryColumn = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const sourceRow = index + 1;
    const branchMatch = text(row[0]).match(/^(\d{2})\s*,\s*(.+)$/);
    if (branchMatch) {
      branchAlias = canonicalBranchAlias(branchMatch[2]);
      continue;
    }

    const rowRegistrationColumn = findLabel(row, "CADASTRO");
    const rowNameColumn = findLabel(row, "NOME");
    const admissionColumn = findLabel(row, "ADMISSAO");
    const rowRoleColumn = findLabel(row, "CARGO");
    const rowSalaryColumn = findLabel(row, "SALARIO");
    if (
      rowRegistrationColumn >= 0 ||
      rowNameColumn >= 0 ||
      admissionColumn >= 0 ||
      rowRoleColumn >= 0 ||
      rowSalaryColumn >= 0
    ) {
      if (
        rowRegistrationColumn < 0 ||
        rowNameColumn < 0 ||
        admissionColumn < 0 ||
        rowRoleColumn < 0 ||
        rowSalaryColumn < 0
      ) {
        structureError(context, "Cabeçalho FPRE131 incompleto.", sourceRow);
      }
      registrationColumn = rowRegistrationColumn;
      nameColumn = rowNameColumn;
      roleColumn = rowRoleColumn;
      salaryColumn = rowSalaryColumn;
      continue;
    }

    if (
      !branchAlias ||
      registrationColumn < 0 ||
      nameColumn < 0 ||
      roleColumn < 0 ||
      salaryColumn < 0
    ) {
      continue;
    }
    const parsedRegistration = registration(row[registrationColumn]);
    if (!parsedRegistration) continue;
    const employeeName = text(row[nameColumn]);
    const role = text(row[roleColumn]);
    const salaryValue = row[salaryColumn];
    const hasSalary = salaryValue !== null && salaryValue !== undefined && salaryValue !== "";
    if (employeeName === "-" && !role && !hasSalary) continue;
    if (!employeeName || !role || !hasSalary) {
      structureError(context, "Colaborador com nome, cargo ou salário incompleto.", sourceRow);
    }
    if (registrations.has(parsedRegistration)) {
      throw new SalaryAdjustmentError(
        "REAJUSTE_REGISTRATION_DUPLICATE",
        `O cadastro ${parsedRegistration} aparece mais de uma vez em ${context.sourceFile}.`,
        [{
          file: context.sourceFile,
          sheet: context.sourceSheet,
          row: sourceRow,
          message: "Cadastro duplicado no relatório FPRE131.",
        }],
      );
    }
    let currentSalaryCents: bigint;
    try {
      currentSalaryCents = parseMoneyCents(salaryValue);
    } catch {
      structureError(context, "Salário vazio ou inválido.", sourceRow);
    }
    registrations.add(parsedRegistration);
    employees.push({
      ...context,
      sourceRow,
      branchAlias,
      registration: parsedRegistration,
      employeeName,
      role,
      currentSalaryCents,
    });
  }

  if (employees.length === 0) {
    structureError(context, "Nenhum colaborador válido foi encontrado.");
  }
  return employees;
}

export async function parseFpre131Workbook(
  bytes: Buffer,
  sourceFile: string,
): Promise<ParsedSalaryRevisionFile> {
  let workbook: ReturnType<typeof readPayrollWorkbookSheets>;
  try {
    workbook = readPayrollWorkbookSheets(bytes);
  } catch {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      `${sourceFile} não pôde ser lido como uma planilha XLSX válida.`,
    );
  }

  const plan1 = workbook.find((sheet) => comparable(sheet.sheet) === "PLAN1");
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
        ? `${sourceFile} possui mais de uma aba compatível com o FPRE131.`
        : `${sourceFile} não possui uma aba compatível com o relatório FPRE131.`,
    );
  }

  return {
    sourceFile,
    sourceSheet: selected.sheet,
    employees: parseFpre131SheetRows(selected.data as unknown[][], {
      sourceFile,
      sourceSheet: selected.sheet,
    }),
  };
}
