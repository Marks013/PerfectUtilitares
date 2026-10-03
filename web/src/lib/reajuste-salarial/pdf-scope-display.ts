import { formatPercentageHundredThousandths } from "./money";
import type { SalaryAdvanceReport } from "./types";

export function salaryAdvanceScopeLabel(report: SalaryAdvanceReport) {
  return report.salaryScope === "drivers-forklift"
    ? "Sindicato de Motoristas e Operadores de Empilhadeira — apuração exclusiva"
    : "Sindicato padrão — exclui Motoristas e Operadores de Empilhadeira";
}

export function salaryAdvancePercentageLabel(report: SalaryAdvanceReport) {
  return report.salaryScope === "drivers-forklift"
    ? `Percentual próprio: ${report.driverPercentageHundredThousandths !== undefined ? formatPercentageHundredThousandths(report.driverPercentageHundredThousandths) : report.driverPercentageTenThousandths !== undefined ? formatPercentageHundredThousandths(report.driverPercentageTenThousandths * 10n) : "não informado"}`
    : `Geral: ${formatPercentageHundredThousandths(report.percentageHundredThousandths ?? report.percentageBasisPoints * 1000n)} | Embalador a mão: ${formatPercentageHundredThousandths(report.packerPercentageHundredThousandths ?? (report.packerPercentageTenThousandths ?? 22655n) * 10n)}`;
}
