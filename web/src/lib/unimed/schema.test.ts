import { describe, expect, it } from "vitest";
import {
  dateOnlySchema,
  unimedCalculationInputSchema,
  unimedCompetencySchema,
  unimedConfigurationSchema,
} from "@/lib/unimed/schema";

describe("Unimed input schemas", () => {
  it("rejects impossible calendar dates", () => {
    expect(dateOnlySchema.safeParse("2026-02-29").success).toBe(false);
    expect(dateOnlySchema.safeParse("2028-02-29").success).toBe(true);
  });

  it("accepts only valid competencies", () => {
    expect(
      unimedCompetencySchema.safeParse({ year: 2026, month: 8 }).success,
    ).toBe(true);
    expect(
      unimedCompetencySchema.safeParse({ year: 2026, month: 13 }).success,
    ).toBe(false);
  });

  it("limits the calculation to six dependents", () => {
    const parsed = unimedCalculationInputSchema.safeParse({
      reasonCode: 1,
      exclusionDate: "2026-07-22",
      planEnrollmentDate: "2022-01-08",
      billingClosure: "OPEN",
      holder: {
        invoicePlanAmount: 100,
        payrollPlanAmount: 40,
        addonAmount: 0,
      },
      dependents: Array.from({ length: 7 }, () => ({
        invoicePlanAmount: 50,
        addonAmount: 0,
      })),
    });

    expect(parsed.success).toBe(false);
  });

  it("rounds configured prices to cents and rejects overlapping age ranges", () => {
    const base = {
      validFrom: "2026-08-01",
      billingClosure: "AUTOMATIC_DAY_25",
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
          companyAmount: 116.017,
          employeeAmount: 40,
        },
      ],
      addonPrices: [],
      email: {
        enabled: true,
        recipients: ["unimed@example.com"],
        subjectTemplate: "Solicitação de Coparticipação",
      },
    } as const;

    const parsed = unimedConfigurationSchema.parse(base);
    expect(parsed.planPrices[0].companyAmount).toBe(116.02);

    expect(
      unimedConfigurationSchema.safeParse({
        ...base,
        reasons: [{ code: 9, label: "Novo motivo", documentKind: "RN561" }],
      }).success,
    ).toBe(true);
    expect(
      unimedConfigurationSchema.safeParse({
        ...base,
        reasons: [
          { code: 9, label: "Motivo A", documentKind: "NONE" },
          { code: 9, label: "Motivo B", documentKind: "INACTIVE_TERM" },
        ],
      }).success,
    ).toBe(false);

    expect(
      unimedConfigurationSchema.safeParse({
        ...base,
        ageBrackets: [
          ...base.ageBrackets,
          {
            code: "18-23",
            label: "18 a 23",
            minAge: 18,
            maxAge: 23,
            sortOrder: 2,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
