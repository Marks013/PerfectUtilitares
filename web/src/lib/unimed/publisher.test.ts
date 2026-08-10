import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ParsedAddress,
  ParsedBeneficiary,
  ParsedInvoiceItem,
  ParsedUnimedSource,
} from "@/lib/unimed/importer";
import type { PublishUnimedInput } from "@/lib/unimed/publisher";

const mocks = vi.hoisted(() => ({
  canUse: vi.fn(),
  reconcile: vi.fn(),
  transaction: vi.fn(),
}));

const database = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    auditLog: {
      create: vi.fn(),
    },
    unimedAddress: {
      createMany: vi.fn(),
    },
    unimedBeneficiary: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    unimedBranch: {
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    unimedCompetency: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    unimedImportBatch: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    unimedImportSnapshot: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    unimedImportSourceResult: {
      createMany: vi.fn(),
    },
    unimedInvoiceItem: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    unimedModuleSession: {
      findFirst: vi.fn(),
    },
    unimedPayrollLoan: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/unimed/access", () => ({
  canUseUnimed: mocks.canUse,
}));

vi.mock("@/lib/unimed/reconcile", () => ({
  reconcileUnimedSources: mocks.reconcile,
}));

import {
  planUnimedCompetencyRetention,
  publishUnimedImport,
} from "@/lib/unimed/publisher";

function source<T>(
  checksum: string,
  rows: T[],
  overrides: Record<string, unknown> = {},
): ParsedUnimedSource<T> {
  return {
    checksum,
    diagnostics: [],
    fileCount: 1,
    rejectedCount: 0,
    rows,
    skippedCount: 0,
    ...overrides,
  } as unknown as ParsedUnimedSource<T>;
}

function sessionInput(
  overrides: Partial<PublishUnimedInput> = {},
): PublishUnimedInput {
  return {
    tenantId: "tenant-1",
    moduleSessionId: "session-1",
    year: 2026,
    month: 8,
    beneficiaries: source<ParsedBeneficiary>(
      "beneficiaries-checksum",
      [{} as unknown as ParsedBeneficiary],
    ),
    ...overrides,
  };
}

function summary() {
  return {
    beneficiaries: 0,
    invoiceItems: 0,
    addresses: 0,
    branches: 0,
    skippedRows: 0,
    warnings: {
      unmatchedInvoiceItems: 0,
      unmatchedDependents: 0,
      ambiguousPlanCodes: 0,
    },
    information: {
      addressOnlyRows: 0,
      dependentsLinkedByRegistration: 0,
      dependentsLinkedFromPreviousCompetency: 0,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  mocks.transaction.mockImplementation(
    async (
      callback: (client: typeof database.tx) => Promise<unknown>,
    ) => callback(database.tx),
  );
  mocks.canUse.mockReturnValue(true);

  database.tx.$queryRaw.mockResolvedValue([]);
  database.tx.auditLog.create.mockResolvedValue({});
  database.tx.unimedAddress.createMany.mockResolvedValue({ count: 0 });

  database.tx.unimedBeneficiary.createMany.mockResolvedValue({ count: 0 });
  database.tx.unimedBeneficiary.deleteMany.mockResolvedValue({ count: 0 });
  database.tx.unimedBeneficiary.findMany.mockResolvedValue([]);
  database.tx.unimedBeneficiary.update.mockResolvedValue({});

  database.tx.unimedBranch.updateMany.mockResolvedValue({ count: 0 });
  database.tx.unimedBranch.upsert.mockResolvedValue({ id: "branch-1" });

  database.tx.unimedCompetency.deleteMany.mockResolvedValue({ count: 0 });
  database.tx.unimedCompetency.findFirst.mockResolvedValue(null);
  database.tx.unimedCompetency.findMany.mockResolvedValue([]);
  database.tx.unimedCompetency.update.mockResolvedValue({});
  database.tx.unimedCompetency.updateMany.mockResolvedValue({ count: 0 });
  database.tx.unimedCompetency.upsert.mockResolvedValue({
    id: "competency-1",
  });

  database.tx.unimedImportBatch.create.mockResolvedValue({ id: "batch-1" });
  database.tx.unimedImportBatch.deleteMany.mockResolvedValue({ count: 0 });
  database.tx.unimedImportBatch.findFirst.mockResolvedValue(null);
  database.tx.unimedImportBatch.findMany.mockResolvedValue([]);
  database.tx.unimedImportBatch.update.mockResolvedValue({});

  database.tx.unimedImportSnapshot.findMany.mockResolvedValue([]);
  database.tx.unimedImportSnapshot.upsert.mockResolvedValue({});
  database.tx.unimedImportSourceResult.createMany.mockResolvedValue({
    count: 0,
  });

  database.tx.unimedInvoiceItem.createMany.mockResolvedValue({ count: 0 });
  database.tx.unimedInvoiceItem.deleteMany.mockResolvedValue({ count: 0 });

  database.tx.unimedModuleSession.findFirst.mockResolvedValue({
    id: "session-1",
    level: "MANAGER",
    operatorName: "OPERADOR",
  });

  database.tx.unimedPayrollLoan.findMany.mockResolvedValue([]);
  database.tx.unimedPayrollLoan.update.mockResolvedValue({});
  database.tx.user.findFirst.mockResolvedValue(null);
});

describe("Unimed publisher", () => {
  it("keeps the newest competency active when an older competency is reimported", () => {
    const retention = planUnimedCompetencyRetention(
      [
        { id: "july", year: 2026, month: 7, status: "PREVIOUS" },
        { id: "august", year: 2026, month: 8, status: "ACTIVE" },
      ],
      "july",
    );

    expect(retention).toEqual({
      active: { id: "august", year: 2026, month: 8, status: "ACTIVE" },
      previous: { id: "july", year: 2026, month: 7, status: "PREVIOUS" },
      expiredIds: [],
      importedCompetencyRetained: true,
    });
  });

  it("rejects a competency older than the two retained bases", () => {
    const retention = planUnimedCompetencyRetention(
      [
        { id: "june", year: 2026, month: 6, status: "DRAFT" },
        { id: "july", year: 2026, month: 7, status: "PREVIOUS" },
        { id: "august", year: 2026, month: 8, status: "ACTIVE" },
      ],
      "june",
    );

    expect(retention.expiredIds).toEqual(["june"]);
    expect(retention.importedCompetencyRetained).toBe(false);
  });

  it("rejects an import without any source before opening a transaction", async () => {
    await expect(
      publishUnimedImport({
        tenantId: "tenant-1",
        moduleSessionId: "session-1",
        year: 2026,
        month: 8,
      }),
    ).rejects.toMatchObject({
      code: "IMPORT_REJECTED",
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a source containing rejected rows", async () => {
    await expect(
      publishUnimedImport(
        sessionInput({
          beneficiaries: source<ParsedBeneficiary>(
            "rejected-checksum",
            [],
            { rejectedCount: 1 },
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "IMPORT_REJECTED",
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an authenticated actor without publish permission", async () => {
    database.tx.user.findFirst.mockResolvedValueOnce({
      id: "user-1",
      name: "USUARIO",
      role: "USER",
      unimedAccess: {
        tenantId: "tenant-1",
        level: "VIEWER",
        active: true,
      },
    });
    mocks.canUse.mockReturnValueOnce(false);

    const input = sessionInput({
      moduleSessionId: undefined,
      userId: "user-1",
    });

    await expect(publishUnimedImport(input)).rejects.toMatchObject({
      code: "INVALID_ACTOR",
    });

    expect(mocks.canUse).toHaveBeenCalled();
    expect(database.tx.unimedCompetency.upsert).not.toHaveBeenCalled();
  });

  it("returns the latest published batch when the provided source is unchanged", async () => {
    const storedSummary = summary();

    database.tx.unimedImportSnapshot.findMany.mockResolvedValueOnce([
      { source: "BENEFICIARIES", checksum: "beneficiaries-checksum" },
      { source: "INVOICES", checksum: "invoices-checksum" },
      { source: "ADDRESSES", checksum: "addresses-checksum" },
    ]);
    database.tx.unimedImportBatch.findFirst.mockResolvedValueOnce({
      id: "published-batch",
      validationSummary: storedSummary,
    });

    const result = await publishUnimedImport(sessionInput());

    expect(result).toEqual({
      idempotent: true,
      ready: true,
      missingSources: [],
      competencyId: "competency-1",
      batchId: "published-batch",
      summary: storedSummary,
    });
    expect(database.tx.unimedImportBatch.create).not.toHaveBeenCalled();
    expect(database.tx.unimedImportSnapshot.upsert).not.toHaveBeenCalled();
  });

  it("retries a serializable write conflict and then returns idempotently", async () => {
    const conflict = Object.assign(new Error("write conflict"), {
      code: "P2034",
    });
    mocks.transaction.mockRejectedValueOnce(conflict);
    database.tx.unimedImportSnapshot.findMany.mockResolvedValueOnce([
      { source: "BENEFICIARIES", checksum: "beneficiaries-checksum" },
      { source: "INVOICES", checksum: "invoices-checksum" },
      { source: "ADDRESSES", checksum: "addresses-checksum" },
    ]);
    database.tx.unimedImportBatch.findFirst.mockResolvedValueOnce({
      id: "published-batch",
      validationSummary: summary(),
    });

    const result = await publishUnimedImport(sessionInput());

    expect(result.idempotent).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(database.tx.unimedImportBatch.create).not.toHaveBeenCalled();
  });

  it("publishes snapshots without activating the competency while sources are missing", async () => {
    const beneficiarySource = source<ParsedBeneficiary>(
      "beneficiaries-checksum",
      [{} as unknown as ParsedBeneficiary],
    );

    database.tx.unimedImportSnapshot.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          source: "BENEFICIARIES",
          payload: beneficiarySource,
        },
      ]);

    const result = await publishUnimedImport(
      sessionInput({ beneficiaries: beneficiarySource }),
    );

    expect(result).toMatchObject({
      idempotent: false,
      ready: false,
      missingSources: ["INVOICES", "ADDRESSES"],
      competencyId: "competency-1",
      batchId: "batch-1",
    });

    expect(database.tx.unimedImportSnapshot.upsert).toHaveBeenCalledOnce();
    expect(database.tx.unimedImportSourceResult.createMany).toHaveBeenCalledOnce();

    expect(database.tx.unimedImportBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: expect.objectContaining({
        status: "PUBLISHED",
        validationSummary: expect.objectContaining({
          ready: false,
          missingSources: ["INVOICES", "ADDRESSES"],
        }),
      }),
    });

    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(database.tx.unimedCompetency.update).not.toHaveBeenCalled();

    expect(database.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PUBLISH",
        entity: "UnimedImportSnapshot",
        entityId: "competency-1",
      }),
    });
  });

  it("reconciles all sources and activates a complete competency", async () => {
    const beneficiarySource = source<ParsedBeneficiary>(
      "beneficiaries-checksum",
      [{} as unknown as ParsedBeneficiary],
    );
    const invoiceSource = source<ParsedInvoiceItem>(
      "invoices-checksum",
      [{} as unknown as ParsedInvoiceItem],
    );
    const addressSource = source<ParsedAddress>(
      "addresses-checksum",
      [{} as unknown as ParsedAddress],
    );

    database.tx.unimedImportSnapshot.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { source: "BENEFICIARIES", payload: beneficiarySource },
        { source: "INVOICES", payload: invoiceSource },
        { source: "ADDRESSES", payload: addressSource },
      ]);

    mocks.reconcile.mockReturnValueOnce({
      branches: [
        {
          code: "001",
          cnpj: "76361807000111",
        },
      ],
      beneficiaries: [
        {
          sourceKey: "beneficiary-source",
          branchCode: "001",
          registration: "1001",
          fullName: "JOAO DA SILVA",
          cpf: "52998224725",
          rg: null,
          birthDate: "1990-01-01",
          inclusionDate: "2026-08-01",
          category: "HOLDER",
          relationship: "TITULAR",
          planName: "PLANO",
          planCode: "P1",
          accommodation: "ENFERMARIA",
          companyCnpj: "76361807000111",
          hasAddon: false,
          holderSourceKey: null,
          address: {},
        },
      ],
      invoiceItems: [
        {
          sourceKey: "invoice-source",
          branchCode: "001",
          beneficiarySourceKey: "beneficiary-source",
          beneficiaryName: "JOAO DA SILVA",
          holderName: "JOAO DA SILVA",
          category: "HOLDER",
          itemCode: "001",
          itemDescription: "CONSULTA",
          amount: 100,
          planCode: "P1",
        },
      ],
      warnings: {
        unmatchedInvoiceItems: 0,
        unmatchedDependents: 0,
        ambiguousPlanCodes: 0,
      },
      warningDetails: [],
      information: {
        addressOnlyRows: 0,
        dependentsLinkedByRegistration: 0,
        dependentsLinkedFromPreviousCompetency: 0,
      },
    });

    database.tx.unimedBeneficiary.findMany
      .mockResolvedValueOnce([
        {
          id: "beneficiary-db-1",
          sourceKey: "beneficiary-source",
        },
      ])
      .mockResolvedValueOnce([]);
    database.tx.unimedCompetency.findMany.mockResolvedValueOnce([
      {
        id: "competency-1",
        year: 2026,
        month: 8,
        status: "DRAFT",
      },
      {
        id: "competency-previous",
        year: 2026,
        month: 7,
        status: "ACTIVE",
      },
      {
        id: "competency-expired",
        year: 2026,
        month: 6,
        status: "PREVIOUS",
      },
    ]);

    const result = await publishUnimedImport({
      tenantId: "tenant-1",
      moduleSessionId: "session-1",
      year: 2026,
      month: 8,
      beneficiaries: beneficiarySource,
      invoiceItems: invoiceSource,
      addresses: addressSource,
    });

    expect(result).toMatchObject({
      idempotent: false,
      ready: true,
      missingSources: [],
      competencyId: "competency-1",
      batchId: "batch-1",
      summary: {
        beneficiaries: 1,
        invoiceItems: 1,
        branches: 1,
      },
    });

    expect(database.tx.unimedBranch.upsert).toHaveBeenCalledOnce();
    expect(database.tx.unimedBeneficiary.createMany).toHaveBeenCalledOnce();
    expect(database.tx.unimedInvoiceItem.createMany).toHaveBeenCalledOnce();

    expect(database.tx.unimedCompetency.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        status: "ACTIVE",
        id: { not: "competency-1" },
      },
      data: { status: "PREVIOUS" },
    });

    expect(database.tx.unimedCompetency.update).toHaveBeenCalledWith({
      where: { id: "competency-1" },
      data: expect.objectContaining({
        status: "ACTIVE",
      }),
    });

    expect(database.tx.unimedCompetency.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["competency-expired"] } },
    });

    expect(database.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: "UnimedCompetency",
        entityId: "competency-1",
      }),
    });
  });

  it("aborts a complete publication when a beneficiary has no persisted branch", async () => {
    const beneficiarySource = source<ParsedBeneficiary>(
      "beneficiaries-checksum",
      [{} as unknown as ParsedBeneficiary],
    );
    const invoiceSource = source<ParsedInvoiceItem>(
      "invoices-checksum",
      [{} as unknown as ParsedInvoiceItem],
    );
    const addressSource = source<ParsedAddress>(
      "addresses-checksum",
      [{} as unknown as ParsedAddress],
    );

    database.tx.unimedImportSnapshot.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { source: "BENEFICIARIES", payload: beneficiarySource },
        { source: "INVOICES", payload: invoiceSource },
        { source: "ADDRESSES", payload: addressSource },
      ]);

    mocks.reconcile.mockReturnValueOnce({
      branches: [],
      beneficiaries: [
        {
          sourceKey: "beneficiary-source",
          branchCode: "404",
          address: {},
        },
      ],
      invoiceItems: [],
      warnings: {
        unmatchedInvoiceItems: 0,
        unmatchedDependents: 0,
        ambiguousPlanCodes: 0,
      },
      warningDetails: [],
      information: {
        addressOnlyRows: 0,
        dependentsLinkedByRegistration: 0,
        dependentsLinkedFromPreviousCompetency: 0,
      },
    });

    await expect(
      publishUnimedImport({
        tenantId: "tenant-1",
        moduleSessionId: "session-1",
        year: 2026,
        month: 8,
        beneficiaries: beneficiarySource,
        invoiceItems: invoiceSource,
        addresses: addressSource,
      }),
    ).rejects.toMatchObject({
      code: "MISSING_BRANCH",
    });

    expect(database.tx.unimedBeneficiary.createMany).not.toHaveBeenCalled();
    expect(database.tx.unimedCompetency.update).not.toHaveBeenCalled();
  });
});
