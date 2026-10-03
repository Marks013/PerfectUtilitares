import { describe, expect, it } from "vitest";
import { buildIntegratedAdvanceSummary, buildSalaryAdvanceSummary, parseOptionalAdvanceEventSettings } from "./advance-events";
import { parseCompetencyFileName } from "./competency";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { buildEventAdjustmentReport } from "./event-adjustments";
import type { EventAdjustmentSettings, ParsedSalaryEventFile } from "./event-adjustment-types";

const settings: EventAdjustmentSettings = { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] };
function reports() {
  const competency = parseCompetencyFileName("06-2026.xlsx");
  const row = { competency, sourceFile: "06-2026.xlsx", sourceSheet: "Plan1", sourceRow: 4, registration: "0001", employeeName: "ÁNA TESTE", branchAlias: "MATRIZ", baseCents: 200_000n };
  const advance = consolidateSalaryAdvanceFiles([{ competency, sourceFile: row.sourceFile, sourceSheet: row.sourceSheet, rows: [row] }], 500n);
  const eventFile: ParsedSalaryEventFile = { competency, sourceFile: row.sourceFile, sourceSheet: row.sourceSheet, company: "EMPRESA TESTE", rows: [{ registration: "1", employeeName: "ANA TESTE", branchAlias: "FILIAL NOVA", events: { "565": [{ paidCents: "8000", reference: "1,00", sourceRow: 5 }], "901": [{ paidCents: "17000", reference: "0,00", sourceRow: 6 }] } }] };
  return { advance, events: buildEventAdjustmentReport([eventFile], settings) };
}

describe("optional advance events", () => {
  it("keeps legacy mode without reading event settings", () => {
    const form = new FormData();
    form.set("bonusOldValue", "invalid");
    expect(parseOptionalAdvanceEventSettings(form)).toBeNull();
    form.set("includeEvents", "false");
    expect(parseOptionalAdvanceEventSettings(form)).toBeNull();
  });

  it("requires a unique boolean option", () => {
    const form = new FormData();
    form.set("includeEvents", "yes");
    expect(() => parseOptionalAdvanceEventSettings(form)).toThrow("opção");
    form.set("includeEvents", "false");
    form.append("includeEvents", "false");
    expect(() => parseOptionalAdvanceEventSettings(form)).toThrow("opção");
  });

  it("requires at least one new value and rejects duplicated active settings", () => {
    const form = new FormData();
    form.set("includeEvents", "true");
    form.set("bonusOldValue", "80,00");
    form.set("sundayOldValue", "85,00");
    expect(() => parseOptionalAdvanceEventSettings(form)).toThrow("pelo menos");
    form.set("bonusNewValue", "90,00");
    expect(parseOptionalAdvanceEventSettings(form)).toEqual({ ...settings, sundayNewValueCents: null });
    form.append("bonusNewValue", "95,00");
    expect(() => parseOptionalAdvanceEventSettings(form)).toThrow("repetidos");
  });
});

describe("integrated advance summary", () => {
  it("rejects duplicated registrations and inconsistent advance subtotals in the separated PDFs", () => {
    const first = reports();
    first.advance.groups.push(first.advance.groups[0]);
    expect(() => buildSalaryAdvanceSummary(first.advance, first.events)).toThrow("repetidas");
    const second = reports();
    second.advance.groups[0].subtotalCents += 1n;
    expect(() => buildSalaryAdvanceSummary(second.advance)).toThrow("subtotais");
    const third = reports();
    third.advance.groups[0].employees[0].totalAdjustmentCents += 1n;
    expect(() => buildSalaryAdvanceSummary(third.advance, third.events)).toThrow("mensais");
  });
  it("adds advance and event differences once, preserving the latest event branch", () => {
    const { advance, events } = reports();
    const summary = buildIntegratedAdvanceSummary(advance, events);
    expect(summary).toEqual({ employees: [{ registration: "1", employeeName: "ANA TESTE", branchAlias: "FILIAL NOVA", advanceCents: 10000n, bonusCents: 1000n, sundayCents: 1000n, totalCents: 12000n }], advanceTotalCents: 10000n, bonusTotalCents: 1000n, sundayTotalCents: 1000n, grandTotalCents: 12000n });
  });

  it("aggregates a registration spread across advance branches", () => {
    const { advance, events } = reports();
    const employee = advance.groups[0].employees[0];
    advance.groups.push({ ...advance.groups[0], branchAlias: "FILIAL", employees: [{ ...employee, totalAdjustmentCents: 5000n }] });
    advance.grandTotalCents = 15000n;
    expect(buildIntegratedAdvanceSummary(advance, events).employees[0].advanceCents).toBe(15000n);
  });

  it("rejects mismatched competencies, employee identities and attendance", () => {
    const first = reports();
    first.events.competencies = [parseCompetencyFileName("07-2026.xlsx")];
    expect(() => buildIntegratedAdvanceSummary(first.advance, first.events)).toThrow("competências");
    const second = reports();
    second.events.employees[0].registration = "2";
    expect(() => buildIntegratedAdvanceSummary(second.advance, second.events)).toThrow("matrículas");
    const third = reports();
    third.events.employees[0].employeeName = "OUTRA PESSOA";
    expect(() => buildIntegratedAdvanceSummary(third.advance, third.events)).toThrow("nomes");
    const fourth = reports();
    fourth.events.employees[0].months[0].inPayroll = false;
    expect(() => buildIntegratedAdvanceSummary(fourth.advance, fourth.events)).toThrow("presença");
  });

  it("rejects pending issues even if the issue counter was tampered with", () => {
    const { advance, events } = reports();
    events.employees[0].months[0].indemnity901.issue = "Quantidade inconsistente";
    expect(() => buildIntegratedAdvanceSummary(advance, events)).toThrow("pendências");
  });

  it("rejects oversized identities, missing employees and inconsistent totals", () => {
    const first = reports();
    first.events.employees[0].employeeName = "A".repeat(513);
    expect(() => buildIntegratedAdvanceSummary(first.advance, first.events)).toThrow("512");
    const second = reports();
    second.events.employees = [];
    expect(() => buildIntegratedAdvanceSummary(second.advance, second.events)).toThrow("ausentes");
    const third = reports();
    third.events.grandTotalCents = "2001";
    expect(() => buildIntegratedAdvanceSummary(third.advance, third.events)).toThrow("totais");
    const fourth = reports();
    fourth.events.employees[0].months[0].bonus565.differenceCents = "2000";
    expect(() => buildIntegratedAdvanceSummary(fourth.advance, fourth.events)).toThrow("mensais");
    const fifth = reports();
    fifth.advance.competencies.push(fifth.advance.competencies[0]);
    fifth.events.competencies.push(fifth.events.competencies[0]);
    expect(() => buildIntegratedAdvanceSummary(fifth.advance, fifth.events)).toThrow("repetidas");
  });
});
