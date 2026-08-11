import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  competencies: vi.fn(),
  branches: vi.fn(),
  configuration: vi.fn(),
  priceHistory: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedCompetency: { findMany: mocks.competencies },
    unimedBranch: { findMany: mocks.branches },
  },
}));

vi.mock("@/lib/unimed/configuration", () => ({
  getUnimedConfiguration: mocks.configuration,
  getUnimedPriceHistory: mocks.priceHistory,
}));

import { createUnimedExcelSnapshot } from "@/lib/unimed/excel-snapshot";

function decimal(value: number) {
  return {
    toFixed: (digits: number) => value.toFixed(digits),
    toNumber: () => value,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.branches.mockResolvedValue([
    {
      code: "001",
      name: "Matriz",
      companyName: "Empresa",
      cnpj: "76361807000111",
      addressLine: "Rua A",
      number: "10",
      district: "Centro",
      postalCode: "87500000",
      city: "Umuarama",
      state: "PR",
      stateRegistration: "123",
      phone: "4430000000",
      active: true,
    },
  ]);
  mocks.competencies.mockResolvedValue([
    {
      year: 2026,
      month: 8,
      status: "ACTIVE",
      beneficiaries: [
        {
          sourceKey: "beneficiary-1",
          holder: null,
          branch: { code: "001" },
          registration: "1001",
          fullName: "JOAO DA SILVA",
          cpf: "52998224725",
          rg: "1234567",
          birthDate: new Date("1990-01-02T00:00:00.000Z"),
          inclusionDate: new Date("2020-03-04T00:00:00.000Z"),
          category: "HOLDER",
          relationship: "TITULAR",
          planCode: "P1",
          planName: "PLANO 1",
          accommodation: "ENFERMARIA",
          companyCnpj: "76361807000111",
          hasAddon: true,
          address: {
            addressLine: "Rua A",
            number: "10",
            complement: null,
            district: "Centro",
            postalCode: "87500000",
            city: "Umuarama",
            state: "PR",
            pis: "12345678901",
          },
        },
      ],
      invoiceItems: [
        {
          sourceKey: "invoice-1",
          beneficiary: { sourceKey: "beneficiary-1" },
          branch: { code: "001" },
          beneficiaryName: "JOAO DA SILVA",
          holderName: "JOAO DA SILVA",
          category: "HOLDER",
          itemCode: "CONSULTA",
          itemDescription: "Consulta",
          amount: decimal(25.5),
          planCode: "P1",
          planName: "PLANO 1",
        },
      ],
      payrollLoans: [
        {
          sourceKey: "loan-1",
          beneficiary: { sourceKey: "beneficiary-1" },
          sourceRow: 2,
          competence: "2026-08",
          cpfNormalized: "52998224725",
          registration: "1001",
          employeeName: "JOAO DA SILVA",
          contractNumber: "C1",
          installmentAmount: decimal(100),
          startCompetence: "2026-01",
          endCompetence: "2026-12",
          bankCode: "001",
          bankName: "Banco",
          totalInstallments: 12,
          loanAmount: decimal(1200),
          releasedAmount: null,
          contractStartDate: new Date("2026-01-01T00:00:00.000Z"),
          contractEndDate: null,
          companyCnpj: "76361807000111",
          matchMethod: "CPF",
        },
      ],
    },
  ]);
  mocks.priceHistory.mockResolvedValue([
    {
      status: "ACTIVE",
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: new Date("2027-07-31T00:00:00.000Z"),
      planPrices: [
        {
          planCode: "P1",
          companyAmount: decimal(116.02),
          employeeAmount: decimal(61.26),
          ageBracket: {
            code: "34-38",
            label: "34 a 38 anos",
            minAge: 34,
            maxAge: 38,
            sortOrder: 5,
          },
        },
      ],
      addonPrices: [
        { code: "FUNERAL", label: "Funeral", amount: decimal(6.12) },
      ],
    },
  ]);
  mocks.configuration.mockResolvedValue({
    ageBrackets: [
      { code: "34-38", label: "34 a 38 anos", minAge: 34, maxAge: 38, sortOrder: 5 },
    ],
    billing: {
      closure: "AUTOMATIC_DAY_25",
      closingDay: 25,
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: null,
    },
    rules: {
      annualAdjustment: decimal(0.13),
      difference: decimal(0.01),
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: null,
    },
    reasons: [{ code: 1, label: "Exclusao", documentKind: "RN561" }],
  });
});

describe("Unimed Excel snapshot", () => {
  it("serializes tenant data deterministically without persistence metadata", async () => {
    const first = await createUnimedExcelSnapshot("tenant-1");
    const second = await createUnimedExcelSnapshot("tenant-1");

    expect(first.snapshotVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(second.snapshotVersion).toBe(first.snapshotVersion);
    expect(first).toMatchObject({
      schemaVersion: 1,
      branches: [{ code: "001", active: true }],
      competencies: [
        {
          year: 2026,
          month: 8,
          status: "ACTIVE",
          beneficiaries: [
            {
              sourceKey: "beneficiary-1",
              birthDate: "1990-01-02",
              address: { city: "Umuarama" },
            },
          ],
          invoiceItems: [{ amount: "25.50" }],
          payrollLoans: [
            {
              installmentAmount: "100.00",
              loanAmount: "1200.00",
              releasedAmount: null,
            },
          ],
        },
      ],
      configuration: {
        billing: { closure: "AUTOMATIC_DAY_25" },
        rules: { annualAdjustmentPercent: 13, differencePercent: 1 },
        priceHistory: [
          {
            planPrices: [{ companyAmount: "116.02", employeeAmount: "61.26" }],
            addonPrices: [{ amount: "6.12" }],
          },
        ],
      },
    });
    expect(JSON.stringify(first)).not.toContain("tenant-1");
    expect(mocks.competencies).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-1", status: { not: "DRAFT" } }, take: 2 }),
    );
  });
});
