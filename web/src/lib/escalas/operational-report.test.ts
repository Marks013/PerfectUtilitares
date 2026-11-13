import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { operationalReportOptionsSchema } from "./operational-report-contracts";
import { buildOperationalReport, operationalReportContext, coverageObservation, coverageReportRows } from "./operational-report";
import type { EscalaWorkspace } from "./types";

function fixture(): EscalaWorkspace {
  const input = newInput("06", "Loja sintética", "2026-12", 42);
  input.visibleMonth = "2026-12";
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 900, kind: "BREAK" }, { start: 900, end: 1200, kind: "WORK" }] }];
  input.employees = [{ ...newEmployee(42, "day"), id: "a", registration: "01", name: "Pessoa A", sector: "Setor A", role: "Atendente" },
    { ...newEmployee(42, "day"), id: "b", registration: "02", name: "Pessoa B", sector: "Setor A", role: "Encarregado", scheduleMode: "UNTIMED", shiftIds: [] }];
  input.assignments = [{ employeeId: "a", date: "2026-12-01", kind: "WORK", shiftId: "day" }, { employeeId: "b", date: "2026-12-01", kind: "DUTY" }];
  return { id: "synthetic", revision: 19, status: "DRAFT", input, canEdit: true, canPublish: false, updatedAt: "2026-12-01", validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null } };
}
describe("read-only operational report adapter", () => {
  it("exposes a manual period and excluded TIMED references without operational attendance", () => {
    const workspace = fixture(); workspace.input.assignments = [];
    workspace.input.shifts.push({ id: "manual", name: "Selected", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 720, kind: "BREAK" }, { start: 720, end: 984, kind: "WORK" }] });
    workspace.input.employees[0].manualShiftOverrides = [{ catalogCode: 1500, shiftId: "manual", markings: ["07:00", "11:00", "12:00", "16:24"], effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-31" }];
    workspace.input.employees[0].planningEnabled = false;
    const before = structuredClone(workspace);
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["journeys", "variants"] });
    const model = buildOperationalReport(workspace, options);
    const person = model.people.find(row => row.employee.id === "a");
    expect(person?.proposedVariants.map(v => v.shiftId)).toEqual(["manual"]);
    expect(person?.proposedSchedule).toContain("Referência manual");
    expect(person?.proposedSchedule).toMatch(/01\/12\/2026.*31\/12\/2026/);
    expect(model.operations.days).toEqual([]); expect(model.presence).toEqual([]); expect(model.dates).toEqual([]);
    expect(workspace).toEqual(before);
  });
  it.each(["REST_ONLY", "DAYS_AND_HOURS", "HOURS_ONLY"] as const)("keeps real roster clocks and DUTY in %s without changing input", generationMode => {
    const workspace = fixture(), before = structuredClone(workspace);
    workspace.input.generationMode = generationMode;
    before.input.generationMode = generationMode;
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["summary", "presence"], date: "2026-12-01" });
    const model = buildOperationalReport(workspace, options);
    expect(model.dates).toHaveLength(31); expect(model.dates[0]).toBe("2026-12-01");
    expect(model.presence.find(row => row.employeeId === "a")?.segments).toContainEqual({ start: 720, end: 900, kind: "BREAK" });
    expect(model.presence.find(row => row.employeeId === "b")?.segments).toEqual([]);
    expect(model.operations.days.find(day => day.date === "2026-12-01")?.counts.duty).toBe(1);
    expect(workspace).toEqual(before);
  });
  it.each([["2026-02", 28], ["2028-02", 29], ["2026-11", 30], ["2026-12", 31]] as const)("uses the real visible dates in %s", (month, count) => {
    const workspace = fixture(), previous = workspace.input;
    workspace.input = { ...newInput("06", "Loja sintética", month, 42), visibleMonth: month, shifts: previous.shifts, employees: previous.employees,
      assignments: [{ employeeId: "a", date: month + "-01", kind: "WORK", shiftId: "day" }] };
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month, sections: ["calendar"] });
    const model = buildOperationalReport(workspace, options);
    expect(model.dates).toHaveLength(count); expect(model.dates.every(date => date.startsWith(month))).toBe(true);
  });
  it("keeps midnight spill canonical, unknown clocks empty, and AF/HOLIDAY distinct", () => {
    const workspace = fixture();
    workspace.input.shifts.push({ id: "night", name: "Noturno", segments: [{ start: 1320, end: 1800, kind: "WORK" }] });
    workspace.input.assignments.push({ employeeId: "a", date: "2026-11-30", kind: "WORK", shiftId: "night" },
      { employeeId: "a", date: "2026-12-02", kind: "ABSENCE" }, { employeeId: "a", date: "2026-12-25", kind: "HOLIDAY" });
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["summary", "presence"], date: "2026-12-01" });
    const model = buildOperationalReport(workspace, options);
    expect(model.presence.find(row => row.employeeId === "a")?.segments).toContainEqual({ start: 0, end: 360, kind: "WORK" });
    expect(model.operations.days.find(day => day.date === "2026-12-02")?.counts.absence).toBe(1);
    expect(model.operations.days.find(day => day.date === "2026-12-25")?.counts.holiday).toBe(1);
    workspace.input.employees[0].scheduleMode = "MISSING";
    expect(buildOperationalReport(workspace, options).presence.find(row => row.employeeId === "a")?.segments).toEqual([]);
  });
  it.each(["REST_ONLY", "DAYS_AND_HOURS", "HOURS_ONLY"] as const)("exposes only configured references without a roster in %s", generationMode => {
    const workspace = fixture(); workspace.input.generationMode = generationMode; workspace.input.assignments = [];
    const before = structuredClone(workspace);
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["journeys", "variants"] });
    const model = buildOperationalReport(workspace, options);
    expect(model.dates).toEqual([]); expect(model.operations.days).toEqual([]); expect(model.presence).toEqual([]);
    expect(model.people[0].proposedVariants[0].daily).toBe("09:00");
    expect(() => buildOperationalReport(workspace, { ...options, sections: ["calendar"] })).toThrow();
    expect(workspace).toEqual(before);
  });
  it("rejects stale identity/month/sector and infers old monthly revisions canonically", () => {
    const workspace = fixture(); delete workspace.input.visibleMonth;
    expect(operationalReportContext(workspace).visibleMonth).toBe("2026-12");
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 18, month: "2026-12", sections: ["journeys"] });
    expect(() => buildOperationalReport(workspace, options)).toThrow();
    expect(() => buildOperationalReport(workspace, { ...options, revision: 19, sectors: ["Other"] })).toThrow();
    workspace.input.startDate = "2026-12-07"; workspace.input.endDate = "2026-12-13";
    expect(() => operationalReportContext(workspace)).toThrow();
  });
  it("identifies the observed limiting function without suggesting a staffing change", () => {
    const workspace = fixture();
    workspace.input.demands = [{ id: "role", date: "2026-12-01", sector: "Setor A", role: "Outra função", start: 540, end: 600, minimum: 1, estimated: false }];
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["coverage"], date: "2026-12-01" });
    const row = coverageReportRows(buildOperationalReport(workspace, options).coverage)[0];
    if (!row?.peak) throw new Error("Expected a known role-limited peak");
    expect(coverageObservation(row)).toContain("Outra função");
    expect(coverageObservation(row)).not.toMatch(/remanejar|contratar/i);
  });
});
