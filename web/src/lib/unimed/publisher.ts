import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type {
  ParsedAddress,
  ParsedBeneficiary,
  ParsedInvoiceItem,
} from "@/lib/unimed/importer";
import { prisma } from "@/lib/prisma";
import { canUseUnimed } from "@/lib/unimed/access";
import {
  CORE_IMPORT_SOURCES,
  pruneImportBatches,
  relinkPayrollLoans,
} from "@/lib/unimed/publisher-maintenance";
import {
  reconcileUnimedSources,
  type PreviousUnimedDependentLink,
} from "@/lib/unimed/reconcile";
import {
  UnimedPublishError,
  dateOnly,
  hasAddressValue,
  incompleteSummary,
  providedSources,
  readSnapshot,
  requireMapValue,
  snapshotPayload,
  sourceSummary,
  sourceWarningCount,
  type PublishUnimedInput,
  type PublishUnimedResult,
} from "@/lib/unimed/publisher-support";

export { UnimedPublishError } from "@/lib/unimed/publisher-support";
export type {
  PublishUnimedInput,
  PublishUnimedResult,
} from "@/lib/unimed/publisher-support";

export async function publishUnimedImport(
  input: PublishUnimedInput,
): Promise<PublishUnimedResult> {
  const provided = providedSources(input);
  if (provided.length === 0) {
    throw new UnimedPublishError(
      "IMPORT_REJECTED",
      "Envie ao menos uma fonte para importação.",
    );
  }
  if (provided.some(({ data }) => data.rejectedCount > 0)) {
    throw new UnimedPublishError(
      "IMPORT_REJECTED",
      "A importação contém linhas rejeitadas e não pode ser publicada.",
    );
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`unimed:${input.tenantId}`}, 0))::text AS "lock"`,
      );

      const actor = input.userId
        ? await tx.user.findFirst({
            where: {
              id: input.userId,
              tenantId: input.tenantId,
              status: "ACTIVE",
            },
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
      const moduleSession = input.moduleSessionId
        ? await tx.unimedModuleSession.findFirst({
            where: {
              id: input.moduleSessionId,
              tenantId: input.tenantId,
              revokedAt: null,
              expiresAt: { gt: new Date() },
              level: { in: ["MANAGER", "ADMIN"] },
            },
            select: { id: true, level: true, operatorName: true },
          })
        : null;
      const validUserActor =
        actor &&
        canUseUnimed(
          {
            role: actor.role,
            accessLevel:
              actor.unimedAccess?.active &&
              actor.unimedAccess.tenantId === input.tenantId
                ? actor.unimedAccess.level
                : null,
          },
          "PUBLISH",
        );
      if (!validUserActor && !moduleSession) {
        throw new UnimedPublishError(
          "INVALID_ACTOR",
          "O usuário não pode publicar importações desta empresa.",
        );
      }

      const competency = await tx.unimedCompetency.upsert({
        where: {
          tenantId_year_month: {
            tenantId: input.tenantId,
            year: input.year,
            month: input.month,
          },
        },
        create: {
          tenantId: input.tenantId,
          year: input.year,
          month: input.month,
          status: "DRAFT",
        },
        update: {},
        select: { id: true },
      });
      const [currentSnapshots, latestCoreBatch] = await Promise.all([
        tx.unimedImportSnapshot.findMany({
          where: {
            competencyId: competency.id,
            source: { in: [...CORE_IMPORT_SOURCES] },
          },
          select: { source: true, checksum: true },
        }),
        tx.unimedImportBatch.findFirst({
          where: {
            competencyId: competency.id,
            status: "PUBLISHED",
            sourceResults: {
              some: { source: { in: [...CORE_IMPORT_SOURCES] } },
            },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            validationSummary: true,
          },
        }),
      ]);
      const currentChecksums = new Map(
        currentSnapshots.map(({ source, checksum }) => [source, checksum]),
      );
      const currentMissingSources = CORE_IMPORT_SOURCES.filter(
        (source) => !currentChecksums.has(source),
      );
      const matchesCurrentState = provided.every(
        ({ source, data }) => currentChecksums.get(source) === data.checksum,
      );
      if (matchesCurrentState && latestCoreBatch) {
        const stored = latestCoreBatch.validationSummary as unknown as
          PublishUnimedResult["summary"] | null;
        return {
          idempotent: true,
          ready: currentMissingSources.length === 0,
          missingSources: [...currentMissingSources],
          competencyId: competency.id,
          batchId: latestCoreBatch.id,
          summary: stored ?? incompleteSummary(),
        };
      }

      const idempotencyKey = createHash("sha256")
        .update(input.tenantId)
        .update("\0")
        .update(String(input.year))
        .update("\0")
        .update(String(input.month))
        .update("\0")
        .update(latestCoreBatch?.id ?? "initial")
        .update("\0")
        .update(
          provided
            .map(({ source, data }) => `${source}:${data.checksum}`)
            .sort()
            .join("\0"),
        )
        .digest("hex");

      const batch = await tx.unimedImportBatch.create({
        data: {
          tenantId: input.tenantId,
          competencyId: competency.id,
          requestedById: actor?.id ?? null,
          idempotencyKey,
          status: "VALIDATING",
          sourceCount: provided.length,
          rowCount: provided.reduce(
            (total, { data }) => total + data.rows.length,
            0,
          ),
          rejectedCount: 0,
          warningCount: provided.reduce(
            (total, { data }) => total + sourceWarningCount(data),
            0,
          ),
        },
        select: { id: true },
      });

      for (const { source, data } of provided) {
        await tx.unimedImportSnapshot.upsert({
          where: {
            competencyId_source: { competencyId: competency.id, source },
          },
          create: {
            tenantId: input.tenantId,
            competencyId: competency.id,
            source,
            checksum: data.checksum,
            rowCount: data.rows.length,
            payload: snapshotPayload(data),
          },
          update: {
            checksum: data.checksum,
            rowCount: data.rows.length,
            payload: snapshotPayload(data),
          },
        });
      }
      await tx.unimedImportSourceResult.createMany({
        data: provided.map(({ source, data }) => ({
          batchId: batch.id,
          source,
          fileCount: data.fileCount,
          rowCount: data.rows.length,
          rejectedCount: 0,
          warningCount: sourceWarningCount(data),
          checksum: data.checksum,
          summary: sourceSummary(data),
        })),
      });

      const snapshots = await tx.unimedImportSnapshot.findMany({
        where: {
          competencyId: competency.id,
          source: { in: [...CORE_IMPORT_SOURCES] },
        },
        select: { source: true, payload: true },
      });
      const snapshotsBySource = new Map(
        snapshots.map((snapshot) => [snapshot.source, snapshot.payload]),
      );
      const missingSources = CORE_IMPORT_SOURCES.filter(
        (source) => !snapshotsBySource.has(source),
      );
      if (missingSources.length > 0) {
        const summary = incompleteSummary();
        const storedSummary = {
          ...summary,
          ready: false,
          missingSources,
        };
        await tx.unimedImportBatch.update({
          where: { id: batch.id },
          data: {
            status: "PUBLISHED",
            publishedById: actor?.id ?? null,
            publishedAt: new Date(),
            finishedAt: new Date(),
            validationSummary: storedSummary,
          },
        });
        await pruneImportBatches(tx, competency.id);
        await tx.auditLog.create({
          data: {
            userId: actor?.id ?? null,
            action: "PUBLISH",
            entity: "UnimedImportSnapshot",
            entityId: competency.id,
            metadata: {
              year: input.year,
              month: input.month,
              ready: false,
              missingSources,
              sources: provided.map(({ source }) => source),
              accessChannel: moduleSession ? "UNIMED_MODULE_PASSWORD" : "USER",
              accessLevel: moduleSession?.level ?? null,
              moduleSessionId: moduleSession?.id ?? null,
              operatorName: moduleSession?.operatorName ?? actor?.name ?? null,
            },
          },
        });
        return {
          idempotent: false,
          ready: false,
          missingSources,
          competencyId: competency.id,
          batchId: batch.id,
          summary,
        };
      }

      const beneficiaries = readSnapshot<ParsedBeneficiary>(
        requireMapValue(snapshotsBySource, "BENEFICIARIES"),
      );
      const invoiceItems = readSnapshot<ParsedInvoiceItem>(
        requireMapValue(snapshotsBySource, "INVOICES"),
      );
      const addressesSource = readSnapshot<ParsedAddress>(
        requireMapValue(snapshotsBySource, "ADDRESSES"),
      );
      const previousCompetency = await tx.unimedCompetency.findFirst({
        where: {
          tenantId: input.tenantId,
          id: { not: competency.id },
          status: { in: ["ACTIVE", "PREVIOUS"] },
          OR: [
            { year: { lt: input.year } },
            { year: input.year, month: { lt: input.month } },
          ],
        },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        select: { id: true },
      });
      const previousDependents = previousCompetency
        ? await tx.unimedBeneficiary.findMany({
            where: {
              competencyId: previousCompetency.id,
              category: "DEPENDENT",
              holderId: { not: null },
            },
            select: {
              registration: true,
              cpf: true,
              fullName: true,
              branch: { select: { code: true } },
              holder: {
                select: {
                  registration: true,
                  cpf: true,
                  fullName: true,
                  branch: { select: { code: true } },
                },
              },
            },
          })
        : [];
      const previousLinks: PreviousUnimedDependentLink[] =
        previousDependents.flatMap((dependent) => {
          const holder = dependent.holder;

          if (!holder) {
            return [];
          }

          return [
            {
              dependent: {
                branchCode: dependent.branch?.code ?? "",
                registration: dependent.registration,
                cpf: dependent.cpf,
                fullName: dependent.fullName,
              },
              holder: {
                branchCode: holder.branch?.code ?? "",
                registration: holder.registration,
                cpf: holder.cpf,
                fullName: holder.fullName,
              },
            },
          ];
        });
      const reconciliation = reconcileUnimedSources(
        beneficiaries.rows,
        invoiceItems.rows,
        addressesSource.rows,
        previousLinks,
      );
      const skippedRows =
        beneficiaries.skippedCount +
        invoiceItems.skippedCount +
        addressesSource.skippedCount;
      const warningCount =
        sourceWarningCount(beneficiaries) +
        sourceWarningCount(invoiceItems) +
        sourceWarningCount(addressesSource) +
        Object.values(reconciliation.warnings).reduce(
          (total, count) => total + count,
          0,
        );
      const summary: PublishUnimedResult["summary"] = {
        beneficiaries: reconciliation.beneficiaries.length,
        invoiceItems: reconciliation.invoiceItems.length,
        addresses: reconciliation.beneficiaries.filter((beneficiary) =>
          hasAddressValue(beneficiary.address),
        ).length,
        branches: reconciliation.branches.length,
        skippedRows,
        warnings: reconciliation.warnings,
        warningDetails: reconciliation.warningDetails,
        information: reconciliation.information,
      };

      const branchIds = new Map<string, string>();
      const incomingCodes = reconciliation.branches.map(({ code }) => code);
      const incomingCnpjs = reconciliation.branches
        .map(({ cnpj }) => cnpj)
        .filter((cnpj): cnpj is string => Boolean(cnpj));
      const existingBranches = await tx.unimedBranch.findMany({
        where: {
          tenantId: input.tenantId,
          OR: [
            { code: { in: incomingCodes } },
            { cnpj: { in: incomingCnpjs } },
          ],
        },
        select: { id: true, code: true, cnpj: true },
      });
      const existingByCode = new Map(
        existingBranches.map((branch) => [branch.code, branch]),
      );
      const existingByCnpj = new Map(
        existingBranches
          .filter((branch) => branch.cnpj)
          .map((branch) => [branch.cnpj as string, branch]),
      );
      for (const branch of reconciliation.branches) {
        const codeMatch = existingByCode.get(branch.code);
        const cnpjMatch = branch.cnpj
          ? existingByCnpj.get(branch.cnpj)
          : undefined;
        if (codeMatch && cnpjMatch && codeMatch.id !== cnpjMatch.id) {
          throw new UnimedPublishError(
            "IMPORT_REJECTED",
            `A filial ${branch.code} conflita com um CNPJ já vinculado a outra filial.`,
          );
        }
        const existing = codeMatch ?? cnpjMatch;
        const saved = existing
          ? await tx.unimedBranch.update({
            where: { id: existing.id },
            data: {
              cnpj: branch.cnpj,
              active: true,
            },
            select: { id: true },
          })
          : await tx.unimedBranch.create({
              data: {
                tenantId: input.tenantId,
                code: branch.code,
                name: branch.code,
                cnpj: branch.cnpj,
              },
              select: { id: true },
            });
        branchIds.set(branch.code, saved.id);
      }
      await tx.unimedBranch.updateMany({
        where: {
          tenantId: input.tenantId,
          code: { notIn: reconciliation.branches.map((branch) => branch.code) },
          active: true,
        },
        data: { active: false },
      });
      await tx.unimedInvoiceItem.deleteMany({
        where: { competencyId: competency.id },
      });
      await tx.unimedBeneficiary.deleteMany({
        where: { competencyId: competency.id },
      });

      for (const beneficiary of reconciliation.beneficiaries) {
        if (!branchIds.has(beneficiary.branchCode)) {
          throw new UnimedPublishError(
            "MISSING_BRANCH",
            `A filial ${beneficiary.branchCode} não possui CNPJ válido.`,
          );
        }
      }
      await tx.unimedBeneficiary.createMany({
        data: reconciliation.beneficiaries.map((beneficiary) => ({
          tenantId: input.tenantId,
          competencyId: competency.id,
          branchId: requireMapValue(branchIds, beneficiary.branchCode),
          sourceKey: beneficiary.sourceKey,
          registration: beneficiary.registration,
          fullName: beneficiary.fullName,
          cpf: beneficiary.cpf,
          rg: beneficiary.rg ?? null,
          birthDate: dateOnly(beneficiary.birthDate),
          inclusionDate: dateOnly(beneficiary.inclusionDate),
          category: beneficiary.category,
          relationship: beneficiary.relationship,
          planName: beneficiary.planName,
          planCode: beneficiary.planCode,
          accommodation: beneficiary.accommodation,
          companyCnpj: beneficiary.companyCnpj,
          hasAddon: beneficiary.hasAddon,
        })),
      });
      const savedBeneficiaries = await tx.unimedBeneficiary.findMany({
        where: { competencyId: competency.id },
        select: { id: true, sourceKey: true },
      });
      const beneficiaryIds = new Map(
        savedBeneficiaries.map((beneficiary) => [
          beneficiary.sourceKey,
          beneficiary.id,
        ]),
      );
      const addresses = reconciliation.beneficiaries
        .filter((beneficiary) => hasAddressValue(beneficiary.address))
        .map((beneficiary) => ({
          beneficiaryId: requireMapValue(
            beneficiaryIds,
            beneficiary.sourceKey,
          ),
          ...beneficiary.address,
        }));
      if (addresses.length > 0) {
        await tx.unimedAddress.createMany({ data: addresses });
      }
      for (const beneficiary of reconciliation.beneficiaries) {
        if (!beneficiary.holderSourceKey) continue;
        const beneficiaryId = beneficiaryIds.get(beneficiary.sourceKey);
        const holderId = beneficiaryIds.get(beneficiary.holderSourceKey);
        if (!beneficiaryId || !holderId) continue;
        await tx.unimedBeneficiary.update({
          where: { id: beneficiaryId },
          data: { holderId },
        });
      }
      if (reconciliation.invoiceItems.length > 0) {
        await tx.unimedInvoiceItem.createMany({
          data: reconciliation.invoiceItems.map((item) => ({
            competencyId: competency.id,
            branchId: branchIds.get(item.branchCode) ?? null,
            beneficiaryId: item.beneficiarySourceKey
              ? (beneficiaryIds.get(item.beneficiarySourceKey) ?? null)
              : null,
            sourceKey: item.sourceKey,
            beneficiaryName: item.beneficiaryName,
            holderName: item.holderName,
            category: item.category,
            itemCode: item.itemCode,
            itemDescription: item.itemDescription,
            amount: item.amount,
            planCode: item.planCode,
          })),
        });
      }
      await relinkPayrollLoans(tx, competency.id);

      await tx.unimedCompetency.updateMany({
        where: {
          tenantId: input.tenantId,
          status: "ACTIVE",
          id: { not: competency.id },
        },
        data: { status: "PREVIOUS" },
      });
      await tx.unimedCompetency.update({
        where: { id: competency.id },
        data: { status: "ACTIVE", activatedAt: new Date() },
      });
      const previous = await tx.unimedCompetency.findMany({
        where: { tenantId: input.tenantId, status: "PREVIOUS" },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        select: { id: true },
      });
      const expiredCompetencyIds = previous.slice(1).map(({ id }) => id);
      if (expiredCompetencyIds.length > 0) {
        await tx.unimedCompetency.deleteMany({
          where: { id: { in: expiredCompetencyIds } },
        });
      }

      const storedSummary = { ...summary, ready: true, missingSources: [] };
      await tx.unimedImportBatch.update({
        where: { id: batch.id },
        data: {
          status: "PUBLISHED",
          publishedById: actor?.id ?? null,
          publishedAt: new Date(),
          finishedAt: new Date(),
          warningCount,
          validationSummary: storedSummary,
        },
      });
      await pruneImportBatches(tx, competency.id);
      await tx.auditLog.create({
        data: {
          userId: actor?.id ?? null,
          action: "PUBLISH",
          entity: "UnimedCompetency",
          entityId: competency.id,
          metadata: {
            year: input.year,
            month: input.month,
            sources: provided.map(({ source }) => source),
            accessChannel: moduleSession ? "UNIMED_MODULE_PASSWORD" : "USER",
            accessLevel: moduleSession?.level ?? null,
            moduleSessionId: moduleSession?.id ?? null,
            operatorName: moduleSession?.operatorName ?? actor?.name ?? null,
            ...summary,
          },
        },
      });
      return {
        idempotent: false,
        ready: true,
        missingSources: [],
        competencyId: competency.id,
        batchId: batch.id,
        summary,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 60_000,
    },
  );
}
