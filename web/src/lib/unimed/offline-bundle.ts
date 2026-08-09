import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

export async function buildUnimedOfflineBundle(
  tenantId: string,
  offlineExpiresAt: Date,
) {
  const generatedAt = new Date();
  const horizonStart = new Date(generatedAt);
  horizonStart.setUTCDate(horizonStart.getUTCDate() - 31);
  const horizonEnd = new Date(offlineExpiresAt);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 31);

  const [competencies, ageBrackets, planPrices, addonPrices, billingSettings] =
    await Promise.all([
      prisma.unimedCompetency.findMany({
        where: {
          tenantId,
          status: { in: ["ACTIVE", "PREVIOUS"] },
          beneficiaries: { some: {} },
        },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        take: 2,
        select: { id: true, year: true, month: true, updatedAt: true },
      }),
      prisma.unimedAgeBracket.findMany({
        where: { tenantId, active: true },
        orderBy: { sortOrder: "asc" },
        select: {
          code: true,
          minAge: true,
          maxAge: true,
          updatedAt: true,
        },
      }),
      prisma.unimedPlanPriceVersion.findMany({
        where: {
          tenantId,
          validFrom: { lte: horizonEnd },
          OR: [{ validTo: null }, { validTo: { gte: horizonStart } }],
        },
        orderBy: [{ validFrom: "asc" }, { planCode: "asc" }],
        select: {
          planCode: true,
          companyAmount: true,
          employeeAmount: true,
          validFrom: true,
          validTo: true,
          updatedAt: true,
          ageBracket: { select: { code: true } },
        },
      }),
      prisma.unimedAddonPriceVersion.findMany({
        where: {
          tenantId,
          validFrom: { lte: horizonEnd },
          OR: [{ validTo: null }, { validTo: { gte: horizonStart } }],
        },
        orderBy: [{ validFrom: "asc" }, { code: "asc" }],
        select: {
          code: true,
          label: true,
          amount: true,
          validFrom: true,
          validTo: true,
          updatedAt: true,
        },
      }),
      prisma.unimedBillingSetting.findMany({
        where: {
          tenantId,
          validFrom: { lte: horizonEnd },
          OR: [{ validTo: null }, { validTo: { gte: horizonStart } }],
        },
        orderBy: { validFrom: "asc" },
        select: {
          closure: true,
          closingDay: true,
          validFrom: true,
          validTo: true,
          updatedAt: true,
        },
      }),
    ]);

  const competencyIds = competencies.map(({ id }) => id);
  const beneficiaries = competencyIds.length > 0
    ? await prisma.unimedBeneficiary.findMany({
        where: {
          tenantId,
          competencyId: { in: competencyIds },
          category: "HOLDER",
        },
        orderBy: { fullName: "asc" },
        select: {
          id: true,
          competencyId: true,
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
          updatedAt: true,
          branch: { select: { code: true, name: true } },
          holder: { select: { id: true, fullName: true } },
          dependents: {
            orderBy: { fullName: "asc" },
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
              updatedAt: true,
            },
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
              updatedAt: true,
            },
          },
        },
      })
    : [];

  const serializedPlanPrices = planPrices.map((price) => ({
    planCode: price.planCode,
    ageBracketCode: price.ageBracket.code,
    companyAmount: price.companyAmount.toFixed(2),
    employeeAmount: price.employeeAmount.toFixed(2),
    validFrom: dateOnly(price.validFrom),
    validTo: dateOnly(price.validTo),
  }));
  const serializedAddonPrices = addonPrices.map((price) => ({
    code: price.code,
    label: price.label,
    amount: price.amount.toFixed(2),
    validFrom: dateOnly(price.validFrom),
    validTo: dateOnly(price.validTo),
  }));
  const serializedBilling = billingSettings.map((setting) => ({
    closure: setting.closure,
    closingDay: setting.closingDay,
    validFrom: dateOnly(setting.validFrom),
    validTo: dateOnly(setting.validTo),
  }));
  const versionInput = {
    competencies: competencies.map((competency) => [
      competency.id,
      competency.updatedAt.toISOString(),
    ]),
    beneficiaries: beneficiaries.map((item) => [
      item.id,
      item.updatedAt.toISOString(),
      ...item.dependents.map((dependent) =>
        `${dependent.id}:${dependent.updatedAt.toISOString()}`,
      ),
    ]),
    configuration: {
      ageBrackets: ageBrackets.map((item) => item.updatedAt.toISOString()),
      planPrices: planPrices.map((item) => item.updatedAt.toISOString()),
      addonPrices: addonPrices.map((item) => item.updatedAt.toISOString()),
      billing: billingSettings.map((item) => item.updatedAt.toISOString()),
    },
  };

  return {
    version: createHash("sha256")
      .update(JSON.stringify(versionInput))
      .digest("hex"),
    generatedAt: generatedAt.toISOString(),
    expiresAt: offlineExpiresAt.toISOString(),
    competency: competencies[0]
      ? {
          id: competencies[0].id,
          year: competencies[0].year,
          month: competencies[0].month,
        }
      : null,
    competencies: competencies.map(({ id, year, month }) => ({
      id,
      year,
      month,
    })),
    beneficiaries,
    configuration: {
      ageBrackets: ageBrackets.map((item) => ({
        code: item.code,
        minAge: item.minAge,
        maxAge: item.maxAge,
      })),
      planPrices: serializedPlanPrices,
      addonPrices: serializedAddonPrices,
      billing: serializedBilling,
    },
  };
}
