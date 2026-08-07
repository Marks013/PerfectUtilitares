import type { Prisma } from "@/generated/prisma/client";

export const CORE_IMPORT_SOURCES = [
  "BENEFICIARIES",
  "INVOICES",
  "ADDRESSES",
] as const;

export type CoreImportSource = (typeof CORE_IMPORT_SOURCES)[number];

function uniqueBy<T>(
  items: T[],
  key: (item: T) => string | null,
) {
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
}

export async function relinkPayrollLoans(
  tx: Prisma.TransactionClient,
  competencyId: string,
) {
  const [beneficiaries, loans] = await Promise.all([
    tx.unimedBeneficiary.findMany({
      where: { competencyId, category: "HOLDER" },
      select: { id: true, cpf: true, registration: true },
    }),
    tx.unimedPayrollLoan.findMany({
      where: { competencyId },
      select: {
        id: true,
        cpfNormalized: true,
        registration: true,
      },
    }),
  ]);


  const byCpf = uniqueBy(beneficiaries, (row) => row.cpf);
  const byRegistration = uniqueBy(
    beneficiaries,
    (row) => row.registration,
  );

  for (const loan of loans) {
    const match = loan.cpfNormalized
      ? byCpf.get(loan.cpfNormalized)
      : loan.registration
        ? byRegistration.get(loan.registration)
        : undefined;

    await tx.unimedPayrollLoan.update({
      where: { id: loan.id },
      data: {
        beneficiaryId: match?.id ?? null,
        matchMethod: match
          ? loan.cpfNormalized
            ? "CPF"
            : "REGISTRATION"
          : null,
        cpfNormalized: loan.cpfNormalized ?? match?.cpf ?? null,
      },
    });
  }
}

export async function pruneImportBatches(
  tx: Prisma.TransactionClient,
  competencyId: string,
) {
  const oldBatches = await tx.unimedImportBatch.findMany({
    where: {
      competencyId,
      sourceResults: {
        some: { source: { in: [...CORE_IMPORT_SOURCES] } },
      },
    },
    orderBy: { createdAt: "desc" },
    skip: 12,
    select: { id: true },
  });

  if (oldBatches.length > 0) {
    await tx.unimedImportBatch.deleteMany({
      where: {
        id: {
          in: oldBatches.map(({ id }) => id),
        },
      },
    });
  }
}
