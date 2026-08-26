import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { FeriasSnapshot } from "./contracts";
import { FeriasError } from "./errors";

const MAX_SOURCE_ROWS = 20_000;

export async function readFeriasSnapshot(tenantId: string, competency: string): Promise<FeriasSnapshot> {
  if (!tenantId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competency)) {
    throw new FeriasError("FERIAS_REFERENCE_INVALID", "A competência informada é inválida.");
  }
  const [year, month] = competency.split("-").map(Number);
  const referenceDate = new Date(`${competency}-01T00:00:00Z`);
  return prisma.$transaction(async (tx) => {
    const competence = await tx.unimedCompetency.findUnique({
      where: { tenantId_year_month: { tenantId, year, month } },
      select: { id: true, status: true },
    });
    const scope = { tenantId, competencyId: competence?.id ?? "" };
    const snapshots = await tx.unimedImportSnapshot.findMany({
      where: { ...scope, source: { in: ["BENEFICIARIES", "INVOICES"] } },
      select: { source: true, checksum: true, rowCount: true, updatedAt: true },
      orderBy: { source: "asc" },
    });
    const publications = await tx.unimedImportBatch.findMany({
      where: { ...scope, status: "PUBLISHED", sourceResults: { some: {
        source: { in: ["BENEFICIARIES", "INVOICES", "PAYROLL_LOANS"] },
      } } },
      select: {
        id: true, publishedAt: true, updatedAt: true,
        sourceResults: { where: { source: { in: ["BENEFICIARIES", "INVOICES", "PAYROLL_LOANS"] } },
          select: { source: true, checksum: true, rowCount: true }, orderBy: { source: "asc" } },
      },
      orderBy: { id: "asc" },
    });
    const published = new Set(publications.flatMap((batch) => batch.sourceResults.map((source) => source.source)));
    const sourceReady = (source: "BENEFICIARIES" | "INVOICES" | "PAYROLL_LOANS") =>
      competence?.status !== "REJECTED" && published.has(source) &&
      (source === "PAYROLL_LOANS" || snapshots.some((snapshot) => snapshot.source === source));
    const beneficiaries = await tx.unimedBeneficiary.findMany({
      where: scope, take: MAX_SOURCE_ROWS + 1, orderBy: { id: "asc" },
      select: { id: true, holderId: true, registration: true, fullName: true, cpf: true,
        branchId: true, branch: { select: { code: true, name: true } },
        category: true, birthDate: true, planCode: true },
    });
    const invoices = await tx.unimedInvoiceItem.findMany({
      where: { competencyId: scope.competencyId, competency: { tenantId } },
      take: MAX_SOURCE_ROWS + 1, orderBy: { id: "asc" },
      select: { id: true, beneficiaryId: true, branchId: true, beneficiaryName: true,
        holderName: true, category: true, itemDescription: true, amount: true },
    });
    const loans = await tx.unimedPayrollLoan.findMany({
      where: scope, take: MAX_SOURCE_ROWS + 1, orderBy: { id: "asc" },
      select: { id: true, beneficiaryId: true, registration: true, employeeName: true,
        cpfNormalized: true, contractNumber: true, installmentAmount: true,
        competence: true, startCompetence: true, endCompetence: true, bankCode: true, companyCnpj: true },
    });
    const prices = await tx.unimedPlanPriceVersion.findMany({
      where: { tenantId, validFrom: { lte: referenceDate },
        OR: [{ validTo: null }, { validTo: { gte: referenceDate } }] },
      take: MAX_SOURCE_ROWS + 1, orderBy: { id: "asc" },
      select: { id: true, planCode: true, employeeAmount: true, companyAmount: true,
        validFrom: true, validTo: true, updatedAt: true,
        ageBracket: { select: { code: true, minAge: true, maxAge: true } } },
    });
    if ([beneficiaries, invoices, loans, prices].some((rows) => rows.length > MAX_SOURCE_ROWS)) {
      throw new FeriasError("FERIAS_SOURCE_LIMIT", "A base excede o limite desta conferência. Solicite a revisão do limite ao administrador.", 413);
    }
    const revision = createHash("sha256").update(JSON.stringify({
      tenantId, competency, competence, snapshots, publications, beneficiaries, invoices, loans, prices,
    })).digest("hex");
    return {
      revision,
      sources: [
        { name: "Cadastro Unimed", ready: sourceReady("BENEFICIARIES") },
        { name: "Fatura e coparticipação", ready: sourceReady("INVOICES") },
        { name: "Consignado Digital", ready: sourceReady("PAYROLL_LOANS") },
      ],
      beneficiaries: beneficiaries.map(({ branch, ...row }) => ({ ...row,
        branchLabel: branch ? `${branch.code} - ${branch.name}` : undefined,
        birthDate: row.birthDate?.toISOString().slice(0, 10) ?? null })),
      invoices: invoices.map((row) => ({ ...row, amount: row.amount.toFixed(2) })),
      loans: loans.map((row) => ({ ...row, installmentAmount: row.installmentAmount.toFixed(2) })),
      prices: prices.map((row) => ({ ...row, employeeAmount: row.employeeAmount.toFixed(2),
        companyAmount: row.companyAmount.toFixed(2), validFrom: row.validFrom.toISOString().slice(0, 10),
        validTo: row.validTo?.toISOString().slice(0, 10) ?? null })),
    };
  }, { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 20_000 });
}
