import { createHash } from "node:crypto";
import { buildInvoiceIndex, calculateLoanBenefit, calculateUnimedBenefit } from "./benefits";
import { FERIAS_CALENDAR_VERSION, vacationHighlight } from "./calendar";
import type { FeriasAnalysis, FeriasChoice, FeriasResultRow, FeriasSnapshot } from "./contracts";
import { FeriasError } from "./errors";
import { branchCompany, buildIdentityIndex, contradictsCompany, cpfKey, holderOptions, loanLabel, matchLoanCompany, normalizedName, registrationKey, resolveHolder, searchName, selectCandidate } from "./identity";
import { readFeriasSnapshot } from "./repository";
import type { FeriasInputRow } from "./workbook";

const RULE_REVISION = "ferias-2026-08-27-v4";

function formatCompetency(value: string) {
  return `${value.slice(5)}/${value.slice(0, 4)}`;
}

function previousCompetency(value: string) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildFeriasAnalysis(
  snapshot: FeriasSnapshot, input: FeriasInputRow[], competency: string,
  choices: FeriasChoice[], fileHash: string,
): FeriasAnalysis {
  const rowNumbers = new Set(input.map((row) => row.row));
  if (choices.some((choice) => !rowNumbers.has(choice.row))) {
    throw new FeriasError("FERIAS_CHOICE_INVALID", "Uma confirmação não pertence ao arquivo enviado.");
  }
  const choicesByRow = new Map(choices.map((choice) => [choice.row, choice]));
  const identities = buildIdentityIndex(snapshot);
  const invoices = buildInvoiceIndex(snapshot.invoices, snapshot.beneficiaries);
  const unimedSources = snapshot.sources.filter((source) => source.name !== "Consignado Digital");
  const loanSource = snapshot.sources.find((source) => source.name === "Consignado Digital");
  const unimedReady = unimedSources.length === 2 && unimedSources.every((source) => source.ready);
  const loansReady = loanSource?.ready === true;
  const issues: string[] = [];
  if (!unimedReady) {
    issues.push(`Unimed: não há uma base completa em ${formatCompetency(competency)} nem em ${formatCompetency(previousCompetency(competency))}. Publique o cadastro e a fatura/coparticipação de uma dessas competências para continuar.`);
  }
  if (!loansReady) {
    issues.push(`Consignado Digital: a base obrigatória de ${formatCompetency(competency)} ainda não foi publicada. Importe e publique essa competência para continuar; o consignado não usa o mês anterior.`);
  }
  const rows: FeriasResultRow[] = input.map((row) => {
    const result: FeriasResultRow = { ...row, unimedText: "", loanText: "", issues: [], warnings: [], holderCandidates: [], loanCandidates: [] };
    if (row.start.slice(0, 7) !== competency) throw new FeriasError("FERIAS_MONTH_MISMATCH", "As férias devem começar na mesma competência.");
    if (vacationHighlight(row.start, row.end).nonBusinessStart) result.warnings.push("O início informado não é dia útil. Confira a data.");
    const name = searchName(row.name);
    if (name !== normalizedName(row.name)) result.warnings.push("A observação de abono foi preservada no nome e desconsiderada apenas na busca.");
    const { candidates: holderCandidates, automatic: automaticHolder } = resolveHolder(
      identities, row.registration, name, row.branch,
    );
    const choice = choicesByRow.get(row.row);
    const holder = unimedSources[0]?.ready
      ? selectCandidate(holderCandidates, automaticHolder, choice?.holderId) : undefined;
    if (unimedSources[0]?.ready) {
      result.holderCandidates = holderOptions(holderCandidates);
      result.holderId = holder?.id;
      if (holder && automaticHolder?.id === holder.id && normalizedName(holder.fullName) !== name) {
        result.warnings.push("Titular confirmado pela matrícula; o nome na planilha difere do cadastro Unimed.");
      }
      if (!holder && holderCandidates.length === 1) {
        result.issues.push("A matrícula não confirmou o titular localizado pelo nome. Escolha a pessoa correta na lista Unimed desta linha.");
      } else if (!holder && holderCandidates.length > 1) {
        result.issues.push("Há mais de um titular possível na base Unimed. Escolha a pessoa correta nesta linha.");
      }
    }
    if (holder && unimedReady) {
      const benefit = calculateUnimedBenefit(holder, identities.dependents.get(holder.id) ?? [], invoices, snapshot.prices, competency);
      result.unimedText = benefit.text;
      result.issues.push(...benefit.issues);
      result.warnings.push(...(benefit.warnings ?? []));
    } else if (unimedReady && !holderCandidates.length && invoices.byHolder.has(name)) {
      result.issues.push("Há itens de fatura para esse nome, mas o titular não foi localizado no cadastro Unimed.");
    }
    if (loansReady) {
      const cpf = cpfKey(holder?.cpf ?? null);
      const cpfMatches = cpf ? identities.loanCpfs.get(cpf) ?? [] : [];
      const identityNames = new Set([name, normalizedName(holder?.fullName ?? row.name)]);
      const names = [...new Map([...identityNames].flatMap(value => identities.loanNames.get(value) ?? [])
        .map(group => [group.id, group])).values()];
      const company = branchCompany(snapshot.branches, row.branch);
      const registrationLoans = (identities.loanRegistrations.get(registrationKey(row.registration)) ?? [])
        .filter(group => !contradictsCompany(group, company) || (!!cpf && group.cpf === cpf) || names.some(match => match.id === group.id));
      const loanCandidates = [...new Map([...cpfMatches, ...names, ...registrationLoans].map((group) => [group.id, group])).values()];
      // A name match never silently overrides a contradictory CPF.
      const compatible = loanCandidates.filter((group) => !cpf || !group.cpf || group.cpf === cpf);
      if (compatible.length !== loanCandidates.length) result.issues.push("O nome corresponde a um Consignado com CPF diferente do titular. Revise a identificação.");
      result.loanCandidates = compatible.map((group) => ({ id: group.id, label: loanLabel(group) }));
      const rowRegistration = registrationKey(row.registration);
      const registrationLoanMatches = compatible.filter((group) =>
        group.loans.some((loan) => registrationKey(loan.registration) === rowRegistration));
      const companyLoan = matchLoanCompany(compatible, company, name, row.registration);
      const automaticLoan = cpfMatches.length === 1
        ? cpfMatches[0]
        : compatible.length === 1 && registrationLoanMatches.length === 1 &&
          names.some((group) => group.id === registrationLoanMatches[0].id)
          ? registrationLoanMatches[0]
          : companyLoan;
      const group = selectCandidate(compatible, automaticLoan, choice?.loanIdentity);
      result.loanIdentity = group?.id;
      const companyConflict = !!group && contradictsCompany(group, company);
      const selectedCompanies = new Set(group?.loans.map(loan => loan.companyCnpj?.replace(/\D/g, "")));
      const selectedCompany = company ?? (selectedCompanies.size === 1 ? [...selectedCompanies][0] : undefined);
      const incompleteParcels = !!group && compatible.some(other => other.id !== group.id && (!group.cpf || !other.cpf) && !contradictsCompany(other, selectedCompany) &&
        other.loans.some(loan => identityNames.has(normalizedName(loan.employeeName))));
      if (companyConflict) {
        result.issues.push("O CNPJ do Consignado não corresponde à filial da planilha. Confira a empresa responsável por essas parcelas antes de exportar.");
      }
      if (incompleteParcels) {
        result.issues.push("Há outras parcelas para esse nome sem CPF confirmado. Revise o cadastro do Consignado para que nenhuma parcela fique de fora.");
      }
      if (group && !companyConflict && !incompleteParcels && !cpfMatches.length && registrationLoanMatches.length === 1) {
        result.warnings.push("Consignado Digital confirmado pela matrícula; não foi necessária seleção manual.");
      } else if (group && !companyConflict && !incompleteParcels && !cpfMatches.length && companyLoan?.id === group.id) {
        result.warnings.push("Consignado Digital confirmado pelo nome completo e CNPJ da filial, com CPF único na base. A identificação bancária não foi confundida com a matrícula do RH.");
      }
      if (group) {
        if (!companyConflict && !incompleteParcels) {
          const benefit = calculateLoanBenefit(group, competency);
          result.loanText = benefit.text;
          result.issues.push(...benefit.issues);
        }
      } else if (compatible.length === 1) {
        result.issues.push(names.length ? "O Consignado foi localizado somente pelo nome. Confirme a pessoa correta na lista desta linha."
          : "A matrícula localizou um Consignado com nome diferente. Confirme a pessoa correta na lista desta linha.");
      } else if (compatible.length > 1) {
        result.issues.push("Há mais de uma pessoa possível no Consignado Digital. Escolha o vínculo correto nesta linha.");
      }
    }
    if (!result.unimedText && !result.loanText && !result.issues.length && !issues.length) {
      result.warnings.push("Nenhum valor de Unimed ou Consignado foi localizado nas bases informadas acima.");
    }
    return result;
  });
  const revision = createHash("sha256").update(JSON.stringify({
    rules: RULE_REVISION, calendar: FERIAS_CALENDAR_VERSION,
    competency, snapshot: snapshot.revision, fileHash,
    choices: [...choices].sort((a, b) => a.row - b.row),
  })).digest("hex");
  return {
    competency, revision, sources: snapshot.sources,
    pricePeriods: [...new Set(snapshot.prices.map((price) => price.validFrom))].sort(),
    issues, rows,
    summary: {
      total: rows.length, unimed: rows.filter((row) => row.unimedText).length,
      loans: rows.filter((row) => row.loanText).length,
      pending: rows.filter((row) => row.issues.length).length,
      highlighted: rows.filter((row) => row.highlight).length,
    },
    canExport: rows.length > 0 && !issues.length && rows.every((row) => !row.issues.length),
  };
}

export async function analyzeFerias(
  tenantId: string, rows: FeriasInputRow[], competency: string, choices: FeriasChoice[], fileHash: string,
) {
  return buildFeriasAnalysis(await readFeriasSnapshot(tenantId, competency), rows, competency, choices, fileHash);
}
