import { describe, expect, it } from "vitest";
import type { ParsedPayrollLoan } from "@/lib/unimed/importer";
import { matchPayrollLoanRows } from "@/lib/unimed/payroll-loan-publisher";

function loan(overrides: Partial<ParsedPayrollLoan> = {}): ParsedPayrollLoan {
  return {
    sourceKey: "loan-1",
    sourceRow: 2,
    competence: "2026-08",
    cpfNormalized: "52998224725",
    registration: "4689",
    employeeName: "JOAO",
    contractNumber: "CTR-1",
    installmentAmount: 100,
    startCompetence: "2026-08",
    endCompetence: "2027-07",
    bankCode: "341",
    bankName: "BANCO",
    totalInstallments: 12,
    loanAmount: 1200,
    releasedAmount: 1100,
    contractStartDate: "2026-08-01",
    contractEndDate: "2027-07-01",
    companyCnpj: "76361807000111",
    ...overrides,
  };
}

describe("payroll loan matching", () => {
  const beneficiaries = [
    { id: "holder-1", cpf: "52998224725", registration: "4689" },
  ];

  it("uses CPF as the authoritative identifier", () => {
    const result = matchPayrollLoanRows(
      [loan({ cpfNormalized: "11144477735", registration: "4689" })],
      beneficiaries,
    );
    expect(result.unmatched).toBe(1);
    expect(result.rows[0].beneficiary).toBeUndefined();
  });

  it("uses a unique registration only when CPF is absent", () => {
    const result = matchPayrollLoanRows(
      [loan({ cpfNormalized: null, registration: "4689" })],
      beneficiaries,
    );
    expect(result.matchedByRegistration).toBe(1);
    expect(result.rows[0]).toMatchObject({
      beneficiary: { id: "holder-1" },
      matchMethod: "REGISTRATION",
      cpfNormalized: "52998224725",
    });
  });

  it("does not link an ambiguous CPF", () => {
    const result = matchPayrollLoanRows(
      [loan()],
      [
        ...beneficiaries,
        { id: "holder-2", cpf: "52998224725", registration: "9999" },
      ],
    );
    expect(result.unmatched).toBe(1);
    expect(result.rows[0].beneficiary).toBeUndefined();
  });
});
