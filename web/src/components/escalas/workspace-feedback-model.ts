import type { EscalaGenerationConflict, EscalaSolveResult } from "@/lib/escalas/types";
import { retryAfterInstruction } from "@/lib/api/retry-after";

export type EscalaRecoveryAction = "team" | "coverage" | "rules" | "reload" | "generate" | "login" | "roster";
export type EscalaProblem = { message: string; explanation: string; tone: "error" | "warning"; action?: EscalaRecoveryAction; actionLabel?: string; conflicts?: EscalaGenerationConflict[]; outcome?: "not-generated" };

/** Keep structured API context without exposing response bodies or stack traces in the workspace. */
export class EscalaRequestError extends Error {
  constructor(public readonly code: string | undefined, public readonly status: number, message: string, public readonly retryAfterSeconds?: number) {
    super(message); this.name = "EscalaRequestError";
  }
}
export function responseCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = body as { code?: unknown; error?: { code?: unknown } | string };
  const code = data.code ?? (typeof data.error === "object" ? data.error?.code : undefined);
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,119}$/.test(code) ? code : undefined;
}

export function invalidatesCandidate(cause: unknown): boolean {
  return cause instanceof EscalaRequestError && ([401, 403, 404, 409].includes(cause.status)
    || cause.code === "ESCALA_COMPARISON_REFERENCE_INVALID" || cause.code?.startsWith("ESCALA_CONFIG_") === true
    || cause.code?.startsWith("ESCALA_PROPOSAL_") === true || cause.code === "ESCALA_ACCESS_REQUIRED");
}

export function toEscalaProblem(cause: unknown): EscalaProblem {
  const code = cause instanceof EscalaRequestError ? cause.code : undefined;
  const status = cause instanceof EscalaRequestError ? cause.status : 0;
  const problem = (message: string, explanation: string, action?: EscalaRecoveryAction, actionLabel?: string): EscalaProblem => ({ message, explanation, tone: "error", ...(action ? { action, actionLabel } : {}) });
  if (status === 401 || code === "AUTH_REQUIRED" || code === "UNAUTHORIZED") return problem("Sua sessão terminou.", "Entre novamente nesta página. O rascunho permanece preservado e a revisão salva será conferida antes de retomar.", "login", "Liberar acesso novamente");
  if (code === "ESCALA_CONFIG_APPROVAL_REQUIRED" || code === "ESCALA_CONFIG_REVOKED") return problem(
    code === "ESCALA_CONFIG_REVOKED" ? "A configuração desta filial foi revogada." : "Este período precisa de uma configuração aprovada.",
    "Seus dados foram preservados. Peça ao administrador para aprovar a configuração e vincular este planejamento à versão válida. Depois confira o período antes de continuar.");
  if (code === "ESCALA_DUPLICATE_REGISTRATION") return problem("Esta matrícula já está cadastrada.",
    "Confira a matrícula informada ou localize a pessoa na equipe para revisar o cadastro.", "team", "Conferir equipe");
  if (code === "ESCALA_EMPLOYEE_REMOVAL_PROTECTED") return problem("A remoção afetaria um dia protegido.",
    "Confira os dias bloqueados, os afastamentos e as escalas publicadas deste colaborador. A equipe foi preservada.", "team", "Conferir equipe");
  if (code === "ESCALA_IMPORTED_TEAM_INVALID" || code === "ESCALA_IMPORTED_TEAM_SEED_CONFLICT") return problem(
    "A equipe da última importação precisa de conferência.",
    "Peça ao administrador para revisar a importação e a configuração aprovada deste período. Nenhum planejamento foi criado.");
  if (code === "ESCALA_PROPOSAL_INVALID") return problem("Esta proposta não pode mais ser aplicada.", "A revisão, a configuração ou o acesso mudou, ou a proposta expirou. Sua grade salva foi preservada. Gere uma nova proposta para conferir.", "generate", "Gerar nova proposta");
  if (code === "ESCALA_SAVE_UNCERTAIN") return problem("A gravação ainda não pôde ser confirmada.", "O rascunho foi preservado. Reconecte e use Tentar salvar; primeiro consultaremos a revisão salva, sem repetir uma gravação às cegas.");
  if (code === "ESCALA_ABSENCE_IMPORT_PROTECTED") return problem("O operador só pode excluir lançamentos manuais.", "Peça ao administrador para conferir os afastamentos importados ou legados.");
  if (status === 403) return problem("Esta ação não está disponível para sua conta.", "Os dados foram preservados. Confira sua sessão ou peça acesso de edição a esta filial.");
  if (code === "ESCALA_DELETE_DEPENDENCY") return problem("Este planejamento participa da continuidade de outro período.", "Há uma proposta publicada próxima que usa o histórico ou os dias compartilhados. Confira os períodos relacionados antes de excluir. Nenhum registro foi removido.");
  if (code === "ESCALA_STALE_REVISION" || status === 409 && !code) return problem("Este planejamento foi atualizado em outra aba.", "Confira a revisão mais recente. Suas alterações locais só serão descartadas após sua confirmação.", "reload", "Conferir revisão atual");
  if (code === "ESCALA_ABSENCE_PERIOD" || code === "ESCALA_ABSENCE_EMPLOYEE") return problem(
    "Confira o colaborador e as datas do afastamento.", "Informe um período válido dentro das datas visíveis do rascunho. Para incluir um afastamento, o colaborador precisa estar ativo nesse período.");
  if (code === "ESCALA_ABSENCE_CONFLICT") return problem("O período inclui dias protegidos.", "Confira os bloqueios, feriados fechados e ajustes manuais da escala. Nenhum dia foi alterado.");
  if (code === "ESCALA_ABSENCE_DRAFT_REQUIRED") return problem("Esta escala já foi publicada.", "Selecione um rascunho para lançar ou excluir afastamentos. A escala publicada foi preservada.");
  if (code === "ESCALA_SETUP_REQUIRED" || code === "ESCALA_INVALID_INPUT" || code === "ESCALA_IMPORT_CONTENT" || code === "ESCALA_IMPORT_FILE" || code === "ESCALA_IMPORT_TYPE") return problem("Há dados da equipe que precisam de conferência.", "Confira o arquivo, os colaboradores incluídos e os horários informados. Os registros atuais não foram apagados.", "team", "Conferir equipe");
  if (code === "ESCALA_DAILY_LIMIT" || code === "ESCALA_SHIFT_CONFLICT" || code === "ESCALA_REFERENCE_REVIEW_REQUIRED" || code === "ESCALA_SHIFT_OPTIONS_LIMIT") return problem("Um horário ou bloqueio precisa de conferência.", cause instanceof EscalaRequestError && cause.code === "ESCALA_REFERENCE_REVIEW_REQUIRED" ? cause.message : "Confira os horários e dias bloqueados da equipe. A proposta anterior foi preservada; não é necessário refazer a importação.", "team", "Conferir horários e bloqueios");
  if (code === "ESCALA_MIXED_42_SHIFT_REQUIRED" && cause instanceof EscalaRequestError) return problem("Não foi possível montar o horário de 9h.", cause.message, "team", "Conferir horários");
  if (code === "ESCALA_DAILY_EXTENSION_REQUIRED" || code === "ESCALA_CERTIFICATE_REQUIRED" || code === "ESCALA_HOLIDAY_POLICY_REQUIRED" || code?.startsWith("ESCALA_CCT_")) return problem("Existe uma regra especial pendente de conferência.", "Confira a condição indicada antes da aplicação real. Não marque uma autorização que não existe; os dados da proposta foram preservados.", "rules", "Conferir condição especial");
  if (code === "SOLVER_RESPONSE_INCOMPLETE") return problem("O cálculo retornou uma proposta incompleta.", "A proposta não cobre todos os dias exigidos e não foi aplicada. Gere novamente; a escala salva foi preservada.", "generate", "Gerar novamente");
  if (code === "SOLVER_PROTECTED_RECORD_CHANGED") return problem("A proposta alterava um registro protegido.", "A proposta foi recusada. Ausências, horários e bloqueios salvos foram preservados. Se repetir, informe ao suporte.");
  if (code === "SOLVER_RULES_INVALID") return problem("A proposta não atende às regras obrigatórias.", "A proposta foi recusada e a escala salva foi mantida. Confira a regra indicada ou informe ao suporte.", "rules", "Conferir regras");
  if (code === "ESCALA_FROZEN_COVERAGE_REGRESSION") return problem(
    "Não foi possível confirmar que a proposta mantém a cobertura protegida.",
    "A grade salva ficou intacta. Confira a cobertura por setor e horário antes de tentar outra proposta. Nenhum mínimo, bloqueio ou afastamento foi alterado.",
    "coverage", "Conferir cobertura");
  if (code === "ESCALA_OPERATION_CHANGED") return problem("O estado deste cálculo mudou.", "Confira a revisão atual antes de iniciar uma nova proposta. A escala salva foi preservada.", "reload", "Conferir revisão atual");
  if (code === "SOLVER_TIMED_OUT") return problem("O prazo deste cálculo terminou.", "A escala salva foi preservada. Gere novamente quando estiver pronto.", "generate", "Gerar novamente");
  if (code === "SOLVER_INVALID_RESPONSE") return problem("O cálculo não passou pela conferência de segurança.", "A resposta recebida não foi aplicada. Tente gerar novamente; se o problema continuar, informe ao suporte. Sua proposta anterior foi preservada.", "generate", "Gerar novamente");
  if (code === "SOLVER_INPUT_TOO_LARGE") return problem("Este planejamento ficou grande demais para o cálculo.", "Sua escala salva e o rascunho foram preservados. Informe o problema ao suporte para revisar o tamanho do envio; não apague colaboradores, ausências ou históricos para tentar novamente.");
  if (code === "SOLVER_BUSY") return problem("Já existe uma análise em andamento.", "Aguarde a análise terminar antes de gerar novamente. Sua equipe e suas alterações foram preservadas.", "generate", "Gerar novamente");
  if (status === 429 && cause instanceof EscalaRequestError) return problem("Foram feitas muitas tentativas em pouco tempo.", `${retryAfterInstruction(cause.retryAfterSeconds)} Não é necessário recarregar a página ou importar a equipe outra vez.`);
  if (code === "SOLVER_UNAVAILABLE") return problem("O serviço de cálculo não respondeu.", "Tente gerar novamente em alguns instantes. Sua equipe e a proposta anterior foram preservadas.", "generate", "Gerar novamente");
  if (code === "ESCALA_UNSAVED_CHANGES") return problem("Salve ou descarte a proposta atual antes de criar outra escala.", "Suas alterações ainda não fazem parte de uma revisão salva. Use Salvar revisão para mantê-las.");
  if (cause instanceof TypeError) return problem("A conexão com o servidor falhou.", "Confira sua conexão e tente a mesma ação novamente. Mantenha esta página aberta para preservar as alterações locais.");
  if (code === "INVALID_RESPONSE") return problem("O servidor não concluiu a resposta corretamente.", "Tente a mesma ação novamente. Seus dados continuam nesta página; não refaça a importação.");
  return problem("Não foi possível concluir esta ação.", "Sua equipe e suas alterações locais foram preservadas. Tente a mesma ação novamente; se continuar, informe o problema ao suporte.");
}

export function generationSuccessNotice(result: import("./mass-generation").GeneratedProposal, canApply: boolean) {
  const preview = "Confira a proposta. Para aplicar ou salvar alterações, peça ajuda a uma pessoa autorizada nesta filial.";
  const comparison = result.result.outcome?.kind === "REFERENCE_RETAINED" || result.comparison?.selection === "REFERENCE_RETAINED"
    ? "A proposta anterior foi mantida para preservar a cobertura."
    : result.comparison?.admission === "EXPIRED" ? "A comparação anterior expirou. Uma nova proposta foi calculada."
      : result.comparison && ["SCENARIO_CHANGED", "INCOMPATIBLE"].includes(result.comparison.admission)
        ? "A comparação anterior não pôde ser usada neste cenário." : "";
  const warning = result.validation.issues.length ? "Proposta concluída com avisos." : "";
  return comparison ? [warning, comparison, canApply ? "Confira antes de aplicar." : preview].filter(Boolean).join(" ")
    : `${warning || "Proposta concluída."} ${canApply ? "Confira e aplique à escala." : preview}`;
}

export function solverProblem(status: string, message = "", conflicts: EscalaGenerationConflict[] = [], evidence?: EscalaSolveResult["rejectionEvidence"], outcome?: EscalaSolveResult["outcome"]): EscalaProblem | null {
  if (status === "OPTIMAL" || status === "FEASIBLE") return null;
  if (outcome?.kind === "SEARCH_UNFINISHED" && outcome.reason === "LOCAL_REPAIR_EXHAUSTED") return { outcome: "not-generated", tone: "warning", message: "O reparo local não encontrou uma proposta válida.", explanation: "A busca geral não foi iniciada. Confira as folgas e os bloqueios sem alterar a grade salva.", action: "roster", actionLabel: "Conferir dias na escala" };
  if (status === "UNKNOWN") return { outcome: "not-generated", tone: "warning", message: "O cálculo terminou sem uma proposta no tempo disponível.", explanation: "Isso não significa que a escala seja impossível. Tente gerar novamente; se repetir, confira os horários e bloqueios da equipe.", action: "generate", actionLabel: "Gerar novamente" };
  if (status === "INFEASIBLE") {
    const stage = evidence === "PRECHECK" ? "A checagem de entrada ou cobertura impediu o início da busca."
      : outcome?.kind === "PROVEN_INFEASIBLE" && outcome.scope === "PROTECTED_MODEL" ? "A busca demonstrou que não há alternativa com a proteção de cobertura usada neste cálculo."
      : evidence === "MODEL_PROOF" ? "A busca demonstrou que o modelo não tem solução com as condições atuais."
        : undefined;
    if (conflicts.length) return { outcome: "not-generated", tone: "warning", message: "Há condições específicas que impedem esta proposta.", explanation: [stage, "Confira os motivos abaixo. Nenhuma ausência, dia bloqueado ou exigência de cobertura foi alterada automaticamente."].filter(Boolean).join(" "), conflicts, action: conflicts[0].target, actionLabel: recoveryActionLabel(conflicts[0].target) };
    const coverage = message.startsWith("Cobertura sem horário disponível");
    return { outcome: "not-generated", tone: "warning", message: "As condições atuais não permitem montar uma proposta.", explanation: [stage, coverage ? "Confira os horários disponíveis para a cobertura exigida." : "Abra a conferência dos dados; nenhum bloqueio, ausência ou mínimo foi alterado."].filter(Boolean).join(" "), action: coverage ? "coverage" : "team", actionLabel: coverage ? "Conferir cobertura" : "Conferir equipe e restrições" };
  }
  return { tone: "error", message: "O cálculo encontrou um dado que não conseguiu processar.", explanation: "Confira os horários informados e tente gerar novamente. Se continuar, informe o problema ao suporte; a proposta anterior foi preservada.", action: "team", actionLabel: "Conferir horários" };
}

export function recoveryActionLabel(action: EscalaRecoveryAction): string {
  return action === "coverage" ? "Conferir cobertura" : action === "roster" ? "Conferir dias na escala" : action === "rules" ? "Conferir regra indicada" : "Conferir equipe e restrições";
}
