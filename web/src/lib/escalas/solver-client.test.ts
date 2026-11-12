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
import type { EscalaInput } from "./types";

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
    shifts: [{ id: "day", name: "Dia", segments: [{ start: 480, end: 984, kind: "WORK" }] }],
  };
}

function completeAssignments(): EscalaInput["assignments"] {
  return Array.from({ length: 7 }, (_, day) => ({ employeeId: "p1", date: `2026-11-0${day + 2}`, kind: "OFF" as const }));
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("isolated schedule processor client", () => {
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
    input.employees[0].history = [{ employeeId: "p1", date: "2026-11-01", kind: "WORK", shiftId: "day", locked: false }];
    input.employees[0].planningHistory = [{ employeeId: "p1", date: "2026-10-31", kind: "OFF", locked: true }];
    input.employees[0].planningFuture = [{ employeeId: "p1", date: "2026-11-09", kind: "ABSENCE" }];
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
      expect(log).toHaveBeenCalledWith({ event: "escala_refinement_failed", errorType: "Error" });
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
      expect(result.assignments).toEqual(completeAssignments());
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
    expect(result.assignments).toEqual(completeAssignments());
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
    expect((await solveEscala(data)).assignments).toEqual(assignments);
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
