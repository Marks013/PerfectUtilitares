import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canUseUnimed } from "@/lib/unimed/access";
import { unimedConfigurationSchema } from "@/lib/unimed/schema";
import type { z } from "zod";

export type UnimedConfigurationInput = z.infer<
  typeof unimedConfigurationSchema
>;

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function previousDay(value: Date) {
  return new Date(value.getTime() - 24 * 60 * 60 * 1_000);
}

function validToBefore(nextValidFrom: Date | undefined) {
  return nextValidFrom ? previousDay(nextValidFrom) : null;
}

function versionKey(...parts: string[]) {
  return parts.join("\u0000");
}

const CONFIGURATION_VERSION_LIMIT = 2;

export class UnimedConfigurationRetentionError extends Error {
  constructor() {
    super(
      "A vigência informada é anterior às duas competências mais recentes e não pode ser mantida.",
    );
    this.name = "UnimedConfigurationRetentionError";
  }
}

async function pruneOldConfigurationVersions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  savedValidFrom: Date,
) {
  const periods = await tx.unimedPlanPriceVersion.findMany({
    where: { tenantId },
    select: { validFrom: true },
    distinct: ["validFrom"],
    orderBy: { validFrom: "desc" },
  });
  const retained = periods.slice(0, CONFIGURATION_VERSION_LIMIT);
  const savedWasRetained = retained.some(
    ({ validFrom }) => validFrom.getTime() === savedValidFrom.getTime(),
  );

  if (!savedWasRetained) {
    throw new UnimedConfigurationRetentionError();
  }

  const obsoleteDates = periods
    .slice(CONFIGURATION_VERSION_LIMIT)
    .map(({ validFrom }) => validFrom);
  const retainedDates = retained.map(({ validFrom }) => validFrom);

  await Promise.all([
    tx.unimedPlanPriceVersion.deleteMany({
      where: { tenantId, validFrom: { notIn: retainedDates } },
    }),
    tx.unimedAddonPriceVersion.deleteMany({
      where: { tenantId, validFrom: { notIn: retainedDates } },
    }),
    tx.unimedBillingSetting.deleteMany({
      where: { tenantId, validFrom: { notIn: retainedDates } },
    }),
    tx.unimedCalculationRuleVersion.deleteMany({
      where: { tenantId, validFrom: { notIn: retainedDates } },
    }),
  ]);

  return obsoleteDates;
}

export async function saveUnimedConfiguration(
  tenantId: string,
  actorIdentity: string | { moduleSessionId: string },
  rawInput: UnimedConfigurationInput,
) {
  const input = unimedConfigurationSchema.parse(rawInput);
  const validFrom = dateOnly(input.validFrom);
  const validTo = previousDay(validFrom);

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`unimed-config:${tenantId}`}, 0))::text AS "lock"`,
      );

      const userId =
        typeof actorIdentity === "string" ? actorIdentity : undefined;
      const actor = userId
        ? await tx.user.findFirst({
            where: { id: userId, tenantId, status: "ACTIVE" },
            select: {
              id: true,
              name: true,
              role: true,
              unimedAccess: {
                select: { tenantId: true, level: true, active: true },
              },
            },
          })
        : null;
      const moduleSession =
        typeof actorIdentity === "object"
          ? await tx.unimedModuleSession.findFirst({
              where: {
                id: actorIdentity.moduleSessionId,
                tenantId,
                level: "ADMIN",
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
              select: { id: true, level: true, operatorName: true },
            })
          : null;
      if (
        !moduleSession &&
        (!actor ||
          !canUseUnimed(
            {
              role: actor.role,
              accessLevel:
                actor.unimedAccess?.active &&
                actor.unimedAccess.tenantId === tenantId
                  ? actor.unimedAccess.level
                  : null,
            },
            "MANAGE_CONFIG",
          ))
      ) {
        throw new Error("Usuário sem permissão para configurar o módulo.");
      }

      const bracketIds = new Map<string, string>();
      for (const bracket of input.ageBrackets) {
        const saved = await tx.unimedAgeBracket.upsert({
          where: {
            tenantId_code: { tenantId, code: bracket.code },
          },
          create: {
            tenantId,
            ...bracket,
          },
          update: {
            label: bracket.label,
            minAge: bracket.minAge,
            maxAge: bracket.maxAge,
            sortOrder: bracket.sortOrder,
            active: true,
          },
          select: { id: true },
        });
        bracketIds.set(bracket.code, saved.id);
      }
      await tx.unimedAgeBracket.updateMany({
        where: {
          tenantId,
          code: { notIn: input.ageBrackets.map((bracket) => bracket.code) },
        },
        data: { active: false },
      });

      const [futurePlanPrices, futureAddonPrices, nextBilling, nextRules] =
        await Promise.all([
          tx.unimedPlanPriceVersion.findMany({
            where: { tenantId, validFrom: { gt: validFrom } },
            select: { ageBracketId: true, planCode: true, validFrom: true },
            orderBy: { validFrom: "asc" },
          }),
          tx.unimedAddonPriceVersion.findMany({
            where: { tenantId, validFrom: { gt: validFrom } },
            select: { code: true, validFrom: true },
            orderBy: { validFrom: "asc" },
          }),
          tx.unimedBillingSetting.findFirst({
            where: { tenantId, validFrom: { gt: validFrom } },
            select: { validFrom: true },
            orderBy: { validFrom: "asc" },
          }),
          tx.unimedCalculationRuleVersion.findFirst({
            where: { tenantId, validFrom: { gt: validFrom } },
            select: { validFrom: true },
            orderBy: { validFrom: "asc" },
          }),
        ]);
      const nextPlanValidFrom = new Map<string, Date>();
      for (const version of futurePlanPrices) {
        const key = versionKey(version.ageBracketId, version.planCode);
        if (!nextPlanValidFrom.has(key)) {
          nextPlanValidFrom.set(key, version.validFrom);
        }
      }
      const nextAddonValidFrom = new Map<string, Date>();
      for (const version of futureAddonPrices) {
        if (!nextAddonValidFrom.has(version.code)) {
          nextAddonValidFrom.set(version.code, version.validFrom);
        }
      }

      await tx.unimedPlanPriceVersion.updateMany({
        where: {
          tenantId,
          validFrom: { lt: validFrom },
          OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
        },
        data: { validTo },
      });
      for (const price of input.planPrices) {
        const ageBracketId = bracketIds.get(price.ageBracketCode);

        if (!ageBracketId) {
          throw new Error(
            `A faixa etária ${price.ageBracketCode} não foi persistida.`,
          );
        }

        const priceValidTo = validToBefore(
          nextPlanValidFrom.get(versionKey(ageBracketId, price.planCode)),
        );
        await tx.unimedPlanPriceVersion.upsert({
          where: {
            tenantId_ageBracketId_planCode_validFrom: {
              tenantId,
              ageBracketId,
              planCode: price.planCode,
              validFrom,
            },
          },
          create: {
            tenantId,
            ageBracketId,
            planCode: price.planCode,
            companyAmount: price.companyAmount,
            employeeAmount: price.employeeAmount,
            validFrom,
            validTo: priceValidTo,
          },
          update: {
            companyAmount: price.companyAmount,
            employeeAmount: price.employeeAmount,
            validTo: priceValidTo,
          },
        });
      }

      await tx.unimedAddonPriceVersion.updateMany({
        where: {
          tenantId,
          validFrom: { lt: validFrom },
          OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
        },
        data: { validTo },
      });
      for (const addon of input.addonPrices) {
        const addonValidTo = validToBefore(nextAddonValidFrom.get(addon.code));
        await tx.unimedAddonPriceVersion.upsert({
          where: {
            tenantId_code_validFrom: {
              tenantId,
              code: addon.code,
              validFrom,
            },
          },
          create: {
            tenantId,
            ...addon,
            validFrom,
            validTo: addonValidTo,
          },
          update: {
            label: addon.label,
            amount: addon.amount,
            validTo: addonValidTo,
          },
        });
      }

      await tx.unimedBillingSetting.updateMany({
        where: {
          tenantId,
          validFrom: { lt: validFrom },
          OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
        },
        data: { validTo },
      });
      await tx.unimedBillingSetting.upsert({
        where: { tenantId_validFrom: { tenantId, validFrom } },
        create: {
          tenantId,
          closure: input.billingClosure,
          closingDay: input.billingClosure === "AUTOMATIC_DAY_25" ? 25 : null,
          validFrom,
          validTo: validToBefore(nextBilling?.validFrom),
        },
        update: {
          closure: input.billingClosure,
          closingDay: input.billingClosure === "AUTOMATIC_DAY_25" ? 25 : null,
          validTo: validToBefore(nextBilling?.validFrom),
        },
      });

      await tx.unimedCalculationRuleVersion.updateMany({
        where: {
          tenantId,
          validFrom: { lt: validFrom },
          OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
        },
        data: { validTo },
      });
      await tx.unimedCalculationRuleVersion.upsert({
        where: { tenantId_validFrom: { tenantId, validFrom } },
        create: {
          tenantId,
          annualAdjustment: input.annualAdjustmentPercent / 100,
          difference: input.differencePercent / 100,
          validFrom,
          validTo: validToBefore(nextRules?.validFrom),
        },
        update: {
          annualAdjustment: input.annualAdjustmentPercent / 100,
          difference: input.differencePercent / 100,
          validTo: validToBefore(nextRules?.validFrom),
        },
      });

      await tx.unimedEmailSetting.upsert({
        where: { tenantId },
        create: {
          tenantId,
          recipients: input.email.recipients,
          subjectTemplate: input.email.subjectTemplate,
          enabled: input.email.enabled,
        },
        update: {
          recipients: input.email.recipients,
          subjectTemplate: input.email.subjectTemplate,
          enabled: input.email.enabled,
        },
      });

      if (input.reasons) {
        for (const reason of input.reasons) {
          await tx.unimedExclusionReason.upsert({
            where: { tenantId_code: { tenantId, code: reason.code } },
            create: { tenantId, ...reason, active: true },
            update: {
              label: reason.label,
              documentKind: reason.documentKind,
              active: true,
            },
          });
        }
        await tx.unimedExclusionReason.updateMany({
          where: {
            tenantId,
            code: { notIn: input.reasons.map((reason) => reason.code) },
          },
          data: { active: false },
        });
      }

      const removedConfigurationPeriods =
        await pruneOldConfigurationVersions(tx, tenantId, validFrom);

      await tx.auditLog.create({
        data: {
          userId: actor?.id ?? null,
          action: "UPDATE",
          entity: "UnimedConfiguration",
          entityId: tenantId,
          metadata: {
            accessChannel: moduleSession ? "UNIMED_MODULE_PASSWORD" : "USER",
            accessLevel: moduleSession?.level ?? null,
            moduleSessionId: moduleSession?.id ?? null,
            operatorName: moduleSession?.operatorName ?? actor?.name ?? null,
            validFrom: input.validFrom,
            billingClosure: input.billingClosure,
            ageBrackets: input.ageBrackets.length,
            planPrices: input.planPrices.length,
            addonPrices: input.addonPrices.length,
            reasons: input.reasons?.length ?? null,
            removedConfigurationPeriods: removedConfigurationPeriods.map(
              (date) => date.toISOString().slice(0, 10),
            ),
          },
        },
      });

      return {
        validFrom: input.validFrom,
        ageBrackets: input.ageBrackets.length,
        planPrices: input.planPrices.length,
        addonPrices: input.addonPrices.length,
        reasons: input.reasons?.length ?? null,
        removedConfigurationPeriods: removedConfigurationPeriods.map((date) =>
          date.toISOString().slice(0, 10),
        ),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}

function activeConfigurationAt(referenceDate: Date) {
  return {
    validFrom: { lte: referenceDate },
    OR: [{ validTo: null }, { validTo: { gte: referenceDate } }],
  };
}

export async function getUnimedCalculationConfiguration(
  tenantId: string,
  referenceDate = new Date(),
) {
  const activeAt = activeConfigurationAt(referenceDate);
  const [ageBrackets, planPrices, addonPrices, billing] = await Promise.all([
      prisma.unimedAgeBracket.findMany({
        where: { tenantId, active: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.unimedPlanPriceVersion.findMany({
        where: { tenantId, ...activeAt },
        include: { ageBracket: true },
        orderBy: [{ planCode: "asc" }, { ageBracket: { sortOrder: "asc" } }],
      }),
      prisma.unimedAddonPriceVersion.findMany({
        where: { tenantId, ...activeAt },
        orderBy: { code: "asc" },
      }),
      prisma.unimedBillingSetting.findFirst({
        where: { tenantId, ...activeAt },
        orderBy: { validFrom: "desc" },
      }),
    ]);

  return { ageBrackets, planPrices, addonPrices, billing };
}

export async function getUnimedConfiguration(
  tenantId: string,
  referenceDate = new Date(),
) {
  const activeAt = activeConfigurationAt(referenceDate);
  const [calculation, rules, email, reasons] = await Promise.all([
      getUnimedCalculationConfiguration(tenantId, referenceDate),
      prisma.unimedCalculationRuleVersion.findFirst({
        where: { tenantId, ...activeAt },
        orderBy: { validFrom: "desc" },
      }),
      prisma.unimedEmailSetting.findUnique({ where: { tenantId } }),
      prisma.unimedExclusionReason.findMany({
        where: { tenantId, active: true },
        orderBy: { code: "asc" },
      }),
    ]);

  return {
    ...calculation,
    rules,
    email,
    reasons,
  };
}

export async function getUnimedPriceHistory(tenantId: string) {
  const periods = await prisma.unimedPlanPriceVersion.findMany({
    where: { tenantId },
    select: { validFrom: true },
    distinct: ["validFrom"],
    orderBy: { validFrom: "desc" },
    take: CONFIGURATION_VERSION_LIMIT,
  });
  const validFromDates = periods.map(({ validFrom }) => validFrom);

  if (validFromDates.length === 0) return [];

  const [planPrices, addonPrices] = await Promise.all([
    prisma.unimedPlanPriceVersion.findMany({
      where: { tenantId, validFrom: { in: validFromDates } },
      include: { ageBracket: true },
      orderBy: [
        { validFrom: "desc" },
        { planCode: "asc" },
        { ageBracket: { sortOrder: "asc" } },
      ],
    }),
    prisma.unimedAddonPriceVersion.findMany({
      where: { tenantId, validFrom: { in: validFromDates } },
      orderBy: [{ validFrom: "desc" }, { code: "asc" }],
    }),
  ]);

  return periods.map((period, index) => {
    const periodPlanPrices = planPrices.filter(
      (price) => price.validFrom.getTime() === period.validFrom.getTime(),
    );
    const periodAddonPrices = addonPrices.filter(
      (price) => price.validFrom.getTime() === period.validFrom.getTime(),
    );

    return {
      status: index === 0 ? ("ACTIVE" as const) : ("PREVIOUS" as const),
      validFrom: period.validFrom,
      validTo:
        periodPlanPrices[0]?.validTo ?? periodAddonPrices[0]?.validTo ?? null,
      planPrices: periodPlanPrices,
      addonPrices: periodAddonPrices,
    };
  });
}
