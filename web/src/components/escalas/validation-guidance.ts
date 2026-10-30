import type { EscalaIssue } from "@/lib/escalas/types";

export type ReviewTarget = "generate" | "rules" | "coverage" | "team" | "roster" | "intervals";
type Guidance = { title: string; instruction: string; target?: ReviewTarget; action?: string };

const GUIDANCE: Record<string, Guidance> = {
  WORK_STREAK: { title: "Mais de cinco dias consecutivos", instruction: "Interrompa a sequência com uma folga ou gere uma proposta atualizada. O limite vale também entre semanas e meses, quando há histórico disponível.", target: "roster", action: "Conferir sequência na escala" },
  FIVE_BY_TWO_POLICY_OUTDATED: { title: "Recalcular o modelo 5×2", instruction: "A revisão usa um limite antigo. Gere e aplique novamente para conferir a escala com no máximo cinco dias consecutivos.", target: "generate", action: "Recalcular a proposta" },
  SIMULATION_SHORT_MEAL_FLEX: { title: "Intervalo curto flexibilizado nesta simulação", instruction: "Nesta simulação, foi dispensado o intervalo mínimo de 15 minutos em jornadas acima de quatro e até seis horas. Isso não dispensa intervalos de jornadas maiores nem certifica regularidade. Confira os horários afetados.", target: "intervals", action: "Ver opção de pausa nesta simulação" },
  MEAL_INTERVAL: { title: "Intervalo insuficiente no horário proposto", instruction: "Confira os períodos de trabalho e o intervalo do turno indicado. Intervalo e duração total da jornada são medidas diferentes.", target: "team", action: "Conferir o horário do colaborador" },
  MEAL_INTERVAL_EXCESSIVE: { title: "Pausa maior que duas horas", instruction: "Confira o intervalo desse horário. O rascunho pode continuar; antes do uso definitivo, ajuste a pausa ou confira a exceção específica.", target: "team", action: "Conferir intervalo do colaborador" },
  ABSENCE_OCCUPIED: { title: "Horário invade um afastamento", instruction: "O turno anterior termina dentro de um dia de afastamento. Ajuste esse horário; o afastamento deve ser mantido.", target: "roster", action: "Conferir dia anterior ao afastamento" },
  ABSENCE_AVAILABILITY: { title: "Disponibilidade reduzida por afastamento", instruction: "O afastamento reduz a disponibilidade no período informado. Nenhuma correção é necessária por esse tratamento; confira as datas somente se o registro estiver incorreto.", target: "roster", action: "Consultar afastamento do colaborador" },
  EMPLOYMENT_AVAILABILITY: { title: "Disponibilidade limitada pelo vínculo", instruction: "A admissão ou o encerramento do vínculo limita os dias disponíveis da semana, não a jornada contratual. Nenhuma correção é necessária se as datas estiverem corretas.", target: "team", action: "Consultar datas do vínculo" },
  HISTORY_UNVERIFIED: { title: "Continuidade anterior não conferida", instruction: "O cálculo usa apenas o histórico conhecido. Para conferir a passagem entre períodos, acrescente os registros reais anteriores; não preencha folgas por suposição.", target: "team", action: "Conferir histórico disponível" },
  HISTORY_UNKNOWN: { title: "Histórico anterior não informado", instruction: "É possível continuar a simulação, mas a continuidade anterior permanece sem conferência. Informe registros reais somente quando disponíveis.", target: "team", action: "Conferir histórico disponível" },
  SCHEDULE_UNVERIFIED: { title: "Folgas planejadas, sem horário fixo", instruction: "As folgas são planejadas normalmente. Sem horário informado, essas pessoas ficam fora da contagem por hora. Se houver um horário conhecido, acrescente-o ao cadastro.", target: "team", action: "Conferir horários não informados" },
  SCENARIO_OUTDATED: { title: "Atualizar a proposta", instruction: "O cenário mudou. Gere e aplique uma nova proposta para atualizar horários, folgas e cobertura, depois salve a revisão.", target: "generate", action: "Gerar proposta atualizada" },
  DAY_PENDING: { title: "Folgas ainda não geradas", instruction: "Peça uma sugestão em massa. O sistema distribui trabalho e folgas para toda a equipe incluída, preservando as decisões bloqueadas.", target: "generate", action: "Gerar proposta mensal" },
  POLICY_PENDING: { title: "Conferência antes de publicar", instruction: "Não é necessário preencher documentos para testar o rascunho. A conferência formal deve ser feita antes da publicação." },
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


const INFORMATION_CODES = new Set(["POLICY_PENDING", "POLICY_VALIDITY", "CCT_VALIDITY", "COMPENSATION_REQUIRED", "COLLECTIVE_AGREEMENT_REQUIRED", "CCT_SUNDAY_CERTIFICATE", "CCT_HOLIDAY_CERTIFICATE", "CCT_NIGHT_CERTIFICATE", "SCHEDULE_UNVERIFIED", "SHORT_REFERENCE_PRESERVED", "HISTORY_UNVERIFIED", "HISTORY_UNKNOWN", "NIGHT_REVIEW", "COVERAGE_REVIEW_PENDING"]);

/** Presentation only: the original validation and publication decision stay unchanged. */
export function isReviewInformation(code: string, severity: EscalaIssue["severity"]) {
  return severity !== "ERROR" && INFORMATION_CODES.has(code);
}

export function reviewNoticeText(code: string): { title: string; message: string } | undefined {
  const text: Record<string, { title: string; message: string }> = {
    POLICY_PENDING: { title: "Conferência antes de publicar", message: "Você já pode gerar, revisar e exportar o rascunho. A conferência das regras da filial fica para a publicação formal." },
    POLICY_VALIDITY: { title: "Conferência das datas da regra", message: "A regra salva não cobre todas as datas. Isso precisa de revisão antes da publicação formal." },
    SCHEDULE_UNVERIFIED: { title: "Folgas planejadas, sem horário fixo", message: "Essas pessoas participam das folgas. Como não têm horário informado, ficam fora da contagem de pessoas por hora." },
    SHORT_REFERENCE_PRESERVED: { title: "Horário reduzido mantido", message: "O horário mais curto da importação foi mantido. O sistema não aumentou essa jornada sozinho." },
    HISTORY_UNVERIFIED: { title: "Sem dados do mês anterior", message: "A proposta usa os dias conhecidos. Se precisar conferir a passagem entre meses, acrescente o histórico real." },
    HISTORY_UNKNOWN: { title: "Sem dados do mês anterior", message: "O histórico é opcional para o rascunho. Informe somente os dias que você conhece." },
    NIGHT_REVIEW: { title: "Horário após as 22h", message: "A pessoa continua no rascunho com o horário informado. Confira o cálculo noturno antes do uso definitivo." },
    COVERAGE_REVIEW_PENDING: { title: "Cobertura sugerida automaticamente", message: "A sugestão ajuda a distribuir a equipe. Confira os setores e horários com menos pessoas; não é uma garantia de atendimento." },
    COMPENSATION_REQUIRED: { title: "Jornada acima de 8h no rascunho", message: "A proposta usa a jornada escolhida. A autorização necessária deve ser conferida antes do uso definitivo." },
  };
  return text[code];
}

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
