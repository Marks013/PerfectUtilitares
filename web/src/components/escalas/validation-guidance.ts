import type { EscalaIssue } from "@/lib/escalas/types";

export type ReviewTarget = "generate" | "rules" | "coverage" | "team" | "roster";
type Guidance = { title: string; instruction: string; target?: ReviewTarget; action?: string };

const GUIDANCE: Record<string, Guidance> = {
  WORK_STREAK: { title: "Mais de cinco dias consecutivos", instruction: "Interrompa a sequência com uma folga ou gere uma proposta atualizada. O limite vale também entre semanas e meses, quando há histórico disponível.", target: "roster", action: "Conferir sequência na escala" },
  FIVE_BY_TWO_POLICY_OUTDATED: { title: "Recalcular o modelo 5×2", instruction: "A revisão usa um limite antigo. Gere e aplique novamente para conferir a escala com no máximo cinco dias consecutivos.", target: "generate", action: "Recalcular a proposta" },
  SIMULATION_SHORT_MEAL_FLEX: { title: "Intervalo curto flexibilizado nesta simulação", instruction: "Nesta simulação, foi dispensado o intervalo mínimo de 15 minutos em jornadas acima de quatro e até seis horas. Isso não dispensa intervalos de jornadas maiores nem certifica regularidade. Confira os horários afetados.", target: "team", action: "Conferir os horários afetados" },
  MEAL_INTERVAL: { title: "Intervalo insuficiente no horário proposto", instruction: "Confira os períodos de trabalho e o intervalo do turno indicado. Intervalo e duração total da jornada são medidas diferentes.", target: "team", action: "Conferir o horário do colaborador" },
  ABSENCE_AVAILABILITY: { title: "Disponibilidade reduzida por afastamento", instruction: "O afastamento reduz a disponibilidade no período informado. Nenhuma correção é necessária por esse tratamento; confira as datas somente se o registro estiver incorreto.", target: "roster", action: "Consultar afastamento do colaborador" },
  EMPLOYMENT_AVAILABILITY: { title: "Disponibilidade limitada pelo vínculo", instruction: "A admissão ou o encerramento do vínculo limita os dias disponíveis da semana, não a jornada contratual. Nenhuma correção é necessária se as datas estiverem corretas.", target: "team", action: "Consultar datas do vínculo" },
  HISTORY_UNVERIFIED: { title: "Continuidade anterior não conferida", instruction: "O cálculo usa apenas o histórico conhecido. Para conferir a passagem entre períodos, acrescente os registros reais anteriores; não preencha folgas por suposição.", target: "team", action: "Conferir histórico disponível" },
  HISTORY_UNKNOWN: { title: "Histórico anterior não informado", instruction: "É possível continuar a simulação, mas a continuidade anterior permanece sem conferência. Informe registros reais somente quando disponíveis.", target: "team", action: "Conferir histórico disponível" },
  SCHEDULE_UNVERIFIED: { title: "Cobertura horária não apurada", instruction: "Pessoas sem horário definido não contam como cobertura garantida por horário. Informe os horários quando conhecidos; não use o cargo para presumir dispensa de controle.", target: "team", action: "Conferir horários não informados" },
  SCENARIO_OUTDATED: { title: "Atualizar a proposta", instruction: "O cenário mudou. Gere e aplique uma nova proposta para atualizar horários, folgas e cobertura, depois salve a revisão.", target: "generate", action: "Gerar proposta atualizada" },
  DAY_PENDING: { title: "Folgas ainda não geradas", instruction: "Peça uma sugestão em massa. O sistema distribui trabalho e folgas para toda a equipe incluída, preservando as decisões bloqueadas.", target: "generate", action: "Gerar proposta mensal" },
  POLICY_PENDING: { title: "Confirmar as regras da filial", instruction: "Você pode gerar e conferir o rascunho. Antes de publicar, informe a norma aplicável e o responsável, e confirme a revisão uma vez para a filial.", target: "rules", action: "Conferir regras da filial" },
  POLICY_VALIDITY: { title: "Ajustar a vigência da norma", instruction: "A norma informada precisa abranger todo o período da escala.", target: "rules", action: "Conferir vigência" },
  CCT_VALIDITY: { title: "Atualizar a convenção coletiva", instruction: "O período está fora da vigência da CCT cadastrada. Confira o instrumento aplicável antes de continuar.", target: "rules", action: "Conferir convenção" },
  COVERAGE_PENDING: { title: "Cobertura dos setores ainda não sugerida", instruction: "A sugestão em massa completa a estimativa de cobertura que estiver faltando. Confira os mínimos da operação antes de publicar.", target: "generate", action: "Sugerir para toda a filial" },
  COVERAGE_REVIEW_PENDING: { title: "Referência automática de cobertura", instruction: "A distribuição estimada não comprova a necessidade da loja. Confira os horários e informe mínimos somente quando houver uma necessidade operacional conhecida.", target: "coverage", action: "Consultar cobertura por setor" },
  ESTIMATED_COVERAGE_GAP: { title: "Distribuição abaixo da referência estimada", instruction: "Compare as faixas com a operação real. A diferença em relação à estimativa não prova falta de pessoal; avalie turnos e folgas sem mudar bloqueios individuais.", target: "coverage", action: "Conferir faixas abaixo da estimativa" },
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
