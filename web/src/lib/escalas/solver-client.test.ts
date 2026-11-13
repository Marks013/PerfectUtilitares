import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const secretDirectory = mkdtempSync(join(tmpdir(), "escalas-client-"));
const secretPath = join(secretDirectory, "secret");
writeFileSync(secretPath, "s".repeat(64), { mode: 0o600 });
beforeEach(() => vi.stubEnv("ESCALAS_SOLVER_SECRET_FILE", secretPath));
afterAll(() => rmSync(secretDirectory, { recursive: true }));
import { solveEscala } from "./solver-client";
import { validateEscala } from "./validation";
import * as rosterRefinement from "./roster-refinement";
import * as rosterQuality from "./roster-quality";
import type { EscalaInput } from "./types";
import { materializeManualShiftOverrides, withManualShiftOverride } from "./shift-catalog/manual-override";

import { escalaInputSchema } from "./schema";
function fixture(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "01", branchName: "Matriz",
    startDate: "2026-11-02", endDate: "2026-11-08", defaultWeeklyHours: 42,
    timeZone: "America/Sao_Paulo",
    policy: { source: "Instrumento confirmado no teste", validFrom: "2026-01-01", validUntil: "2026-12-31",
      reviewed: true, reviewedBy: "Responsável", weeklyLimit: 44, dailyLimitMinutes: 528,
      compensationAuthorized: true, limitContinuousWorkBlocks: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100,
      minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [],
      authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
    employees: [{ id: "p1", registration: "01", name: "Pessoa", sector: "Loja", role: "Repositor",
      weeklyHours: 42, shiftIds: ["day"], activeFrom: "2026-11-02", offMode: "VARIABLE", fixedOffDays: [],
      offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }],
    demands: [], assignments: [],
    shifts: [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
  };
}

function completeAssignments(): EscalaInput["assignments"] {
  // Monday rest also separates the scoped Sunday history from five actual workdays.
  return Array.from({ length: 7 }, (_, day) => ({ employeeId: "p1", date: `2026-11-0${day + 2}`,
    ...(day === 0 || day === 6 ? { kind: "OFF" as const } : { kind: "WORK" as const, shiftId: "day" }) }));
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("isolated schedule processor client", () => {
  it("still compares a complete valid incumbent through the real quality selector", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const input = fixture(); input.assignments = completeAssignments();
    const selection = vi.spyOn(rosterQuality, "selectVerifiedRoster");
    const refine = vi.spyOn(rosterRefinement, "refineRoster").mockImplementation(value => value);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: input.assignments, message: "Synthetic", wallTimeSeconds: 1 })));
    try { expect((await solveEscala(input)).assignments).toStrictEqual(input.assignments); expect(selection).toHaveBeenCalled(); }
    finally { selection.mockRestore(); refine.mockRestore(); }
  });
  it("never uses an incomplete absence draft as a verified incumbent over a complete worker result", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const input = fixture(); input.needsRegeneration = true;
    input.employees[0].sourceSchedule = { report: "FPRE136", code: "ORIGINAL", description: "Synthetic source", weekday: "08:00-12:00 / 13:00-17:24", saturday: "08:00-12:00" };
    const absence = { employeeId: "p1", date: "2026-11-05", kind: "ABSENCE" as const };
    const locked = { employeeId: "p1", date: "2026-11-04", kind: "WORK" as const, shiftId: "day", locked: true };
    input.assignments = [locked, absence];
    const initial = validateEscala(input);
    expect(initial.valid).toBe(true);
    expect(initial.issues.some(issue => issue.code === "DAY_PENDING")).toBe(true);
    const complete: EscalaInput["assignments"] = [
      { employeeId: "p1", date: "2026-11-02", kind: "OFF" },
      { employeeId: "p1", date: "2026-11-03", kind: "OFF" }, locked, absence,
      { employeeId: "p1", date: "2026-11-06", kind: "WORK", shiftId: "day" },
      { employeeId: "p1", date: "2026-11-07", kind: "WORK", shiftId: "day" },
      { employeeId: "p1", date: "2026-11-08", kind: "WORK", shiftId: "day" },
    ];
    expect(validateEscala({ ...input, assignments: complete }).valid).toBe(true);
    const before = structuredClone(input);
    const selection = vi.spyOn(rosterQuality, "selectVerifiedRoster");
    const refine = vi.spyOn(rosterRefinement, "refineRoster").mockImplementation(value => value);
    let response = complete;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: response, message: "Synthetic", wallTimeSeconds: 1 })));
    try {
      const result = await solveEscala(input);
      expect(result.assignments).toHaveLength(7);
      expect(result.assignments).toContainEqual(absence); expect(result.assignments).toContainEqual(locked);
      expect(result).toMatchObject({ restQuality: { search: { retainedReference: false } } });
      expect(selection).not.toHaveBeenCalled();
      expect(input).toStrictEqual(before);
      // A complete but invalid worker response still fails independent validation.
      response = complete.map(day => day.kind === "OFF" ? { ...day, kind: "WORK" as const, shiftId: "day" } : day);
      await expect(solveEscala(input)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
    } finally { selection.mockRestore(); refine.mockRestore(); }
  });
  it("preserves established automatic provenance in HOURS_ONLY when Python omits false", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const input = fixture(); input.generationMode = "HOURS_ONLY";
    input.assignments = completeAssignments().map(day => ({ ...day, locked: false }));
    const payload = completeAssignments();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: payload, message: "Synthetic", wallTimeSeconds: 1 })));
    expect((await solveEscala(input)).assignments).toStrictEqual(input.assignments);
    expect(payload.every(day => !("locked" in day))).toBe(true);
  });
  it("keeps legacy/manual ambiguity and every disabled protected record exact", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const input = fixture(); input.assignments = completeAssignments();
    const disabled = { ...structuredClone(input.employees[0]), id: "excluded", registration: "02", planningEnabled: false };
    input.employees.push(disabled);
    const protectedDays: EscalaInput["assignments"] = [
      { employeeId: disabled.id, date: "2026-11-02", kind: "ABSENCE" },
      { employeeId: disabled.id, date: "2026-11-03", kind: "HOLIDAY" },
      { employeeId: disabled.id, date: "2026-11-04", kind: "WORK", shiftId: "day", locked: true },
    ];
    input.assignments.push(...protectedDays);
    const before = structuredClone(input);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: input.assignments, message: "Synthetic", wallTimeSeconds: 1 })));
    const refine = vi.spyOn(rosterRefinement, "refineRoster").mockImplementation(value => value);
    try { expect((await solveEscala(input)).assignments).toStrictEqual(input.assignments); expect(input).toStrictEqual(before); }
    finally { refine.mockRestore(); }
  });
  it.each(["inside", "outside", "outside-lock", "selector"] as const)("rejects a manual clock violation at %s", async boundary => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    let value = fixture();
    value.employees[0].sourceSchedule = { report: "FPRE136", code: "X", description: "CSV", weekday: "08:00-12:00 / 13:00-17:24", saturday: "08:00-12:00" };
    value.employees[0] = withManualShiftOverride(value.employees[0], { catalogCode: 1500, shiftId: "catalog-1500", markings: ["07:00", "11:00", "12:00", "16:24"], effectiveFrom: "2026-11-03", effectiveUntil: "2026-11-04" });
    value = materializeManualShiftOverrides(value);
    let assignments = completeAssignments().map(day => day.kind === "WORK" && day.date >= "2026-11-03" && day.date <= "2026-11-04" ? { ...day, shiftId: "catalog-1500" } : day);
    if (boundary === "selector") {
      value.assignments = structuredClone(assignments);
      expect(validateEscala(value).valid).toBe(true);
      expect(validateEscala(value).issues.some(issue => issue.code === "DAY_PENDING")).toBe(false);
    }
    if (boundary === "inside") assignments = assignments.map(day => day.date === "2026-11-03" ? { ...day, shiftId: "day" } : day);
    if (boundary === "outside") assignments = assignments.map(day => day.date === "2026-11-05" ? { ...day, shiftId: "catalog-1500" } : day);
    if (boundary === "outside-lock") assignments = assignments.map(day => day.date === "2026-11-05" ? { ...day, shiftId: "catalog-1500", locked: true } : day);
    const refinement = vi.spyOn(rosterRefinement, "refineRoster").mockImplementation(input => input);
    const selection = boundary === "selector" ? vi.spyOn(rosterQuality, "selectVerifiedRoster").mockImplementation((_old, proposal) => ({
      input: { ...proposal, assignments: proposal.assignments.map(day => day.date === "2026-11-03" ? { ...day, shiftId: "day" } : day) }, retainedReference: false,
    })).mockImplementationOnce((_reference, proposal) => ({ input: proposal, retainedReference: false })) : undefined;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments, message: "Synthetic", wallTimeSeconds: 1 })));
    try { await expect(solveEscala(value)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" }); }
    finally { selection?.mockRestore(); refinement.mockRestore(); }
  });
  it("rechecks disabled holidays after final roster selection", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const data = fixture();
    data.employees.push({ ...structuredClone(data.employees[0]), id: "excluded", registration: "02", planningEnabled: false });
    const holiday = { employeeId: "excluded", date: "2026-11-04", kind: "HOLIDAY" as const };
    data.assignments = [...completeAssignments(), holiday];
    expect(validateEscala(data).valid).toBe(true);
    expect(validateEscala(data).issues.some(issue => issue.code === "DAY_PENDING")).toBe(false);
    const response = [...completeAssignments(), holiday];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: response, message: "Ready", wallTimeSeconds: 1 })));
    const selection = vi.spyOn(rosterQuality, "selectVerifiedRoster").mockImplementation((_reference, proposal) => ({
      input: { ...proposal, assignments: proposal.assignments.filter(day => day.employeeId !== "excluded") }, retainedReference: false,
    })).mockImplementationOnce((_reference, proposal) => ({ input: proposal, retainedReference: false }));
    try { await expect(solveEscala(data)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" }); }
    finally { selection.mockRestore(); }
  });
  it.each(["DAYS_AND_HOURS", "HOURS_ONLY"] as const)("retains disabled protected records in %s and rejects a missing holiday", async mode => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const data = fixture(); data.generationMode = mode;
    data.employees.push({ ...structuredClone(data.employees[0]), id: "excluded", registration: "02", planningEnabled: false });
    const retained: EscalaInput["assignments"] = [
      { employeeId: "excluded", date: "2026-11-02", kind: "ABSENCE" },
      { employeeId: "excluded", date: "2026-11-03", kind: "ABSENCE", locked: true },
      { employeeId: "excluded", date: "2026-11-04", kind: "HOLIDAY" },
      { employeeId: "excluded", date: "2026-11-05", kind: "HOLIDAY", locked: true },
      { employeeId: "excluded", date: "2026-11-06", kind: "WORK", shiftId: "day", locked: true },
    ];
    const ordinary = { employeeId: "excluded", date: "2026-11-07", kind: "WORK" as const, shiftId: "day" };
    data.assignments = mode === "HOURS_ONLY" ? [...completeAssignments(), ...retained, ordinary] : [...retained, ordinary];
    const expected = [...completeAssignments(), ...retained, ...(mode === "HOURS_ONLY" ? [ordinary] : [])];
    const refine = vi.spyOn(rosterRefinement, "refineRoster").mockImplementation(value => value);
    let response = expected;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: response, message: "Ready", wallTimeSeconds: 1 })));
    try {
      expect((await solveEscala(data)).assignments).toEqual(mode === "HOURS_ONLY" ? expected : [...completeAssignments().map(day => ({ ...day, locked: false })), ...retained]);
      response = expected.filter(day => day.employeeId !== "excluded" || day.date !== "2026-11-04");
      await expect(solveEscala(data)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
      response = expected.map(day => day.employeeId === "excluded" && day.date === "2026-11-04" ? { ...day, kind: "OFF" as const } : day);
      await expect(solveEscala(data)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
      if (mode === "DAYS_AND_HOURS") {
        response = [...expected, ordinary];
        await expect(solveEscala(data)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
      } else {
        response = expected.map(day => day === ordinary ? { ...day, kind: "OFF" as const, shiftId: undefined } : day);
        await expect(solveEscala(data)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
      }
    } finally { refine.mockRestore(); }
  });
  it.each(["json", "schema", "completeness", "preservation", "validation"] as const)("logs a safe internal %s rejection with the same public failure", async scenario => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const sentinel = "PRIVATE_DIAGNOSTIC_SENTINEL";
    const input = fixture(); input.employees[0].name = sentinel; input.employees[0].registration = sentinel;
    if (scenario === "preservation") input.assignments = [{ employeeId: "p1", date: input.startDate, kind: "ABSENCE" }];
    const assignments = scenario === "completeness" ? [] : scenario === "validation"
      ? completeAssignments().map(({ employeeId, date }) => ({ employeeId, date, kind: "OFF" })) : completeAssignments();
    vi.stubGlobal("fetch", vi.fn(async () => scenario === "json" ? new Response(sentinel)
      : Response.json({ status: scenario === "schema" ? sentinel : "FEASIBLE", assignments, message: sentinel, wallTimeSeconds: 1 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(solveEscala(input)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE", message: "O cálculo não passou pela conferência. Sua escala salva foi mantida; tente novamente." });
      const stages = { json: "transport-json", schema: "result-schema", completeness: "completeness", preservation: "preservation", validation: "independent-validation" };
      const codes = { json: "JSON_INVALID", schema: "SCHEMA_INVALID", completeness: "MISSING_ACTIVE_DATE", preservation: "ABSENCE_CHANGED", validation: "RULES_INVALID" };
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "escala_solver_rejected", stage: stages[scenario], code: codes[scenario] }));
      expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    } finally { log.mockRestore(); }
  });
  it("does not emit rejection diagnostics for an unchanged successful response", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Valid", wallTimeSeconds: 1 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await solveEscala(fixture())).assignments).toEqual(completeAssignments().map(day => ({ ...day, locked: false }))); expect(log).not.toHaveBeenCalled(); }
    finally { log.mockRestore(); }
  });
  it("keeps an established draft instead of replacing an unrepaired rest pattern with an unrestricted fallback", async () => {
    const input = fixture(); input.restRulesVersion = 1; input.endDate = "2026-11-15";
    input.shifts[0].segments = [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }];
    input.assignments = Array.from({ length: 14 }, (_, index) => {
      const work = index < 5 || index >= 8 && index <= 12;
      const date = new Date(Date.parse("2026-11-02T12:00:00Z") + index * 86400000).toISOString().slice(0, 10);
      return { employeeId: "p1", date, kind: work ? "WORK" as const : "OFF" as const, ...(work ? { shiftId: "day" } : {}) };
    });
    const before = structuredClone(input), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(validateEscala(input).issues.filter(issue => issue.severity === "ERROR").every(issue => issue.code === "CONSECUTIVE_REST_LIMIT")).toBe(true);
    await expect(solveEscala(input)).rejects.toMatchObject({ code: "ESCALA_REST_REPAIR_PENDING", status: 409 });
    expect(fetch).not.toHaveBeenCalled(); expect(input).toEqual(before);
  });
  it("sends scoped history without repeating IDs and preserves every scheduling field", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const input = fixture();
    // Employment must include the locked planning day and actual work preceding the current horizon.
    input.employees[0].activeFrom = "2026-10-31";
    input.employees[0].history = [{ employeeId: "p1", date: "2026-11-01", kind: "WORK", shiftId: "day", locked: false }];
    input.employees[0].planningHistory = [{ employeeId: "p1", date: "2026-10-31", kind: "OFF", locked: true }];
    input.employees[0].planningFuture = [{ employeeId: "p1", date: "2026-11-09", kind: "ABSENCE" }];
    expect(validateEscala({ ...input, assignments: completeAssignments() }).valid).toBe(true);
    const original = structuredClone(input);
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const sent = JSON.parse(String(options?.body)).input;
      expect(sent.employees[0].history).toEqual([{ date: "2026-11-01", kind: "WORK", shiftId: "day", locked: false }]);
      expect(sent.employees[0].planningHistory).toEqual([{ date: "2026-10-31", kind: "OFF", locked: true }]);
      expect(sent.employees[0].planningFuture).toEqual([{ date: "2026-11-09", kind: "ABSENCE" }]);
      const restored = { ...sent, employees: sent.employees.map((person: EscalaInput["employees"][number]) => ({
        ...person, ...Object.fromEntries(["history", "planningHistory", "planningFuture"].map(key => [
          key, person[key as "history"].map(entry => ({ ...entry, employeeId: person.id })),
        ])),
      })) };
      expect(restored).toEqual({ ...escalaInputSchema.parse(original), storeClosingMinutes: 1200 });
      return Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 1 });
    });
    vi.stubGlobal("fetch", fetch);
    expect((await solveEscala(input)).status).toBe("FEASIBLE");
    expect(input).toEqual(original);
  });

  it.each([
    { branchCode: "018", storeClosingMinutes: undefined, expected: 1320 },
    { branchCode: "18", storeClosingMinutes: 1440, expected: 1440 },
  ])("sends effective closing for $branchCode and accepts a closing coverage phase", async ({ branchCode, storeClosingMinutes, expected }) => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const input = { ...fixture(), branchCode, storeClosingMinutes };
    const optimization = {
      budgetSeconds: 12,
      phases: [{
        objective: "CLOSING_COVERAGE", status: "FEASIBLE", wallTimeSeconds: 0.2,
        budgetSeconds: 0.5, initialValue: 60, incumbentValue: 30,
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect(JSON.parse(String(options?.body)).input.storeClosingMinutes).toBe(expected);
      return Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 1, optimization });
    }));
    expect((await solveEscala(input)).optimization).toEqual(optimization);
  });

  it("rejects an oversized valid schema before sending or waiting for the processor", async () => {
    const input = fixture();
    input.demands = Array.from({ length: 12000 }, (_, index) => ({ id: String(index), date: input.startDate,
      sector: "漢".repeat(160), role: "字".repeat(160), start: 480, end: 600, minimum: 1 }));
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(solveEscala(input)).rejects.toMatchObject({ code: "SOLVER_INPUT_TOO_LARGE" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("classifies HTTP 413 as an input limit instead of a service outage", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 413 })));
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_INPUT_TOO_LARGE" });
  });

  it("reports invalid processor input without treating it as an outage or exposing the payload", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "INVALID_MODEL_INPUT", details: "private payload must not escape" }, { status: 400 })));
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_INVALID_INPUT" });
    await expect(solveEscala(fixture())).rejects.not.toThrow("private payload");
  });

  it("accepts bounded production timings and sufficient conflict families without inventing assignments", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const solverDiagnostics = [{ family: "WEEKLY_MINUTES", message: "Os horários permitidos não completam a jornada semanal." }];
    const optimization = { budgetSeconds: 12, constructionSeconds: 0.1, feasibilitySeconds: 0.2,
      refinementSeconds: 0, stopReason: "INFEASIBLE", phases: [] };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "INFEASIBLE", assignments: [],
      message: "Condições incompatíveis", wallTimeSeconds: 0.3, optimization, solverDiagnostics })));
    const result = await solveEscala(fixture());
    expect(result.assignments).toEqual([]);
    expect(result.solverDiagnostics).toEqual(solverDiagnostics);
    expect(result.optimization).toEqual(optimization);
  });

  it("accepts one joint secondary phase with separate protected objective values", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const optimization = { budgetSeconds: 12, phases: [{ objective: "SECONDARY_POLISH", status: "FEASIBLE", wallTimeSeconds: 1.2, budgetSeconds: 1.5, initialValue: 1200, incumbentValue: 900, searchScope: "SELECTED_PEOPLE", members: [
      { objective: "STABILITY", initialValue: 20, incumbentValue: 18 },
      { objective: "REST_ROTATION", initialValue: -2, incumbentValue: -3 },
    ] }] };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 12, optimization })));
    expect((await solveEscala(fixture())).optimization).toEqual(optimization);
  });

  it.each([
    { objective: "SECONDARY_POLISH" },
    { objective: "SECONDARY_POLISH", members: [{ objective: "STABILITY", initialValue: 5, incumbentValue: 6 }] },
    { objective: "SECONDARY_POLISH", members: [{ objective: "STABILITY", initialValue: 5, incumbentValue: 4 }, { objective: "STABILITY", initialValue: 5, incumbentValue: 4 }] },
    { objective: "SECONDARY_POLISH", members: [{ objective: "SECONDARY_POLISH", initialValue: 5, incumbentValue: 4 }] },
    { objective: "STABILITY", members: [{ objective: "STABILITY", initialValue: 5, incumbentValue: 4 }] },
  ])("rejects invalid or worsening joint phase diagnostics: %j", async details => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 12,
      optimization: { budgetSeconds: 12, phases: [{ status: "FEASIBLE", wallTimeSeconds: 1, budgetSeconds: 1.5, initialValue: 10, incumbentValue: 9, ...details }] },
    })));
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });

  it("reports an unexpected refinement failure without sending, changing or logging personal data", async () => {
    const input = fixture(), original = structuredClone(input);
    const failure = vi.spyOn(rosterRefinement, "refineRoster").mockImplementation(() => { throw new Error("private payload"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      await expect(solveEscala(input)).rejects.toMatchObject({ code: "SOLVER_REFINEMENT_FAILED" });
      expect(input).toEqual(original);
      expect(fetch).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "escala_solver_rejected", stage: "refinement", code: "REFINEMENT_FAILED" }));
      expect(JSON.stringify(log.mock.calls)).not.toContain("private payload");
    } finally { failure.mockRestore(); log.mockRestore(); }
  });

  it("sends a verified better seed with the same demand and preserves the caller's saved roster", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const input = fixture();
    input.shifts[0].segments = [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }];
    input.employees.push({ ...structuredClone(input.employees[0]), id: "p2", registration: "02", name: "Outra pessoa" });
    input.assignments = input.employees.flatMap(person => Array.from({ length: 7 }, (_, index) => ({ employeeId: person.id,
      date: `2026-11-0${index + 2}`, kind: (index === 6 || index === (person.id === "p1" ? 3 : 5) ? "OFF" : "WORK") as "WORK" | "OFF",
      ...(index === 6 || index === (person.id === "p1" ? 3 : 5) ? {} : { shiftId: "day" }),
    })));
    input.demands = [{ id: "morning", date: "2026-11-05", sector: "Loja", start: 480, end: 720, minimum: 2, estimated: true },
      { id: "afternoon", date: "2026-11-05", sector: "Loja", start: 840, end: 1104, minimum: 2, estimated: true }];
    expect(validateEscala(input).valid).toBe(true);
    const original = structuredClone(input);
    let sent: EscalaInput | undefined;
    let seed: EscalaInput["assignments"] | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options?: RequestInit) => {
      sent = JSON.parse(String(options?.body)).input;
      seed = (sent as EscalaInput & { _initialAssignments?: EscalaInput["assignments"] })._initialAssignments;
      return Response.json({ status: "FEASIBLE", assignments: seed, message: "Pronto", wallTimeSeconds: 1 });
    }));
    const result = await solveEscala(input);
    expect(input).toEqual(original);
    expect(sent?.demands).toEqual(input.demands);
    expect(sent?.assignments).toEqual(input.assignments);
    expect(seed).not.toEqual(input.assignments);
    expect(seed?.filter((entry, index) => entry.kind !== input.assignments[index]?.kind)).toHaveLength(4);
    expect(seed?.find(a => a.employeeId === "p1" && a.date === "2026-11-05")?.kind).toBe("WORK");
    expect(result.assignments).toEqual(seed);
    expect(validateEscala({ ...input, assignments: result.assignments }).valid).toBe(true);
  });

  it.each([20, 21])("validates the bounded diagnostic contract with %i phases", async count => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const names = ["COVERAGE", "MOVEMENT_COVERAGE", "COVERAGE", "COVERAGE", "COVERAGE", "SUNDAY_COVERAGE", "CLOSING_COVERAGE", "SUNDAY_BALANCE", "LEADERSHIP", "REST_SPACING", "UNTIMED_ROTATION", "SATURDAY_BALANCE", "REST_DISTRIBUTION", "REST_ROTATION", "PEOPLE_CHANGED", "STABILITY", "PREFERENCES", "TIE_BREAK", "TIE_BREAK", "TIE_BREAK", "TIE_BREAK"];
    const optimization = { budgetSeconds: 12, phases: names.slice(0, count).map(objective => ({ objective, status: "FEASIBLE", wallTimeSeconds: 0.1, budgetSeconds: 0.2, initialValue: 500, incumbentValue: 400 })) };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 2, optimization })));
    if (count === 20) {
      const result = await solveEscala(fixture());
      expect(result.optimization).toEqual(optimization);
      expect(result.assignments).toEqual(completeAssignments().map(day => ({ ...day, locked: false })));
    } else await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });

  it("accepts all eleven active objectives including Sunday and closing coverage without losing assignments", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const objectives = ["COVERAGE", "SUNDAY_COVERAGE", "CLOSING_COVERAGE", "SUNDAY_BALANCE", "SATURDAY_BALANCE", "REST_DISTRIBUTION", "REST_ROTATION", "PEOPLE_CHANGED", "STABILITY", "PREFERENCES", "TIE_BREAK"];
    const optimization = { budgetSeconds: 12, unattemptedObjectives: [], phases: objectives.map(objective => ({
      objective, status: "FEASIBLE", wallTimeSeconds: 0.1, budgetSeconds: 0.2,
      initialValue: 500, incumbentValue: 400, searchScope: "GLOBAL",
    })) };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      status: "FEASIBLE", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 2, optimization,
    })));
    const result = await solveEscala(fixture());
    expect(result.optimization).toEqual(optimization);
    expect(result.assignments).toEqual(completeAssignments().map(day => ({ ...day, locked: false })));
    expect(result.optimization?.phases[1].objective).toBe("SUNDAY_COVERAGE");
  });

  it("accepts the maximum assignment count with Unicode IDs without narrowing the data contract", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const data = fixture(); data.endDate = "2026-12-13";
    data.shifts[0].id = "字".repeat(100);
    data.employees = Array.from({ length: 250 }, (_, index) => ({ ...data.employees[0], id: "漢".repeat(97) + String(index).padStart(3, "0"), registration: String(index + 1).padStart(6, "0"), shiftIds: [data.shifts[0].id] }));
    const assignments = data.employees.flatMap(person => Array.from({ length: 42 }, (_, day) => ({ employeeId: person.id, date: new Date(Date.UTC(2026, 10, 2 + day)).toISOString().slice(0, 10), ...(day % 7 < 5 ? { kind: "WORK", shiftId: data.shifts[0].id } : { kind: "OFF" }) })));
    const body = JSON.stringify({ status: "FEASIBLE", assignments, message: "Pronto", wallTimeSeconds: 12 });
    expect(Buffer.byteLength(body)).toBeGreaterThan(4 * 1024 * 1024);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "application/json" } })));
    expect((await solveEscala(data)).assignments).toHaveLength(10500);
  });

  it("rejects an insecure secret file before making an internal request", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubEnv("ESCALAS_SOLVER_SECRET_FILE", join(secretDirectory, "missing"));
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_AUTH_FAILED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels independently when the signal aborts while consuming the result body", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const controller = new AbortController();
    const fetch = vi.fn(async (url: URL) => {
      if (url.pathname === "/cancel") return Response.json({ state: "CANCELLED" });
      return new Response(new ReadableStream({ start(stream) { controller.abort(); stream.error(new DOMException("Aborted", "AbortError")); } }));
    });
    vi.stubGlobal("fetch", fetch);
    await expect(solveEscala(fixture(), { signal: controller.signal })).rejects.toMatchObject({ code: "SOLVER_CANCELLED" });
    expect(fetch.mock.calls.some(([url]) => url.pathname === "/cancel")).toBe(true);
  });

  it("authenticates internal requests and identifies the exact operation", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const fetch = vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 1 }));
    vi.stubGlobal("fetch", fetch);
    await solveEscala(fixture());
    expect(fetch.mock.calls[0]).toBeDefined();
    const init = (fetch.mock.calls as unknown[][])[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer " + "s".repeat(64));
    expect(headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get("X-Cancel-Token")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never starts an already cancelled calculation", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const fetch = vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 1 }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(); controller.abort();
    await expect(solveEscala(fixture(), { signal: controller.signal })).rejects.toMatchObject({ code: "SOLVER_CANCELLED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts a successful response and sends only validated inputs", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const fetch = vi.fn(async (_url: URL, _init?: RequestInit) => Response.json({ status: "OPTIMAL", assignments: completeAssignments(), message: "Concluído", wallTimeSeconds: 0.1 }));
    vi.stubGlobal("fetch", fetch);
    expect((await solveEscala(fixture())).status).toBe("OPTIMAL");
    expect(fetch).toHaveBeenCalledWith(new URL("http://escalas-solver:8080/solve"), expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ input: { ...fixture(), storeClosingMinutes: 1200 } });
  });
  it("preserves bounded numeric phase diagnostics on a real-shaped success response", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const optimization = { budgetSeconds: 12, phases: [
      { objective: "COVERAGE", status: "UNKNOWN", wallTimeSeconds: 6, budgetSeconds: 6, incumbentValue: 1200 },
      { objective: "PREFERENCES", status: "OPTIMAL", wallTimeSeconds: 0.1, budgetSeconds: 0.2, incumbentValue: -2, bestBound: -2 },
    ] };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: completeAssignments(), message: "Proposta", wallTimeSeconds: 6.5, optimization })));
    expect((await solveEscala(fixture())).optimization).toEqual(optimization);
    optimization.phases[0].incumbentValue = Number.POSITIVE_INFINITY;
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });
  it.each(["Repositor", "AUX. DE SERVIÇOS EM SUPER"])("retains only protected records of a disabled %s", async role => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const data = fixture();
    data.employees.push({ ...data.employees[0], id: "learner", registration: "02", role, planningEnabled: false });
    const absence = { employeeId: "learner", date: "2026-11-02", kind: "ABSENCE" as const };
    const locked = { employeeId: "learner", date: "2026-11-03", kind: "WORK" as const, shiftId: "day", locked: true };
    data.assignments.push(absence, locked);
    const assignments = [...completeAssignments(), absence, locked];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments, message: "Pronto", wallTimeSeconds: 1 })));
    expect((await solveEscala(data)).assignments).toEqual([...completeAssignments().map(day => ({ ...day, locked: false })), absence, locked]);
    assignments.push({ employeeId: "learner", date: "2026-11-04", kind: "OFF" });
    await expect(solveEscala(data)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });
  it("preserves unavailability and busy as separate conditions", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429 })));
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_BUSY" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_UNAVAILABLE" });
  });
  it("rejects forged employee references in a nominal success", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: [
      { employeeId: "other", date: "2026-11-02", kind: "OFF" },
    ], message: "Pronto", wallTimeSeconds: 1 })));
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });
  it("does not call the processor for an invalid model", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(solveEscala({ ...fixture(), endDate: "2026-11-99" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a structurally complete all-OFF response with missing weekly work", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const assignments = completeAssignments().map(({ employeeId, date }) => ({ employeeId, date, kind: "OFF" }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments, message: "Invalid claim", wallTimeSeconds: 1 })));
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });
  it("rejects a success with missing active dates instead of replacing the roster", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: [], message: "Pronto", wallTimeSeconds: 12 })));
    await expect(solveEscala(fixture())).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });
  it("rejects a complete result that removed an absence", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "OPTIMAL", assignments: completeAssignments(), message: "Pronto", wallTimeSeconds: 1 })));
    const input = fixture(); input.assignments = [{ employeeId: "p1", date: "2026-11-02", kind: "ABSENCE" }];
    await expect(solveEscala(input)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });
});
