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
    competency: "2026-07",
    exclusionDate: "2026-08-31",
    planEnrollmentDate: "2022-01-01",
    billingClosure: "AUTOMATIC_DAY_25",
    branchCode: "MULTI ATACADO",
    holder: {
      id: "holder",
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
      daysInMonth: 31,
      usedDays: 31,
      usedProrata: "100.00",
      cutoffApplied: true,
      currentCompetency: "2026-08",
      nextCompetency: "2026-09",
      nextCompetencyDays: 30,
      totalRefundDays: 30,
      currentCompetencyRefund: "0.00",
      nextCompetencyRefund: "100.00",
      nextCompetencyInvoiceTotal: "100.00",
      nextCompetencyPayrollCharge: "61.26",
      invoiceRefund: "100.00",
      refundDays: 0,
      payrollCharge: "61.26",
      employeeCurrentRefund: "0.00",
      employeeNextRefund: "61.26",
      employeeFullRefund: "61.26",
      companyCurrentRefund: "0.00",
      companyNextRefund: "38.74",
      companyFullRefund: "38.74",
      enrollmentMonths: 55,
      contributionMonths: 55,
      documentKind: "INACTIVE_TERM",
      emailHasAttachment: false,
      display: {
        invoiceTotal: "100.00",
        nextCompetencyInvoiceTotal: "100.00",
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
    expect(content).toContain("Consignado digital");
    expect(content).toContain("Empréstimo Consignado");
    expect(content).toContain("120,15");
    expect(content).toContain("CONTRATO-1");
    expect(content).toContain("CONTRATO-2");
    expect(content).toContain("08/2026");
    expect(content).toContain("07/2027");
    expect(content).toContain("001 - Banco Um");
    expect(content).toContain("341 - Banco Dois");
    expect(markup).toContain("<td>MA</td>");
    expect(markup).toContain("<td>08/2026</td><td>31/08/2026</td>");
    expect(content).toContain("Total estornado em fatura");
  });

  it("prints C when the source branch is Castelo Branco", () => {
    const markup = renderToStaticMarkup(
      <UnimedPrintCopy
        copy={1}
        data={printData({ branchCode: "Castelo Branco" })}
      />,
    );
    expect(markup).toContain("<td>C</td>");
    expect(text(markup)).not.toContain("Castelo Branco");
  });

  it("states explicitly when the CPF has no digital payroll loan", () => {
    const markup = renderToStaticMarkup(
      <UnimedPrintCopy copy={1} data={printData({ payrollLoans: null })} />,
    );
    expect(text(markup)).toContain(
      "Não há consignado digital para o CPF consultado.",
    );
  });

  it("states explicitly when the imported competence has no contracts", () => {
    const markup = renderToStaticMarkup(
      <UnimedPrintCopy
        copy={1}
        data={printData({
          payrollLoans: {
            competence: "2026-08",
            totalAmount: "0.00",
            contracts: [],
          },
        })}
      />,
    );
    expect(text(markup)).toContain(
      "Não há consignado digital na competência 08/2026.",
    );
  });

  it("omits payroll loans when the remembered preference is disabled", () => {
    const markup = renderToStaticMarkup(
      <UnimedPrintCopy
        copy={1}
        data={printData({ includePayrollLoans: false })}
      />,
    );
    const content = text(markup);
    expect(content).not.toContain("Empréstimo Consignado");
    expect(content).not.toContain("Consignado digital");
    expect(content).not.toContain("Não há consignado digital");
  });

  it("omits unchecked dependents from the printable PDF summary", () => {
    const dependent = {
      registration: null,
      birthDate: "2010-01-01",
      age: 16,
      planCode: "10041",
      hasFuneral: false,
      invoicePlanAmount: "100.00",
      payrollPlanAmount: null,
      funeralAmount: "0.00",
    };
    const markup = renderToStaticMarkup(
      <UnimedPrintCopy
        copy={1}
        data={printData({
          dependents: [
            {
              ...dependent,
              id: "dependent-selected",
              name: "Dependente Incluído",
              selected: true,
            },
            {
              ...dependent,
              id: "dependent-unchecked",
              name: "Dependente Desmarcado",
              selected: false,
            },
          ],
        })}
      />,
    );
    const content = text(markup);

    expect(content).toContain("Dependente Incluído");
    expect(content).not.toContain("Dependente Desmarcado");
  });
});
