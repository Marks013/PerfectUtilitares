import { SalaryAdjustmentError } from "./errors";
import { MAX_UNIQUE_EMPLOYEES, PARSER_PROFILE } from "./limits";
import { calculateAdjustmentCents } from "./money";
import {
  canonicalBranchAlias,
  compareBranchAliases,
  comparePtBr,
} from "./branches";
import type {
  ConsolidatedEmployee,
  ParsedPayrollFile,
  SalaryAdvanceReport,
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
): SalaryAdvanceReport {
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
      };
      employee.employeeName = row.employeeName;
      employee.branchAlias = branchAlias;
      employee.basesByCompetency.set(file.competency.key, row.baseCents);
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
    let total = 0n;
    for (const competency of competencies) {
      const base = employee.basesByCompetency.get(competency.key) ?? null;
      employee.basesByCompetency.set(competency.key, base);
      const adjustment =
        base === null
          ? 0n
          : calculateAdjustmentCents(base, percentageBasisPoints);
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

  return {
    parserProfile: PARSER_PROFILE,
    generatedAt,
    percentageBasisPoints,
    competencies,
    groups: reportGroups,
    employeeCount: employees.size,
    grandTotalCents: reportGroups.reduce(
      (total, group) => total + group.subtotalCents,
      0n,
    ),
  };
}
