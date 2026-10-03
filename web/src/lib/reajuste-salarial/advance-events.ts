import { SalaryAdjustmentError } from "./errors";
import { parseEventAdjustmentSettings } from "./event-adjustment-request";
import type { EventAdjustmentReport, EventAdjustmentSettings } from "./event-adjustment-types";
import { MAX_EVENT_IDENTITY_LENGTH, MAX_FILES, MAX_UNIQUE_EMPLOYEES } from "./limits";
import type { SalaryAdvanceReport } from "./types";

function invalid(message: string): never {
  throw new SalaryAdjustmentError("REAJUSTE_RULE_INVALID", message);
}

export function parseOptionalAdvanceEventSettings(formData: FormData): EventAdjustmentSettings | null {
  const values = formData.getAll("includeEvents");
  if (values.length > 1 || (values.length === 1 && values[0] !== "true" && values[0] !== "false")) {
    return invalid("A opção de incluir bônus e domingos é inválida.");
  }
  if (values.length === 0 || values[0] === "false") return null;
  for (const key of ["bonusOldValue", "bonusNewValue", "sundayOldValue", "sundayNewValue", "historicOverrides"]) {
    if (formData.getAll(key).length > 1) return invalid("Há valores repetidos na configuração de bônus e domingos.");
  }
  const settings = parseEventAdjustmentSettings(formData);
  if (settings.bonusNewValueCents === null && settings.sundayNewValueCents === null) {
    return invalid("Informe pelo menos um novo valor para incluir as diferenças de bônus ou domingos.");
  }
  return settings;
}

function identity(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_EVENT_IDENTITY_LENGTH) {
    return invalid(`As identificações devem conter até ${MAX_EVENT_IDENTITY_LENGTH} caracteres.`);
  }
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
}

function registration(value: string): string {
  identity(value);
  if (!/^\d+$/.test(value)) return invalid("Uma matrícula do relatório integrado é inválida.");
  return value.replace(/^0+(?=\d)/, "");
}

function cents(value: string): bigint {
  if (typeof value !== "string" || value.length > 32 || !/^\d+$/.test(value)) return invalid("Uma diferença do relatório integrado é inválida.");
  return BigInt(value);
}

export function buildIntegratedAdvanceSummary(advanceReport: SalaryAdvanceReport, eventReport: EventAdjustmentReport) {
  if (eventReport.issueCount !== 0 || eventReport.employees.some((employee) => employee.months.some((month) => month.bonus565.issue !== null || month.indemnity901.issue !== null))) {
    return invalid("Resolva as pendências dos eventos antes de gerar o relatório integrado.");
  }
  if (advanceReport.competencies.length === 0 || advanceReport.competencies.length > MAX_FILES || new Set(advanceReport.competencies.map((competency) => competency.key)).size !== advanceReport.competencies.length) {
    return invalid("As competências do relatório integrado são inválidas ou repetidas.");
  }
  if (advanceReport.competencies.length !== eventReport.competencies.length || advanceReport.competencies.some((competency, index) => {
    const other = eventReport.competencies[index];
    return !other || competency.key !== other.key || competency.month !== other.month || competency.year !== other.year || competency.order !== other.order;
  })) return invalid("As competências da antecipação e dos eventos não coincidem.");
  const advances = new Map<string, { name: string; advanceCents: bigint; present: Set<string> }>();
  for (const group of advanceReport.groups) for (const employee of group.employees) {
    identity(group.branchAlias);
    identity(employee.branchAlias);
    const key = registration(employee.registration);
    const name = identity(employee.employeeName);
    if (typeof employee.totalAdjustmentCents !== "bigint" || employee.totalAdjustmentCents < 0n) return invalid("Um valor da antecipação é inválido.");
    const previous = advances.get(key);
    if (previous && previous.name !== name) return invalid("Há nomes divergentes para uma matrícula na antecipação.");
    const entry = previous ?? { name, advanceCents: 0n, present: new Set<string>() };
    entry.advanceCents += employee.totalAdjustmentCents;
    for (const competency of advanceReport.competencies) {
      if (employee.basesByCompetency.get(competency.key) !== null && employee.basesByCompetency.get(competency.key) !== undefined) entry.present.add(competency.key);
    }
    advances.set(key, entry);
  }
  if (advances.size > MAX_UNIQUE_EMPLOYEES || eventReport.employees.length > MAX_UNIQUE_EMPLOYEES) return invalid("O relatório integrado ultrapassa o limite de colaboradores.");
  const seen = new Set<string>();
  const employees = eventReport.employees.map((employee) => {
    const key = registration(employee.registration);
    const name = identity(employee.employeeName);
    identity(employee.branchAlias);
    const advance = advances.get(key);
    if (!advance || seen.has(key)) return invalid("As matrículas da antecipação e dos eventos não coincidem ou estão repetidas.");
    if (advance.name !== name) return invalid("Há nomes divergentes entre a antecipação e os eventos.");
    if (employee.months.length !== eventReport.competencies.length || employee.months.some((month, index) => month.competency.key !== eventReport.competencies[index]?.key || month.inPayroll !== advance.present.has(month.competency.key))) {
      return invalid("A presença por competência diverge entre a antecipação e os eventos.");
    }
    seen.add(key);
    const bonusCents = cents(employee.bonusDifferenceCents);
    const sundayCents = cents(employee.sundayDifferenceCents);
    const monthlyBonus = employee.months.reduce((total, month) => total + cents(month.bonus565.differenceCents), 0n);
    const monthlySunday = employee.months.reduce((total, month) => total + cents(month.indemnity901.differenceCents), 0n);
    if (monthlyBonus !== bonusCents || monthlySunday !== sundayCents) return invalid("As diferenças mensais dos eventos são inconsistentes.");
    if (bonusCents + sundayCents !== cents(employee.totalDifferenceCents)) return invalid("O total individual dos eventos é inconsistente.");
    return {
      registration: key,
      employeeName: employee.employeeName,
      branchAlias: employee.branchAlias,
      advanceCents: advance.advanceCents,
      bonusCents,
      sundayCents,
      totalCents: advance.advanceCents + bonusCents + sundayCents,
    };
  });
  if (seen.size !== advances.size) return invalid("Há colaboradores da antecipação ausentes no relatório dos eventos.");
  const advanceTotalCents = employees.reduce((total, employee) => total + employee.advanceCents, 0n);
  const bonusTotalCents = employees.reduce((total, employee) => total + employee.bonusCents, 0n);
  const sundayTotalCents = employees.reduce((total, employee) => total + employee.sundayCents, 0n);
  if (advanceTotalCents !== advanceReport.grandTotalCents || bonusTotalCents !== cents(eventReport.bonusTotalCents) || sundayTotalCents !== cents(eventReport.sundayTotalCents) || bonusTotalCents + sundayTotalCents !== cents(eventReport.grandTotalCents)) {
    return invalid("Os totais do relatório integrado são inconsistentes.");
  }
  return { employees, advanceTotalCents, bonusTotalCents, sundayTotalCents, grandTotalCents: advanceTotalCents + bonusTotalCents + sundayTotalCents };
}

export function buildSalaryAdvanceSummary(report: SalaryAdvanceReport, eventReport?: EventAdjustmentReport) {
  const registrations = new Set<string>();
  for (const group of report.groups) {
    for (const employee of group.employees) {
      const key = registration(employee.registration);
      if (registrations.has(key)) return invalid("Há matrículas repetidas nas filiais da antecipação.");
      registrations.add(key);
      const monthlyTotal = report.competencies.reduce((sum, competency) => sum + (employee.adjustmentsByCompetency.get(competency.key) ?? 0n), 0n);
      if (monthlyTotal !== employee.totalAdjustmentCents) return invalid("Os valores mensais da antecipação são inconsistentes.");
    }
    if (group.employeeCount !== group.employees.length || group.subtotalCents !== group.employees.reduce((sum, employee) => sum + employee.totalAdjustmentCents, 0n)) return invalid("Os subtotais das filiais da antecipação são inconsistentes.");
  }
  if (registrations.size !== report.employeeCount || report.grandTotalCents !== report.groups.reduce((sum, group) => sum + group.subtotalCents, 0n)) return invalid("Os totais da antecipação são inconsistentes.");
  const integrated = eventReport ? buildIntegratedAdvanceSummary(report, eventReport) : null;
  const byRegistration = new Map(integrated?.employees.map(employee => [employee.registration, employee]));
  const groups = report.groups.map(group => {
    const employees = group.employees.map(employee => {
      const events = byRegistration.get(registration(employee.registration));
      const bonusCents = events?.bonusCents ?? 0n;
      const sundayCents = events?.sundayCents ?? 0n;
      return { registration: employee.registration, employeeName: employee.employeeName, branchAlias: group.branchAlias,
        advanceCents: employee.totalAdjustmentCents, bonusCents, sundayCents,
        totalCents: employee.totalAdjustmentCents + bonusCents + sundayCents };
    });
    return { branchAlias: group.branchAlias, employees,
      advanceCents: employees.reduce((sum, employee) => sum + employee.advanceCents, 0n),
      bonusCents: employees.reduce((sum, employee) => sum + employee.bonusCents, 0n),
      sundayCents: employees.reduce((sum, employee) => sum + employee.sundayCents, 0n),
      totalCents: employees.reduce((sum, employee) => sum + employee.totalCents, 0n) };
  });
  return { groups, employees: groups.flatMap(group => group.employees),
    advanceTotalCents: report.grandTotalCents, bonusTotalCents: integrated?.bonusTotalCents ?? 0n,
    sundayTotalCents: integrated?.sundayTotalCents ?? 0n,
    grandTotalCents: integrated?.grandTotalCents ?? report.grandTotalCents };
}
