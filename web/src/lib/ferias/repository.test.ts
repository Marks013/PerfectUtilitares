import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFeriasSnapshot } from "./repository";

const mocks = vi.hoisted(() => {
  const tx = {
    unimedCompetency: { findUnique: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation((operation) => operation(mocks.tx));
  mocks.tx.unimedCompetency.findUnique.mockResolvedValue({ id: "c-september", status: "DRAFT" });
  mocks.tx.unimedImportSnapshot.findMany.mockResolvedValue([]);
  mocks.tx.unimedImportBatch.findMany.mockResolvedValue([{ id: "batch-loans", sourceResults: [{ source: "PAYROLL_LOANS" }] }]);
  mocks.tx.unimedBeneficiary.findMany.mockResolvedValue([]);
  mocks.tx.unimedInvoiceItem.findMany.mockResolvedValue([]);
  mocks.tx.unimedPayrollLoan.findMany.mockResolvedValue([]);
  mocks.tx.unimedPlanPriceVersion.findMany.mockResolvedValue([]);
});

describe("Férias: leitura consistente e isolada", () => {
  it("uses exact requested competency for every source and independently published loans", async () => {
    const result = await readFeriasSnapshot("tenant-a", "2026-09");
    expect(result.sources.map((source) => source.ready)).toEqual([false, false, true]);
    expect(mocks.tx.unimedCompetency.findUnique).toHaveBeenCalledWith({
      where: { tenantId_year_month: { tenantId: "tenant-a", year: 2026, month: 9 } },
      select: { id: true, status: true },
    });
    expect(mocks.tx.unimedBeneficiary.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a", competencyId: "c-september" });
    expect(mocks.tx.unimedPayrollLoan.findMany.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a", competencyId: "c-september" });
    expect(mocks.tx.unimedInvoiceItem.findMany.mock.calls[0][0].where).toEqual({ competencyId: "c-september", competency: { tenantId: "tenant-a" } });
    expect(mocks.tx.unimedPlanPriceVersion.findMany.mock.calls[0][0].where.validFrom.lte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(mocks.transaction.mock.calls[0][1].isolationLevel).toBe("RepeatableRead");
  });
  it("recognizes explicitly published empty source instead of requiring records", async () => {
    mocks.tx.unimedImportSnapshot.findMany.mockResolvedValue([{ source: "BENEFICIARIES", rowCount: 0 }, { source: "INVOICES", rowCount: 0 }]);
    mocks.tx.unimedImportBatch.findMany.mockResolvedValue([{ sourceResults: [{ source: "BENEFICIARIES" }, { source: "INVOICES" }, { source: "PAYROLL_LOANS" }] }]);
    expect((await readFeriasSnapshot("tenant-a", "2026-09")).sources.every((source) => source.ready)).toBe(true);
  });
  it("does not search another month when the requested one is missing", async () => {
    mocks.tx.unimedCompetency.findUnique.mockResolvedValue(null);
    mocks.tx.unimedImportBatch.findMany.mockResolvedValue([]);
    const result = await readFeriasSnapshot("tenant-a", "2026-01");
    expect(result.sources.every((source) => !source.ready)).toBe(true);
    expect(mocks.tx.unimedCompetency.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.tx.unimedPayrollLoan.findMany.mock.calls[0][0].where.competencyId).toBe("");
  });
  it("binds revision to tenant, source data and price revisions", async () => {
    const first = await readFeriasSnapshot("tenant-a", "2026-09");
    expect((await readFeriasSnapshot("tenant-b", "2026-09")).revision).not.toBe(first.revision);
    mocks.tx.unimedImportSnapshot.findMany.mockResolvedValue([{ source: "INVOICES", checksum: "new" }]);
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
