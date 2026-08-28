import type { FeriasBeneficiary, FeriasInvoice } from "./contracts";
import { appendIndex, normalizedName } from "./identity";

export function buildFamilyIndex(beneficiaries: FeriasBeneficiary[]) {
  const people = new Map<string, FeriasBeneficiary[]>();
  for (const person of beneficiaries) appendIndex(people, normalizedName(person.fullName), person);
  return people;
}

export function reconcileFamilyInvoices(
  holder: FeriasBeneficiary, dependents: FeriasBeneficiary[], invoices: FeriasInvoice[],
  people: ReturnType<typeof buildFamilyIndex>,
) {
  const family = new Map([holder, ...dependents].map((person) => [person.id, person]));
  const holderName = normalizedName(holder.fullName);
  const holders = (people.get(holderName) ?? []).filter((person) =>
    person.category === "HOLDER" && (!person.branchId || person.branchId === holder.branchId));
  const anchored = !!holder.branchId && holders.length === 1 && holders[0].id === holder.id &&
    invoices.some((item) => item.beneficiaryId === holder.id && item.branchId === holder.branchId &&
      item.category === "HOLDER" && normalizedName(item.itemDescription) === "MENSALIDADE");
  const items: FeriasInvoice[] = [];
  let reconciled = 0;
  for (const item of invoices) {
    if (item.beneficiaryId) {
      const person = family.get(item.beneficiaryId);
      if (!person || person.category !== item.category ||
          (item.branchId && holder.branchId && item.branchId !== holder.branchId)) {
        return { items: [], reconciled: 0, issue: "Há um item da fatura vinculado a outra pessoa ou filial. Confira o vínculo na base Unimed antes de exportar." };
      }
      items.push(item);
      continue;
    }
    const name = normalizedName(item.beneficiaryName);
    const candidates = (people.get(name) ?? []).filter((person) =>
      !person.branchId || person.branchId === holder.branchId);
    const namedFamily = candidates.length === 1 && family.has(candidates[0].id) && candidates[0].category === "DEPENDENT";
    const declaredHolder = normalizedName(item.holderName ?? "");
    // Invoice-only dependents need an unambiguous, billed holder in the same branch.
    if (!anchored || item.branchId !== holder.branchId || !name || name === holderName ||
        item.category !== "DEPENDENT" || (declaredHolder ? declaredHolder !== holderName : !namedFamily) ||
        candidates.length > 1 || candidates.some((person) => !family.has(person.id) || person.category !== "DEPENDENT")) {
      return { items: [], reconciled: 0, issue: "Não foi possível confirmar a família de um item da fatura. Confira nome do dependente, titular e filial na base Unimed; nenhuma cobrança foi descartada." };
    }
    const beneficiaryId = candidates[0]?.id ?? `invoice:${holder.id}:${name}`;
    items.push({ ...item, beneficiaryId });
    reconciled += 1;
  }
  return { items, reconciled, issue: undefined };
}
