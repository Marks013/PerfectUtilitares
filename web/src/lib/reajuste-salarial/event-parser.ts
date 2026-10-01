import { SalaryAdjustmentError } from "./errors";
import { parseMoneyCents } from "./money";
import { readPayrollWorkbookSheets } from "./ooxml-reader";
import { parsePayrollSheetRows } from "./parser";
import type { Competency } from "./types";
import type { ParsedSalaryEventFile, ParsedSalaryEventEmployee } from "./event-adjustment-types";

function text(value: unknown): string {
  return value == null ? "" : String(value).replace(/\u00a0/g, " ").trim();
}

function normalized(value: unknown): string {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

function structural(message: string, sourceFile: string, sourceSheet: string, row?: number): never {
  throw new SalaryAdjustmentError("REAJUSTE_STRUCTURE_INVALID", message, [{ file: sourceFile, sheet: sourceSheet, row, message }]);
}

/** Only detailed monthly payroll contains the individual event evidence. */
export async function parseSalaryEventWorkbook(bytes: Buffer, competency: Competency, sourceFile: string): Promise<ParsedSalaryEventFile> {
  let sheets: ReturnType<typeof readPayrollWorkbookSheets>;
  try {
    sheets = readPayrollWorkbookSheets(bytes);
  } catch (error) {
    if (error instanceof SalaryAdjustmentError) throw error;
    throw new SalaryAdjustmentError("REAJUSTE_WORKBOOK_INVALID", `${sourceFile} não pôde ser lido como uma planilha XLSX válida.`);
  }
  const compatible = sheets.filter(({ data }) => data.some((row) => row?.some((cell) => normalized(cell) === "FOLHA DE PAGAMENTO"))
    && data.some((row) => row?.some((cell) => normalized(cell) === "COLABORADOR:")));
  if (compatible.length !== 1) {
    throw new SalaryAdjustmentError("REAJUSTE_WORKBOOK_INVALID", compatible.length > 1
      ? `${sourceFile} possui mais de uma folha detalhada; mantenha somente uma aba.`
      : `${sourceFile} exige FOLHA DE PAGAMENTO detalhada com rubricas individuais. O relatório de INSS não contém os eventos.`);
  }
  const { data, sheet: sourceSheet } = compatible[0];
  const payroll = parsePayrollSheetRows(data, { competency, sourceFile, sourceSheet });
  const rows: ParsedSalaryEventEmployee[] = payroll.map(({ registration, employeeName, branchAlias }) => ({ registration, employeeName, branchAlias, events: { "565": [], "901": [] } }));
  const byRegistration = new Map(rows.map((row) => [row.registration, row]));
  const companies = new Map<string, string>();
  let employee: ParsedSalaryEventEmployee | undefined;
  for (let index = 0; index < data.length; index += 1) {
    const row = data[index] ?? [];
    // Repeated page headers preserve the active employee but must belong to one company.
    if (row.some((cell) => /^PAG\.?\s*:$/.test(normalized(cell))) && /^\d+$/.test(text(row[0])) && text(row[1])) {
      const company = `${text(row[0]).replace(/^0+(?=\d)/, "")} - ${text(row[1])}`;
      companies.set(normalized(company), company);
      if (companies.size > 1) structural("A folha contém empresas diferentes; separe os arquivos por empresa.", sourceFile, sourceSheet, index + 1);
    }
    const collaborator = row.findIndex((cell) => normalized(cell) === "COLABORADOR:");
    if (collaborator >= 0) {
      const identification = row.slice(collaborator + 1).find((cell) => text(cell));
      const registration = /^(\d+)\s*-/.exec(text(identification))?.[1].replace(/^0+(?=\d)/, "");
      employee = registration ? byRegistration.get(registration) : undefined;
      if (!employee) structural("Colaborador sem cadastro válido para os eventos.", sourceFile, sourceSheet, index + 1);
      continue;
    }
    if (row.some((cell) => normalized(cell) === "INSS PROC:")) {
      employee = undefined;
      continue;
    }
    if (!employee) continue;
    for (const [codeColumn, typeColumn, referenceColumn, valueColumn] of [[0, 1, 4, 5], [8, 9, 12, 14]]) {
      const rawCode = text(row[codeColumn]);
      if (!/^\d+$/.test(rawCode)) continue;
      const code = rawCode.replace(/^0+(?=\d)/, "");
      if (code !== "565" && code !== "901") continue;
      const type = text(row[typeColumn]);
      if (!/^0*1$/.test(type)) structural(`O evento ${code} não está identificado como provento tipo 01.`, sourceFile, sourceSheet, index + 1);
      let paidCents: bigint;
      try { paidCents = parseMoneyCents(row[valueColumn]); }
      catch { structural(`Valor inválido no evento ${code}.`, sourceFile, sourceSheet, index + 1); }
      employee.events[code].push({ paidCents: paidCents.toString(), reference: text(row[referenceColumn]), sourceRow: index + 1 });
    }
  }
  return { competency, sourceFile, sourceSheet, company: companies.values().next().value ?? null, rows };
}
