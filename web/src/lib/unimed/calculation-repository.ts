import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getUnimedCalculationConfiguration } from "./configuration";
import type { UnimedCalculationRequest } from "./calculation-request";

function normalizeCpf(value: string | null) {
  return value?.replace(/\D/g, "") ?? "";
}

export async function loadUnimedCalculationContext(
  tenantId: string,
  input: UnimedCalculationRequest,
  referenceDate: Date,
) {
  const referenceYear = referenceDate.getUTCFullYear();
  const referenceMonth = referenceDate.getUTCMonth() + 1;
  const [reason, competency, configuration, beneficiary] = await Promise.all([
    prisma.unimedExclusionReason.findFirst({
      where: {
        tenantId: tenantId,
        code: input.reasonCode,
        active: true,
      },
      select: { documentKind: true },
    }),
    prisma.unimedCompetency.findFirst({
      where: {
        tenantId: tenantId,
        status: { in: ["ACTIVE", "PREVIOUS"] },
        beneficiaries: { some: {} },
        OR: [
          { year: { lt: referenceYear } },
          { year: referenceYear, month: { lte: referenceMonth } },
        ],
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { id: true },
    }),
    getUnimedCalculationConfiguration(tenantId, referenceDate),
    prisma.unimedBeneficiary.findFirst({
      where: {
        id: input.beneficiaryId,
        tenantId: tenantId,
        competency: {
          status: { in: ["ACTIVE", "PREVIOUS"] },
          OR: [
            { year: { lt: referenceYear } },
            { year: referenceYear, month: { lte: referenceMonth } },
          ],
        },
        category: "HOLDER",
      },
      select: {
        cpf: true,
        birthDate: true,
        inclusionDate: true,
        planCode: true,
        hasAddon: true,
        dependents: {
          where: { id: { in: input.dependentIds } },
          orderBy: { sourceKey: "asc" },
          select: {
            id: true,
            birthDate: true,
            inclusionDate: true,
            planCode: true,
            hasAddon: true,
          },
        },
      },
    }),
  ]);
  return { reason, competency, configuration, beneficiary };
}

export async function loadUnimedPayrollLoans(
  tenantId: string,
  cpf: string | null,
  exclusionDate: string,
) {
  let payrollLoans: {
    competence: string;
    totalAmount: string;
    contracts: Array<{
      contractNumber: string;
      installmentAmount: string;
      startCompetence: string;
      endCompetence: string;
      bankCode: string;
      bankName: string;
    }>;
  } | null = null;

  const cpfNormalized = normalizeCpf(cpf);
  if (cpfNormalized) {
    const requestedCompetence = exclusionDate.slice(0, 7);
    const availableCompetence = await prisma.unimedPayrollLoan.findFirst({
      where: {
        tenantId: tenantId,
        cpfNormalized,
        competence: { lte: requestedCompetence },
      },
      orderBy: { competence: "desc" },
      select: { competence: true },
    });
    if (availableCompetence) {
      const contracts = await prisma.unimedPayrollLoan.findMany({
        where: {
          tenantId: tenantId,
          cpfNormalized,
          competence: availableCompetence.competence,
          startCompetence: { lte: requestedCompetence },
          endCompetence: { gte: requestedCompetence },
        },
        select: {
          contractNumber: true,
          installmentAmount: true,
          startCompetence: true,
          endCompetence: true,
          bankCode: true,
          bankName: true,
        },
        orderBy: [{ bankCode: "asc" }, { contractNumber: "asc" }],
      });
      const totalAmount = contracts.reduce(
        (total, contract) => total.plus(contract.installmentAmount),
        new Prisma.Decimal(0),
      );
      payrollLoans = {
        competence: availableCompetence.competence,
        totalAmount: totalAmount.toFixed(2),
        contracts: contracts.map((contract) => ({
          ...contract,
          installmentAmount: contract.installmentAmount.toFixed(2),
        })),
      };
    }
  }

  return payrollLoans;
}
