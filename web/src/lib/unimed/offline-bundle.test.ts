import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addonPrices: vi.fn(),
  ageBrackets: vi.fn(),
  beneficiaries: vi.fn(),
  billing: vi.fn(),
  competencies: vi.fn(),
  planPrices: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedAddonPriceVersion: { findMany: mocks.addonPrices },
    unimedAgeBracket: { findMany: mocks.ageBrackets },
    unimedBeneficiary: { findMany: mocks.beneficiaries },
    unimedBillingSetting: { findMany: mocks.billing },
    unimedCompetency: { findMany: mocks.competencies },
    unimedPlanPriceVersion: { findMany: mocks.planPrices },
  },
}));

import { buildUnimedOfflineBundle } from "@/lib/unimed/offline-bundle";

const updatedAt = new Date("2026-08-08T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.competencies.mockResolvedValue([
    { id: "competency-1", year: 2026, month: 8, updatedAt },
    { id: "competency-0", year: 2026, month: 7, updatedAt },
  ]);
  mocks.ageBrackets.mockResolvedValue([
    { code: "ADULT", minAge: 18, maxAge: null, updatedAt },
  ]);
  mocks.planPrices.mockResolvedValue([
    {
      planCode: "PLAN-A",
      companyAmount: { toFixed: () => "200.00" },
      employeeAmount: { toFixed: () => "80.00" },
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: null,
      updatedAt,
      ageBracket: { code: "ADULT" },
    },
  ]);
  mocks.addonPrices.mockResolvedValue([
    {
      code: "FUNERAL",
      label: "Acessório Funeral",
      amount: { toFixed: () => "12.00" },
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: null,
      updatedAt,
    },
  ]);
  mocks.billing.mockResolvedValue([
    {
      closure: "AUTOMATIC_DAY_25",
      closingDay: 25,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: null,
      updatedAt,
    },
  ]);
  mocks.beneficiaries.mockResolvedValue([
    {
      id: "holder-1",
      competencyId: "competency-1",
      registration: "123",
      fullName: "ANA TITULAR",
      cpf: "11122233344",
      birthDate: new Date("1990-01-01T00:00:00.000Z"),
      inclusionDate: new Date("2020-01-10T00:00:00.000Z"),
      category: "HOLDER",
      relationship: null,
      planCode: "PLAN-A",
      planName: "Plano A",
      accommodation: "ENFERMARIA",
      hasAddon: true,
      updatedAt,
      branch: { code: "001", name: "Matriz" },
      holder: null,
      dependents: [
        {
          id: "dependent-1",
          registration: "123",
          fullName: "BRUNO DEPENDENTE",
          cpf: null,
          birthDate: null,
          inclusionDate: null,
          category: "DEPENDENT",
          relationship: "FILHO",
          planCode: "PLAN-A",
          planName: "Plano A",
          accommodation: "ENFERMARIA",
          hasAddon: false,
          updatedAt,
        },
      ],
      address: {
        addressLine: "Rua Um",
        number: "10",
        complement: null,
        district: "Centro",
        postalCode: "01001000",
        city: "São Paulo",
        state: "SP",
        updatedAt,
      },
    },
  ]);
});

describe("Unimed offline bundle", () => {
  it("serializes a tenant-scoped, versioned snapshot without Decimal values", async () => {
    const result = await buildUnimedOfflineBundle(
      "tenant-1",
      new Date("2026-08-15T12:00:00.000Z"),
    );

    expect(result.version).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt).toBe("2026-08-15T12:00:00.000Z");
    expect(result.beneficiaries).toHaveLength(1);
    expect(result.competencies).toHaveLength(2);
    expect(result.configuration.planPrices[0]).toMatchObject({
      companyAmount: "200.00",
      employeeAmount: "80.00",
      validFrom: "2026-08-01",
    });
    expect(mocks.beneficiaries).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          competencyId: { in: ["competency-1", "competency-0"] },
        }),
      }),
    );
  });

  it("returns an empty snapshot when no published competency exists", async () => {
    mocks.competencies.mockResolvedValue([]);
    const result = await buildUnimedOfflineBundle(
      "tenant-1",
      new Date("2026-08-15T12:00:00.000Z"),
    );
    expect(result.competency).toBeNull();
    expect(result.beneficiaries).toEqual([]);
    expect(mocks.beneficiaries).not.toHaveBeenCalled();
  });
});
