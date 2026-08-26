import { Prisma } from "@/generated/prisma/client";
import { resolveUnimedPlanPrice } from "@/lib/unimed/pricing";
import type { FeriasBeneficiary, FeriasInvoice, FeriasPrice } from "./contracts";
import { appendIndex, normalizedName, type LoanGroup } from "./identity";

type Benefit = { text: string; issues: string[] };

function money(value: Prisma.Decimal) {
  return value.toFixed(2).replace(".", ",");
}

export function buildInvoiceIndex(invoices: FeriasInvoice[]) {
  const byBeneficiary = new Map<string, FeriasInvoice[]>();
  const byHolder = new Map<string, FeriasInvoice[]>();
  for (const invoice of invoices) {
    if (!["MENSALIDADE", "ADITIVO"].includes(normalizedName(invoice.itemDescription))) continue;
    if (invoice.beneficiaryId) appendIndex(byBeneficiary, invoice.beneficiaryId, invoice);
    const name = invoice.holderName || (invoice.category === "HOLDER" ? invoice.beneficiaryName : "");
    appendIndex(byHolder, normalizedName(name), invoice);
  }
  return { byBeneficiary, byHolder };
}

export function calculateUnimedBenefit(
  holder: FeriasBeneficiary,
  dependents: FeriasBeneficiary[],
  index: ReturnType<typeof buildInvoiceIndex>,
  prices: FeriasPrice[],
  competency: string,
): Benefit {
  const family = new Set([holder.id, ...dependents.map((person) => person.id)]);
  const invoices = new Map<string, FeriasInvoice>();
  for (const id of family) for (const item of index.byBeneficiary.get(id) ?? []) invoices.set(item.id, item);
  for (const item of index.byHolder.get(normalizedName(holder.fullName)) ?? []) {
    if (item.branchId && holder.branchId && item.branchId !== holder.branchId) continue;
    invoices.set(item.id, item);
  }
  const items = [...invoices.values()];
  if (items.some((item) => !item.beneficiaryId || !family.has(item.beneficiaryId))) {
    return { text: "", issues: ["Há mensalidades ou acessórios sem vínculo familiar confirmado na fatura. Revise a base Unimed."] };
  }
  const monthly = items.filter((item) => normalizedName(item.itemDescription) === "MENSALIDADE");
  const holderMonthly = monthly.filter((item) => item.beneficiaryId === holder.id);
  if (!holderMonthly.length) {
    return { text: "", issues: items.length ? ["A fatura possui itens da família, mas não a mensalidade do titular. Revise a competência."] : [] };
  }
  const billedPeople = new Set<string>();
  for (const item of items) {
    const key = `${item.beneficiaryId}:${normalizedName(item.itemDescription)}`;
    if (billedPeople.has(key)) {
      return { text: "", issues: ["Há mensalidade ou acessório repetido para a mesma pessoa na fatura. Revise antes de exportar."] };
    }
    billedPeople.add(key);
  }
  const resolved = resolveUnimedPlanPrice({
    birthDate: holder.birthDate ? new Date(`${holder.birthDate}T00:00:00Z`) : null,
    referenceDate: new Date(`${competency}-01T00:00:00Z`), planCode: holder.planCode,
    ageBrackets: prices.map((price) => price.ageBracket),
    prices: prices.map((price) => ({ ...price, ageBracketCode: price.ageBracket.code })),
  });
  if (resolved.status !== "RESOLVED" || resolved.employeeAmount === null) {
    return { text: "", issues: ["Não foi possível localizar a mensalidade do titular na tabela da competência. Confira nascimento, plano e vigência."] };
  }
  if (items.some((item) => new Prisma.Decimal(item.amount).isNegative())) {
    return { text: "", issues: ["Há mensalidade ou acessório com valor negativo. Revise a fatura."] };
  }
  let monthlyTotal = new Prisma.Decimal(resolved.employeeAmount);
  let addonTotal = new Prisma.Decimal(0);
  for (const item of items) {
    if (normalizedName(item.itemDescription) === "ADITIVO") addonTotal = addonTotal.plus(item.amount);
    else if (item.beneficiaryId !== holder.id) monthlyTotal = monthlyTotal.plus(item.amount);
  }
  return { text: `Mens.: ${money(monthlyTotal)}${addonTotal.gt(0) ? ` + Adit.: ${money(addonTotal)}` : ""}`, issues: [] };
}

export function calculateLoanBenefit(group: LoanGroup, competency: string): Benefit {
  const contracts = new Set<string>();
  const issues: string[] = [];
  let total = new Prisma.Decimal(0);
  if (new Set(group.loans.map((loan) => normalizedName(loan.employeeName))).size > 1) {
    issues.push("O mesmo CPF possui nomes divergentes no Consignado. Revise a base.");
  }
  for (const loan of group.loans) {
    const key = `${loan.bankCode}:${loan.contractNumber}`;
    if (!loan.contractNumber || contracts.has(key)) issues.push("Há contrato repetido ou sem identificação no Consignado. Revise a base.");
    contracts.add(key);
    if (loan.competence !== competency || !/^\d{4}-(0[1-9]|1[0-2])$/.test(loan.startCompetence) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(loan.endCompetence) ||
      loan.startCompetence > competency || loan.endCompetence < competency) {
      issues.push("Há contrato fora da competência das férias. Revise as datas do Consignado.");
    }
    const amount = new Prisma.Decimal(loan.installmentAmount);
    if (amount.isNegative()) issues.push("Há parcela negativa no Consignado. Revise a base.");
    total = total.plus(amount);
  }
  return { text: issues.length ? "" : `Consig.R$ ${money(total)}`, issues: [...new Set(issues)] };
}
