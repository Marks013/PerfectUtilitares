import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { requireUnimedAccess } from "@/lib/unimed/access.server";
import { prisma } from "@/lib/prisma";
import { calculateUnimed } from "@/lib/unimed/calculation";
import { getUnimedConfiguration } from "@/lib/unimed/configuration";
import { resolveUnimedPlanPrice } from "@/lib/unimed/pricing";
import { dateOnlySchema, zodIssueDetails } from "@/lib/unimed/schema";
import type { UnimedCalculationInput } from "@/lib/unimed/types";

export const runtime = "nodejs";

const MAX_CALCULATION_BODY_BYTES = 16 * 1024;
const calculationRequestSchema = z
  .object({
    beneficiaryId: z.string().trim().min(8).max(64),
    dependentIds: z
      .array(z.string().trim().min(8).max(64))
      .max(6)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Não repita dependentes no mesmo cálculo.",
      }),
    reasonCode: z.number().int().min(1).max(9_999),
    exclusionDate: dateOnlySchema,
  })
  .strict();

function normalizeCpf(value: string | null) {
  return value?.replace(/\D/g, "") ?? "";
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function competence(value: Date) {
  return value.toISOString().slice(0, 7);
}

function nextCompetencyReference(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1),
  );
}

type Configuration = Awaited<ReturnType<typeof getUnimedConfiguration>>;
type PersonForPricing = {
  birthDate: Date | null;
  planCode: string | null;
  hasAddon: boolean;
};

function pricingResolver(configuration: Configuration, referenceDate: Date) {
  const ageBrackets = configuration.ageBrackets.map((bracket) => ({
    code: bracket.code,
    minAge: bracket.minAge,
    maxAge: bracket.maxAge,
  }));
  const prices = configuration.planPrices.map((price) => ({
    planCode: price.planCode,
    ageBracketCode: price.ageBracket.code,
    companyAmount: price.companyAmount.toFixed(2),
    employeeAmount: price.employeeAmount.toFixed(2),
  }));
  return (person: PersonForPricing) =>
    resolveUnimedPlanPrice({
      birthDate: person.birthDate,
      referenceDate,
      planCode: person.planCode,
      ageBrackets,
      prices,
    });
}

function addonAmountFor(
  configuration: Configuration,
  people: PersonForPricing[],
) {
  if (!people.some((person) => person.hasAddon)) return 0;
  if (configuration.addonPrices.length !== 1) return null;
  return configuration.addonPrices[0].amount.toNumber();
}

function officialMoneySet(input: {
  holder: PersonForPricing;
  dependents: PersonForPricing[];
  configuration: Configuration;
  referenceDate: Date;
}) {
  const resolvePricing = pricingResolver(
    input.configuration,
    input.referenceDate,
  );
  const holderPricing = resolvePricing(input.holder);
  const dependentPricing = input.dependents.map((dependent) => ({
    dependent,
    pricing: resolvePricing(dependent),
  }));
  if (
    holderPricing.status !== "RESOLVED" ||
    dependentPricing.some(({ pricing }) => pricing.status !== "RESOLVED")
  ) {
    return { status: "PRICE_MISSING" as const };
  }
  const addonAmount = addonAmountFor(input.configuration, [
    input.holder,
    ...input.dependents,
  ]);
  if (addonAmount === null) {
    return { status: "ADDON_MISSING" as const };
  }
  return {
    status: "RESOLVED" as const,
    holder: {
      invoicePlanAmount: Number(holderPricing.companyAmount),
      payrollPlanAmount: Number(holderPricing.employeeAmount),
      addonAmount: input.holder.hasAddon ? addonAmount : 0,
    },
    dependents: dependentPricing.map(({ dependent, pricing }) => ({
      invoicePlanAmount: Number(pricing.companyAmount),
      addonAmount: dependent.hasAddon ? addonAmount : 0,
    })),
  };
}

type OfficialMoneySetResult = ReturnType<typeof officialMoneySet>;

export function GET() {
  return methodNotAllowed(["POST"]);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("CALCULATE");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-calculation",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const contentLengthError = requireMaxContentLength(
    request,
    MAX_CALCULATION_BODY_BYTES,
  );
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = calculationRequestSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_CALCULATION_INVALID",
      "Revise os dados informados para o cálculo.",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const referenceDate = new Date(
      `${parsed.data.exclusionDate}T00:00:00.000Z`,
    );
    const referenceYear = referenceDate.getUTCFullYear();
    const referenceMonth = referenceDate.getUTCMonth() + 1;
    const [reason, competency, configuration] = await Promise.all([
      prisma.unimedExclusionReason.findFirst({
        where: {
          tenantId: access.tenantId,
          code: parsed.data.reasonCode,
          active: true,
        },
        select: { documentKind: true },
      }),
      prisma.unimedCompetency.findFirst({
        where: {
          tenantId: access.tenantId,
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
      getUnimedConfiguration(access.tenantId, referenceDate),
    ]);
    if (!reason) {
      return jsonError(
        422,
        "UNIMED_REASON_NOT_FOUND",
        "O motivo selecionado não está ativo. Atualize a página.",
      );
    }
    if (!competency) {
      return jsonError(
        422,
        "UNIMED_COMPETENCY_NOT_FOUND",
        "Não existe uma base de beneficiários vigente para a data informada.",
      );
    }
    if (!configuration.billing) {
      return jsonError(
        422,
        "UNIMED_BILLING_NOT_CONFIGURED",
        "Configure o fechamento da fatura para a data informada.",
      );
    }

    const beneficiary = await prisma.unimedBeneficiary.findFirst({
      where: {
        id: parsed.data.beneficiaryId,
        tenantId: access.tenantId,
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
          where: { id: { in: parsed.data.dependentIds } },
          select: {
            id: true,
            birthDate: true,
            planCode: true,
            hasAddon: true,
          },
        },
      },
    });
    if (!beneficiary) {
      return jsonError(
        422,
        "UNIMED_BENEFICIARY_NOT_CURRENT",
        "O titular não pertence às duas competências disponíveis. Pesquise o colaborador novamente.",
      );
    }
    if (beneficiary.dependents.length !== parsed.data.dependentIds.length) {
      return jsonError(
        422,
        "UNIMED_DEPENDENT_NOT_LINKED",
        "Um dos dependentes não pertence ao titular selecionado.",
      );
    }
    const dependentById = new Map(
      beneficiary.dependents.map((dependent) => [dependent.id, dependent]),
    );
    const selectedDependents = parsed.data.dependentIds.map(
      (dependentId) => dependentById.get(dependentId)!,
    );
    if (!beneficiary.inclusionDate) {
      return jsonError(
        422,
        "UNIMED_ENROLLMENT_DATE_MISSING",
        "A data de inclusão do titular não está disponível na base vigente.",
      );
    }

    const currentMoney = officialMoneySet({
      holder: beneficiary,
      dependents: selectedDependents,
      configuration,
      referenceDate,
    });
    if (currentMoney.status === "PRICE_MISSING") {
      return jsonError(
        422,
        "UNIMED_PRICE_NOT_CONFIGURED",
        `Não há preço oficial único configurado para a competência ${competence(referenceDate)}.`,
      );
    }
    if (currentMoney.status === "ADDON_MISSING") {
      return jsonError(
        422,
        "UNIMED_ADDON_NOT_CONFIGURED",
        `Configure um único valor de Acessório Funeral para a competência ${competence(referenceDate)}.`,
      );
    }

    const cutoffApplied =
      configuration.billing.closure === "AUTOMATIC_DAY_25" &&
      referenceDate.getUTCDate() >= 25;
    const nextReferenceDate = nextCompetencyReference(referenceDate);
    let nextMoney: OfficialMoneySetResult | null = null;
    if (cutoffApplied) {
      const nextConfiguration = await getUnimedConfiguration(
        access.tenantId,
        nextReferenceDate,
      );
      nextMoney = officialMoneySet({
        holder: beneficiary,
        dependents: selectedDependents,
        configuration: nextConfiguration,
        referenceDate: nextReferenceDate,
      });
      if (nextMoney.status === "PRICE_MISSING") {
        return jsonError(
          422,
          "UNIMED_NEXT_PRICE_NOT_CONFIGURED",
          `Não há preço oficial único configurado para a mensalidade de ${competence(nextReferenceDate)}.`,
        );
      }
      if (nextMoney.status === "ADDON_MISSING") {
        return jsonError(
          422,
          "UNIMED_NEXT_ADDON_NOT_CONFIGURED",
          `Configure um único valor de Acessório Funeral para ${competence(nextReferenceDate)}.`,
        );
      }
    }

    const officialInput: UnimedCalculationInput = {
      reasonCode: parsed.data.reasonCode,
      exclusionDate: parsed.data.exclusionDate,
      planEnrollmentDate: dateOnly(beneficiary.inclusionDate),
      billingClosure: configuration.billing.closure,
      holder: currentMoney.holder,
      dependents: currentMoney.dependents,
      ...(nextMoney?.status === "RESOLVED"
        ? {
            nextCompetency: {
              holder: nextMoney.holder,
              dependents: nextMoney.dependents,
            },
          }
        : {}),
    };
    const calculation = calculateUnimed(officialInput);
    calculation.documentKind = reason.documentKind;

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

    const cpfNormalized = normalizeCpf(beneficiary.cpf);
    if (cpfNormalized) {
      const requestedCompetence = parsed.data.exclusionDate.slice(0, 7);
      const availableCompetence = await prisma.unimedPayrollLoan.findFirst({
        where: {
          tenantId: access.tenantId,
          cpfNormalized,
          competence: { lte: requestedCompetence },
        },
        orderBy: { competence: "desc" },
        select: { competence: true },
      });
      if (availableCompetence) {
        const contracts = await prisma.unimedPayrollLoan.findMany({
          where: {
            tenantId: access.tenantId,
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

    const response = NextResponse.json({
      calculation,
      officialInput,
      pricingCompetencies: {
        current: competence(referenceDate),
        next: cutoffApplied ? competence(nextReferenceDate) : null,
      },
      payrollLoans,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return jsonError(
      500,
      "UNIMED_CALCULATION_FAILED",
      "Não foi possível concluir o cálculo. Tente novamente.",
    );
  }
}
