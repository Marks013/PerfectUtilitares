import { describe, expect, it } from "vitest";
import {
  approximateUnimedAge,
  resolveUnimedPlanPrice,
} from "@/lib/unimed/pricing";

const ageBrackets = [
  { code: "00-18", minAge: 0, maxAge: 18 },
  { code: "19-23", minAge: 19, maxAge: 23 },
  { code: "24+", minAge: 24, maxAge: null },
];

describe("Unimed configured pricing", () => {
  it("uses the workbook 365.25-day age rule", () => {
    expect(
      approximateUnimedAge(
        new Date("2000-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(26);
  });

  it("resolves official company and employee values by plan and age", () => {
    expect(
      resolveUnimedPlanPrice({
        birthDate: new Date("2004-01-01T00:00:00.000Z"),
        referenceDate: new Date("2026-07-01T00:00:00.000Z"),
        planCode: "1013",
        ageBrackets,
        prices: [
          {
            planCode: "1013",
            ageBracketCode: "19-23",
            companyAmount: "250.00",
            employeeAmount: "87.50",
          },
        ],
      }),
    ).toMatchObject({
      status: "RESOLVED",
      ageBracketCode: "19-23",
      companyAmount: "250.00",
      employeeAmount: "87.50",
    });
  });

  it("returns an explicit gap instead of inventing a price", () => {
    expect(
      resolveUnimedPlanPrice({
        birthDate: new Date("2004-01-01T00:00:00.000Z"),
        referenceDate: new Date("2026-07-01T00:00:00.000Z"),
        planCode: null,
        ageBrackets,
        prices: [],
      }).status,
    ).toBe("MISSING_PLAN_CODE");
  });

  it("treats plan codes 10041 and 1013 as aliases of one age table", () => {
    const prices = [
      {
        planCode: "UNIFIED",
        ageBracketCode: "19-23",
        companyAmount: "250.00",
        employeeAmount: "87.50",
      },
    ];
    for (const planCode of ["10041", "1013"]) {
      expect(
        resolveUnimedPlanPrice({
          birthDate: new Date("2004-01-01T00:00:00.000Z"),
          referenceDate: new Date("2026-07-01T00:00:00.000Z"),
          planCode,
          ageBrackets,
          prices,
        }),
      ).toMatchObject({
        status: "RESOLVED",
        companyAmount: "250.00",
        employeeAmount: "87.50",
      });
    }
  });

  it("does not resolve a price without a birth date", () => {
    expect(
      resolveUnimedPlanPrice({
        birthDate: null,
        referenceDate: new Date("2026-07-01T00:00:00.000Z"),
        planCode: "1013",
        ageBrackets,
        prices: [],
      }).status,
    ).toBe("MISSING_BIRTH_DATE");
  });

  it("rejects ambiguous duplicate prices", () => {
    const price = {
      planCode: "1013",
      ageBracketCode: "19-23",
      companyAmount: "250.00",
      employeeAmount: "87.50",
    };
    expect(
      resolveUnimedPlanPrice({
        birthDate: new Date("2004-01-01T00:00:00.000Z"),
        referenceDate: new Date("2026-07-01T00:00:00.000Z"),
        planCode: "1013",
        ageBrackets,
        prices: [price, price],
      }).status,
    ).toBe("MISSING_PRICE");
  });
});
