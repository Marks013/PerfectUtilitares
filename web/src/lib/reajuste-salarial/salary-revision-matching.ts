import type { SalaryRevisionRule, SalaryRevisionScope } from "./salary-revision-types";

function normalizeRole(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
}

export function salaryRevisionRoleMatches(role: string, filter?: string) {
  return !filter?.trim() || normalizeRole(role) === normalizeRole(filter);
}

export function salaryRevisionUsesGeneralPercentage(
  scope: SalaryRevisionScope,
  rules: readonly { calculation?: SalaryRevisionRule["calculation"] }[],
) {
  return scope === "all" || rules.some((rule) => rule.calculation === "general_percentage");
}
