import { parseCompetencyFileName, sortAndValidateCompetencies } from "./competency";
import { SalaryAdjustmentError } from "./errors";
import type { EventAdjustmentSettings } from "./event-adjustment-types";
import { parseSalaryEventWorkbook } from "./event-parser";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_FILE_BYTES, MIN_FILES, MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES, MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES } from "./limits";
import { parseMoneyCents } from "./money";
import { prepareXlsxArchive } from "@/lib/spreadsheets/xlsx-security";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function invalid(message: string): never {
  throw new SalaryAdjustmentError("REAJUSTE_RULE_INVALID", message);
}

function money(value: unknown, label: string): string;
function money(value: unknown, label: string, optional: true): string | null;
function money(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 32) {
    return invalid(`Informe ${label} em reais.`);
  }
  let cents: bigint;
  try {
    cents = parseMoneyCents(value);
  } catch {
    return invalid(`Informe ${label} em reais, como 85,00.`);
  }
  if (cents <= 0n || cents > 100_000_000_000n) return invalid(`${label} deve ser maior que zero e estar dentro do limite aceito.`);
  return cents.toString();
}

export function parseEventAdjustmentSettings(formData: FormData): EventAdjustmentSettings {
  const bonusOldValueCents = money(formData.get("bonusOldValue"), "o valor anterior do bônus");
  const sundayOldValueCents = money(formData.get("sundayOldValue"), "o valor anterior por domingo");
  const bonusNewValueCents = money(formData.get("bonusNewValue"), "o novo valor do bônus", true);
  const sundayNewValueCents = money(formData.get("sundayNewValue"), "o novo valor por domingo", true);
  const encoded = formData.get("historicOverrides");
  let overrides: unknown = [];
  if (encoded !== null && encoded !== "") {
    if (typeof encoded !== "string" || encoded.length > 4096) return invalid("As exceções por competência são inválidas.");
    try { overrides = JSON.parse(encoded); } catch { return invalid("As exceções por competência são inválidas."); }
  }
  if (!Array.isArray(overrides) || overrides.length > MAX_FILES) return invalid("Informe no máximo uma exceção por competência enviada.");
  const seen = new Set<string>();
  const historicOverrides = overrides.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return invalid("Uma exceção por competência é inválida.");
    const row = entry as Record<string, unknown>;
    if (typeof row.competencyKey !== "string") return invalid("Informe a competência da exceção.");
    const competency = parseCompetencyFileName(`${row.competencyKey}.xlsx`);
    if (seen.has(competency.key)) return invalid("Há mais de uma exceção para a mesma competência.");
    seen.add(competency.key);
    return {
      competencyKey: competency.key,
      bonusOldValueCents: money(row.bonusOldValue, "o valor anterior do bônus na exceção"),
      sundayOldValueCents: money(row.sundayOldValue, "o valor anterior por domingo na exceção"),
    };
  });
  return { bonusOldValueCents, bonusNewValueCents, sundayOldValueCents, sundayNewValueCents, historicOverrides };
}

export function validateEventAdjustmentFiles(values: FormDataEntryValue[]) {
  if (values.length < MIN_FILES || values.length > MAX_FILES || values.some((value) => typeof value !== "object" || !value || !("arrayBuffer" in value) || !("name" in value) || !("size" in value))) {
    throw new SalaryAdjustmentError("REAJUSTE_WORKBOOK_INVALID", `Envie de ${MIN_FILES} a ${MAX_FILES} arquivos .xlsx.`);
  }
  const files = values as File[];
  let totalBytes = 0;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".xlsx") || (file.type && file.type !== XLSX_MIME) || file.size === 0) {
      throw new SalaryAdjustmentError("REAJUSTE_WORKBOOK_INVALID", "Um dos arquivos enviados não é um XLSX válido.");
    }
    if (file.size > MAX_FILE_BYTES) throw new SalaryAdjustmentError("REAJUSTE_ROW_LIMIT_EXCEEDED", "Um arquivo ultrapassa o limite de 10 MB.", [], 413);
    totalBytes += file.size;
  }
  if (totalBytes > MAX_TOTAL_FILE_BYTES) throw new SalaryAdjustmentError("REAJUSTE_ROW_LIMIT_EXCEEDED", "O conjunto de arquivos ultrapassa o limite de 20 MB.", [], 413);
  const withCompetency = files.map((file) => ({ file, competency: parseCompetencyFileName(file.name) }));
  const competencies = sortAndValidateCompetencies(withCompetency.map((item) => item.competency));
  const byKey = new Map(withCompetency.map((item) => [item.competency.key, item.file]));
  return { files: competencies.map((competency) => {
    const file = byKey.get(competency.key);
    if (!file) return invalid("Não foi possível localizar um arquivo da competência.");
    return { file, competency };
  }), totalBytes };
}

export async function parseEventAdjustmentFiles(validated: ReturnType<typeof validateEventAdjustmentFiles>) {
  const parsed = [];
  for (const { file, competency } of validated.files) {
    const bytes = prepareXlsxArchive(Buffer.from(await file.arrayBuffer()), {
      strict: true,
      maxEntryUncompressedBytes: MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES,
      maxTotalUncompressedBytes: MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES,
    });
    parsed.push(await parseSalaryEventWorkbook(bytes, competency, file.name));
  }
  return parsed;
}
