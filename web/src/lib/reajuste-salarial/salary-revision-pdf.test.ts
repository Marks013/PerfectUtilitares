import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { generateSalaryRevisionPdf } from "./salary-revision-pdf";
import { applySalaryRevisionRules } from "./salary-revision-rules";

describe("salary revision PDF", () => {
  it("generates readable A4 landscape pages", async () => {
    const report = applySalaryRevisionRules(
      {
        sourceFile: "FPRE131.xlsx",
        sourceSheet: "Plan1",
        employees: Array.from({ length: 100 }, (_, index) => ({
          sourceFile: "FPRE131.xlsx",
          sourceSheet: "Plan1",
          sourceRow: index + 4,
          branchAlias: index < 50 ? "Matriz" : "Hiper",
          registration: String(index + 1),
          employeeName: `COLABORADOR ${String(index + 1).padStart(3, "0")}`,
          role: index % 2 === 0 ? "CAIXA" : "REPOSITOR",
          currentSalaryCents: 203_194n,
        })),
      },
      442n,
      [],
      new Date("2026-08-24T12:00:00.000Z"),
    );
    const bytes = await generateSalaryRevisionPdf(report);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(841.89, 1);
      expect(page.getHeight()).toBeCloseTo(595.28, 1);
    }
  });
});
