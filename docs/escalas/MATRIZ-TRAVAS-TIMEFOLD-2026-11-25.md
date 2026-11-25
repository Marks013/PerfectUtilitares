# Inventário de regras e travas CP-SAT para substituição por Timefold

Status: AUDITORIA INICIAL; toda linha precisa de teste semântico e revisão antes de implementação. Código de referência: main f78c691edbeaf16283f534bcacd8db1b4b7d5e66 em 25/11/2026. Atualizar com novos arquivos e mudanças da main antes de iniciar a migração.

Classificação:
- D: REGRA de domínio/contrato; deve existir no Timefold ou permanecer como guarda independente do produto.
- S: SEGURANÇA/integridade/persistência; permanece na camada apropriada, não na pontuação do motor.
- A: ARTEFATO CP-SAT; deve desaparecer, substituído por mecanismo nativo ou rejeição controlada.
- P: PROVISÓRIO/OPCIONAL; confirmar regra com responsável, não elevar a hard implicitamente.

## 1. Regras de domínio que precisam continuar funcionando

| ID | Código existente auditado | Categoria | Semântica exigida após troca | Implementação Timefold recomendada | Testes obrigatórios |
| --- | --- | --- | --- | --- | --- |
| R01 | types.ts; schema.ts; model_input.py | D | 1 a 6 semanas completas, datas válidas, calendário salvo MONDAY ou novo SUNDAY, 250 empregados, 42 dias, timezone America/Sao_Paulo | DTO e validação de domínio, fatos de calendário imutáveis | Semana de origem, virada de mês, limites, timezone |
| R02 | solver.py:solve/_solve; eligibility TypeScript | D/S | Excluir planejamento de empregados desabilitados, reter registros históricos sem usá-los como força de trabalho | Value Range somente para ativos; retorno preserva desabilitados em adaptador, não em planning entities | Inativo, desligamento, contratado no meio do mês |
| R03 | solver.py:admissible; policy-reference.json | D | 40/42/44 horas, transições 2026-12-16 e 2027-12-16 quando aplicáveis, limites diários, compensação | Pré-filtrar AssignmentOption elegíveis pela política aprovada; Constraint Streams confirma totais | Transições, dia exato, contrato individual, 42 misto |
| R04 | solver.py:_rest, _civil_rest, occupied_dates | D | Descanso entre jornadas, repouso semanal, turnos cruzando 24h, ocupação civil do dia seguinte | Intervalos reais em minutos e Instant/ZonedDateTime, regras Constraint Streams | Overnight, feriados contíguos, DST e fronteira técnica |
| R05 | rest_configuration.py; solver.py:_streaks | D | 5 dias consecutivos na geração atual, dias fixos, modo VARIABLE/MIXED/FIXED e padrões ANY/CONSECUTIVE/PREFER_CONSECUTIVE | Hard para regra obrigatória; soft para preferir consecutivas | História real, 1-6 semanas, fim/início publicado |
| R06 | weekend_balance.py; solver.py:sunday_limit | D | Classificação explícita de domingos PROTECTIVE/UNREVIEWED/CLT_386/COMMERCE e máximo individual; sem inferir por nome do cargo | Regra de histórico+ocupação civil, ConstraintVerifier com casos de 1/2 | Domingo consecutivo, histórico e feriado |
| R07 | types.ts; schema.ts; solver.py:_solve | D/S | WORK/DUTY/OFF/ABSENCE/HOLIDAY; não transformar DUTY em horas; não alterar afastamentos/férias/bloqueios | Entidade por empregado-dia + opção; @PlanningPin para bloqueados; status/mode em Value Range | OFF e WORK bloqueados, ausência, DUTY sem relógio |
| R08 | solver.py; generation.ts; hours-reference | D | REST_ONLY altera folgas preservando referências de trabalho; HOURS_ONLY muda apenas relógios sem alterar tipo do dia; DAYS_AND_HOURS ambos onde permitido | Restrição do conjunto de valores por modo, evitar pinning completo de HOURS_ONLY | Todos os modos com locks, histórico, turnos importados |
| R09 | solver.py; manualShiftByDate; FPRE136 | D | Turno fixado e alternativa manual por data, importações não autorizam contrato fictício | AssignmentOption restrita à data e às opções efetivamente admitidas | manual override, lock de turno, clock importado |
| R10 | solver.py:_coverage; coverage_service_protection.py | D/S | Cobertura hard confirmada e faixas de serviço protegidas por setor, cargo e horário civil, inclusive abertura/fechamento | Pré-computar janelas imutáveis; Constraint Streams hard e comparação independente TS | Fiscal não substitui zelador; presença por minuto e fechamento |
| R11 | coverage_comparison.py; roster-quality.ts | D/S | Não piorar cobertura e serviço publicado em horizontes/mês/domingos comparáveis | Fato de limites de comparação + veto independente de aceitação | Recorte dezembro, dia/semana/setor e horários |
| R12 | solver.py:_coverage; schema coverageReview | P/D | Demanda ESTIMATED é objetivo operacional, não mínimo aprovado; CONFIRMED depende do dado explícito | Medium score de pessoas-minutos faltantes; hard somente aprovado | Nenhum número presumido, aviso de estimativa |
| R13 | solver.py:_coverage; sunday_peak.py; leadership.py | D/P | Priorização de domingos, fechamento, movimentação e presença de líder, sem contar líder como substituto de função | Medium para risco operacional, soft para preferências, conforme regra documentada | Sem demanda não inventar pico; líder com cargo distinto |
| R14 | weekend_balance.py; rest_quality.py; optimization.py | D/P | Justiça de sábados/domingos somente entre comparáveis por função e relógio; pares e espaçamento de folgas | Score soft com dados de oportunidade; nenhum mínimo de pares inventado | Coortes unitárias, ausências, feriados, rodízio |
| R15 | solver.py:_solve; planning_calendar.py | D/S | Histórico real, planejamento publicado anterior e futuro, revisão imutável e continuidade | Fatos imutáveis; decisões já publicadas fixadas por opção válida | Margem de -21/+21 dias, não duplicar registros |
| R16 | labor-rules TS; policy_reference.py; solver.py:cct_admissible | P | Documentos coletivos/certidões só habilitam regras aprovadas explicitamente. Na main, cct_admissible retorna True; não inventar veto documental novo | Validação de política no aplicativo; fatos confiáveis no Solver | Documento vencido, simulação e alteração de regime |
| R17 | global-workforce-* TS; manual absence | S | Afastamentos confirmados persistem em revisão/tenant; publicação não altera outro ramo | Permanecer fora do motor, fluxo Next.js/DB | Revisions concorrentes, tenant distinto, excluído |
| R18 | solver-client.ts; validation.ts; proposal-proof.ts | S | Proposta completa, válida, não degradada, assinada e restrita ao workspace antes de aplicar/publicar | Verificador TS e proof existentes, retorno normalizado | Violação hard rejeita; prova expirada rejeita |
| R19 | model_input.py; service_security.py; service_operations.py | S | Auth Bearer, requestId/cancelToken, limite 8 MiB, 1 operação pesada, cancel/timeout e erros saneados | Quarkus REST + Java security adapter + SolverManager lifecycle | Interrupção, 429, 409, cancel antes e depois |
| R20 | types.ts; policy + shifts | D | Pausa paga ou não, limiar de refeição, jornada > 1440 offsets, hora na região de São Paulo | Precomputar intervalos efetivos, Constraint Streams | Segmentos, pausas e fronteira civil |

**G0 exige** que cada R01-R20 tenha pelo menos um teste com ID rastreável, preferência por reutilizar fixtures sintéticas e implementação espelhada do verificador independente. A matriz não equivale a prova de que a regra já está implantada em Java.

## 2. Travas que existem para trabalhar em volta do CP-SAT e NÃO devem migrar

| ID | Local | O que faz hoje | Destino Timefold | Decisão |
| --- | --- | --- | --- | --- |
| A01 | solver.py:work/off/choices, cp_model | BoolVar por pessoa/data e por turno; auxiliares de intervalo e soma | Planning Entity por pessoa-data + AssignmentOption como valor | ELIMINAR estrutura CP |
| A02 | solver.py:_feasibility_hints; hints.py | Heurística de seed com tentativas, rechecagens e fixed hints | Construction Heuristic, solução inicial pinada/salva quando compatível | SUBSTITUIR; manter só mapping válido |
| A03 | optimization.py:Snapshot/remember | Índices de variáveis, snapshots e hints de estado booleano | Score incremental, SolutionManager e planning clone | ELIMINAR |
| A04 | optimization.py:_movable_people/_coverage_people/_polish_people | Bairros de otimização por grupo liberando variáveis manualmente | Local Search nativa e seleção de move sob avaliação | ELIMINAR na primeira versão |
| A05 | optimization.py:_phase_budget, reserves, multi-phases | Microgerenciamento de segundos do CP-SAT e sequenciamento de objetivos | Hierarquia HardMediumSoftScore e terminação nativa; limites de tempo operacionais permanecem | ELIMINAR mecanística |
| A06 | optimization.py/model.clone/domain.clear | Copiar CP-SAT, congelar índice, resolver reparos | @PlanningPin, Value Range, move filtering nativo e hard constraints | ELIMINAR |
| A07 | sunday_peak.py; weekend_balance.py | max/min/div igualdade com variáveis auxiliares | Constraint Streams com agregação ou penalty de justiça, sem booleanos extras | REIMPLEMENTAR sem artefatos CP |
| A08 | diagnostics.py:ConflictRegistry | Prova diagnóstica por famílias de constraint CP-SAT | Códigos semânticos + verificação e métricas independentes TypeScript; não assumir Score Analysis Enterprise na edição Community nem fingir prova de inviabilidade | REDESENHAR |
| A09 | Python Dockerfile, requirements, Ruff, OR-Tools wheels | Imagem Python e locks, treinamento do CI | Gradle/Maven, Java 21, container JVM fixado | REMOVER só após cutover |
| A10 | 12s/23s, 18s/27s, busy slot | Limites da operação privada e da experiência | **NÃO remover**; trocar aplicação por contrato Timefold e cancelamento cooperativo | MANTER limite, trocar implementação |
| A11 | compare coverage/advisory repair | Alguns reparos locais de proteção do cenário salvo | A regra de não piorar é D/S; estratégia de busca CP é A | DIVIDIR obrigação da técnica |
| A12 | TRAVA de proteção de mês visível e publicação | Impede reescrever dias publicados ou de origem | Semântica deve permanecer no modelo e validador TS | MANTER, não simplificar indevidamente |

## 3. Diferenças importantes entre motores

- Timefold não traduz CpModel, OnlyEnforceIf, AddMin/Max, nem prova INFEASIBLE por timeout. Não migrar metadata de presolve, bounds, provec optimal ou membros artificiais de fases.
- Construction Heuristic, Local Search, SolverManager, ConstraintVerifier, PlanningPin e scores hierárquicos são nativos. Não adicionar outra biblioteca de metaheurística, SAT ou genetic algorithm para duplicá-los.
- Uma entidade com todos os tipos de decisão não pode ser indiscriminadamente pinada no modo HOURS_ONLY, pois neste caso só o tipo do dia é fixo e o horário pode mudar. Testar Value Range por modo ou modelo de variáveis distintas.
- Timefold não garante que normas legais estejam automaticamente corretas. Não mover regras de RH para dependência de terceiros sem formulação/validação explícita.
- As funções __solver.py__ e __optimization.py__ da main evoluíram depois do PR #61 experimental, fechado sem merge. Não usar o antigo PR como fonte da nova implementação.

## 4. Evidência, aceite e critérios de exclusão

1. Testes unitários com ConstraintVerifier por regra R01-R20 e adversariais onde as regras conflitam.
2. Todos os cenários historicamente problemáticos (A08/50 empregados e A08/115 empregados) exigem **não regressão separada**. Ganho em um cenário não paga perda noutro.
3. Hard score zero, proposta completa e verificador TypeScript aprovado antes de aceitar. Score interno diferente não é, por si, perda ou ganho.
4. Não incluir código Python/CP-SAT desnecessário no Java. Adicionar configuração especial ao Timefold só depois de benchmark mostrar que sua configuração nativa inicial é insuficiente.
5. Controle de rollout da aplicação, e não o score, impede publicação com revisão obsoleta ou perda de aprovação.

Fontes do projeto: web/ops/escalas/; web/src/lib/escalas/; web/src/app/api/escalas/; web/docker-compose.yml; .github/workflows/ci.yml. Fontes Timefold: https://docs.timefold.ai/timefold-solver/latest/domain-modeling/modeling-planning-problems e https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/overview.
