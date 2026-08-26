import { isValidCpf } from "@/lib/unimed/importer-shared";
import type { FeriasBeneficiary, FeriasCandidate, FeriasLoan, FeriasSnapshot } from "./contracts";
import { FeriasError } from "./errors";

export function normalizedName(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toUpperCase();
}
export function searchName(value: string) {
  return normalizedName(value.replace(/\s*\(\d+\s+ABONO\)\s*$/i, ""));
}
export function registrationKey(value: string | null) {
  return value?.trim().replace(/^0+(?=\d)/, "") ?? "";
}
export function cpfKey(value: string | null) {
  const cpf = value?.replace(/\D/g, "") ?? "";
  return isValidCpf(cpf) ? cpf : "";
}
export function appendIndex<T>(index: Map<string, T[]>, key: string, item: T) {
  if (!key) return;
  const items = index.get(key) ?? [];
  items.push(item);
  index.set(key, items);
}
export type LoanGroup = { id: string; cpf: string; name: string; loans: FeriasLoan[] };

export function buildIdentityIndex(snapshot: FeriasSnapshot) {
  const holderNames = new Map<string, FeriasBeneficiary[]>();
  const holderRegistrations = new Map<string, FeriasBeneficiary[]>();
  const dependents = new Map<string, FeriasBeneficiary[]>();
  for (const person of snapshot.beneficiaries) {
    if (person.category === "HOLDER") {
      appendIndex(holderNames, normalizedName(person.fullName), person);
      appendIndex(holderRegistrations, registrationKey(person.registration), person);
    } else if (person.holderId) appendIndex(dependents, person.holderId, person);
  }
  const grouped = new Map<string, LoanGroup>();
  for (const loan of snapshot.loans) {
    const cpf = cpfKey(loan.cpfNormalized);
    const key = cpf ? `cpf:${cpf}` : `name:${normalizedName(loan.employeeName)}:${registrationKey(loan.registration)}:${loan.companyCnpj ?? ""}`;
    const group = grouped.get(key) ?? { id: loan.id, cpf, name: loan.employeeName, loans: [] };
    group.loans.push(loan);
    grouped.set(key, group);
  }
  const loanNames = new Map<string, LoanGroup[]>();
  const loanCpfs = new Map<string, LoanGroup[]>();
  for (const group of grouped.values()) {
    for (const name of new Set(group.loans.map((loan) => normalizedName(loan.employeeName)))) appendIndex(loanNames, name, group);
    appendIndex(loanCpfs, group.cpf, group);
  }
  return { holderNames, holderRegistrations, dependents, loanNames, loanCpfs };
}

function candidateLabel(name: string, cpf: string | null) {
  const digits = cpfKey(cpf);
  return digits ? `${name} · CPF ***.***.${digits.slice(6, 9)}-**` : `${name} · CPF não disponível`;
}

export function selectCandidate<T extends { id: string }>(
  candidates: T[], automatic: T | undefined, selectedId: string | undefined,
): T | undefined {
  if (!selectedId) return automatic;
  const selected = candidates.find((candidate) => candidate.id === selectedId);
  if (!selected) throw new FeriasError("FERIAS_IDENTITY_CHANGED", "Uma identificação não corresponde mais à base. Analise o arquivo novamente.", 409);
  return selected;
}

export function holderOptions(holders: FeriasBeneficiary[]): FeriasCandidate[] {
  return holders.map((holder) => ({ id: holder.id,
    label: `${candidateLabel(holder.fullName, holder.cpf)}${holder.branchLabel ? ` · ${holder.branchLabel}` : ""}` }));
}

export function loanLabel(group: LoanGroup) {
  const loan = group.loans[0];
  return `${candidateLabel(group.name, group.cpf)}${loan.registration ? ` · Matrícula ${loan.registration}` : ""}${!group.cpf && loan.companyCnpj ? ` · Empresa ${loan.companyCnpj}` : ""}`;
}
