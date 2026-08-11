import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  getUnimedConfiguration,
  getUnimedPriceHistory,
} from "@/lib/unimed/configuration";

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function decimal(value: { toFixed(digits: number): string } | null | undefined) {
  return value ? value.toFixed(2) : null;
}

export async function createUnimedExcelSnapshot(tenantId: string) {
  const [competencies, branches, priceHistory] = await Promise.all([
    prisma.unimedCompetency.findMany({
      where: { tenantId, status: { not: "DRAFT" } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: 2,
      include: {
        beneficiaries: {
          orderBy: [{ fullName: "asc" }, { sourceKey: "asc" }],
          include: {
            address: true,
            branch: { select: { code: true } },
            holder: { select: { sourceKey: true } },
          },
        },
        invoiceItems: {
          orderBy: [{ beneficiaryName: "asc" }, { sourceKey: "asc" }],
          include: {
            branch: { select: { code: true } },
            beneficiary: { select: { sourceKey: true } },
          },
        },
        payrollLoans: {
          orderBy: [{ employeeName: "asc" }, { sourceKey: "asc" }],
          include: { beneficiary: { select: { sourceKey: true } } },
        },
      },
    }),
    prisma.unimedBranch.findMany({
      where: { tenantId },
      orderBy: [{ active: "desc" }, { code: "asc" }],
    }),
    getUnimedPriceHistory(tenantId),
  ]);

  const referenceDate = priceHistory[0]?.validFrom ?? new Date();
  const configuration = await getUnimedConfiguration(tenantId, referenceDate);

  const payload = {
    schemaVersion: 1,
    branches: branches.map((branch) => ({
      code: branch.code,
      name: branch.name,
      companyName: branch.companyName,
      cnpj: branch.cnpj,
      addressLine: branch.addressLine,
      number: branch.number,
      district: branch.district,
      postalCode: branch.postalCode,
      city: branch.city,
      state: branch.state,
      stateRegistration: branch.stateRegistration,
      phone: branch.phone,
      active: branch.active,
    })),
    competencies: competencies.map((competency) => ({
      year: competency.year,
      month: competency.month,
      status: competency.status,
      beneficiaries: competency.beneficiaries.map((beneficiary) => ({
        sourceKey: beneficiary.sourceKey,
        holderSourceKey: beneficiary.holder?.sourceKey ?? null,
        branchCode: beneficiary.branch?.code ?? null,
        registration: beneficiary.registration,
        fullName: beneficiary.fullName,
        cpf: beneficiary.cpf,
        rg: beneficiary.rg,
        birthDate: isoDate(beneficiary.birthDate),
        inclusionDate: isoDate(beneficiary.inclusionDate),
        category: beneficiary.category,
        relationship: beneficiary.relationship,
        planCode: beneficiary.planCode,
        planName: beneficiary.planName,
        accommodation: beneficiary.accommodation,
        companyCnpj: beneficiary.companyCnpj,
        hasAddon: beneficiary.hasAddon,
        address: beneficiary.address
          ? {
              addressLine: beneficiary.address.addressLine,
              number: beneficiary.address.number,
              complement: beneficiary.address.complement,
              district: beneficiary.address.district,
              postalCode: beneficiary.address.postalCode,
              city: beneficiary.address.city,
              state: beneficiary.address.state,
              pis: beneficiary.address.pis,
            }
          : null,
      })),
      invoiceItems: competency.invoiceItems.map((item) => ({
        sourceKey: item.sourceKey,
        beneficiarySourceKey: item.beneficiary?.sourceKey ?? null,
        branchCode: item.branch?.code ?? null,
        beneficiaryName: item.beneficiaryName,
        holderName: item.holderName,
        category: item.category,
        itemCode: item.itemCode,
        itemDescription: item.itemDescription,
        amount: decimal(item.amount),
        planCode: item.planCode,
        planName: item.planName,
      })),
      payrollLoans: competency.payrollLoans.map((loan) => ({
        sourceKey: loan.sourceKey,
        beneficiarySourceKey: loan.beneficiary?.sourceKey ?? null,
        sourceRow: loan.sourceRow,
        competence: loan.competence,
        cpf: loan.cpfNormalized,
        registration: loan.registration,
        employeeName: loan.employeeName,
        contractNumber: loan.contractNumber,
        installmentAmount: decimal(loan.installmentAmount),
        startCompetence: loan.startCompetence,
        endCompetence: loan.endCompetence,
        bankCode: loan.bankCode,
        bankName: loan.bankName,
        totalInstallments: loan.totalInstallments,
        loanAmount: decimal(loan.loanAmount),
        releasedAmount: decimal(loan.releasedAmount),
        contractStartDate: isoDate(loan.contractStartDate),
        contractEndDate: isoDate(loan.contractEndDate),
        companyCnpj: loan.companyCnpj,
        matchMethod: loan.matchMethod,
      })),
    })),
    configuration: {
      ageBrackets: configuration.ageBrackets.map((bracket) => ({
        code: bracket.code,
        label: bracket.label,
        minAge: bracket.minAge,
        maxAge: bracket.maxAge,
        sortOrder: bracket.sortOrder,
      })),
      billing: configuration.billing
        ? {
            closure: configuration.billing.closure,
            closingDay: configuration.billing.closingDay,
            validFrom: isoDate(configuration.billing.validFrom),
            validTo: isoDate(configuration.billing.validTo),
          }
        : null,
      rules: configuration.rules
        ? {
            annualAdjustmentPercent:
              configuration.rules.annualAdjustment.toNumber() * 100,
            differencePercent: configuration.rules.difference.toNumber() * 100,
            validFrom: isoDate(configuration.rules.validFrom),
            validTo: isoDate(configuration.rules.validTo),
          }
        : null,
      reasons: configuration.reasons.map((reason) => ({
        code: reason.code,
        label: reason.label,
        documentKind: reason.documentKind,
      })),
      priceHistory: priceHistory.map((period) => ({
        status: period.status,
        validFrom: isoDate(period.validFrom),
        validTo: isoDate(period.validTo),
        planPrices: period.planPrices.map((price) => ({
          planCode: price.planCode,
          ageBracketCode: price.ageBracket.code,
          ageBracketLabel: price.ageBracket.label,
          minAge: price.ageBracket.minAge,
          maxAge: price.ageBracket.maxAge,
          sortOrder: price.ageBracket.sortOrder,
          companyAmount: decimal(price.companyAmount),
          employeeAmount: decimal(price.employeeAmount),
        })),
        addonPrices: period.addonPrices.map((price) => ({
          code: price.code,
          label: price.label,
          amount: decimal(price.amount),
        })),
      })),
    },
  };

  const snapshotVersion = createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");

  return { ...payload, snapshotVersion };
}
