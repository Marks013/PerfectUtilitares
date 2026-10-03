import { SalaryAdjustmentError } from "./errors";
import { parsePercentageHundredThousandths } from "./money";
import type { SalaryAdvanceScope } from "./types";

export function isDriversForkliftRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const value = role.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/^\s*\d+\s*[-.:]?\s*/, "").replace(/\s+/g, " ").trim();
  return /^MOTORISTA(?:\s|$)/.test(value) || /^OPERADOR(?:\s+DE)?\s+EMPILHADEIRA(?:\s|$)/.test(value);
}

export function payrollScopeEligible(role: string | null | undefined, scope: SalaryAdvanceScope): boolean {
  return scope === "drivers-forklift" ? isDriversForkliftRole(role) : !isDriversForkliftRole(role);
}

export function payrollScopeExclusionReason(role: string | null | undefined, scope: SalaryAdvanceScope): string | null {
  if (payrollScopeEligible(role, scope)) return null;
  return scope === "standard" ? "Cargo de outro sindicato: Motorista ou Operador de Empilhadeira."
    : "Cargo fora da apuração exclusiva de Motoristas e Operadores de Empilhadeira.";
}

function singleField(form: FormData, name: string): string | undefined {
  const values = form.getAll(name);
  if (values.length > 1 || (values.length === 1 && typeof values[0] !== "string")) {
    throw new SalaryAdjustmentError("REAJUSTE_PERCENTAGE_INVALID", "Informe um único valor textual para cada configuração da antecipação.");
  }
  return values[0] as string | undefined;
}

export function parseSalaryAdvanceScope(form: FormData): SalaryAdvanceScope {
  const values = form.getAll("salaryScope");
  const value = values[0] ?? "standard";
  if (values.length > 1 || (value !== "standard" && value !== "drivers-forklift")) {
    throw new SalaryAdjustmentError("REAJUSTE_SCOPE_INVALID", "Escolha uma única apuração: sindicato principal ou somente Motoristas e Operadores de Empilhadeira.");
  }
  return value;
}

export function parseSalaryAdvanceScopeSettings(form: FormData) {
  const salaryScope = parseSalaryAdvanceScope(form);
  const percentage = singleField(form, "percentage");
  const packer = singleField(form, "packerPercentage");
  const driver = singleField(form, "driverPercentage");
  const percentageHundredThousandths = salaryScope === "standard" ? parsePercentageHundredThousandths(percentage ?? "") : 0n;
  const packerPercentageHundredThousandths = salaryScope === "standard" ? parsePercentageHundredThousandths(packer ?? "") : 0n;
  const driverPercentageHundredThousandths = salaryScope === "drivers-forklift" ? parsePercentageHundredThousandths(driver ?? "") : undefined;
  return {
    salaryScope,
    percentageHundredThousandths,
    packerPercentageHundredThousandths,
    driverPercentageHundredThousandths,
    percentageBasisPoints: percentageHundredThousandths / 1_000n,
    packerPercentageTenThousandths: packerPercentageHundredThousandths / 10n,
    driverPercentageTenThousandths: driverPercentageHundredThousandths === undefined ? undefined : driverPercentageHundredThousandths / 10n,
  };
}
