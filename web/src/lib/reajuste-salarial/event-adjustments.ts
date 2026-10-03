import { SalaryAdjustmentError } from "./errors";
import { payrollExclusionReason } from "./advance-rules";
import { payrollScopeEligible, payrollScopeExclusionReason } from "./payroll-scope";
import { parseCompetencyFileName, sortAndValidateCompetencies } from "./competency";
import { MAX_UNIQUE_EMPLOYEES, MAX_EVENT_IDENTITY_LENGTH } from "./limits";
import type { Competency, SalaryAdvanceScope } from "./types";
import type { EventAdjustmentSettings, EventAdjustmentResult, EventAdjustmentReport, ParsedSalaryEvent, ParsedSalaryEventFile } from "./event-adjustment-types";

function invalid(message: string): never {
  throw new SalaryAdjustmentError("REAJUSTE_RULE_INVALID", message);
}

function cents(value: unknown, positive = false): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) invalid("Os valores devem conter somente centavos inteiros não negativos.");
  const amount = BigInt(value);
  if (positive && amount === 0n) invalid("O valor histórico unitário deve ser maior que zero.");
  return amount;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
}

function referenceQuantity(value: string): bigint | null {
  const match = /^(\d+)(?:[.,](0+))?$/.exec(value.trim());
  return match ? BigInt(match[1]) : null;
}

function sundayCount({ month, year }: Competency): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let total = 0;
  for (let day = 1; day <= days; day += 1) if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0) total += 1;
  return total;
}

function result(events: ParsedSalaryEvent[], oldValue: bigint, newValue: bigint | null, maxQuantity?: number): EventAdjustmentResult {
  const paid = events.reduce((sum, event) => sum + cents(event.paidCents), 0n);
  const base: EventAdjustmentResult = { received: events.length > 0, paidCents: paid.toString(), quantity: 0, targetCents: newValue === null ? null : "0", differenceCents: "0", quantitySource: "none", issue: null };
  if (!events.length) return base;
  function pending(issue: string): EventAdjustmentResult { return { ...base, quantity: null, targetCents: null, issue }; }
  if (events.length !== 1) return pending("Evento duplicado na competência. Confira as rubricas antes de calcular.");
  if (paid % oldValue !== 0n) return pending("O valor pago não é múltiplo exato do valor histórico unitário. Confira o histórico ou a proporcionalidade.");
  const quantity = paid / oldValue;
  // The monthly payroll exports a zero placeholder for event 901 when no quantity was entered.
  // Positive or fractional references remain evidence and must agree with the exact division.
  const hasReference = events[0].reference.trim() !== "" && !(maxQuantity !== undefined && referenceQuantity(events[0].reference) === 0n);
  if (hasReference) {
    const reference = referenceQuantity(events[0].reference);
    if (reference === null) return pending("A referência não representa uma quantidade inteira. Confira a folha.");
    if (reference !== quantity) return pending("A referência diverge da quantidade calculada pelo valor pago e pelo histórico.");
  }
  if (quantity > BigInt(Number.MAX_SAFE_INTEGER)) return pending("Quantidade acima do limite seguro de cálculo.");
  if (maxQuantity !== undefined && quantity > BigInt(maxQuantity)) return pending(`A quantidade supera os ${maxQuantity} domingos existentes nesta competência.`);
  const target = newValue === null ? null : quantity * newValue;
  return { ...base, quantity: Number(quantity), quantitySource: hasReference ? "reference" : "amount", targetCents: target?.toString() ?? null, differenceCents: target !== null && target > paid ? (target - paid).toString() : "0" };
}

function gcd(a: bigint, b: bigint): bigint { while (b !== 0n) [a, b] = [b, a % b]; return a; }

function suggestions(files: ParsedSalaryEventFile[]): EventAdjustmentReport["suggestions"] {
  const bonus = new Set<string>();
  let inconsistentBonus = false;
  let sunday = 0n;
  for (const file of files) for (const row of file.rows) {
    const entries = row.events["565"];
    if (entries.length > 1) inconsistentBonus = true;
    for (const event of entries) {
      const paid = cents(event.paidCents);
      const quantity = referenceQuantity(event.reference);
      if (quantity !== null && quantity > 0n && paid > 0n && paid % quantity === 0n) bonus.add((paid / quantity).toString());
      else if (paid > 0n) inconsistentBonus = true;
    }
    for (const event of row.events["901"]) { const paid = cents(event.paidCents); if (paid > 0n) sunday = gcd(sunday, paid); }
  }
  return {
    bonusOldValueCents: !inconsistentBonus && bonus.size === 1 ? [...bonus][0] : null,
    sundayOldValueCents: sunday > 0n ? sunday.toString() : null,
    bonusEvidence: !inconsistentBonus && bonus.size === 1 ? "Valor unitário consistente entre os pagamentos e as referências inteiras do evento 565. Confirme o histórico." : "Não há evidência uniforme de valor unitário para o evento 565. Informe o histórico.",
    sundayEvidence: sunday > 0n ? "MDC dos valores positivos pagos no evento 901. É apenas sugestão: pode representar múltiplos domingos e exige confirmação do histórico." : "Nenhum pagamento positivo do evento 901 foi encontrado.",
  };
}

export function buildEventAdjustmentReport(files: ParsedSalaryEventFile[], settings: EventAdjustmentSettings, generatedAt = new Date(), salaryScope: SalaryAdvanceScope = "standard"): EventAdjustmentReport {
  if (salaryScope !== "standard" && salaryScope !== "drivers-forklift") throw new SalaryAdjustmentError("REAJUSTE_SCOPE_INVALID", "Apuração sindical inválida.");
  if (!files.length) invalid("Envie pelo menos uma folha mensal.");
  if (!settings || typeof settings !== "object") invalid("A configuração dos eventos é inválida.");
  const competencies = sortAndValidateCompetencies(files.map((file) => file.competency));
  for (const competency of competencies) {
    const expected = parseCompetencyFileName(`${competency.key}.xlsx`);
    if (expected.month !== competency.month || expected.year !== competency.year || expected.order !== competency.order) invalid("Competência inválida na folha.");
  }
  const bonusOld = cents(settings.bonusOldValueCents, true);
  const sundayOld = cents(settings.sundayOldValueCents, true);
  const bonusNew = settings.bonusNewValueCents === null ? null : cents(settings.bonusNewValueCents);
  const sundayNew = settings.sundayNewValueCents === null ? null : cents(settings.sundayNewValueCents);
  if (!Array.isArray(settings.historicOverrides)) invalid("A configuração histórica por competência é inválida.");
  const overrides = new Map<string, { bonus: bigint; sunday: bigint }>();
  for (const override of settings.historicOverrides) {
    if (!override || typeof override !== "object") invalid("A configuração histórica por competência é inválida.");
    if (!competencies.some(({ key }) => key === override.competencyKey) || overrides.has(override.competencyKey)) invalid("O histórico possui competência desconhecida ou repetida.");
    overrides.set(override.competencyKey, { bonus: cents(override.bonusOldValueCents, true), sunday: cents(override.sundayOldValueCents, true) });
  }
  const companies = new Set(files.map(({ company }) => {
    if (typeof company !== "string" || !company.trim() || company.length > MAX_EVENT_IDENTITY_LENGTH) {
      throw new SalaryAdjustmentError("REAJUSTE_STRUCTURE_INVALID", `A identificação da empresa é obrigatória e deve conter até ${MAX_EVENT_IDENTITY_LENGTH} caracteres. Reenvie a folha completa com o cabeçalho da empresa.`);
    }
    return normalize(company);
  }));
  if (companies.size > 1) throw new SalaryAdjustmentError("REAJUSTE_STRUCTURE_INVALID", "As folhas pertencem a empresas diferentes. Apure cada empresa separadamente.");
  const employees = new Map<string, { registration: string; employeeName: string; branchAlias: string; entries: Map<string, ParsedSalaryEventFile["rows"][number]> }>();
  for (const file of [...files].sort((a, b) => a.competency.order - b.competency.order)) for (const row of file.rows) {
    if (!/^\d+$/.test(row.registration) || !row.employeeName.trim() || !row.branchAlias.trim()) invalid("Identificação de colaborador inválida.");
    if ([row.registration, row.employeeName, row.branchAlias].some((value) => value.length > MAX_EVENT_IDENTITY_LENGTH)) {
      throw new SalaryAdjustmentError("REAJUSTE_STRUCTURE_INVALID", `A identificação do colaborador ou da filial ultrapassa ${MAX_EVENT_IDENTITY_LENGTH} caracteres. Confira o conteúdo da folha antes de reenviar.`);
    }
    const registration = row.registration.replace(/^0+(?=\d)/, "");
    const existing = employees.get(registration);
    if (existing && normalize(existing.employeeName) !== normalize(row.employeeName)) throw new SalaryAdjustmentError("REAJUSTE_NAME_CONFLICT", `O cadastro ${registration} possui nomes conflitantes entre as folhas.`);
    if (existing?.entries.has(file.competency.key)) throw new SalaryAdjustmentError("REAJUSTE_REGISTRATION_DUPLICATE", `O cadastro ${registration} aparece mais de uma vez na competência ${file.competency.key}.`);
    const employee = existing ?? { registration, employeeName: row.employeeName, branchAlias: row.branchAlias, entries: new Map() };
    // Branch grouping follows the latest imported competency; each month's evidence remains separate.
    employee.branchAlias = row.branchAlias;
    employee.entries.set(file.competency.key, row);
    employees.set(registration, employee);
    if (employees.size > MAX_UNIQUE_EMPLOYEES) {
      throw new SalaryAdjustmentError(
        "REAJUSTE_ROW_LIMIT_EXCEEDED",
        `O conjunto ultrapassa o limite de ${MAX_UNIQUE_EMPLOYEES.toLocaleString("pt-BR")} colaboradores.`,
        [],
        413,
      );
    }
  }
  let issueCount = 0;
  const scopedEmployees = [...employees.values()].filter((employee) => [...employee.entries.values()].some((entry) => payrollScopeEligible(entry.role, salaryScope)));
  if (!scopedEmployees.length) throw new SalaryAdjustmentError("REAJUSTE_SCOPE_EMPTY", "Nenhum colaborador possui cargo correspondente à apuração sindical selecionada nas competências importadas.");
  const reportEmployees = scopedEmployees.map((employee) => {
    const months = competencies.map((competency) => {
      const entry = employee.entries.get(competency.key);
      const old = overrides.get(competency.key);
      const exclusionReason = entry ? payrollExclusionReason(entry.employmentStatus) ?? payrollScopeExclusionReason(entry.role, salaryScope) : null;
      const eligibleResult = (value: EventAdjustmentResult): EventAdjustmentResult => exclusionReason
        ? { ...value, differenceCents: "0", issue: null, exclusionReason }
        : value;
      const bonus565 = eligibleResult(result(entry?.events["565"] ?? [], old?.bonus ?? bonusOld, bonusNew));
      const indemnity901 = eligibleResult(result(entry?.events["901"] ?? [], old?.sunday ?? sundayOld, sundayNew, sundayCount(competency)));
      issueCount += Number(bonus565.issue !== null) + Number(indemnity901.issue !== null);
      return { competency, inPayroll: Boolean(entry), employmentStatus: entry?.employmentStatus ?? null, exclusionReason, bonus565, indemnity901 };
    });
    const bonus = months.reduce((sum, month) => sum + BigInt(month.bonus565.differenceCents), 0n);
    const sunday = months.reduce((sum, month) => sum + BigInt(month.indemnity901.differenceCents), 0n);
    return { registration: employee.registration, employeeName: employee.employeeName, branchAlias: employee.branchAlias, months, bonusDifferenceCents: bonus.toString(), sundayDifferenceCents: sunday.toString(), totalDifferenceCents: (bonus + sunday).toString() };
  }).sort((a, b) => a.branchAlias.localeCompare(b.branchAlias, "pt-BR") || a.employeeName.localeCompare(b.employeeName, "pt-BR") || a.registration.localeCompare(b.registration, "pt-BR", { numeric: true }));
  const bonus = reportEmployees.reduce((sum, employee) => sum + BigInt(employee.bonusDifferenceCents), 0n);
  const sunday = reportEmployees.reduce((sum, employee) => sum + BigInt(employee.sundayDifferenceCents), 0n);
  const scopedFiles = files.map((file) => ({ ...file, rows: file.rows.filter((row) => payrollScopeEligible(row.role, salaryScope)) }));
  return { settings: { ...settings, historicOverrides: settings.historicOverrides.map((override) => ({ ...override })) }, competencies, employees: reportEmployees, employeeCount: reportEmployees.length, branchCount: new Set(reportEmployees.map(({ branchAlias }) => branchAlias)).size, bonusTotalCents: bonus.toString(), sundayTotalCents: sunday.toString(), grandTotalCents: (bonus + sunday).toString(), generatedAt: generatedAt.toISOString(), issueCount, suggestions: suggestions(scopedFiles) };
}
