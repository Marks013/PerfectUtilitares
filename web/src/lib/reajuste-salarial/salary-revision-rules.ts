import {
  compareBranchAliases,
  comparePtBr,
} from "./branches";
import { SalaryAdjustmentError } from "./errors";
import { MAX_UNIQUE_EMPLOYEES } from "./limits";
import { calculateAdjustmentCents } from "./money";
import { salaryRevisionRoleMatches, salaryRevisionUsesGeneralPercentage } from "./salary-revision-matching";
import type {
  AppliedSalaryRevisionEmployee,
  ParsedSalaryRevisionFile,
  SalaryRevisionAnalysis,
  SalaryRevisionReport,
  SalaryRevisionRule,
  SalaryRevisionScope,
} from "./salary-revision-types";

export const MAX_SALARY_REVISION_RULES = 20;

function normalizeRegistration(value: string) {
  const digits = value.replace(/\s+/g, "");
  return /^\d+$/.test(digits) ? digits.replace(/^0+(?=\d)/, "") : null;
}

function orderedEmployees(file: ParsedSalaryRevisionFile) {
  return [...file.employees].sort(
    (left, right) =>
      compareBranchAliases(left.branchAlias, right.branchAlias) ||
      comparePtBr(left.employeeName, right.employeeName) ||
      left.registration.localeCompare(right.registration),
  );
}

export function buildSalaryRevisionAnalysis(
  file: ParsedSalaryRevisionFile,
  fileHash: string,
): SalaryRevisionAnalysis {
  if (file.employees.length > MAX_UNIQUE_EMPLOYEES) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_ROW_LIMIT_EXCEEDED",
      `O relatório ultrapassa o limite de ${MAX_UNIQUE_EMPLOYEES.toLocaleString("pt-BR")} colaboradores.`,
      [],
      413,
    );
  }
  const employees = orderedEmployees(file);
  const salaryCounts = new Map<bigint, number>();
  for (const employee of employees) {
    salaryCounts.set(
      employee.currentSalaryCents,
      (salaryCounts.get(employee.currentSalaryCents) ?? 0) + 1,
    );
  }
  const salaries = [...salaryCounts.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return {
    fileHash,
    sourceFile: file.sourceFile,
    employeeCount: employees.length,
    branchCount: new Set(employees.map((employee) => employee.branchAlias)).size,
    distinctSalaryCount: salaries.length,
    minimumSalaryCents: salaries[0]?.[0].toString() ?? "0",
    maximumSalaryCents: salaries.at(-1)?.[0].toString() ?? "0",
    employees: employees.map((employee) => ({
      branchAlias: employee.branchAlias,
      registration: employee.registration,
      employeeName: employee.employeeName,
      role: employee.role,
      currentSalaryCents: employee.currentSalaryCents.toString(),
    })),
    salaries: salaries.map(([salaryCents, employeeCount]) => ({
      salaryCents: salaryCents.toString(),
      employeeCount,
    })),
  };
}

function invalidRule(message: string): never {
  throw new SalaryAdjustmentError("REAJUSTE_RULE_INVALID", message);
}

export function applySalaryRevisionRules(
  file: ParsedSalaryRevisionFile,
  generalPercentageBasisPoints: bigint,
  rules: SalaryRevisionRule[],
  generatedAt = new Date(),
  adjustmentScope: SalaryRevisionScope = "all",
): SalaryRevisionReport {
  if (rules.length > MAX_SALARY_REVISION_RULES) {
    invalidRule(`Use no máximo ${MAX_SALARY_REVISION_RULES} regras especiais.`);
  }
  if (file.employees.length > MAX_UNIQUE_EMPLOYEES) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_ROW_LIMIT_EXCEEDED",
      `O relatório ultrapassa o limite de ${MAX_UNIQUE_EMPLOYEES.toLocaleString("pt-BR")} colaboradores.`,
      [],
      413,
    );
  }
  if (adjustmentScope === "rules_only" && rules.length === 0) {
    invalidRule("Adicione ao menos uma regra no escopo somente selecionados.");
  }
  const usesGeneralPercentage = salaryRevisionUsesGeneralPercentage(adjustmentScope, rules);
  if (usesGeneralPercentage && (generalPercentageBasisPoints < 1n || generalPercentageBasisPoints > 10_000n)) {
    invalidRule("Informe um percentual geral entre 0,01 e 100,00.");
  }

  const employeeByRegistration = new Map(
    file.employees.map((employee) => [employee.registration, employee]),
  );
  const ruleByRegistration = new Map<string, SalaryRevisionRule>();
  const ruleIds = new Set<string>();
  const normalizedRules = rules.map((rule) => {
    const name = rule.name.replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) invalidRule("Nome de regra especial inválido.");
    if (ruleIds.has(rule.id)) invalidRule(`O identificador da regra ${name} está duplicado.`);
    ruleIds.add(rule.id);
    if (
      rule.minimumSalaryCents < 0n ||
      rule.maximumSalaryCents < rule.minimumSalaryCents
    ) {
      invalidRule(`A regra ${name} possui uma faixa ou novo salário inválido.`);
    }
    if (rule.calculation !== undefined && !["fixed", "general_percentage", "percentage"].includes(rule.calculation)) {
      invalidRule(`A regra ${name} possui cálculo inválido.`);
    }
    if (rule.calculation === undefined || rule.calculation === "fixed") {
      if (typeof rule.newSalaryCents !== "bigint" || rule.newSalaryCents < 0n || rule.percentageBasisPoints !== undefined) {
        invalidRule(`A regra ${name} possui novo salário inválido.`);
      }
    } else if (rule.newSalaryCents !== undefined || (rule.calculation === "general_percentage" && rule.percentageBasisPoints !== undefined)) {
      invalidRule(`A regra ${name} possui campos de cálculo conflitantes.`);
    } else if (rule.calculation === "percentage" && (typeof rule.percentageBasisPoints !== "bigint" || rule.percentageBasisPoints < 1n || rule.percentageBasisPoints > 10_000n)) {
      invalidRule(`A regra ${name} exige percentual entre 0,01 e 100,00.`);
    }
    if (rule.roleFilter !== undefined && (typeof rule.roleFilter !== "string" || rule.roleFilter.trim().length > 120)) {
      invalidRule(`A regra ${name} possui filtro de cargo inválido.`);
    }
    if (rule.selectedRegistrations.length === 0) {
      invalidRule(`A regra ${name} não possui colaboradores selecionados.`);
    }
    const selectedRegistrations = rule.selectedRegistrations.map((value) => {
      const normalized = normalizeRegistration(value);
      if (!normalized) invalidRule(`A regra ${name} contém cadastro inválido.`);
      return normalized;
    });
    if (new Set(selectedRegistrations).size !== selectedRegistrations.length) {
      invalidRule(`A regra ${name} repete o mesmo cadastro.`);
    }
    const normalizedRule = { ...rule, name, selectedRegistrations };
    for (const selectedRegistration of selectedRegistrations) {
      const employee = employeeByRegistration.get(selectedRegistration);
      if (!employee) {
        invalidRule(`O cadastro ${selectedRegistration} da regra ${name} não existe no arquivo.`);
      }
      if (
        employee.currentSalaryCents < rule.minimumSalaryCents ||
        employee.currentSalaryCents > rule.maximumSalaryCents
      ) {
        invalidRule(`O cadastro ${selectedRegistration} está fora da faixa da regra ${name}.`);
      }
      if (!salaryRevisionRoleMatches(employee.role, rule.roleFilter)) {
        invalidRule(`O cadastro ${selectedRegistration} possui cargo diferente do filtro da regra ${name}.`);
      }
      if ((rule.calculation === undefined || rule.calculation === "fixed") && rule.newSalaryCents < employee.currentSalaryCents) {
        invalidRule(`O novo salário da regra ${name} é menor que o salário atual do cadastro ${selectedRegistration}.`);
      }
      if (ruleByRegistration.has(selectedRegistration)) {
        invalidRule(`O cadastro ${selectedRegistration} foi selecionado em mais de uma regra.`);
      }
      ruleByRegistration.set(selectedRegistration, normalizedRule);
    }
    return normalizedRule;
  });

  const applied = orderedEmployees(file).flatMap<AppliedSalaryRevisionEmployee>(
    (employee) => {
    const rule = ruleByRegistration.get(employee.registration);
    if (rule) {
      const percentageBasisPoints = rule.calculation === "percentage"
        ? rule.percentageBasisPoints
        : rule.calculation === "general_percentage" ? generalPercentageBasisPoints : undefined;
      const adjustmentCents = rule.calculation === undefined || rule.calculation === "fixed"
        ? rule.newSalaryCents - employee.currentSalaryCents
        : calculateAdjustmentCents(employee.currentSalaryCents, rule.calculation === "percentage" ? rule.percentageBasisPoints : generalPercentageBasisPoints);
      return [{
        ...employee,
        application: {
          kind: "special" as const,
          ruleId: rule.id,
          ruleName: rule.name,
          ...(percentageBasisPoints !== undefined ? { percentageBasisPoints } : {}),
        },
        adjustmentCents,
        newSalaryCents: employee.currentSalaryCents + adjustmentCents,
      }];
    }
    if (adjustmentScope === "rules_only") return [];
    const adjustmentCents = calculateAdjustmentCents(
      employee.currentSalaryCents,
      generalPercentageBasisPoints,
    );
    return [{
      ...employee,
      application: { kind: "general" as const },
      adjustmentCents,
      newSalaryCents: employee.currentSalaryCents + adjustmentCents,
    }];
    },
  );

  const grouped = new Map<string, AppliedSalaryRevisionEmployee[]>();
  for (const employee of applied) {
    const group = grouped.get(employee.branchAlias) ?? [];
    group.push(employee);
    grouped.set(employee.branchAlias, group);
  }
  const groups = [...grouped.entries()]
    .sort(([left], [right]) => compareBranchAliases(left, right))
    .map(([branchAlias, employees]) => ({
      branchAlias,
      employees,
      employeeCount: employees.length,
      currentPayrollCents: employees.reduce(
        (total, employee) => total + employee.currentSalaryCents,
        0n,
      ),
      adjustmentSubtotalCents: employees.reduce(
        (total, employee) => total + employee.adjustmentCents,
        0n,
      ),
      newPayrollCents: employees.reduce(
        (total, employee) => total + employee.newSalaryCents,
        0n,
      ),
    }));
  const currentPayrollCents = groups.reduce(
    (total, group) => total + group.currentPayrollCents,
    0n,
  );
  const totalAdjustmentCents = groups.reduce(
    (total, group) => total + group.adjustmentSubtotalCents,
    0n,
  );

  return {
    parserProfile: "fpre131-reajuste-v1",
    sourceFile: file.sourceFile,
    generatedAt,
    adjustmentScope,
    generalPercentageBasisPoints:
      usesGeneralPercentage ? generalPercentageBasisPoints : null,
    rules: normalizedRules,
    groups,
    employeeCount: applied.length,
    generalEmployeeCount: applied.filter(
      (employee) => employee.application.kind === "general",
    ).length,
    specialEmployeeCount: ruleByRegistration.size,
    currentPayrollCents,
    totalAdjustmentCents,
    newPayrollCents: currentPayrollCents + totalAdjustmentCents,
  };
}
