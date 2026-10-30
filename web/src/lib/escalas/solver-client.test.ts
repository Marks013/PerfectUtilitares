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
import type { EscalaInput } from "./types";

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
  it("accepts all ten active objectives including Sunday coverage without losing assignments", async () => {
    vi.stubEnv("ESCALAS_SOLVER_URL", "http://escalas-solver:8080");
    const objectives = ["COVERAGE", "SUNDAY_COVERAGE", "SUNDAY_BALANCE", "SATURDAY_BALANCE", "REST_DISTRIBUTION", "REST_ROTATION", "PEOPLE_CHANGED", "STABILITY", "PREFERENCES", "TIE_BREAK"];
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
