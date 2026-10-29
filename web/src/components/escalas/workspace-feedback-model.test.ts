import { describe, expect, it } from "vitest";
import { EscalaRequestError, responseCode, solverProblem, toEscalaProblem } from "./workspace-feedback-model";

describe("plain language planning recovery", () => {
  it("does not call a published continuity dependency a concurrent editing conflict", () => {
    const problem = toEscalaProblem(new EscalaRequestError("ESCALA_DELETE_DEPENDENCY", 409, "raw"));
    expect(problem.message).toContain("continuidade");
    expect(problem.action).not.toBe("reload");
  });
  it("does not blame the team when the processor returned an independently invalid result", () => {
    const problem = toEscalaProblem(new EscalaRequestError("SOLVER_INVALID_RESPONSE", 503, "raw"));
    expect(problem.action).toBe("generate");
    expect(problem.explanation).toContain("não foi aplicada");
  });
  it("keeps API error codes separate from personal or technical response payloads", () => {
    expect(responseCode({ code: "ESCALA_STALE_REVISION", error: "private payload" })).toBe("ESCALA_STALE_REVISION");
    expect(responseCode({ error: { code: "AUTH_REQUIRED" } })).toBe("AUTH_REQUIRED");
    expect(responseCode(null)).toBeUndefined();
    expect(responseCode({ code: 12 })).toBeUndefined();
  });
  it("offers a safe current-revision check instead of overwriting concurrent changes", () => {
    const problem = toEscalaProblem(new EscalaRequestError("ESCALA_STALE_REVISION", 409, "raw"));
    expect(problem.action).toBe("reload");
    expect(problem.explanation).toContain("confirmação");
    expect(problem.message).not.toContain("raw");
  });
  it("does not promise impossibility when the bounded solver returned UNKNOWN", () => {
    const problem = solverProblem("UNKNOWN");
    expect(problem).toMatchObject({ tone: "warning", action: "generate" });
    expect(problem?.explanation).toContain("não significa");
    expect(solverProblem("FEASIBLE")).toBeNull();
    expect(solverProblem("OPTIMAL")).toBeNull();
  });
  it("links a genuine coverage conflict to the coverage controls without reducing minima", () => {
    expect(solverProblem("INFEASIBLE", "Cobertura sem horário disponível em 2026-11-02.")).toMatchObject({ tone: "warning", action: "coverage" });
    expect(toEscalaProblem(new EscalaRequestError("ESCALA_SETUP_REQUIRED", 422, "raw"))).toMatchObject({ action: "team" });
  });
  it("keeps an expired login recoverable in another tab and hides unknown server detail", () => {
    expect(toEscalaProblem(new EscalaRequestError("AUTH_REQUIRED", 401, "raw"))).toMatchObject({ action: "login" });
    const problem = toEscalaProblem(new EscalaRequestError("OTHER", 500, "credential-secret/private-person"));
    expect(JSON.stringify(problem)).not.toContain("credential-secret");
    expect(JSON.stringify(problem)).not.toContain("private-person");
    expect(problem.explanation).toContain("preservad");
  });
  it("provides network and rate-limit recovery without inventing a countdown", () => {
    expect(toEscalaProblem(new TypeError("Failed to fetch")).message).toContain("conexão");
    const limited = toEscalaProblem(new EscalaRequestError("RATE_LIMITED", 429, "raw"));
    expect(limited.message).toContain("tentativas");
    expect(limited.explanation).not.toMatch(/\d+ segundos/);
  });
});
