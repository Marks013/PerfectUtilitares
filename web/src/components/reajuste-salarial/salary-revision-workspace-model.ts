"use client";

import { MAX_FILE_BYTES } from "@/lib/reajuste-salarial/limits";
import {
  parseMoneyCents,
  parsePercentageBasisPoints,
} from "@/lib/reajuste-salarial/money";
import type {
  SalaryRevisionAnalysis,
  SalaryRevisionAnalysisEmployee,
} from "@/lib/reajuste-salarial/salary-revision-types";

export type SalaryRevisionRuleDraft = {
  id: string;
  name: string;
  minimumSalary: string;
  maximumSalary: string;
  newSalary: string;
  selectedRegistrations: string[];
};

export type SalaryRevisionClientState =
  | { status: "idle" }
  | { status: "analyzing" }
  | { status: "ready" }
  | { status: "generating"; progress: number }
  | { status: "success"; fileName: string }
  | { status: "error"; messages: string[] };

export function validateSalaryRevisionFile(file: File | null) {
  if (!file) return ["Selecione um arquivo FPRE131 em formato .xlsx."];
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return ["Somente arquivos .xlsx são aceitos."];
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    return ["O arquivo deve ter entre 1 byte e 10 MB."];
  }
  return [];
}

function centsOrNull(value: string) {
  try {
    return parseMoneyCents(value);
  } catch {
    return null;
  }
}

export function candidatesForRule(
  analysis: SalaryRevisionAnalysis,
  rule: SalaryRevisionRuleDraft,
) {
  const minimum = centsOrNull(rule.minimumSalary);
  const maximum = centsOrNull(rule.maximumSalary);
  if (minimum === null || maximum === null || maximum < minimum) return [];
  return analysis.employees.filter((employee) => {
    const salary = BigInt(employee.currentSalaryCents);
    return salary >= minimum && salary <= maximum;
  });
}

export function selectedByOtherRules(
  rules: SalaryRevisionRuleDraft[],
  ruleId: string,
) {
  return new Set(
    rules
      .filter((rule) => rule.id !== ruleId)
      .flatMap((rule) => rule.selectedRegistrations),
  );
}

export function formatClientCents(value: string | bigint) {
  const cents = typeof value === "bigint" ? value : BigInt(value);
  const whole = (cents / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${whole},${(cents % 100n).toString().padStart(2, "0")}`;
}

export function validateSalaryRevisionGeneration(
  file: File | null,
  analysis: SalaryRevisionAnalysis | null,
  percentage: string,
  rules: SalaryRevisionRuleDraft[],
) {
  const messages = validateSalaryRevisionFile(file);
  if (!analysis) messages.push("Analise o arquivo antes de gerar o PDF.");
  try {
    parsePercentageBasisPoints(percentage);
  } catch {
    messages.push("Informe um percentual geral entre 0,01 e 100,00.");
  }
  const selectedGlobally = new Set<string>();
  const employeeByRegistration = new Map(
    analysis?.employees.map((employee) => [employee.registration, employee]) ?? [],
  );
  for (const rule of rules) {
    const minimum = centsOrNull(rule.minimumSalary);
    const maximum = centsOrNull(rule.maximumSalary);
    const newSalary = centsOrNull(rule.newSalary);
    if (!rule.name.trim() || minimum === null || maximum === null || newSalary === null) {
      messages.push(`Complete nome, faixa e novo salário da regra ${rule.name || "sem nome"}.`);
      continue;
    }
    if (maximum < minimum) {
      messages.push(`A faixa da regra ${rule.name} está invertida.`);
    }
    if (rule.selectedRegistrations.length === 0) {
      messages.push(`Selecione ao menos um colaborador na regra ${rule.name}.`);
    }
    for (const registration of rule.selectedRegistrations) {
      if (selectedGlobally.has(registration)) {
        messages.push(`O cadastro ${registration} está em mais de uma regra.`);
      }
      selectedGlobally.add(registration);
      const employee = employeeByRegistration.get(registration);
      if (!employee) continue;
      const current = BigInt(employee.currentSalaryCents);
      if (current < minimum || current > maximum) {
        messages.push(`O cadastro ${registration} está fora da faixa da regra ${rule.name}.`);
      }
      if (newSalary < current) {
        messages.push(`O novo salário da regra ${rule.name} é menor que o atual do cadastro ${registration}.`);
      }
    }
  }
  return [...new Set(messages)];
}

export function serializeSalaryRevisionRules(rules: SalaryRevisionRuleDraft[]) {
  return JSON.stringify(
    rules.map((rule) => ({
      id: rule.id,
      name: rule.name.trim(),
      minimumSalaryCents: parseMoneyCents(rule.minimumSalary).toString(),
      maximumSalaryCents: parseMoneyCents(rule.maximumSalary).toString(),
      newSalaryCents: parseMoneyCents(rule.newSalary).toString(),
      selectedRegistrations: rule.selectedRegistrations,
    })),
  );
}

export function employeeMatchesSearch(
  employee: SalaryRevisionAnalysisEmployee,
  query: string,
) {
  const normalized = query.trim().toLocaleUpperCase("pt-BR");
  if (!normalized) return true;
  return [
    employee.employeeName,
    employee.registration,
    employee.role,
    employee.branchAlias,
  ].some((value) => value.toLocaleUpperCase("pt-BR").includes(normalized));
}
