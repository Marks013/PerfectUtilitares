import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  UnimedPrintCopy,
  type UnimedPrintSummaryData,
} from "./unimed-print-summary";

function printData(
  overrides: Partial<UnimedPrintSummaryData> = {},
): UnimedPrintSummaryData {
  return {
    employeeName: "Pessoa Titular",
    cpf: "529.982.247-25",
    registration: "101",
    reason: "8. Inativo",
    exclusionDate: "2026-08-31",
    planEnrollmentDate: "2022-01-01",
    billingClosure: "AUTOMATIC_DAY_25",
    branchCode: "001",
    holder: {
      registration: "101",
      name: "Pessoa Titular",
      birthDate: "1980-01-01",
      age: 46,
      planCode: "10041",
      hasFuneral: false,
      invoicePlanAmount: "100.00",
      payrollPlanAmount: "61.26",
      funeralAmount: "0.00",
    },
    dependents: [],
    includePayrollLoans: true,
    payrollLoans: {
      competence: "2026-08",
      totalAmount: "120.15",
      contracts: [
        {
          contractNumber: "CONTRATO-1",
          installmentAmount: "100.10",
          startCompetence: "2026-08",
          endCompetence: "2027-07",
          bankCode: "001",
          bankName: "Banco Um",
        },
        {
          contractNumber: "CONTRATO-2",
          installmentAmount: "20.05",
          startCompetence: "2026-08",
          endCompetence: "2026-12",
          bankCode: "341",
          bankName: "Banco Dois",
        },
      ],
    },
    result: {
      invoiceTotal: "100.00",
      usedProrata: "100.00",
      invoiceRefund: "0.00",
      refundDays: 0,
      payrollCharge: "61.26",
      employeeFullRefund: "0.00",
      companyFullRefund: "0.00",
      enrollmentMonths: 55,
      contributionMonths: 55,
      documentKind: "INACTIVE_TERM",
      emailHasAttachment: false,
      display: {
        invoiceTotal: "100.00",
        usedProrata: "100.00",
        invoiceRefund: "0.00",
        payrollCharge: "61.26",
        employeeFullRefund: "0.00",
        companyFullRefund: "0.00",
      },
    },
    ...overrides,
  };
}

function text(markup: string) {
  return markup.replace(/<[^>]+>/g, " ").replace(/\u00a0/g, " ");
}

describe("Unimed printable payroll loans", () => {
  it("prints the total and every contract below the plan legend", () => {
    const markup = renderToStaticMarkup(
      <UnimedPrintCopy copy={1} data={printData()} />,
    );
    const content = text(markup);

    expect(content).toContain("Legenda de Planos");
    expect(content).toContain("Empréstimo Consignado");
    expect(content).toContain("120,15");
    expect(content).toContain("CONTRATO-1");
    expect(content).toContain("CONTRATO-2");
    expect(content).toContain("08/2026");
    expect(content).toContain("07/2027");
    expect(content).toContain("001 - Banco Um");
    expect(content).toContain("341 - Banco Dois");
  });

  it("omits payroll loans when the remembered preference is disabled", () => {
    const markup = renderToStaticMarkup(
      <UnimedPrintCopy
        copy={1}
        data={printData({ includePayrollLoans: false })}
      />,
    );

    expect(text(markup)).not.toContain("Empréstimo Consignado");
  });
});
