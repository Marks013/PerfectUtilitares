import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findAgeBrackets: vi.fn(),
  findPlanPrices: vi.fn(),
  findAddonPrices: vi.fn(),
  findBilling: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    unimedAgeBracket: { findMany: mocks.findAgeBrackets },
    unimedPlanPriceVersion: { findMany: mocks.findPlanPrices },
    unimedAddonPriceVersion: { findMany: mocks.findAddonPrices },
    unimedBillingSetting: { findFirst: mocks.findBilling },
  },
}));

vi.mock("@/lib/unimed/access", () => ({
  canUseUnimed: vi.fn(() => true),
}));

import {
  getUnimedCalculationConfiguration,
  saveUnimedConfiguration,
} from "@/lib/unimed/configuration";

const validConfiguration = {
  validFrom: "2026-08-01",
  billingClosure: "AUTOMATIC_DAY_25" as const,
  annualAdjustmentPercent: 13,
  differencePercent: 1,
  ageBrackets: [
    {
      code: "00-18",
      label: "0 a 18",
      minAge: 0,
      maxAge: 18,
      sortOrder: 1,
    },
  ],
  planPrices: [
    {
      planCode: "1013",
      ageBracketCode: "00-18",
      companyAmount: 116.02,
      employeeAmount: 40,
    },
  ],
  addonPrices: [
    {
      code: "AEROMEDICO",
      label: "Aeromédico",
      amount: 12.5,
    },
  ],
  email: {
    enabled: true,
    recipients: ["unimed@example.com"],
    subjectTemplate: "Solicitação de Coparticipação" as const,
  },
};

function transactionClient() {
  return {
    $queryRaw: vi.fn(),
    user: {
      findFirst: vi.fn().mockResolvedValue({
        id: "user-1",
        name: "Administrador",
        role: "ADMIN",
        unimedAccess: null,
      }),
    },
    unimedModuleSession: { findFirst: vi.fn() },
    unimedAgeBracket: {
      upsert: vi.fn().mockResolvedValue({ id: "bracket-1" }),
      updateMany: vi.fn(),
    },
    unimedPlanPriceVersion: {
      findMany: vi.fn().mockResolvedValue([
        {
          ageBracketId: "bracket-1",
          planCode: "1013",
          validFrom: new Date("2026-09-01T00:00:00.000Z"),
        },
      ]),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    unimedAddonPriceVersion: {
      findMany: vi.fn().mockResolvedValue([
        {
          code: "AEROMEDICO",
          validFrom: new Date("2026-09-01T00:00:00.000Z"),
        },
      ]),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    unimedBillingSetting: {
      findFirst: vi.fn().mockResolvedValue({
        validFrom: new Date("2026-09-01T00:00:00.000Z"),
      }),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    unimedCalculationRuleVersion: {
      findFirst: vi.fn().mockResolvedValue({
        validFrom: new Date("2026-09-01T00:00:00.000Z"),
      }),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    unimedEmailSetting: { upsert: vi.fn() },
    unimedExclusionReason: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAgeBrackets.mockResolvedValue([{ code: "00-18" }]);
  mocks.findPlanPrices.mockResolvedValue([{ planCode: "UNIFIED" }]);
  mocks.findAddonPrices.mockResolvedValue([{ code: "FUNERAL" }]);
  mocks.findBilling.mockResolvedValue({ closure: "AUTOMATIC_DAY_25" });
});

describe("Unimed configuration history", () => {
  it("loads only the four data sets required by the calculation", async () => {
    const referenceDate = new Date("2026-08-15T00:00:00.000Z");

    const configuration = await getUnimedCalculationConfiguration(
      "tenant-12345678",
      referenceDate,
    );

    expect(configuration).toEqual({
      ageBrackets: [{ code: "00-18" }],
      planPrices: [{ planCode: "UNIFIED" }],
      addonPrices: [{ code: "FUNERAL" }],
      billing: { closure: "AUTOMATIC_DAY_25" },
    });
    expect(mocks.findAgeBrackets).toHaveBeenCalledOnce();
    expect(mocks.findPlanPrices).toHaveBeenCalledOnce();
    expect(mocks.findAddonPrices).toHaveBeenCalledOnce();
    expect(mocks.findBilling).toHaveBeenCalledOnce();
  });

  it("keeps a retroactive version bounded by the next future version", async () => {
    const tx = transactionClient();
    mocks.transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
    );

    await saveUnimedConfiguration(
      "tenant-12345678",
      "user-12345678",
      validConfiguration,
    );

    const expectedPreviousEnd = new Date("2026-07-31T00:00:00.000Z");
    const expectedRetroactiveEnd = new Date("2026-08-31T00:00:00.000Z");

    expect(tx.unimedPlanPriceVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { validTo: expectedPreviousEnd } }),
    );
    expect(tx.unimedPlanPriceVersion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ validTo: expectedRetroactiveEnd }),
        update: expect.objectContaining({ validTo: expectedRetroactiveEnd }),
      }),
    );
    expect(tx.unimedAddonPriceVersion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ validTo: expectedRetroactiveEnd }),
        update: expect.objectContaining({ validTo: expectedRetroactiveEnd }),
      }),
    );
    expect(tx.unimedBillingSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ validTo: expectedRetroactiveEnd }),
        update: expect.objectContaining({ validTo: expectedRetroactiveEnd }),
      }),
    );
    expect(tx.unimedCalculationRuleVersion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ validTo: expectedRetroactiveEnd }),
        update: expect.objectContaining({ validTo: expectedRetroactiveEnd }),
      }),
    );
  });
});
