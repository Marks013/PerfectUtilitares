import type { EscalaIssue } from "@/lib/escalas/types";

export type ReviewTarget = "generate" | "rules" | "coverage" | "team" | "roster";
type Guidance = { title: string; instruction: string; target?: ReviewTarget; action?: string };

const GUIDANCE: Record<string, Guidance> = {
  DAY_PENDING: { title: "Folgas ainda não geradas", instruction: "Peça uma sugestão em massa. O sistema distribui trabalho e folgas para toda a equipe incluída, preservando as decisões bloqueadas.", target: "generate", action: "Sugerir para toda a filial" },
  POLICY_PENDING: { title: "Confirmar as regras da filial", instruction: "Você pode gerar e conferir o rascunho. Antes de publicar, informe a norma aplicável e o responsável, e confirme a revisão uma vez para a filial.", target: "rules", action: "Conferir regras da filial" },
  POLICY_VALIDITY: { title: "Ajustar a vigência da norma", instruction: "A norma informada precisa abranger todo o período da escala.", target: "rules", action: "Conferir vigência" },
  CCT_VALIDITY: { title: "Atualizar a convenção coletiva", instruction: "O período está fora da vigência da CCT cadastrada. Confira o instrumento aplicável antes de continuar.", target: "rules", action: "Conferir convenção" },
  COVERAGE_PENDING: { title: "Cobertura dos setores ainda não sugerida", instruction: "A sugestão em massa completa a estimativa de cobertura que estiver faltando. Confira os mínimos da operação antes de publicar.", target: "generate", action: "Sugerir para toda a filial" },
  COVERAGE_REVIEW_PENDING: { title: "Conferir a cobertura sugerida", instruction: "A estimativa está pronta. Confira por setor se os mínimos atendem à loja e confirme a cobertura da filial, inclusive as faixas com mínimo zero.", target: "coverage", action: "Conferir cobertura por setor" },
  ESTIMATED_COVERAGE_GAP: { title: "Ajustar a cobertura estimada", instruction: "Há faixas em que a proposta fica abaixo da estimativa de pessoas. Confira setor, data, horário e quantidade nos detalhes. Ajuste os turnos ou o mínimo real da operação antes de confirmar; o sistema não aprova essa falta de cobertura.", target: "coverage", action: "Conferir faixas abaixo da estimativa" },
  COVERAGE_DEFICIT: { title: "Cobertura confirmada não atendida", instruction: "A proposta não atende a um mínimo operacional já confirmado. Ajuste os turnos ou a equipe e gere novamente. Esse mínimo continua obrigatório.", target: "coverage", action: "Conferir mínimo confirmado" },
  EMPLOYEES_PENDING: { title: "Importar a equipe", instruction: "Use o FPRE136 da filial. Um único arquivo fornece os colaboradores e seus horários de referência.", target: "team", action: "Ir para importação" },
  ACTIVE_EMPLOYEES_PENDING: { title: "Nenhum colaborador incluído", instruction: "Confira quem está fora da geração e os motivos antes de continuar.", target: "team", action: "Conferir equipe" },
  SHIFTS_PENDING: { title: "Preparar os horários da equipe", instruction: "A sugestão em massa prepara horários compatíveis quando há referência suficiente. Cadastros sem adaptação segura ficam identificados para conferência.", target: "generate", action: "Preparar e sugerir folgas" },
  TRANSITION_WEEK_PENDING: { title: "Confirmar a semana de mudança da jornada", instruction: "A escala atravessa uma redução da carga legal. Confira a adoção da carga menor para a semana completa.", target: "rules", action: "Conferir a transição" },
  COMPENSATION_REQUIRED: { title: "Conferir a autorização da jornada", instruction: "A distribuição acima de oito horas depende da autorização aplicável. Informe os dados reais do instrumento ou ajuste os horários.", target: "rules", action: "Conferir autorização" },
  COVERAGE: { title: "Equipe insuficiente em algumas faixas", instruction: "Confira os mínimos por setor e os horários disponíveis. A solução precisa preservar os descansos e a cobertura cadastrada.", target: "coverage", action: "Conferir cobertura" },
};

/** One actionable group per cause; every original issue remains available in details. */
export function groupValidationIssues(issues: EscalaIssue[]) {
  const groups = new Map<string, { key: string; severity: EscalaIssue["severity"]; guidance: Guidance; issues: EscalaIssue[] }>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    const current = groups.get(key);
    if (current) current.issues.push(issue);
    else groups.set(key, { key, severity: issue.severity, guidance: GUIDANCE[issue.code] ?? {
      title: issue.severity === "WARNING" ? "Limite da conferência" : issue.severity === "ERROR" ? "Ajuste necessário na escala" : "Conferência necessária",
      instruction: issue.message,
      ...(issue.severity === "ERROR" ? { target: "roster" as const, action: "Conferir grade" } : {}),
    }, issues: [issue] });
  }
  const priority = { ERROR: 0, PENDING: 1, WARNING: 2 };
  return [...groups.values()].sort((a, b) => priority[a.severity] - priority[b.severity]
    || Number(a.issues[0].code === "DAY_PENDING") - Number(b.issues[0].code === "DAY_PENDING"));
}
