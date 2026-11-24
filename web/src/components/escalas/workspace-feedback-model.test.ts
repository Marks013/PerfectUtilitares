import { describe, expect, it } from "vitest";
import { EscalaRequestError, responseCode, solverProblem, toEscalaProblem } from "./workspace-feedback-model";

describe("plain language planning recovery", () => {
  it("shows the server's remaining time when generation is rate-limited", () => {
    const problem = toEscalaProblem(new EscalaRequestError("RATE_LIMITED", 429, "raw", 61));
    expect(problem.explanation).toContain("Tente novamente em 1 minuto e 1 segundo.");
  });

  it("distinguishes a blocked absence range from a concurrent revision change", () => {
    expect(toEscalaProblem(new EscalaRequestError("ESCALA_ABSENCE_CONFLICT", 409, "raw"))).toMatchObject({
      message: "O período inclui dias protegidos.", explanation: expect.stringContaining("Nenhum dia foi alterado"),
    });
    expect(toEscalaProblem(new EscalaRequestError("ESCALA_STALE_REVISION", 409, "raw")).action).toBe("reload");
    expect(toEscalaProblem(new EscalaRequestError("ESCALA_ABSENCE_IMPORT_PROTECTED", 403, "raw")).message).toContain("lançamentos manuais");
  });
  it("explains missing and revoked administrative approval without sending the operator to edit protected rules", () => {
    for (const code of ["ESCALA_CONFIG_APPROVAL_REQUIRED", "ESCALA_CONFIG_REVOKED"]) {
      const problem = toEscalaProblem(new EscalaRequestError(code, 409, "private"));
      expect(problem.explanation).toContain("administrador");
      expect(problem.action).not.toBe("reload");
      expect(problem.action).not.toBe("rules");
      expect(problem.message).not.toContain("outra aba");
    }
  });

  it("distinguishes a duplicate registration from configuration approval", () => {
    const problem = toEscalaProblem(new EscalaRequestError("ESCALA_DUPLICATE_REGISTRATION", 422, "private"));
    expect(problem).toMatchObject({ message: "Esta matrícula já está cadastrada.", action: "team" });
    expect(problem.explanation).not.toContain("aprova");
  });
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
  it("explains a processor size limit without blaming the connection or suggesting data removal", () => {
    const problem = toEscalaProblem(new EscalaRequestError("SOLVER_INPUT_TOO_LARGE", 413, "raw"));
    expect(problem.message).toContain("grande demais");
    expect(problem.explanation).toContain("suporte");
    expect(problem.explanation).toContain("não apague");
    expect(problem.action).toBeUndefined();
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
  it("distingue reparo local esgotado de inviabilidade sob cobertura protegida", () => {
    expect(solverProblem("UNKNOWN", "", [], undefined, { kind: "SEARCH_UNFINISHED", reason: "LOCAL_REPAIR_EXHAUSTED" }))
      .toMatchObject({ action: "roster", explanation: expect.stringContaining("busca geral não foi iniciada") });
    expect(solverProblem("INFEASIBLE", "", [], "MODEL_PROOF", { kind: "PROVEN_INFEASIBLE", scope: "PROTECTED_MODEL" })?.explanation)
      .toContain("proteção de cobertura usada neste cálculo");
  });
  it.each([["PRECHECK", "checagem de entrada ou cobertura"], ["MODEL_PROOF", "modelo não tem solução"]] as const)("shows %s only from verified evidence", (evidence, label) => {
    const conflicts = [{ code: "SOLVER_COVERAGE", message: "Synthetic", target: "coverage" as const }];
    const problem = solverProblem("INFEASIBLE", "private worker text", conflicts, evidence);
    expect(problem).toMatchObject({ action: "coverage", conflicts });
    expect(problem?.explanation).toContain(label);
    expect(solverProblem("INFEASIBLE", "private worker text", conflicts)?.explanation).not.toContain(label);
  });
  it.each([["SOLVER_RESPONSE_INCOMPLETE", "incompleta"], ["SOLVER_PROTECTED_RECORD_CHANGED", "registro protegido"],
    ["SOLVER_RULES_INVALID", "regras obrigatórias"]])("classifies %s without raw worker text", (code, label) => {
    const problem = toEscalaProblem(new EscalaRequestError(code, 503, "private worker text"));
    expect(problem.message).toContain(label);
    expect(JSON.stringify(problem)).not.toContain("private worker text");
  });
  it("links a genuine coverage conflict to the coverage controls without reducing minima", () => {
    expect(solverProblem("INFEASIBLE", "Cobertura sem horário disponível em 2026-11-02.")).toMatchObject({ tone: "warning", action: "coverage" });
    expect(toEscalaProblem(new EscalaRequestError("ESCALA_SETUP_REQUIRED", 422, "raw"))).toMatchObject({ action: "team" });
  });
  it("explains a rejected coverage comparison without exposing the calculation payload", () => {
    const problem = toEscalaProblem(new EscalaRequestError("ESCALA_FROZEN_COVERAGE_REGRESSION", 422, "private worker text"));
    expect(problem).toMatchObject({ action: "coverage", actionLabel: "Conferir cobertura", tone: "error" });
    expect(problem.message).toContain("cobertura protegida");
    expect(problem.explanation).toContain("grade salva ficou intacta");
    expect(JSON.stringify(problem)).not.toContain("private worker text");
  });
  it("keeps an expired module session recoverable without discarding the draft and hides unknown server detail", () => {
    expect(toEscalaProblem(new EscalaRequestError("AUTH_REQUIRED", 401, "raw"))).toMatchObject({ action: "login" });
    const problem = toEscalaProblem(new EscalaRequestError("OTHER", 500, "credential-secret/private-person"));
    expect(JSON.stringify(problem)).not.toContain("credential-secret");
    expect(JSON.stringify(problem)).not.toContain("private-person");
    expect(problem.explanation).toContain("preservad");
  });
  it("requires reconciliation for an uncertain save without claiming success", () => {
    const problem = toEscalaProblem(new EscalaRequestError("ESCALA_SAVE_UNCERTAIN", 0, "raw"));
    expect(problem.message).toContain("não pôde ser confirmada");
    expect(problem.explanation).toContain("consultaremos a revisão salva");
    expect(problem.explanation).not.toContain("raw");
  });
  it("provides network and rate-limit recovery without inventing a countdown", () => {
    expect(toEscalaProblem(new TypeError("Failed to fetch")).message).toContain("conexão");
    const limited = toEscalaProblem(new EscalaRequestError("RATE_LIMITED", 429, "raw"));
    expect(limited.message).toContain("tentativas");
    expect(limited.explanation).not.toMatch(/\d+ segundos/);
  });
});
