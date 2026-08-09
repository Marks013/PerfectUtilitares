import { describe, expect, it } from "vitest";

import {
  calculateUnimedFromOfflineBundle,
  searchUnimedOfflineBundle,
  type UnimedOfflineBundle,
} from "@/lib/unimed/offline-store";

const bundle: UnimedOfflineBundle = {
  version: "bundle-test",
  generatedAt: "2026-08-08T12:00:00.000Z",
  expiresAt: "2099-08-15T12:00:00.000Z",
  competency: { id: "competency-1", year: 2026, month: 8 },
  competencies: [
    { id: "competency-1", year: 2026, month: 8 },
    { id: "competency-0", year: 2026, month: 7 },
  ],
  beneficiaries: [
    {
      id: "holder-12345678",
      competencyId: "competency-1",
      registration: "12345",
      fullName: "ANA TITULAR",
      cpf: "11122233344",
      birthDate: "1990-01-01",
      inclusionDate: "2020-01-10",
      category: "HOLDER",
      relationship: null,
      planCode: "PLAN-A",
      planName: "Plano A",
      accommodation: "ENFERMARIA",
      hasAddon: true,
      branch: { code: "001", name: "Matriz" },
      holder: null,
      address: {
        addressLine: "Rua Um",
        number: "10",
        complement: null,
        district: "Centro",
        postalCode: "01001000",
        city: "São Paulo",
        state: "SP",
      },
      dependents: [
        {
          id: "dependent-12345678",
          registration: "12345",
          fullName: "BRUNO DEPENDENTE",
          cpf: "55566677788",
          birthDate: "2010-01-01",
          inclusionDate: "2021-01-10",
          category: "DEPENDENT",
          relationship: "FILHO",
          planCode: "PLAN-A",
          planName: "Plano A",
          accommodation: "ENFERMARIA",
          hasAddon: false,
        },
      ],
    },
    {
      id: "holder-previous",
      competencyId: "competency-0",
      registration: "98765",
      fullName: "CARLA COMPETENCIA ANTERIOR",
      cpf: "12345678909",
      birthDate: "1985-01-01",
      inclusionDate: "2020-01-10",
      category: "HOLDER",
      relationship: null,
      planCode: "PLAN-A",
      planName: "Plano A",
      accommodation: "ENFERMARIA",
      hasAddon: false,
      branch: { code: "001", name: "Matriz" },
      holder: null,
      address: null,
      dependents: [],
    },
  ],
  configuration: {
    ageBrackets: [
      { code: "YOUNG", minAge: 0, maxAge: 17 },
      { code: "ADULT", minAge: 18, maxAge: null },
    ],
    planPrices: [
      {
        planCode: "PLAN-A",
        ageBracketCode: "ADULT",
        companyAmount: "200.00",
        employeeAmount: "80.00",
        validFrom: "2026-08-01",
        validTo: "2026-08-31",
      },
      {
        planCode: "PLAN-A",
        ageBracketCode: "YOUNG",
        companyAmount: "100.00",
        employeeAmount: "40.00",
        validFrom: "2026-08-01",
        validTo: "2026-08-31",
      },
      {
        planCode: "PLAN-A",
        ageBracketCode: "ADULT",
        companyAmount: "220.00",
        employeeAmount: "90.00",
        validFrom: "2026-09-01",
        validTo: null,
      },
      {
        planCode: "PLAN-A",
        ageBracketCode: "YOUNG",
        companyAmount: "110.00",
        employeeAmount: "45.00",
        validFrom: "2026-09-01",
        validTo: null,
      },
    ],
    addonPrices: [
      {
        code: "FUNERAL",
        label: "Acessório Funeral",
        amount: "12.00",
        validFrom: "2026-08-01",
        validTo: "2026-08-31",
      },
      {
        code: "FUNERAL",
        label: "Acessório Funeral",
        amount: "13.00",
        validFrom: "2026-09-01",
        validTo: null,
      },
    ],
    billing: [
      {
        closure: "AUTOMATIC_DAY_25",
        closingDay: 25,
        validFrom: "2026-01-01",
        validTo: null,
      },
    ],
  },
};

describe("Unimed offline data", () => {
  it("searches holders through holder and dependent identifiers", () => {
    expect(
      searchUnimedOfflineBundle(bundle, "bruno", "2026-08-20")
        ?.beneficiaries,
    ).toHaveLength(1);
    expect(
      searchUnimedOfflineBundle(bundle, "555.666.777-88", "2026-08-20")
        ?.beneficiaries[0]?.fullName,
    ).toBe("ANA TITULAR");
    expect(
      searchUnimedOfflineBundle(bundle, "12345", "2026-08-20")
        ?.pricingContext.billingClosure,
    ).toBe("AUTOMATIC_DAY_25");
  });

  it("calculates current and next competency with official offline prices", () => {
    const result = calculateUnimedFromOfflineBundle(bundle, {
      beneficiaryId: "holder-12345678",
      dependentIds: ["dependent-12345678"],
      reasonCode: 2,
      exclusionDate: "2026-08-25",
    });

    expect(result?.officialInput).toMatchObject({
      billingClosure: "AUTOMATIC_DAY_25",
      holder: {
        invoicePlanAmount: 200,
        payrollPlanAmount: 80,
        addonAmount: 12,
      },
      dependents: [{ invoicePlanAmount: 100, addonAmount: 0 }],
      nextCompetency: {
        holder: {
          invoicePlanAmount: 220,
          payrollPlanAmount: 90,
          addonAmount: 13,
        },
        dependents: [{ invoicePlanAmount: 110, addonAmount: 0 }],
      },
    });
    expect(result?.calculation.cutoffApplied).toBe(true);
  });

  it("falls back to the previous competency when latest has no match", () => {
    const result = searchUnimedOfflineBundle(bundle, "carla", "2026-08-20");
    expect(result?.beneficiaries[0]?.id).toBe("holder-previous");
    expect(result?.pricingContext.dataCompetency).toEqual({
      year: 2026,
      month: 7,
    });
  });

  it("rejects expired bundles and unrelated dependents", () => {
    expect(
      searchUnimedOfflineBundle(
        { ...bundle, expiresAt: "2020-01-01T00:00:00.000Z" },
        "ana",
      ),
    ).toBeNull();
    expect(() =>
      calculateUnimedFromOfflineBundle(bundle, {
        beneficiaryId: "holder-12345678",
        dependentIds: ["unknown-dependent"],
        reasonCode: 2,
        exclusionDate: "2026-08-20",
      }),
    ).toThrow(/dependente/i);
  });
});
