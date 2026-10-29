import type { EscalaGenerationConflict } from "@/lib/escalas/types";

export type EscalaRecoveryAction = "team" | "coverage" | "rules" | "reload" | "generate" | "login" | "roster";
export type EscalaProblem = { message: string; explanation: string; tone: "error" | "warning"; action?: EscalaRecoveryAction; actionLabel?: string; conflicts?: EscalaGenerationConflict[]; outcome?: "not-generated" };

/** Keep structured API context without exposing response bodies or stack traces in the workspace. */
export class EscalaRequestError extends Error {
  constructor(public readonly code: string | undefined, public readonly status: number, message: string) {
    super(message); this.name = "EscalaRequestError";
  }
}
export function responseCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = body as { code?: unknown; error?: { code?: unknown } | string };
  const code = data.code ?? (typeof data.error === "object" ? data.error?.code : undefined);
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,119}$/.test(code) ? code : undefined;
}

export function toEscalaProblem(cause: unknown): EscalaProblem {
  const code = cause instanceof EscalaRequestError ? cause.code : undefined;
  const status = cause instanceof EscalaRequestError ? cause.status : 0;
  const problem = (message: string, explanation: string, action?: EscalaRecoveryAction, actionLabel?: string): EscalaProblem => ({ message, explanation, tone: "error", ...(action ? { action, actionLabel } : {}) });
  if (status === 401 || code === "AUTH_REQUIRED" || code === "UNAUTHORIZED") return problem("Sua sessão terminou.", "Digite a senha novamente nesta página. O rascunho permanece preservado e a revisão salva será conferida antes de retomar.", "login", "Liberar acesso novamente");
  if (code === "ESCALA_SAVE_UNCERTAIN") return problem("A gravação ainda não pôde ser confirmada.", "O rascunho foi preservado. Reconecte e use Tentar salvar; primeiro consultaremos a revisão salva, sem repetir uma gravação às cegas.");
  if (status === 403) return problem("Esta ação não está disponível para sua conta.", "Os dados foram preservados. Confira sua sessão ou peça acesso de edição a esta filial.");
  if (code === "ESCALA_DELETE_DEPENDENCY") return problem("Este planejamento participa da continuidade de outro período.", "Há uma proposta publicada próxima que usa o histórico ou os dias compartilhados. Confira os períodos relacionados antes de excluir. Nenhum registro foi removido.");
  if (code === "ESCALA_STALE_REVISION" || status === 409) return problem("Este planejamento foi atualizado em outra aba.", "Confira a revisão mais recente. Suas alterações locais só serão descartadas após sua confirmação.", "reload", "Conferir revisão atual");
  if (code === "ESCALA_SETUP_REQUIRED" || code === "ESCALA_INVALID_INPUT" || code === "ESCALA_IMPORT_CONTENT" || code === "ESCALA_IMPORT_FILE" || code === "ESCALA_IMPORT_TYPE") return problem("Há dados da equipe que precisam de conferência.", "Confira o arquivo, os colaboradores incluídos e os horários informados. Os registros atuais não foram apagados.", "team", "Conferir equipe");
  if (code === "ESCALA_DAILY_LIMIT" || code === "ESCALA_SHIFT_CONFLICT" || code === "ESCALA_REFERENCE_REVIEW_REQUIRED" || code === "ESCALA_SHIFT_OPTIONS_LIMIT") return problem("Um horário ou bloqueio precisa de conferência.", cause instanceof EscalaRequestError && cause.code === "ESCALA_REFERENCE_REVIEW_REQUIRED" ? cause.message : "Confira os horários e dias bloqueados da equipe. A proposta anterior foi preservada; não é necessário refazer a importação.", "team", "Conferir horários e bloqueios");
  if (code === "ESCALA_DAILY_EXTENSION_REQUIRED" || code === "ESCALA_CERTIFICATE_REQUIRED" || code === "ESCALA_HOLIDAY_POLICY_REQUIRED" || code?.startsWith("ESCALA_CCT_")) return problem("Existe uma regra especial pendente de conferência.", "Confira a condição indicada antes da aplicação real. Não marque uma autorização que não existe; os dados da proposta foram preservados.", "rules", "Conferir condição especial");
  if (code === "SOLVER_INVALID_RESPONSE") return problem("O cálculo não passou pela conferência de segurança.", "A resposta recebida não foi aplicada. Tente gerar novamente; se o problema continuar, informe ao suporte. Sua proposta anterior foi preservada.", "generate", "Gerar novamente");
  if (code === "SOLVER_BUSY") return problem("Já existe uma análise em andamento.", "Aguarde a análise terminar antes de gerar novamente. Sua equipe e suas alterações foram preservadas.", "generate", "Gerar novamente");
  if (status === 429) return problem("Foram feitas muitas tentativas em pouco tempo.", "Espere um pouco e tente a mesma ação novamente. Não é necessário recarregar a página ou importar a equipe outra vez.");
  if (code === "SOLVER_UNAVAILABLE") return problem("O serviço de cálculo não respondeu.", "Tente gerar novamente em alguns instantes. Sua equipe e a proposta anterior foram preservadas.", "generate", "Gerar novamente");
  if (code === "ESCALA_UNSAVED_CHANGES") return problem("Salve ou descarte a proposta atual antes de criar outra escala.", "Suas alterações ainda não fazem parte de uma revisão salva. Use Salvar revisão para mantê-las.");
  if (cause instanceof TypeError) return problem("A conexão com o servidor falhou.", "Confira sua conexão e tente a mesma ação novamente. Mantenha esta página aberta para preservar as alterações locais.");
  if (code === "INVALID_RESPONSE") return problem("O servidor não concluiu a resposta corretamente.", "Tente a mesma ação novamente. Seus dados continuam nesta página; não refaça a importação.");
  return problem("Não foi possível concluir esta ação.", "Sua equipe e suas alterações locais foram preservadas. Tente a mesma ação novamente; se continuar, informe o problema ao suporte.");
}

export function solverProblem(status: string, message = "", conflicts: EscalaGenerationConflict[] = []): EscalaProblem | null {
  if (status === "OPTIMAL" || status === "FEASIBLE") return null;
  if (status === "UNKNOWN") return { outcome: "not-generated", tone: "warning", message: "O cálculo terminou sem uma proposta no tempo disponível.", explanation: "Isso não significa que a escala seja impossível. Tente gerar novamente; se repetir, confira os horários e bloqueios da equipe.", action: "generate", actionLabel: "Gerar novamente" };
  if (status === "INFEASIBLE") {
    if (conflicts.length) return { outcome: "not-generated", tone: "warning", message: "Há condições específicas que impedem esta proposta.", explanation: "Confira os motivos abaixo. Nenhuma ausência, dia bloqueado ou exigência de cobertura foi alterada automaticamente.", conflicts, action: conflicts[0].target, actionLabel: recoveryActionLabel(conflicts[0].target) };
    const coverage = message.startsWith("Cobertura sem horário disponível");
    return { outcome: "not-generated", tone: "warning", message: "As condições atuais não permitem montar uma proposta.", explanation: coverage ? message : "O cálculo não identificou um único ajuste seguro. Abra a conferência dos dados; nenhum bloqueio, ausência ou mínimo foi alterado.", action: coverage ? "coverage" : "team", actionLabel: coverage ? "Conferir cobertura" : "Conferir equipe e restrições" };
  }
  return { tone: "error", message: "O cálculo encontrou um dado que não conseguiu processar.", explanation: "Confira os horários informados e tente gerar novamente. Se continuar, informe o problema ao suporte; a proposta anterior foi preservada.", action: "team", actionLabel: "Conferir horários" };
}

export function recoveryActionLabel(action: EscalaRecoveryAction): string {
  return action === "coverage" ? "Conferir cobertura" : action === "roster" ? "Conferir dias na escala" : action === "rules" ? "Conferir regra indicada" : "Conferir equipe e restrições";
}
