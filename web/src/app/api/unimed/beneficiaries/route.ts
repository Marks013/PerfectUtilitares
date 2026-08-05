import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
} from "@/lib/api/security";
import { prisma } from "@/lib/prisma";
import { requireUnimedAccess } from "@/lib/unimed/access.server";
import { findWithPreviousCompetencyFallback } from "@/lib/unimed/competency-fallback";
import { getUnimedConfiguration } from "@/lib/unimed/configuration";
import { resolveUnimedPlanPrice } from "@/lib/unimed/pricing";
import { dateOnlySchema, zodIssueDetails } from "@/lib/unimed/schema";

export const runtime = "nodejs";

const searchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  referenceDate: dateOnlySchema.optional(),
});

type BeneficiarySearchMode = "NAME" | "CPF" | "REGISTRATION";

export function classifyBeneficiarySearch(query: string): {
  mode: BeneficiarySearchMode;
  value: string;
} {
  const trimmed = query.trim();
  const digits = trimmed.replace(/\D/g, "");
  const numericQuery = /^[\d.()\-/\s]+$/.test(trimmed);

  if (numericQuery && digits.length === 11) {
    return { mode: "CPF", value: digits };
  }
  if (numericQuery && digits.length > 0) {
    return { mode: "REGISTRATION", value: digits };
  }
  return { mode: "NAME", value: trimmed };
}

function currentUtcDate() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function GET(request: Request) {
  const access = await requireUnimedAccess("VIEW");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-beneficiary-search",
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = searchSchema.safeParse({
    q: url.searchParams.get("q"),
    referenceDate: url.searchParams.get("referenceDate") || undefined,
  });
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_SEARCH_INVALID",
      "Informe ao menos dois caracteres para pesquisar.",
      zodIssueDetails(parsed.error),
    );
  }

  const search = classifyBeneficiarySearch(parsed.data.q);
  const referenceDate = parsed.data.referenceDate
    ? new Date(`${parsed.data.referenceDate}T00:00:00.000Z`)
    : currentUtcDate();
  const referenceYear = referenceDate.getUTCFullYear();
  const referenceMonth = referenceDate.getUTCMonth() + 1;
  const [initialCompetency, configuration] = await Promise.all([
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
      select: { id: true, year: true, month: true },
    }),
    getUnimedConfiguration(access.tenantId, referenceDate),
  ]);
  const findBeneficiaries = (competencyId: string) =>
    prisma.unimedBeneficiary.findMany({
        where: {
          tenantId: access.tenantId,
          competencyId,
          category: "HOLDER",
          ...(search.mode === "CPF"
            ? {
                OR: [
                  { cpf: search.value },
                  { dependents: { some: { cpf: search.value } } },
                ],
              }
            : search.mode === "REGISTRATION"
              ? {
                  registration: search.value,
                  // A matrícula corporativa é autoridade do cadastro de
                  // endereço. O vínculo existe somente após conciliação por CPF.
                  address: { isNot: null },
                }
              : {
                  OR: [
                    {
                      fullName: {
                        contains: search.value,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      dependents: {
                        some: {
                          fullName: {
                            contains: search.value,
                            mode: "insensitive" as const,
                          },
                        },
                      },
                    },
                  ],
                }),
        },
        select: {
          id: true,
          registration: true,
          fullName: true,
          cpf: true,
          birthDate: true,
          inclusionDate: true,
          category: true,
          relationship: true,
          planCode: true,
          planName: true,
          accommodation: true,
          hasAddon: true,
          branch: { select: { code: true, name: true } },
          holder: { select: { id: true, fullName: true } },
          dependents: {
            select: {
              id: true,
              fullName: true,
              birthDate: true,
              category: true,
              relationship: true,
              planCode: true,
              planName: true,
              hasAddon: true,
            },
            orderBy: { fullName: "asc" },
          },
          address: {
            select: {
              addressLine: true,
              number: true,
              complement: true,
              district: true,
              postalCode: true,
              city: true,
              state: true,
            },
          },
        },
                orderBy: { fullName: "asc" },
        take: 20,
      });
  const { competency, items: beneficiaries } =
    await findWithPreviousCompetencyFallback(
      initialCompetency,
      findBeneficiaries,
      (currentCompetency) =>
        prisma.unimedCompetency.findFirst({
          where: {
            tenantId: access.tenantId,
            status: { in: ["ACTIVE", "PREVIOUS"] },
            beneficiaries: { some: {} },
            id: { not: currentCompetency.id },
            OR: [
              { year: { lt: referenceYear } },
              { year: referenceYear, month: { lte: referenceMonth } },
            ],
          },
          orderBy: [{ year: "desc" }, { month: "desc" }],
          select: { id: true, year: true, month: true },
        }),
    );
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
  const pricingFor = (beneficiary: {
    birthDate: Date | null;
    planCode: string | null;
  }) =>
    resolveUnimedPlanPrice({
      birthDate: beneficiary.birthDate,
      referenceDate,
      planCode: beneficiary.planCode,
      ageBrackets,
      prices,
    });

  const response = NextResponse.json({
    searchMode: search.mode,
    beneficiaries: beneficiaries.map((beneficiary) => ({
      ...beneficiary,
      pricing: pricingFor(beneficiary),
      dependents: beneficiary.dependents.map((dependent) => ({
        ...dependent,
        pricing: pricingFor(dependent),
      })),
    })),
    pricingContext: {
      referenceDate: referenceDate.toISOString().slice(0, 10),
      dataCompetency: competency
        ? { year: competency.year, month: competency.month }
        : null,
      billingClosure: configuration.billing?.closure ?? null,
      addonPrices: configuration.addonPrices.map((price) => ({
        code: price.code,
        label: price.label,
        amount: price.amount.toFixed(2),
      })),
    },
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function POST() {
  return methodNotAllowed(["GET"]);
}
