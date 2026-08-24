import {
  compareBranchAliases,
  comparePtBr,
} from "./branches";
import { SalaryAdjustmentError } from "./errors";
import { MAX_UNIQUE_EMPLOYEES } from "./limits";
import { calculateAdjustmentCents } from "./money";
import type {
  AppliedSalaryRevisionEmployee,
  ParsedSalaryRevisionFile,
  SalaryRevisionAnalysis,
  SalaryRevisionReport,
  SalaryRevisionRule,
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

  const employeeByRegistration = new Map(
    file.employees.map((employee) => [employee.registration, employee]),
  );
  const ruleByRegistration = new Map<string, SalaryRevisionRule>();
  const normalizedRules = rules.map((rule) => {
    const name = rule.name.replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) invalidRule("Nome de regra especial inválido.");
    if (
      rule.minimumSalaryCents < 0n ||
      rule.maximumSalaryCents < rule.minimumSalaryCents ||
      rule.newSalaryCents < 0n
    ) {
      invalidRule(`A regra ${name} possui uma faixa ou novo salário inválido.`);
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
      if (rule.newSalaryCents < employee.currentSalaryCents) {
        invalidRule(`O novo salário da regra ${name} é menor que o salário atual do cadastro ${selectedRegistration}.`);
      }
      if (ruleByRegistration.has(selectedRegistration)) {
        invalidRule(`O cadastro ${selectedRegistration} foi selecionado em mais de uma regra.`);
      }
      ruleByRegistration.set(selectedRegistration, normalizedRule);
    }
    return normalizedRule;
  });

  const applied = orderedEmployees(file).map((employee) => {
    const rule = ruleByRegistration.get(employee.registration);
    if (rule) {
      return {
        ...employee,
        application: {
          kind: "special" as const,
          ruleId: rule.id,
          ruleName: rule.name,
        },
        adjustmentCents: rule.newSalaryCents - employee.currentSalaryCents,
        newSalaryCents: rule.newSalaryCents,
      };
    }
    const adjustmentCents = calculateAdjustmentCents(
      employee.currentSalaryCents,
      generalPercentageBasisPoints,
    );
    return {
      ...employee,
      application: { kind: "general" as const },
      adjustmentCents,
      newSalaryCents: employee.currentSalaryCents + adjustmentCents,
    };
  });

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
    generalPercentageBasisPoints,
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
