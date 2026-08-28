import { isValidCpf } from "@/lib/unimed/importer-shared";
import { formatUnimedBranchForPdf } from "@/lib/unimed/print-format";
import type { FeriasBeneficiary, FeriasCandidate, FeriasLoan, FeriasSnapshot } from "./contracts";
import { FeriasError } from "./errors";

export function normalizedName(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[.'’]/g, "")
    .replace(/[-‐–—]/g, " ").trim().replace(/\s+/g, " ").toUpperCase();
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
  const loanRegistrations = new Map<string, LoanGroup[]>();
  for (const group of grouped.values()) {
    for (const name of new Set(group.loans.map((loan) => normalizedName(loan.employeeName)))) appendIndex(loanNames, name, group);
    appendIndex(loanCpfs, group.cpf, group);
    for (const registration of new Set(group.loans.map((loan) => registrationKey(loan.registration)))) {
      appendIndex(loanRegistrations, registration, group);
    }
  }
  return { holderNames, holderRegistrations, dependents, loanNames, loanCpfs, loanRegistrations };
}

export function resolveHolder(
  identities: ReturnType<typeof buildIdentityIndex>, registration: string, name: string, branch: string,
) {
  const names = identities.holderNames.get(name) ?? [];
  const registrations = identities.holderRegistrations.get(registrationKey(registration)) ?? [];
  const candidates = [...new Map([...names, ...registrations].map((person) => [person.id, person])).values()];
  const branchKey = normalizedName(formatUnimedBranchForPdf(branch));
  const sameBranch = (person: FeriasBeneficiary) => !!person.branchCode &&
    normalizedName(formatUnimedBranchForPdf(person.branchCode)) === branchKey;
  const compatible = registrations.filter((person) => !person.branchCode || sameBranch(person));
  const exact = compatible.filter((person) => normalizedName(person.fullName) === name);
  const exactBranch = exact.filter(sameBranch);
  const automatic = exactBranch.length === 1 ? exactBranch[0]
    : exact.length === 1 ? exact[0]
    : compatible.length === 1 && candidates.length === 1 ? compatible[0]
    : names.length === 1 && !registrationKey(names[0].registration) && sameBranch(names[0]) ? names[0]
    : undefined;
  return { candidates, automatic };
}

export function branchCompany(branches: FeriasSnapshot["branches"], branch: string) {
  const code = normalizedName(formatUnimedBranchForPdf(branch));
  const companies = (branches ?? []).filter(item => normalizedName(formatUnimedBranchForPdf(item.code)) === code);
  const cnpj = companies.length === 1 ? companies[0].cnpj?.replace(/\D/g, "") : "";
  if (cnpj?.length !== 14 || /^(\d)\1+$/.test(cnpj)) return undefined;
  return cnpj;
}

export function contradictsCompany(group: LoanGroup, cnpj: string | undefined) {
  return !!cnpj && group.loans.some(loan => loan.companyCnpj && loan.companyCnpj.replace(/\D/g, "") !== cnpj);
}

export function matchLoanCompany(
  groups: LoanGroup[], cnpj: string | undefined, name: string, registration: string,
) {
  if (!cnpj) return undefined;
  const matches = groups.filter(group => group.loans.every(loan => {
    const bankRegistration = registrationKey(loan.registration);
    return normalizedName(loan.employeeName) === name && loan.companyCnpj?.replace(/\D/g, "") === cnpj &&
      (!/^\d+$/.test(bankRegistration) || bankRegistration === registrationKey(registration));
  }));
  return matches.length === 1 && matches[0].cpf ? matches[0] : undefined;
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
