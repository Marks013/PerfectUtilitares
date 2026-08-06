import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canUseUnimed } from "@/lib/unimed/access";
import type {
  ParsedPayrollLoan,
  ParsedPayrollLoanSource,
} from "@/lib/unimed/importer";
import { UnimedPublishError } from "@/lib/unimed/publisher";

export type PublishPayrollLoanInput = {
  tenantId: string;
  userId?: string;
  moduleSessionId?: string;
  year: number;
  month: number;
  loans: ParsedPayrollLoanSource;
};

export type PublishPayrollLoanResult = {
  idempotent: boolean;
  competencyId: string;
  batchId: string;
  summary: {
    payrollLoans: number;
    totalInstallmentAmount: number;
    matchedByCpf: number;
    matchedByRegistration: number;
    unmatched: number;
    warnings: number;
    sourceSheet: string;
  };
};

function dateOnly(value: string | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

type PayrollLoanBeneficiary = {
  id: string;
  cpf: string | null;
  registration: string | null;
};

export function matchPayrollLoanRows(
  loans: ParsedPayrollLoan[],
  beneficiaries: PayrollLoanBeneficiary[],
) {
  const unique = <T>(items: T[], key: (item: T) => string | null) => {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const value = key(item);
      if (!value) continue;
      grouped.set(value, [...(grouped.get(value) ?? []), item]);
    }
    return new Map(
      [...grouped.entries()]
        .filter(([, matches]) => matches.length === 1)
        .map(([value, matches]) => [value, matches[0]]),
    );
  };
  const byCpf = unique(beneficiaries, (row) => row.cpf);
  const byRegistration = unique(beneficiaries, (row) => row.registration);
  let matchedByCpf = 0;
  let matchedByRegistration = 0;
  const rows = loans.map((loan) => {
    const beneficiary = loan.cpfNormalized
      ? byCpf.get(loan.cpfNormalized)
      : loan.registration
        ? byRegistration.get(loan.registration)
        : undefined;
    const matchMethod = beneficiary
      ? loan.cpfNormalized
        ? "CPF"
        : "REGISTRATION"
      : null;
    if (matchMethod === "CPF") matchedByCpf += 1;
    if (matchMethod === "REGISTRATION") matchedByRegistration += 1;
    return {
      loan,
      beneficiary,
      matchMethod,
      cpfNormalized: loan.cpfNormalized ?? beneficiary?.cpf ?? null,
    };
  });
  return {
    rows,
    matchedByCpf,
    matchedByRegistration,
    unmatched: rows.length - matchedByCpf - matchedByRegistration,
  };
}

export async function publishPayrollLoanImport(
  input: PublishPayrollLoanInput,
): Promise<PublishPayrollLoanResult> {
  if (input.loans.rejectedCount > 0) {
    throw new UnimedPublishError(
      "IMPORT_REJECTED",
      "O consignado contém linhas rejeitadas e não pode ser publicado.",
    );
  }
  const idempotencyKey = createHash("sha256")
    .update(input.tenantId)
    .update("\0")
    .update(String(input.year))
    .update("\0")
    .update(String(input.month))
    .update("\0PAYROLL_LOANS\0")
    .update(input.loans.checksum)
    .digest("hex");

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
          "O usuário não pode publicar consignados desta empresa.",
        );
      }

      const existingBatch = await tx.unimedImportBatch.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId: input.tenantId,
            idempotencyKey,
          },
        },
        select: {
          id: true,
          competencyId: true,
          status: true,
          validationSummary: true,
        },
      });
      if (existingBatch?.status === "PUBLISHED") {
        return {
          idempotent: true,
          competencyId: existingBatch.competencyId,
          batchId: existingBatch.id,
          summary:
            existingBatch.validationSummary as unknown as PublishPayrollLoanResult["summary"],
        };
      }
      if (existingBatch) {
        throw new UnimedPublishError(
          "IMPORT_IN_PROGRESS",
          "Este consignado já está em processamento.",
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
      const beneficiaries = await tx.unimedBeneficiary.findMany({
        where: {
          tenantId: input.tenantId,
          competencyId: competency.id,
          category: "HOLDER",
        },
        select: { id: true, cpf: true, registration: true },
      });
      const matched = matchPayrollLoanRows(input.loans.rows, beneficiaries);
      const total = input.loans.rows.reduce(
        (sum, loan) => sum.plus(loan.installmentAmount),
        new Prisma.Decimal(0),
      );
      const summary: PublishPayrollLoanResult["summary"] = {
        payrollLoans: input.loans.rows.length,
        totalInstallmentAmount: total
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber(),
        matchedByCpf: matched.matchedByCpf,
        matchedByRegistration: matched.matchedByRegistration,
        unmatched: matched.unmatched,
        warnings:
          matched.unmatched +
          input.loans.diagnostics.filter(
            (diagnostic) => diagnostic.severity === "WARNING",
          ).length,
        sourceSheet: input.loans.sourceSheet,
      };
      const batch = await tx.unimedImportBatch.create({
        data: {
          tenantId: input.tenantId,
          competencyId: competency.id,
          requestedById: actor?.id ?? null,
          idempotencyKey,
          status: "VALIDATING",
          sourceCount: 1,
          rowCount: input.loans.rows.length,
          rejectedCount: 0,
          warningCount: summary.warnings,
          validationSummary: summary,
        },
        select: { id: true },
      });

      await tx.unimedPayrollLoan.deleteMany({
        where: { tenantId: input.tenantId, competencyId: competency.id },
      });
      if (matched.rows.length > 0) {
        await tx.unimedPayrollLoan.createMany({
          data: matched.rows.map(
            ({ loan, beneficiary, matchMethod, cpfNormalized }) => ({
              tenantId: input.tenantId,
              competencyId: competency.id,
              importBatchId: batch.id,
              beneficiaryId: beneficiary?.id ?? null,
              sourceKey: loan.sourceKey,
              sourceRow: loan.sourceRow,
              competence: loan.competence,
              cpfNormalized,
              registration: loan.registration,
              employeeName: loan.employeeName,
              contractNumber: loan.contractNumber,
              installmentAmount: loan.installmentAmount,
              startCompetence: loan.startCompetence,
              endCompetence: loan.endCompetence,
              bankCode: loan.bankCode,
              bankName: loan.bankName,
              totalInstallments: loan.totalInstallments,
              loanAmount: loan.loanAmount,
              releasedAmount: loan.releasedAmount,
              contractStartDate: dateOnly(loan.contractStartDate),
              contractEndDate: dateOnly(loan.contractEndDate),
              companyCnpj: loan.companyCnpj,
              matchMethod,
            }),
          ),
        });
      }
      await tx.unimedImportSourceResult.create({
        data: {
          batchId: batch.id,
          source: "PAYROLL_LOANS",
          fileCount: 1,
          rowCount: input.loans.rows.length,
          rejectedCount: 0,
          warningCount: summary.warnings,
          checksum: input.loans.checksum,
          summary: {
            ...summary,
            skipped: input.loans.skippedCount,
          },
        },
      });
      await tx.unimedImportBatch.update({
        where: { id: batch.id },
        data: {
          status: "PUBLISHED",
          publishedById: actor?.id ?? null,
          publishedAt: new Date(),
          finishedAt: new Date(),
          validationSummary: summary,
        },
      });
      await tx.unimedImportBatch.deleteMany({
        where: {
          competencyId: competency.id,
          id: { not: batch.id },
          sourceResults: { some: { source: "PAYROLL_LOANS" } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor?.id ?? null,
          action: "PUBLISH",
          entity: "UnimedPayrollLoan",
          entityId: competency.id,
          metadata: {
            year: input.year,
            month: input.month,
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
