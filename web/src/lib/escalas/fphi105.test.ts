import { describe, expect, it } from "vitest";
import { previewFphi105Import, mergeAbsenceAssignments, parseFphi105Report } from "./fphi105";
import type { AbsenceImportOptions } from "./fphi105";
import type { EscalaAssignment } from "./types";

const header = "Empresa,Tipo,Cadastro,Nome,Função,Admissão,Afastamento,CID,Situação,Término,Dias";
const options: AbsenceImportOptions = { startDate: "2026-10-26", endDate: "2026-12-06", visibleMonth: "2026-11", employees: [{ id: "p1", registration: "0001" }] };
function row(registration = "1", start = "02/11/2026", end = "04/11/2026", status = "Férias", company = "0001", statusCode = "2") {
  return [company, "1", registration, "Pessoa sintética", "Operador", "01/01/2020", start, "MEDICAL-CODE-DO-NOT-RETURN", "MEDICAL-TEXT-DO-NOT-RETURN", statusCode, status, end, "999"].map((value) => JSON.stringify(value)).join(",");
}
function preview(records = [row()], settings = options) {
  return previewFphi105Import(Buffer.from(["Período,01/11/2026,a,30/11/2026", header, ...records].join("\n")), settings);
}

const decemberPeriod = { startDate: "2026-12-01", endDate: "2026-12-31" };
const decemberOptions: AbsenceImportOptions = {
  ...decemberPeriod, branchCode: "07", visibleMonth: "2026-12",
  employees: [{ id: "p1", registration: "0001" }, { id: "p2", registration: "0002" }],
};
function decemberPage(page: number, sections: { branch: string; records: string[] }[]) {
  return [
    `0001,Empresa sintética,Pág.:,${page},FPHI105`,
    "Período :,01/12/2026,a,31/12/2026",
    ...sections.flatMap(({ branch, records }) => [`"${branch}.01 , FILIAL SINTÉTICA, SETOR SINTÉTICO"`, header, ...records]),
  ].join("\r\n");
}
const decemberReport = (...pages: string[]) => Buffer.from(pages.join("\r\n"), "latin1");

describe("FPHI105 reports with page and branch sections", () => {
  it.each(["", "00/00/0000"])("keeps an undated return (%j) as null in the report and projects only through the requested horizon", (end) => {
    const buffer = decemberReport(
      decemberPage(1, [{ branch: "07", records: [row("0001", "29/12/2026", end)] }]),
      decemberPage(2, [{ branch: "08", records: [row("0002", "30/12/2026", end)] }]),
      decemberPage(3, [{ branch: "07", records: [row("0003", "31/12/2026", "31/12/2026")] }]),
    );
    const report = parseFphi105Report(buffer);
    expect(report).toMatchObject({ hasBranchSections: true, reportPeriod: decemberPeriod, totalRows: 3, invalidRows: 0, unrecognizedRows: 0 });
    expect(report.records).toEqual([
      { line: 5, companyCode: "0001", employmentType: "1", branchCode: "07", registration: "0001", startDate: "2026-12-29", endDate: null },
      { line: 10, companyCode: "0001", employmentType: "1", branchCode: "08", registration: "0002", startDate: "2026-12-30", endDate: null },
      { line: 15, companyCode: "0001", employmentType: "1", branchCode: "07", registration: "0003", startDate: "2026-12-31", endDate: "2026-12-31" },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/MEDICAL|Pessoa|Operador|Férias|2020|999/);

    const cropped = previewFphi105Import(buffer, { ...decemberOptions, endDate: "2026-12-30" });
    expect(cropped.assignments).toEqual(["2026-12-29", "2026-12-30"].map((date) => ({ employeeId: "p1", date, kind: "ABSENCE" })));
    expect(cropped.reportPeriod).toEqual(decemberPeriod);
    expect(cropped.counts).toMatchObject({ matchedRows: 1, openEndedRows: 1, invalidRows: 0, unmatchedRows: 0 });
    expect(cropped.issues).toContainEqual(expect.objectContaining({ line: 5, code: "OPEN_ENDED_ABSENCE" }));

    const full = previewFphi105Import(buffer, decemberOptions);
    expect(full.assignments.map((entry) => entry.date)).toEqual(["2026-12-29", "2026-12-30", "2026-12-31"]);
    expect(full.counts).toMatchObject({ unmatchedRows: 1, outsidePeriodRows: 0 });
    expect(full.issues).toContainEqual(expect.objectContaining({ line: 15, code: "UNMATCHED_REGISTRATION" }));
  });

  it("projects only the selected branch even when another branch contains a matrícula known to the rascunho", () => {
    const buffer = decemberReport(decemberPage(1, [
      { branch: "08", records: [row("0001", "20/12/2026", "")] },
      { branch: "07", records: [row("0002", "30/12/2026", "30/12/2026")] },
    ]));
    const result = previewFphi105Import(buffer, decemberOptions);
    expect(result.assignments).toEqual([{ employeeId: "p2", date: "2026-12-30", kind: "ABSENCE" }]);
    expect(result.counts).toMatchObject({ matchedRows: 1, unmatchedRows: 0, openEndedRows: 0, days: 1 });
  });

  it("does not claim another branch for an unknown matrícula in a report without branch sections", () => {
    const buffer = Buffer.from(["Período,01/12/2026,a,31/12/2026", header, row("0001", "31/12/2026", ""), row("0003", "31/12/2026", "")].join("\n"));
    expect(parseFphi105Report(buffer).hasBranchSections).toBe(false);
    const result = previewFphi105Import(buffer, decemberOptions);
    expect(result.assignments).toEqual([{ employeeId: "p1", date: "2026-12-31", kind: "ABSENCE" }]);
    expect(result.counts).toMatchObject({ matchedRows: 1, unmatchedRows: 1 });
    expect(result.issues).toContainEqual(expect.objectContaining({ line: 4, code: "UNMATCHED_REGISTRATION" }));
  });

  it("flags missing report pages as incomplete even when the remaining absence data matches", () => {
    const buffer = decemberReport(
      decemberPage(1, [{ branch: "07", records: [row("0001", "30/12/2026", "")] }]),
      decemberPage(3, [{ branch: "07", records: [row("0002", "31/12/2026", "")] }]),
    );
    const report = parseFphi105Report(buffer);
    expect(report.unrecognizedRows).toBeGreaterThan(0);
    expect(report.issues).toContainEqual(expect.objectContaining({ line: 6, code: "INVALID_REPORT_PAGE" }));
    expect(previewFphi105Import(buffer, decemberOptions).replacement?.unrecognizedRows).toBe(report.unrecognizedRows);
  });

  it("does not inherit the previous page's branch or accept a row from a different company", () => {
    const buffer = decemberReport(
      decemberPage(1, [{ branch: "07", records: [
        row("0001", "31/12/2026", ""),
        row("0002", "31/12/2026", "", "Férias", "0002"),
      ] }]),
      [decemberPage(2, []), header, row("0002", "31/12/2026", "")].join("\r\n"),
    );
    const report = parseFphi105Report(buffer);
    expect(report.records.map((record) => record.registration)).toEqual(["0001"]);
    expect(report.issues).toEqual(expect.arrayContaining([6, 10].map((line) => expect.objectContaining({ line, code: "INVALID_REPORT_CONTEXT" }))));
    expect(previewFphi105Import(buffer, decemberOptions).assignments).toEqual([{ employeeId: "p1", date: "2026-12-31", kind: "ABSENCE" }]);
  });

  it("keeps the Término day inclusive when a later report supplies the end of an open absence", () => {
    const report = (end: string) => decemberReport(decemberPage(1, [{ branch: "07", records: [row("0001", "27/12/2026", end)] }]));
    const open = report("");
    expect(parseFphi105Report(open).records[0]?.endDate).toBeNull();
    expect(previewFphi105Import(open, decemberOptions).counts).toMatchObject({ openEndedRows: 1, days: 5 });

    const closed = report("29/12/2026");
    expect(parseFphi105Report(closed).records[0]?.endDate).toBe("2026-12-29");
    const result = previewFphi105Import(closed, decemberOptions);
    expect(result.assignments.map((entry) => entry.date)).toEqual(["2026-12-27", "2026-12-28", "2026-12-29"]);
    expect(result.counts).toMatchObject({ openEndedRows: 0, days: 3 });
    expect(result.issues.some((entry) => entry.code === "OPEN_ENDED_ABSENCE")).toBe(false);
  });

  it.each([["8", "Lic. s/ Remuneração"], ["17", "Aposent. Invalidez"], ["368", "Detenção"]])(
    "recognizes the report's open-ended absence status %s without returning its description",
    (code, status) => {
      const buffer = decemberReport(decemberPage(1, [{ branch: "07", records: [row("0001", "31/12/2026", "", status, "0001", code)] }]));
      const report = parseFphi105Report(buffer);
      expect(report.records).toEqual([expect.objectContaining({ registration: "0001", startDate: "2026-12-31", endDate: null })]);
      expect(report.invalidRows).toBe(0);
      expect(JSON.stringify(report)).not.toContain(status);
      expect(previewFphi105Import(buffer, decemberOptions).assignments).toEqual([{ employeeId: "p1", date: "2026-12-31", kind: "ABSENCE" }]);
    },
  );
});

describe("optional FPHI105 absence import", () => {
  it("exposes numeric fallback and unknown lines as structured replacement metadata", () => {
    const result = preview([row(), "truncated,record"]);
    expect(result.replacement).toEqual({ unrecognizedRows: 1, numericMatches: [{ line: 3, employeeId: "p1" }] });
    expect(preview([row("0001")]).replacement?.numericMatches).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("MEDICAL");
  });
  it("reads actual thirteen-column rows below the eleven-column report header, includes the termination and ignores admission/days/medical fields", () => {
    const result = preview();
    expect(result.assignments).toEqual([2, 3, 4].map((day) => ({ employeeId: "p1", date: `2026-11-0${day}`, kind: "ABSENCE" })));
    expect(result.counts).toMatchObject({ totalRows: 1, matchedRows: 1, employees: 1, days: 3, invalidRows: 0 });
    expect(result.reportPeriod).toEqual({ startDate: "2026-11-01", endDate: "2026-11-30" });
    expect(result.issues).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/MEDICAL|Pessoa|Operador|2020|999/);
  });
  it("accepts UTF-8 BOM, quoted comma cells and Windows-1252 reports", () => {
    const content = [header, row().replace("Pessoa sintética", "Pessoa, sintética")].join("\r\n");
    expect(previewFphi105Import(Buffer.from(`\uFEFF${content}`), options).counts.days).toBe(3);
    expect(previewFphi105Import(Buffer.from(content, "latin1"), options).counts.days).toBe(3);
  });
  it("clips to the technical horizon, not just the visible month", () => {
    const result = preview([row("1", "20/10/2026", "28/10/2026"), row("1", "04/12/2026", "15/12/2026")]);
    expect(result.assignments.map((item) => item.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-12-04", "2026-12-05", "2026-12-06"]);
  });
  it("deduplicates overlapping rows without extending the reported period", () => {
    expect(preview([row(), row("1", "03/11/2026", "05/11/2026")]).counts).toMatchObject({ matchedRows: 2, days: 4, employees: 1 });
  });
  it("reports unmatched registrations without matching names", () => {
    const result = preview([row("99")]);
    expect(result.counts).toMatchObject({ unmatchedRows: 1, days: 0 });
    expect(result.assignments).toEqual([]);
  });
  it("rejects ambiguous numeric registrations but accepts an exact unambiguous registration", () => {
    const employees = [{ id: "p1", registration: "0001" }, { id: "p2", registration: "01" }];
    expect(preview([row("1")], { ...options, employees }).counts.ambiguousRows).toBe(1);
    expect(preview([row("0001")], { ...options, employees }).assignments.every((item) => item.employeeId === "p1")).toBe(true);
  });
  it("does not guess across companies or employee types sharing a registration", () => {
    const result = preview([row(), row("1", "02/11/2026", "04/11/2026", "Férias", "0002")]);
    expect(result.counts).toMatchObject({ ambiguousRows: 2, days: 0 });
  });
  it.each(["", "00/00/0000"])("marks an open-ended absence explicitly (%s), never derives a termination from days", (end) => {
    const result = preview([row("1", "04/12/2026", end)]);
    expect(result.assignments.map((item) => item.date)).toEqual(["2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(result.counts.openEndedRows).toBe(1);
    expect(result.issues[0].code).toBe("OPEN_ENDED_ABSENCE");
  });
  it.each([["31/11/2026", "04/12/2026"], ["05/11/2026", "04/11/2026"], ["02/11/2026", "31/11/2026"]])("rejects invalid/reversed dates %s to %s", (start, end) => {
    expect(preview([row("1", start, end)]).counts).toMatchObject({ invalidRows: 1, days: 0 });
  });
  it("ignores active or unknown situations instead of inventing an absence", () => {
    expect(preview([row("1", "02/11/2026", "04/11/2026", "Trabalhando")]).counts).toMatchObject({ invalidRows: 1, days: 0 });
  });
  it("supports explicit non-vacation leaves and reports rows outside the horizon", () => {
    const result = preview([row("1", "02/11/2026", "04/11/2026", "Licença maternidade"), row("1", "01/01/2027", "03/01/2027")]);
    expect(result.counts).toMatchObject({ matchedRows: 1, outsidePeriodRows: 1, days: 3 });
  });
  it("classifies future open-ended absences as outside the horizon, not invalid dates", () => {
    const result = preview([row("1", "01/01/2027", "")]);
    expect(result.counts).toMatchObject({ outsidePeriodRows: 1, invalidRows: 0, days: 0 });
    expect(result.issues).toEqual([]);
  });
  it.each([
    ["Lic.Médica 15 d. Ac.Trab", "02/11/2026", "04/11/2026", ["2026-11-02", "2026-11-03", "2026-11-04"]],
    ["Lic.Medica - 15 Dias", "01/11/2026", "01/11/2026", ["2026-11-01"]],
  ])("accepts the medical leave abbreviation %s and uses only the inclusive reported dates", (status, start, end, dates) => {
    const result = preview([row("1", start, end, status)]);
    expect(result.assignments.map((item) => item.date)).toEqual(dates);
    expect(result.assignments.every((item) => item.kind === "ABSENCE")).toBe(true);
    expect(result.counts).toMatchObject({ matchedRows: 1, invalidRows: 0, days: dates.length });
    expect(result.issues).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/MEDICAL|Pessoa|Operador|Lic\.|999/);
  });
  it.each(["Lic. prêmio", "Lic. remunerada", "Lic.Medicação", "Lic.Medical"])("does not treat the unrelated abbreviation %s as medical leave", (status) => {
    expect(preview([row("1", "02/11/2026", "04/11/2026", status)]).counts).toMatchObject({ invalidRows: 1, days: 0 });
  });

  it("warns about a report/month mismatch rather than silently changing the planning month", () => {
    const result = preview([row()], { ...options, visibleMonth: "2026-10" });
    expect(result.issues[0].code).toBe("REPORT_PERIOD_MISMATCH");
    expect(result.counts.days).toBe(3);
  });
  it("flags malformed employee rows and distinguishes an empty report from an unknown layout", () => {
    expect(preview(["0001,1,1,incomplete"]).counts.invalidRows).toBe(1);
    expect(preview([]).issues[0].code).toBe("NO_ABSENCE_ROWS");
    expect(() => previewFphi105Import(Buffer.from("not a report"), options)).toThrow(/FPHI105/);
  });
  it("bounds upload size, dates, rows and period before generating assignments", () => {
    expect(() => previewFphi105Import(Buffer.from("x".repeat(513 * 1024)), options)).toThrow(/512 KB/);
    expect(() => preview([], { ...options, startDate: "2026-02-30" })).toThrow(/42 dias/);
    expect(() => preview([], { ...options, endDate: "2026-12-07" })).toThrow(/42 dias/);
    expect(() => previewFphi105Import(Buffer.from(`${header}\n${Array(5001).fill("a").join("\n")}`), options)).toThrow(/5.000/);
    expect(() => previewFphi105Import(Buffer.from(`${header}\0`), options)).toThrow(/válido/);
  });
});

describe("absence preview application", () => {
  it("preserves every existing absence, replaces unlocked work/off and is idempotent without mutating inputs", () => {
    const existing: EscalaAssignment[] = [{ employeeId: "p1", date: "2026-11-02", kind: "WORK", shiftId: "original" }, { employeeId: "p1", date: "2026-11-03", kind: "ABSENCE", locked: true }, { employeeId: "p1", date: "2026-11-04", kind: "OFF" }, { employeeId: "p1", date: "2026-11-10", kind: "ABSENCE" }];
    const before = JSON.stringify(existing), incoming = preview().assignments;
    const result = mergeAbsenceAssignments(existing, incoming);
    expect(result.conflicts).toEqual([]);
    expect(result.assignments).toHaveLength(4);
    expect(result.assignments.find((item) => item.date === "2026-11-03")).toEqual(existing[1]);
    expect(result.assignments.every((item) => item.kind === "ABSENCE")).toBe(true);
    expect(mergeAbsenceAssignments(result.assignments, incoming)).toEqual(result);
    expect(JSON.stringify(existing)).toBe(before);
  });
  it.each(["WORK", "DUTY", "OFF"] as const)("does not overwrite locked %s and returns one actionable conflict per day", (kind) => {
    const existing: EscalaAssignment[] = [{ employeeId: "p1", date: "2026-11-02", kind, locked: true }];
    const incoming: EscalaAssignment[] = [{ employeeId: "p1", date: "2026-11-02", kind: "ABSENCE" }];
    expect(mergeAbsenceAssignments(existing, [...incoming, ...incoming])).toEqual({ assignments: existing, conflicts: [{ employeeId: "p1", date: "2026-11-02" }] });
  });
});
