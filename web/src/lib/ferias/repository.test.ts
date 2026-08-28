import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFeriasSnapshot } from "./repository";

const mocks = vi.hoisted(() => {
  const tx = {
    unimedBranch: { findMany: vi.fn() },
    unimedCompetency: { findMany: vi.fn() },
    unimedImportSnapshot: { findMany: vi.fn() },
    unimedImportBatch: { findMany: vi.fn() },
    unimedBeneficiary: { findMany: vi.fn() },
    unimedInvoiceItem: { findMany: vi.fn() },
    unimedPayrollLoan: { findMany: vi.fn() },
    unimedPlanPriceVersion: { findMany: vi.fn() },
  };
  return { tx, transaction: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

const september = { id: "c-september", year: 2026, month: 9, status: "DRAFT" };
const august = { id: "c-august", year: 2026, month: 8, status: "DRAFT" };
const publication = (competencyId: string, ...sources: string[]) => ({
  id: `batch-${competencyId}-${sources.join("-")}`, competencyId,
  sourceResults: sources.map((source) => ({ source })),
});
const snapshot = (competencyId: string, source: string) => ({ competencyId, source, rowCount: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((operation) => operation(mocks.tx));
  mocks.tx.unimedBranch.findMany.mockResolvedValue([]);
  mocks.tx.unimedCompetency.findMany.mockResolvedValue([september]);
  mocks.tx.unimedImportSnapshot.findMany.mockResolvedValue([]);
  mocks.tx.unimedImportBatch.findMany.mockResolvedValue([publication(september.id, "PAYROLL_LOANS")]);
  mocks.tx.unimedBeneficiary.findMany.mockResolvedValue([]);
  mocks.tx.unimedInvoiceItem.findMany.mockResolvedValue([]);
  mocks.tx.unimedPayrollLoan.findMany.mockResolvedValue([]);
  mocks.tx.unimedPlanPriceVersion.findMany.mockResolvedValue([]);
});

describe("Férias: leitura consistente e isolada", () => {
  it("scopes branch identity evidence to the tenant and fingerprints changes", async () => {
    mocks.tx.unimedBranch.findMany.mockResolvedValue([{ code: "MATRIZ", cnpj: "76361807000898" }]);
    const first = await readFeriasSnapshot("tenant-a", "2026-09");
    expect(first.branches).toEqual([{ code: "MATRIZ", cnpj: "76361807000898" }]);
    expect(mocks.tx.unimedBranch.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a" });
    mocks.tx.unimedBranch.findMany.mockResolvedValue([{ code: "MATRIZ", cnpj: "76361807000111" }]);
    expect((await readFeriasSnapshot("tenant-a", "2026-09")).revision).not.toBe(first.revision);
  });
  it("uses the previous month only for Unimed and keeps loans on the requested month", async () => {
    const result = await readFeriasSnapshot("tenant-a", "2026-09");
    expect(result.sources).toEqual([
      { name: "Cadastro Unimed", ready: false, competency: "2026-08", fallback: true },
      { name: "Fatura e coparticipação", ready: false, competency: "2026-08", fallback: true },
      { name: "Consignado Digital", ready: true, competency: "2026-09", fallback: false },
    ]);
    expect(mocks.tx.unimedCompetency.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", OR: [{ year: 2026, month: 9 }, { year: 2026, month: 8 }] },
      select: { id: true, year: true, month: true, status: true },
    });
    expect(mocks.tx.unimedBeneficiary.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a", competencyId: "" });
    expect(mocks.tx.unimedInvoiceItem.findMany.mock.calls[0][0].where).toEqual({ competencyId: "", competency: { tenantId: "tenant-a" } });
    expect(mocks.tx.unimedPayrollLoan.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a", competencyId: "c-september" });
    expect(mocks.tx.unimedPlanPriceVersion.findMany.mock.calls[0][0].where.validFrom.lte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(mocks.transaction.mock.calls[0][1].isolationLevel).toBe("RepeatableRead");
  });

  it("uses the requested month when both Unimed sources are complete", async () => {
    mocks.tx.unimedImportSnapshot.findMany.mockResolvedValue([
      snapshot(september.id, "BENEFICIARIES"), snapshot(september.id, "INVOICES"),
    ]);
    mocks.tx.unimedImportBatch.findMany.mockResolvedValue([
      publication(september.id, "BENEFICIARIES", "INVOICES", "PAYROLL_LOANS"),
    ]);
    const result = await readFeriasSnapshot("tenant-a", "2026-09");
    expect(result.sources.every((source) => source.ready)).toBe(true);
    expect(result.sources.every((source) => !source.fallback)).toBe(true);
    expect(mocks.tx.unimedBeneficiary.findMany.mock.calls[0][0].where.competencyId).toBe(september.id);
  });

  it("uses a complete previous Unimed base atomically without moving loans", async () => {
    mocks.tx.unimedCompetency.findMany.mockResolvedValue([september, august]);
    mocks.tx.unimedImportSnapshot.findMany.mockResolvedValue([
      snapshot(august.id, "BENEFICIARIES"), snapshot(august.id, "INVOICES"),
    ]);
    mocks.tx.unimedImportBatch.findMany.mockResolvedValue([
      publication(august.id, "BENEFICIARIES", "INVOICES"),
      publication(september.id, "PAYROLL_LOANS"),
    ]);
    const result = await readFeriasSnapshot("tenant-a", "2026-09");
    expect(result.sources.slice(0, 2).every((source) => source.ready && source.fallback && source.competency === "2026-08")).toBe(true);
    expect(result.sources[2]).toEqual({ name: "Consignado Digital", ready: true, competency: "2026-09", fallback: false });
    expect(mocks.tx.unimedBeneficiary.findMany.mock.calls[0][0].where.competencyId).toBe(august.id);
    expect(mocks.tx.unimedPayrollLoan.findMany.mock.calls[0][0].where.competencyId).toBe(september.id);
  });

  it("never uses previous-month loans, including across a year boundary", async () => {
    const december = { id: "c-december", year: 2025, month: 12, status: "DRAFT" };
    mocks.tx.unimedCompetency.findMany.mockResolvedValue([december]);
    mocks.tx.unimedImportSnapshot.findMany.mockResolvedValue([
      snapshot(december.id, "BENEFICIARIES"), snapshot(december.id, "INVOICES"),
    ]);
    mocks.tx.unimedImportBatch.findMany.mockResolvedValue([
      publication(december.id, "BENEFICIARIES", "INVOICES", "PAYROLL_LOANS"),
    ]);
    const result = await readFeriasSnapshot("tenant-a", "2026-01");
    expect(result.sources.slice(0, 2).every((source) => source.ready && source.competency === "2025-12")).toBe(true);
    expect(result.sources[2]).toEqual({ name: "Consignado Digital", ready: false, competency: "2026-01", fallback: false });
    expect(mocks.tx.unimedPayrollLoan.findMany.mock.calls[0][0].where.competencyId).toBe("");
  });

  it("binds revision to tenant, source selection and price revisions", async () => {
    const first = await readFeriasSnapshot("tenant-a", "2026-09");
    expect((await readFeriasSnapshot("tenant-b", "2026-09")).revision).not.toBe(first.revision);
    mocks.tx.unimedCompetency.findMany.mockResolvedValue([september, august]);
    expect((await readFeriasSnapshot("tenant-a", "2026-09")).revision).not.toBe(first.revision);
  });

  it("rejects invalid references before querying", async () => {
    await expect(readFeriasSnapshot("tenant-a", "2026-13")).rejects.toThrow();
    await expect(readFeriasSnapshot("", "2026-09")).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when source size exceeds bound", async () => {
    mocks.tx.unimedBeneficiary.findMany.mockResolvedValue(new Array(20_001).fill({}));
    await expect(readFeriasSnapshot("tenant-a", "2026-09")).rejects.toThrow(/limite/);
  });
});
