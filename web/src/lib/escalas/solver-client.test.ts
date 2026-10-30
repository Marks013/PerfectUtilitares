import { afterEach, describe, expect, it, vi } from "vitest";
import { solveEscala } from "./solver-client";
import type { EscalaInput } from "./types";

function fixture(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "01", branchName: "Matriz",
    startDate: "2026-11-02", endDate: "2026-11-08", defaultWeeklyHours: 42,
    timeZone: "America/Sao_Paulo",
    policy: { source: "Instrumento confirmado no teste", validFrom: "2026-01-01", validUntil: "2026-12-31",
      reviewed: true, reviewedBy: "Responsável", weeklyLimit: 44, dailyLimitMinutes: 528,
      compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100,
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
  it("accepts a successful response and sends only validated inputs", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const fetch = vi.fn(async (_url: URL, _init?: RequestInit) => Response.json({ status: "OPTIMAL", assignments: completeAssignments(), message: "Concluído", wallTimeSeconds: 0.1 }));
    vi.stubGlobal("fetch", fetch);
    expect((await solveEscala(fixture())).status).toBe("OPTIMAL");
    expect(fetch).toHaveBeenCalledWith(new URL("http://escalas-solver:8080/solve"), expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ input: fixture() });
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
  it("accepts only the retained protected records of a disabled apprentice", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const data = fixture();
    data.employees.push({ ...data.employees[0], id: "learner", registration: "02", role: "AUX. DE SERVIÇOS EM SUPER", planningEnabled: false });
    const absence = { employeeId: "learner", date: "2026-11-02", kind: "ABSENCE" as const };
    data.assignments.push(absence);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "FEASIBLE", assignments: [...completeAssignments(), absence], message: "Pronto", wallTimeSeconds: 1 })));
    expect((await solveEscala(data)).assignments).toContainEqual(absence);
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
