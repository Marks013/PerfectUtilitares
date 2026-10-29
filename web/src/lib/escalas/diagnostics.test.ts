import { describe, expect, it } from "vitest";
import { buildEscalaDiagnostics } from "./diagnostics";
import type { EscalaEmployee, EscalaInput, EscalaIssue } from "./types";

function person(id: string, role = "Padeiro"): EscalaEmployee {
  return { id, registration: id, name: "Pessoa de teste", sector: "Padaria", role, weeklyHours: 40, shiftIds: ["day"], activeFrom: "",
    offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] };
}
function fixture(): EscalaInput {
  return { schemaVersion: 1, branchCode: "01", branchName: "Filial de teste", startDate: "2026-10-26", endDate: "2026-12-06", visibleMonth: "2026-11", defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
    policy: { source: "", validFrom: "2026-01-01", validUntil: "2026-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false,
      coverageReview: "SUGGESTED", minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
    employees: [person("p1"), person("p2", "Balconista"), { ...person("duty"), scheduleMode: "MISSING", shiftIds: [] }, { ...person("excluded"), planningEnabled: false }],
    shifts: [{ id: "day", name: "Horário de teste", segments: [{ start: 480, end: 600, kind: "WORK" }, { start: 600, end: 630, kind: "PAID_BREAK" }, { start: 630, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 960, kind: "WORK" }] }],
    demands: [], assignments: [{ employeeId: "p1", date: "2026-11-02", kind: "WORK", shiftId: "day" }, { employeeId: "p2", date: "2026-11-02", kind: "WORK", shiftId: "day" }, { employeeId: "duty", date: "2026-11-02", kind: "DUTY" }, { employeeId: "excluded", date: "2026-11-02", kind: "WORK", shiftId: "day" }] };
}

describe("actionable Escalas diagnostics", () => {
  it("does not label an estimate as a mandatory minimum because of a legacy global review flag", () => {
    const input = fixture(); input.policy.coverageReview = "CONFIRMED";
    input.demands = [{ id: "auto", date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 480, end: 600, minimum: 2, estimated: true }];
    expect(buildEscalaDiagnostics(input, []).coverage[0].estimated).toBe(true);
    input.demands[0].estimated = false;
    expect(buildEscalaDiagnostics(input, []).coverage[0].estimated).toBe(false);
  });
  it("reports every exact deficit interval by role without counting pauses, untimed or excluded people", () => {
    const input = fixture();
    input.demands = [480, 540, 600, 630, 720, 780].map((start, index) => ({ id: String(index), date: "2026-11-02", sector: "Padaria", role: "Padeiro", start, end: [540, 600, 630, 720, 780, 840][index], minimum: 2, estimated: true }));
    const before = structuredClone(input), result = buildEscalaDiagnostics(input, []);
    expect(result.coverage).toEqual([
      { date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 480, end: 600, present: 1, minimum: 2, missing: 1, estimated: true },
      { date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 600, end: 630, present: 0, minimum: 2, missing: 2, estimated: true },
      { date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 630, end: 720, present: 1, minimum: 2, missing: 1, estimated: true },
      { date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 720, end: 780, present: 0, minimum: 2, missing: 2, estimated: true },
      { date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 780, end: 840, present: 1, minimum: 2, missing: 1, estimated: true },
    ]);
    expect(input).toEqual(before);
  });

  it("never merges across holes, roles, minima, actual counts or estimate status", () => {
    const input = fixture();
    input.demands = [
      { id: "a", date: "2026-11-02", sector: "Padaria", start: 480, end: 540, minimum: 3, estimated: true },
      { id: "b", date: "2026-11-02", sector: "Padaria", start: 600, end: 630, minimum: 3, estimated: true },
      { id: "c", date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 480, end: 540, minimum: 3, estimated: true },
      { id: "d", date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 540, end: 600, minimum: 4, estimated: true },
      { id: "e", date: "2026-11-02", sector: "Padaria", role: "Padeiro", start: 480, end: 540, minimum: 3, estimated: false },
    ];
    const rows = buildEscalaDiagnostics(input, []).coverage;
    expect(rows).toHaveLength(5);
    expect(rows.some(row => !row.role && row.start === 480 && row.end === 540 && row.present === 2)).toBe(true);
    expect(rows.filter(row => row.role === "Padeiro" && row.start === 480).map(row => row.estimated).sort()).toEqual([false, true]);
  });

  it("partitions overlapping identical demands without adding fictitious requirements", () => {
    const input = fixture();
    input.demands = [{ id: "a", date: "2026-11-02", sector: "Padaria", start: 480, end: 600, minimum: 3, estimated: true }, { id: "b", date: "2026-11-02", sector: "Padaria", start: 540, end: 600, minimum: 4, estimated: true }];
    expect(buildEscalaDiagnostics(input, []).coverage.map(row => [row.start, row.end, row.minimum, row.missing])).toEqual([[480, 540, 3, 1], [540, 600, 4, 2]]);
  });

  it("counts real overnight boundary work once, including prior published context", () => {
    const input = fixture(), employee = person("p1");
    input.shifts = [{ id: "night", name: "Noturno", segments: [{ start: 1320, end: 1500, kind: "WORK" }] }];
    employee.shiftIds = ["night"];
    employee.planningHistory = [{ employeeId: "p1", date: "2026-10-31", kind: "WORK", shiftId: "night" }];
    employee.history = [...employee.planningHistory];
    input.employees = [employee]; input.assignments = [...employee.history];
    input.demands = [{ id: "night-gap", date: "2026-11-01", sector: "Padaria", start: 0, end: 120, minimum: 1 }];
    expect(buildEscalaDiagnostics(input, []).coverage).toEqual([{ date: "2026-11-01", sector: "Padaria", start: 60, end: 120, present: 0, minimum: 1, missing: 1, estimated: false }]);
  });

  it("keeps confirmed estimates hard and ignores technical dates outside the displayed month", () => {
    const input = fixture(); input.policy.coverageReview = "CONFIRMED";
    input.demands = ["2026-10-31", "2026-11-01", "2026-12-01"].map((date, index) => ({ id: String(index), date, sector: "Padaria", start: 480, end: 600, minimum: 1, estimated: false }));
    expect(buildEscalaDiagnostics(input, []).coverage).toEqual([{ date: "2026-11-01", sector: "Padaria", start: 480, end: 600, present: 0, minimum: 1, missing: 1, estimated: false }]);
  });

  it("summarizes global history and documents once while preserving concrete critical dates and identities", () => {
    const input = fixture();
    const issues: EscalaIssue[] = [
      ...["p1", "p2", "duty"].map(employeeId => ({ code: "HISTORY_UNVERIFIED", severity: "WARNING" as const, employeeId, date: input.startDate, message: "Histórico anterior não conferido." })),
      { code: "POLICY_PENDING", severity: "PENDING", message: "Documento não conferido." },
      { code: "WORK_STREAK", severity: "ERROR", employeeId: "p1", date: "2026-11-02", message: "Sequência de 7 jornadas; máximo de 6." },
      { code: "WORK_STREAK", severity: "ERROR", employeeId: "p1", date: "2026-11-09", message: "Sequência de 7 jornadas; máximo de 6." },
      { code: "INTER_SHIFT_REST", severity: "ERROR", employeeId: "p2", date: "2026-10-31", message: "Descanso de 500 minutos; mínimo de 660." },
    ];
    const before = structuredClone(issues), result = buildEscalaDiagnostics(input, issues);
    const history = result.notices.filter(notice => notice.code === "HISTORY_UNVERIFIED");
    expect(history).toHaveLength(1); expect(history[0].employeeIds.sort()).toEqual(["duty", "p1", "p2"]);
    expect(result.notices.find(notice => notice.code === "WORK_STREAK")).toMatchObject({ dates: ["2026-11-02", "2026-11-09"], employeeIds: ["p1"], count: 2 });
    expect(result.technicalIssueCount).toBe(1);
    expect(result.totalIssueCount).toBe(7);
    expect(issues).toEqual(before);
  });

  it("avoids duplicating raw coverage messages once exact actionable intervals are available", () => {
    const input = fixture(); input.demands = [{ id: "gap", date: "2026-11-02", sector: "Padaria", start: 480, end: 600, minimum: 3, estimated: true }];
    const result = buildEscalaDiagnostics(input, [{ code: "ESTIMATED_COVERAGE_GAP", severity: "PENDING", date: "2026-11-02", message: "Mensagem resumida e incompleta." }]);
    expect(result.coverage).toHaveLength(1); expect(result.notices).toEqual([]);
  });

  it("keeps an empty large proposal as one actionable generation notice instead of a wall of pending days", () => {
    const input = fixture(); input.assignments = [];
    const issues: EscalaIssue[] = Array.from({ length: 4000 }, (_, index) => ({ code: "DAY_PENDING", severity: "PENDING", employeeId: `person-${index % 160}`, date: "2026-11-02", message: "Dia de vínculo ainda sem trabalho, folga ou ausência definido." }));
    const result = buildEscalaDiagnostics(input, issues);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatchObject({ code: "DAY_PENDING", label: "Escala ainda não gerada", message: "Gere a proposta para definir trabalho e folgas.", global: true, count: 4000 });
    expect(result.notices[0].employeeIds).toHaveLength(160);
  });


  it("merges overlapping schedule-limit notices across severities without diluting the strongest warning", () => {
    const input = fixture();
    const result = buildEscalaDiagnostics(input, [
      { code: "MISSING_SCHEDULE", severity: "PENDING", employeeId: "p1", message: "Horário não informado." },
      { code: "UNTIMED_REST_UNVERIFIED", severity: "WARNING", employeeId: "p1", message: "Horas não apuradas." },
      { code: "UNTIMED_REST_UNVERIFIED", severity: "WARNING", employeeId: "duty", message: "Horas não apuradas." },
    ]);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatchObject({ code: "SCHEDULE_UNVERIFIED", severity: "PENDING", global: true, count: 3, employeeIds: ["duty", "p1"] });
  });

  it("summarizes missing holiday evidence in a simulation but never hides a concrete strict-mode holiday conflict", () => {
    const input = fixture(); input.simulation = true;
    const issues: EscalaIssue[] = ["p1", "p2"].map(employeeId => ({ code: "HOLIDAY_WORK", severity: "PENDING", employeeId, date: "2026-11-02", message: "Trabalho em feriado sem autorização registrada." }));
    expect(buildEscalaDiagnostics(input, issues).notices).toHaveLength(1);
    input.simulation = false;
    const strict = buildEscalaDiagnostics(input, issues.map(issue => ({ ...issue, severity: "ERROR" })));
    expect(strict.notices).toHaveLength(2);
    expect(strict.notices.every(notice => !notice.global && notice.dates[0] === "2026-11-02")).toBe(true);
  });

});
