import { describe, expect, it } from "vitest";
import goldenMaster from "@/lib/unimed/__fixtures__/golden-master.json";
import { calculateUnimed } from "@/lib/unimed/calculation";
import { unimedCalculationInputSchema } from "@/lib/unimed/schema";

describe("Unimed calculation engine", () => {
  it("reproduces every audited calculation reference", () => {
    for (const reference of goldenMaster.cases) {
      const result = calculateUnimed(
        unimedCalculationInputSchema.parse(reference.calculationInput),
      );

      expect(result).toMatchObject(reference.expected);
      if ("display" in reference && reference.display) {
        expect(result.display).toMatchObject(reference.display);
      }
    }
  });

  it("locks the critical matrix covered by the reference set", () => {
    const inputs = goldenMaster.cases.map((reference) =>
      unimedCalculationInputSchema.parse(reference.calculationInput),
    );
    const reasons = new Set(inputs.map((input) => input.reasonCode));
    const dependentCounts = new Set(
      inputs.map((input) => input.dependents.length),
    );
    const monthLengths = new Set(
      inputs.map((input) => {
        const [year, month] = input.exclusionDate.split("-").map(Number);
        return new Date(Date.UTC(year, month, 0)).getUTCDate();
      }),
    );

    expect(reasons).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    expect([...dependentCounts]).toEqual(
      expect.arrayContaining([0, 1, 4, 5, 6]),
    );
    expect([...monthLengths]).toEqual(expect.arrayContaining([28, 29, 30, 31]));
  });

  it("splits the proportional refund between employee and company", () => {
    const result = calculateUnimed({
      reasonCode: 3,
      exclusionDate: "2026-08-03",
      planEnrollmentDate: "2025-01-01",
      billingClosure: "AUTOMATIC_DAY_25",
      holder: {
        invoicePlanAmount: 176.95,
        payrollPlanAmount: 61.26,
        addonAmount: 0,
      },
      dependents: [{ invoicePlanAmount: 116.02, addonAmount: 0 }],
    });

    expect(result.invoiceTotal).toBe("292.97");
    expect(result.payrollCharge).toBe("177.28");
    expect(result.daysInMonth).toBe(31);
    expect(result.usedDays).toBe(3);
    expect(result.refundDays).toBe(28);
    expect(result.cutoffApplied).toBe(false);
    expect(result.currentCompetencyRefund).toBe("264.62");
    expect(result.nextCompetencyRefund).toBe("0.00");
    expect(result.employeeCurrentRefund).toBe("160.12");
    expect(result.employeeNextRefund).toBe("0.00");
    expect(result.employeeFullRefund).toBe("160.12");
    expect(result.companyFullRefund).toBe("104.50");
    expect(result.invoiceRefund).toBe("264.62");
  });

  it("adds one full installment after the day-25 cutoff", () => {
    const result = calculateUnimed({
      reasonCode: 3,
      exclusionDate: "2026-08-30",
      planEnrollmentDate: "2025-01-01",
      billingClosure: "AUTOMATIC_DAY_25",
      holder: {
        invoicePlanAmount: 176.95,
        payrollPlanAmount: 61.26,
        addonAmount: 0,
      },
      dependents: [{ invoicePlanAmount: 116.02, addonAmount: 0 }],
    });

    expect(result.usedDays).toBe(30);
    expect(result.refundDays).toBe(1);
    expect(result.cutoffApplied).toBe(true);
    expect(result.currentCompetencyRefund).toBe("9.45");
    expect(result.nextCompetencyRefund).toBe("292.97");
    expect(result.employeeCurrentRefund).toBe("5.72");
    expect(result.employeeNextRefund).toBe("177.28");
    expect(result.employeeFullRefund).toBe("183.00");
    expect(result.companyFullRefund).toBe("119.42");
    expect(result.invoiceRefund).toBe("302.42");
  });

  it("applies the audited cutoff starting on day 25", () => {
    const calculateForDay = (day: number) =>
      calculateUnimed({
        reasonCode: 3,
        exclusionDate: `2026-08-${String(day).padStart(2, "0")}`,
        planEnrollmentDate: "2025-01-01",
        billingClosure: "AUTOMATIC_DAY_25",
        holder: {
          invoicePlanAmount: 100,
          payrollPlanAmount: 60,
          addonAmount: 0,
        },
        dependents: [],
      });
    expect(calculateForDay(24).cutoffApplied).toBe(false);
    expect(calculateForDay(25).cutoffApplied).toBe(true);
  });

  it("maps reasons 1, 2 and 8 to the documents used by the workbook", () => {
    const base = unimedCalculationInputSchema.parse(
      goldenMaster.cases[0].calculationInput,
    );

    expect(calculateUnimed({ ...base, reasonCode: 1 }).documentKind).toBe(
      "RN561",
    );
    expect(calculateUnimed({ ...base, reasonCode: 2 }).documentKind).toBe(
      "RN561",
    );
    expect(calculateUnimed({ ...base, reasonCode: 8 }).documentKind).toBe(
      "INACTIVE_TERM",
    );
    expect(calculateUnimed({ ...base, reasonCode: 4 }).documentKind).toBe(
      "NONE",
    );
  });

  it("rounds decimal half up without binary floating-point drift", () => {
    const base = unimedCalculationInputSchema.parse(
      goldenMaster.cases[0].calculationInput,
    );
    const result = calculateUnimed({
      ...base,
      billingClosure: "OPEN",
      holder: {
        invoicePlanAmount: 10.075,
        payrollPlanAmount: 10.075,
        addonAmount: 0,
      },
      dependents: [],
    });

    expect(result.invoiceTotal).toBe("10.08");
    expect(result.payrollCharge).toBe("10.08");
  });

  it("keeps financial and document invariants under varied accidental inputs", () => {
    let state = 0x5612026;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };

    for (let index = 0; index < 200; index += 1) {
      const reasonCode = (index % 8) + 1;
      const dependentCount = index % 7;
      const amount = () => Math.round(random() * 70_000) / 100;
      const input = unimedCalculationInputSchema.parse({
        reasonCode,
        exclusionDate: `2026-07-${String((index % 31) + 1).padStart(2, "0")}`,
        planEnrollmentDate: "2022-01-08",
        billingClosure: index % 2 === 0 ? "OPEN" : "AUTOMATIC_DAY_25",
        holder: {
          invoicePlanAmount: amount(),
          payrollPlanAmount: amount(),
          addonAmount: index % 3 === 0 ? 6.12 : 0,
        },
        dependents: Array.from({ length: dependentCount }, () => ({
          invoicePlanAmount: amount(),
          addonAmount: random() > 0.5 ? 6.12 : 0,
        })),
      });
      const result = calculateUnimed(input);
      const invoiceTotal = Number(result.invoiceTotal);
      const usedProrata = Number(result.usedProrata);
      const invoiceRefund = Number(result.invoiceRefund);
      const payrollCharge = Number(result.payrollCharge);
      const employeeFullRefund = Number(result.employeeFullRefund);
      const companyFullRefund = Number(result.companyFullRefund);

      expect(
        [
          invoiceTotal,
          usedProrata,
          invoiceRefund,
          payrollCharge,
          employeeFullRefund,
          companyFullRefund,
        ].every(Number.isFinite),
      ).toBe(true);
      expect(invoiceTotal).toBeGreaterThanOrEqual(0);
      expect(usedProrata).toBeGreaterThanOrEqual(0);
      expect(usedProrata).toBeLessThanOrEqual(invoiceTotal);
      expect(invoiceRefund).toBeGreaterThanOrEqual(0);
      expect(invoiceRefund).toBeLessThanOrEqual(invoiceTotal * 2);
      expect(Number((employeeFullRefund + companyFullRefund).toFixed(2))).toBe(
        invoiceRefund,
      );
      expect(result.refundDays).toBeGreaterThanOrEqual(0);
      expect(result.refundDays).toBeLessThanOrEqual(31);
      expect(result.documentKind).toBe(
        reasonCode <= 2 ? "RN561" : reasonCode === 8 ? "INACTIVE_TERM" : "NONE",
      );
    }
  });
});
