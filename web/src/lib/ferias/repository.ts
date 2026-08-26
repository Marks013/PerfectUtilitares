import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { FeriasSnapshot } from "./contracts";
import { FeriasError } from "./errors";

const MAX_SOURCE_ROWS = 20_000;

function previousCompetency(year: number, month: number) {
  const date = new Date(Date.UTC(year, month - 2, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1,
    value: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` };
}

export async function readFeriasSnapshot(tenantId: string, competency: string): Promise<FeriasSnapshot> {
  if (!tenantId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competency)) {
    throw new FeriasError("FERIAS_REFERENCE_INVALID", "A competência informada é inválida.");
  }
  const [year, month] = competency.split("-").map(Number);
  const previous = previousCompetency(year, month);
  const referenceDate = new Date(`${competency}-01T00:00:00Z`);
  return prisma.$transaction(async (tx) => {
    const competencies = await tx.unimedCompetency.findMany({
      where: { tenantId, OR: [{ year, month }, { year: previous.year, month: previous.month }] },
      select: { id: true, year: true, month: true, status: true },
    });
    const byPeriod = new Map(competencies.map((item) => [
      `${item.year}-${String(item.month).padStart(2, "0")}`, item,
    ]));
    const currentCompetence = byPeriod.get(competency);
    const previousCompetence = byPeriod.get(previous.value);
    const competencyIds = competencies.map((item) => item.id);
    const snapshots = await tx.unimedImportSnapshot.findMany({
      where: { tenantId, competencyId: { in: competencyIds }, source: { in: ["BENEFICIARIES", "INVOICES"] } },
      select: { competencyId: true, source: true, checksum: true, rowCount: true, updatedAt: true },
      orderBy: { source: "asc" },
    });
    const publications = await tx.unimedImportBatch.findMany({
      where: { tenantId, competencyId: { in: competencyIds }, status: "PUBLISHED", sourceResults: { some: {
        source: { in: ["BENEFICIARIES", "INVOICES", "PAYROLL_LOANS"] },
      } } },
      select: {
        id: true, competencyId: true, publishedAt: true, updatedAt: true,
        sourceResults: { where: { source: { in: ["BENEFICIARIES", "INVOICES", "PAYROLL_LOANS"] } },
          select: { source: true, checksum: true, rowCount: true }, orderBy: { source: "asc" } },
      },
      orderBy: { id: "asc" },
    });
    const sourceReady = (competence: typeof currentCompetence, source: "BENEFICIARIES" | "INVOICES" | "PAYROLL_LOANS") => {
      if (!competence || competence.status === "REJECTED") return false;
      const published = publications.some((batch) => batch.competencyId === competence.id &&
        batch.sourceResults.some((result) => result.source === source));
      return published && (source === "PAYROLL_LOANS" ||
        snapshots.some((snapshot) => snapshot.competencyId === competence.id && snapshot.source === source));
    };
    const currentUnimedReady = sourceReady(currentCompetence, "BENEFICIARIES") && sourceReady(currentCompetence, "INVOICES");
    const unimedCompetence = currentUnimedReady ? currentCompetence : previousCompetence;
    const unimedCompetency = currentUnimedReady ? competency : previous.value;
    const unimedFallback = !currentUnimedReady;
    const unimedScope = { tenantId, competencyId: unimedCompetence?.id ?? "" };
    const loanScope = { tenantId, competencyId: currentCompetence?.id ?? "" };
    const beneficiaries = await tx.unimedBeneficiary.findMany({
      where: unimedScope, take: MAX_SOURCE_ROWS + 1, orderBy: { id: "asc" },
      select: { id: true, holderId: true, registration: true, fullName: true, cpf: true,
        branchId: true, branch: { select: { code: true, name: true } },
        category: true, birthDate: true, planCode: true },
    });
    const invoices = await tx.unimedInvoiceItem.findMany({
      where: { competencyId: unimedScope.competencyId, competency: { tenantId } },
      take: MAX_SOURCE_ROWS + 1, orderBy: { id: "asc" },
      select: { id: true, beneficiaryId: true, branchId: true, beneficiaryName: true,
        holderName: true, category: true, itemDescription: true, amount: true },
    });
    const loans = await tx.unimedPayrollLoan.findMany({
      where: loanScope, take: MAX_SOURCE_ROWS + 1, orderBy: { id: "asc" },
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
      tenantId, competency, previous: previous.value, competencies, snapshots, publications,
      unimedCompetency, beneficiaries, invoices, loans, prices,
    })).digest("hex");
    return {
      revision,
      sources: [
        { name: "Cadastro Unimed", ready: sourceReady(unimedCompetence, "BENEFICIARIES"),
          competency: unimedCompetency, fallback: unimedFallback },
        { name: "Fatura e coparticipação", ready: sourceReady(unimedCompetence, "INVOICES"),
          competency: unimedCompetency, fallback: unimedFallback },
        { name: "Consignado Digital", ready: sourceReady(currentCompetence, "PAYROLL_LOANS"),
          competency, fallback: false },
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
