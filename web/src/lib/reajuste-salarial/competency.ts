import { SalaryAdjustmentError } from "./errors";
import type { Competency } from "./types";

const COMPETENCY_FILE = /^(0[1-9]|1[0-2])-(\d{4})\.xlsx$/i;

export function parseCompetencyFileName(fileName: string): Competency {
  const match = COMPETENCY_FILE.exec(fileName.trim());
  if (!match) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_COMPETENCY_INVALID",
      `O arquivo "${fileName}" deve seguir o padrão MM-AAAA.xlsx.`,
    );
  }

  const month = Number(match[1]);
  const year = Number(match[2]);
  if (year < 2000 || year > 2100) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_COMPETENCY_INVALID",
      `A competência de "${fileName}" está fora do intervalo aceito.`,
    );
  }

  return {
    key: `${match[1]}-${match[2]}`,
    month,
    year,
    order: year * 100 + month,
  };
}

export function sortAndValidateCompetencies(competencies: Competency[]) {
  const seen = new Set<string>();
  for (const competency of competencies) {
    if (seen.has(competency.key)) {
      throw new SalaryAdjustmentError(
        "REAJUSTE_COMPETENCY_DUPLICATE",
        `A competência ${competency.key} foi enviada mais de uma vez.`,
      );
    }
    seen.add(competency.key);
  }
  return [...competencies].sort((left, right) => left.order - right.order);
}
