import { PDFDocument as LoadedPdf } from "pdf-lib";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateEventAdjustmentPdf } from "./event-adjustment-pdf";
import type { EventAdjustmentReport, EventAdjustmentResult } from "./event-adjustment-types";
import { MAX_EVENT_IDENTITY_LENGTH } from "./limits";

function result(paidCents: string, quantity: number, targetCents: string, differenceCents: string): EventAdjustmentResult {
  return { received: true, paidCents, quantity, targetCents, differenceCents, quantitySource: "amount", issue: null };
}

function fixture(count = 1): EventAdjustmentReport {
  const competencies = [6, 7, 8].map((month) => ({ key: `2026-${String(month).padStart(2, "0")}` as `${string}-${string}`, month, year: 2026, order: month }));
  return {
    settings: { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] },
    competencies,
    employees: Array.from({ length: count }, (_, index) => ({
      registration: String(index + 1), employeeName: `COLABORADOR FICTÍCIO ${index + 1}`, branchAlias: index % 2 ? "Filial Beta" : "Filial Alfa",
      months: competencies.map((competency) => ({ competency, inPayroll: true, bonus565: result("8000", 1, "9000", "1000"), indemnity901: result("17000", 2, "18000", "1000") })),
      bonusDifferenceCents: "3000", sundayDifferenceCents: "3000", totalDifferenceCents: "6000",
    })),
    employeeCount: count, branchCount: count > 1 ? 2 : 1,
    bonusTotalCents: String(count * 3000), sundayTotalCents: String(count * 3000), grandTotalCents: String(count * 6000),
    generatedAt: "2026-10-01T12:00:00.000Z", issueCount: 0,
    suggestions: { bonusOldValueCents: "8000", sundayOldValueCents: "8500", bonusEvidence: "Dados sintéticos", sundayEvidence: "Dados sintéticos" },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("event adjustment PDF", () => {
  it("keeps the largest accepted identities inside controlled pages", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const report = fixture(3);
    for (const employee of report.employees) {
      employee.registration = "1".repeat(MAX_EVENT_IDENTITY_LENGTH);
      employee.employeeName = "COLABORADOR FICTICIO ".repeat(30).slice(0, MAX_EVENT_IDENTITY_LENGTH);
      employee.branchAlias = "FILIAL FICTICIA ".repeat(40).slice(0, MAX_EVENT_IDENTITY_LENGTH);
    }
    const pdf = await LoadedPdf.load(await generateEventAdjustmentPdf(report));
    expect(text.mock.calls.filter((call) => call[0] === "Apuração de diferenças — eventos 565 e 901")).toHaveLength(pdf.getPageCount());
    expect(text.mock.calls.filter((call) => /^Página \d+ de \d+$/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
    const bodyCalls = text.mock.calls.filter((call) => !String(call[0]).startsWith("PerfectUtilitares |") && !/^Página \d+ de \d+$/.test(String(call[0])));
    expect(bodyCalls.filter((call) => typeof call[2] === "number" && call[2] > 549.28)).toEqual([]);
    for (const field of ["registration", "employeeName", "branchAlias"] as const) {
      expect(text.mock.calls.some((call) => String(call[0]).includes(report.employees[0][field]))).toBe(true);
    }
  });
  it("rejects an oversized identity before PDFKit can paginate it implicitly", async () => {
    const report = fixture();
    report.employees[0].employeeName = "COLABORADOR FICTICIO ".repeat(600);
    await expect(generateEventAdjustmentPdf(report)).rejects.toMatchObject({ code: "REAJUSTE_STRUCTURE_INVALID" });
  });
  it("generates real landscape PDF with audit values, sources, months and totals", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const report = fixture();
    report.settings.historicOverrides = [{ competencyKey: "2026-07", bonusOldValueCents: "7500", sundayOldValueCents: "8000" }];
    report.employees[0].months[0].indemnity901.quantitySource = "reference";
    const bytes = await generateEventAdjustmentPdf(report);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const pdf = await LoadedPdf.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(841.89, 1);
      expect(page.getHeight()).toBeCloseTo(595.28, 1);
    }
    const values = text.mock.calls.map((call) => call[0]).join("\n");
    for (const value of ["06/2026", "07/2026", "08/2026", "R$ 80,00", "R$ 85,00", "R$ 90,00", "R$ 170,00", "R$ 180,00", "R$ 10,00", "R$ 30,00", "R$ 60,00", "Referência da folha", "Valor / histórico", "2 dom.", "1 unid.", "R$ 75,00", "Filial Alfa"]) {
      expect(values).toContain(value);
    }
    expect(values).toContain("Página 2 de 2");
  });

  it("repeats headers and identities without clipping long names across many pages", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const report = fixture(120);
    report.competencies = Array.from({ length: 12 }, (_, index) => ({ key: `2026-${String(index + 1).padStart(2, "0")}` as `${string}-${string}`, month: index + 1, year: 2026, order: index + 1 }));
    for (const employee of report.employees) {
      employee.months = report.competencies.map((competency) => ({ ...employee.months[0], competency }));
    }
    report.employees[0].employeeName = "COLABORADOR FICTÍCIO COM NOME MUITO LONGO ".repeat(8);
    const bytes = await generateEventAdjustmentPdf(report);
    const pdf = await LoadedPdf.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(30);
    const calls = text.mock.calls;
    expect(calls.filter((call) => call[0] === "Apuração de diferenças — eventos 565 e 901")).toHaveLength(pdf.getPageCount());
    expect(calls.filter((call) => call[0] === "Competência")).toHaveLength(pdf.getPageCount() - 1);
    expect(calls.some((call) => String(call[0]).includes(report.employees[0].employeeName))).toBe(true);
    expect(calls.some((call) => String(call[0]).includes("(continuação)"))).toBe(true);
    expect(calls.every((call) => !(call[3] as { ellipsis?: boolean } | undefined)?.ellipsis)).toBe(true);
    expect(calls.some((call) => call[0] === `Página ${pdf.getPageCount()} de ${pdf.getPageCount()}`)).toBe(true);
  });

  it("distinguishes missing payroll and absent events, null settings and zero without deduction", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const report = fixture();
    report.settings.bonusNewValueCents = null;
    const months = report.employees[0].months;
    months[0].bonus565.targetCents = null;
    months[0].bonus565.differenceCents = "0";
    months[0].indemnity901 = result("17000", 2, "16000", "0");
    months[1].bonus565 = { received: false, paidCents: "0", quantity: null, targetCents: null, differenceCents: "0", quantitySource: "none", issue: null };
    months[2].inPayroll = false;
    await generateEventAdjustmentPdf(report);
    const values = text.mock.calls.map((call) => call[0]).join("\n");
    for (const value of ["Evento ausente", "Sem folha", "Não reajustado", "Recebeu; não reajustado", "Adicional zero; sem desconto", "R$ 160,00", "R$ 0,00"]) expect(values).toContain(value);
    expect(text.mock.calls.filter((call) => call[0] === "08/2026")).toHaveLength(2);
  });

  it("blocks unresolved reports before creating payment PDFs", async () => {
    const report = fixture();
    report.issueCount = 1;
    await expect(generateEventAdjustmentPdf(report)).rejects.toThrow("Resolva todas as pendências");
    report.issueCount = 0;
    report.employees[0].months[0].indemnity901.issue = "Quantidade ambígua";
    await expect(generateEventAdjustmentPdf(report)).rejects.toThrow("Resolva todas as pendências");
  });

  it("handles 787 collaborators across three months without extra unnumbered pages", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const pdf = await LoadedPdf.load(await generateEventAdjustmentPdf(fixture(787)));
    const calls = text.mock.calls;
    expect(calls.filter((call) => call[0] === "06/2026")).toHaveLength(1574);
    expect(calls.filter((call) => String(call[0]).startsWith("Total do colaborador:"))).toHaveLength(787);
    expect(calls.filter((call) => /^Página \d+ de \d+$/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
    expect(pdf.getPageCount()).toBeGreaterThan(100);
  }, 20_000);
});
