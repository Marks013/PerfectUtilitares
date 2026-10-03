import { SalaryAdjustmentError } from "./errors";
import { MAX_UNIQUE_EMPLOYEES, PARSER_PROFILE } from "./limits";
import { calculateAdjustmentAtHundredThousandths } from "./money";
import { payrollScopeEligible, payrollScopeExclusionReason } from "./payroll-scope";
import { DEFAULT_PACKER_PERCENTAGE_TEN_THOUSANDTHS, isHandPacker, payrollExclusionReason } from "./advance-rules";
import {
  canonicalBranchAlias,
  compareBranchAliases,
  comparePtBr,
} from "./branches";
import type {
  ConsolidatedEmployee,
  ParsedPayrollFile,
  SalaryAdvanceReport,
  SalaryAdvanceScopeOptions,
} from "./types";

function normalizeComparableText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

export function consolidateSalaryAdvanceFiles(
  files: ParsedPayrollFile[],
  percentageBasisPoints: bigint,
  generatedAt = new Date(),
  packerPercentageTenThousandths = DEFAULT_PACKER_PERCENTAGE_TEN_THOUSANDTHS,
  scopeOptions: SalaryAdvanceScopeOptions = { salaryScope: "standard" },
): SalaryAdvanceReport {
  const { salaryScope, driverPercentageTenThousandths } = scopeOptions;
  const percentageHundredThousandths = scopeOptions.percentageHundredThousandths ?? percentageBasisPoints * 1_000n;
  const packerPercentageHundredThousandths = scopeOptions.packerPercentageHundredThousandths ?? packerPercentageTenThousandths * 10n;
  const driverPercentageHundredThousandths = scopeOptions.driverPercentageHundredThousandths ?? (driverPercentageTenThousandths === undefined ? undefined : driverPercentageTenThousandths * 10n);
  if (salaryScope !== "standard" && salaryScope !== "drivers-forklift") throw new SalaryAdjustmentError("REAJUSTE_SCOPE_INVALID", "Apuração sindical inválida.");
  if (salaryScope === "standard" && [scopeOptions.percentageHundredThousandths, scopeOptions.packerPercentageHundredThousandths].some((rate) => rate !== undefined && (typeof rate !== "bigint" || rate <= 0n || rate > 10_000_000n))) {
    throw new SalaryAdjustmentError("REAJUSTE_PERCENTAGE_INVALID", "Informe percentuais entre 0,00001% e 100%.");
  }
  if (salaryScope === "drivers-forklift" && (typeof driverPercentageHundredThousandths !== "bigint" || driverPercentageHundredThousandths <= 0n || driverPercentageHundredThousandths > 10_000_000n)) {
    throw new SalaryAdjustmentError("REAJUSTE_PERCENTAGE_INVALID", "Informe o percentual próprio de Motoristas e Operadores de Empilhadeira.");
  }
  const ordered = [...files].sort(
    (left, right) => left.competency.order - right.competency.order,
  );
  const competencies = ordered.map((file) => file.competency);
  const employees = new Map<
    string,
    {
      employee: ConsolidatedEmployee;
      comparableName: string;
    }
  >();

  for (const file of ordered) {
    for (const row of file.rows) {
      const comparableName = normalizeComparableText(row.employeeName);
      const branchAlias = canonicalBranchAlias(row.branchAlias);
      const existing = employees.get(row.registration);
      if (existing && existing.comparableName !== comparableName) {
        throw new SalaryAdjustmentError(
          "REAJUSTE_NAME_CONFLICT",
          `O cadastro ${row.registration} possui nomes diferentes entre as competências.`,
          [{ file: row.sourceFile, sheet: row.sourceSheet, row: row.sourceRow, message: "Nome divergente para o mesmo cadastro." }],
        );
      }

      const employee = existing?.employee ?? {
        registration: row.registration,
        employeeName: row.employeeName,
        branchAlias,
        basesByCompetency: new Map<string, bigint | null>(),
        adjustmentsByCompetency: new Map<string, bigint>(),
        totalAdjustmentCents: 0n,
        advanceRulesByCompetency: new Map(),
      };
      employee.employeeName = row.employeeName;
      employee.branchAlias = branchAlias;
      employee.basesByCompetency.set(file.competency.key, row.baseCents);
      employee.advanceRulesByCompetency?.set(file.competency.key, {
        employmentStatus: row.employmentStatus ?? null,
        role: row.role ?? null,
        percentageTenThousandths: (salaryScope === "drivers-forklift" ? driverPercentageHundredThousandths ?? 0n : isHandPacker(row.role) ? packerPercentageHundredThousandths : percentageHundredThousandths) / 10n,
        percentageHundredThousandths: salaryScope === "drivers-forklift" ? driverPercentageHundredThousandths ?? 0n : isHandPacker(row.role) ? packerPercentageHundredThousandths : percentageHundredThousandths,
        exclusionReason: payrollExclusionReason(row.employmentStatus) ?? payrollScopeExclusionReason(row.role, salaryScope),
        scopeEligible: payrollScopeEligible(row.role, salaryScope),
        metadataKnown: Boolean(row.employmentStatus && row.role),
      });
      employees.set(row.registration, { employee, comparableName });
    }
  }

  if (employees.size > MAX_UNIQUE_EMPLOYEES) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_ROW_LIMIT_EXCEEDED",
      `O conjunto ultrapassa o limite de ${MAX_UNIQUE_EMPLOYEES.toLocaleString("pt-BR")} colaboradores.`,
      [],
      413,
    );
  }

  const groups = new Map<string, ConsolidatedEmployee[]>();
  for (const { employee } of employees.values()) {
    if (!Array.from(employee.advanceRulesByCompetency?.values() ?? []).some((rule) => rule.scopeEligible)) continue;
    let total = 0n;
    for (const competency of competencies) {
      const base = employee.basesByCompetency.get(competency.key) ?? null;
      employee.basesByCompetency.set(competency.key, base);
      const adjustment =
        base === null || employee.advanceRulesByCompetency?.get(competency.key)?.exclusionReason
          ? 0n
          : calculateAdjustmentAtHundredThousandths(base, employee.advanceRulesByCompetency?.get(competency.key)?.percentageHundredThousandths ?? percentageHundredThousandths);
      employee.adjustmentsByCompetency.set(competency.key, adjustment);
      total += adjustment;
    }
    employee.totalAdjustmentCents = total;
    const group = groups.get(employee.branchAlias) ?? [];
    group.push(employee);
    groups.set(employee.branchAlias, group);
  }

  const reportGroups = [...groups.entries()]
    .sort(([left], [right]) => compareBranchAliases(left, right))
    .map(([branchAlias, groupEmployees]) => {
      groupEmployees.sort(
        (left, right) =>
          comparePtBr(left.employeeName, right.employeeName) ||
          left.registration.localeCompare(right.registration),
      );
      return {
        branchAlias,
        employees: groupEmployees,
        employeeCount: groupEmployees.length,
        subtotalCents: groupEmployees.reduce(
          (total, employee) => total + employee.totalAdjustmentCents,
          0n,
        ),
      };
    });

  if (!reportGroups.length) throw new SalaryAdjustmentError("REAJUSTE_SCOPE_EMPTY", "Nenhum colaborador possui cargo correspondente à apuração sindical selecionada nas competências importadas.");

  return {
    parserProfile: PARSER_PROFILE,
    generatedAt,
    percentageBasisPoints,
    packerPercentageTenThousandths,
    competencies,
    groups: reportGroups,
    salaryScope,
    driverPercentageTenThousandths,
    percentageHundredThousandths,
    packerPercentageHundredThousandths,
    driverPercentageHundredThousandths,
    employeeCount: reportGroups.reduce((sum, group) => sum + group.employeeCount, 0),
    grandTotalCents: reportGroups.reduce(
      (total, group) => total + group.subtotalCents,
      0n,
    ),
  };
}
