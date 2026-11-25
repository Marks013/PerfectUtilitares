# Roteiro de execução: seleção e evolução do Solver de Escalas

**Estado:** planejamento revisado, sem implementação ou implantação. **Base de código:** main f78c691edbeaf16283f534bcacd8db1b4b7d5e66. **Revisão documental anterior:** 41fa40371b3ed3a2b3674d53a2f41b960d348fc5. **Data:** 25/11/2026. Este arquivo é a entrada do plano e a fonte de verdade para ordem de trabalho, seleção e conjunto de cenários. A [especificação executável](ESPECIFICACAO-EXECUTAVEL-TIMEFOLD-2026-11-25.md) governa contratos, evidências, métricas e gates G0–G9; a [matriz de travas](MATRIZ-TRAVAS-TIMEFOLD-2026-11-25.md) inicia o inventário de domínio. Demais documentos são complementos, não cronogramas paralelos. Nenhum gate técnico está aprovado. Não usar a documentação como autorização de acesso ao servidor ou de deploy.

## 1. Decisão de engenharia

**Objetivo:** produzir mais propostas novas, completas e válidas dentro dos prazos atuais, com cobertura, folgas, liderança, estabilidade e segurança pelo menos equivalentes. Reduzir custo computacional e complexidade acidental quando comprovado. Linguagem/arquitetura não são critério de superioridade matemática.

- Referência obrigatória: OR-Tools CP-SAT da main auditada, imagem/digest e configuração atuais congelados, sem alterar pesos, parâmetros ou regras para beneficiar uma variante.
- Desafiante prioritário: Timefold Community, biblioteca com integração Java isolada; provar modelagem e busca incremental antes de construir o serviço completo.
- Segunda opção condicional: SolverForge. Fazer avaliação curta de licença, API, versão fixada e capacidade de representar as mesmas regras se Timefold não superar a referência, se resultado for inconclusivo ou se houver hipótese concreta de ganho adicional aprovada. Não construir os dois serviços simultaneamente.
- Reserva: reformulação central do CP-SAT por padrões, SCIP/HiGHS/MILP, híbridos. Só abrir spike específico após um gargalo mensurado ou evidência preliminar promissora; não repetir tuning, heurísticas, recortes ou fases já tentadas. Alternativa comercial exige aprovação independente.
- Se Timefold não ganhar, manter CP-SAT produtivo; se Timefold ganhar, avançar para os gates de integração e capacidade, sem troca automática. Se outra opção ganhar, revisar a arquitetura em PR próprio.

A seleção inicial não certifica o melhor solver do mercado; é uma decisão proporcional ao custo de engenharia, dados disponíveis, objetivos e restrições desta operação. O [parecer comparativo](SELECAO-COMPARATIVA-MOTORES-2026-11-25.md) documenta a literatura e os benchmarks externos como evidência exploratória.

## 2. Base operacional e evidência disponível

Conferência local dos anexos entregues pelo responsável: CSV FPRE136 (relatório de horários originais) e PDF de uma revisão 14, dezembro de 2026, 28 páginas. CSV lido como CP1252 e registros deduplicados por filial/matrícula; PDF lido pelo texto e linhas de 31 células; cruzamento em memória. Somente estatísticas agregadas de dimensionamento são registradas aqui. Nenhum nome, matrícula, horário individual, CSV, PDF, payload, hash pessoal ou fixture real é publicado no repositório.

| Dimensão observada | Valor / interpretação |
| --- | --- |
| Operação declarada pelo responsável | 9 filiais, 2 somente horários, 7 horários e folgas; processamento independente por filial |
| Cadastros no FPRE136 | 728 em 9 filiais; tamanhos observados de 24 a 143 |
| Perfil das referências | 627 com marcações não zeradas e 101 com quatro marcações zeradas; não inferir condição jurídica ou participação apenas do relógio |
| Duração principal importada | 506 registros de 7h20, 76 de 8h, 43 com duração positiva <=6h e 2 de 7h; 101 zerados |
| Diversidade dos horários | 85 tuplas principais não zeradas; 95 combinações de dia principal + sábado entre esses registros |
| Maior filial no CSV | 143 cadastros |
| PDF da maior filial | 139 pessoas distintas, todas correspondentes ao CSV; 124 linhas de grade (109 com relógio, 15 ENC), 9 referências sem grade diária e 6 exclusões explícitas; 4 registros do setor AFASTADOS fora do PDF |
| Grade apresentada | 10 setores, 31 dias, 3.844 células, 14 turnos temporizados usados; um único código de trabalho por pessoa no resultado visível |
| Distribuição de células | 2.289 WORK com relógio, 305 ENC, 1.126 F, 124 FE; maior sequência visível de trabalho = 5; todos os 124 trabalham nos 4 sábados visíveis |
| Adaptação observada | 103 dos 109 temporizados partem de 7h20 e 6 de 8h; PDF mostra jornadas de 8h24 |
| Limite técnico existente | Até 250 colaboradores, 42 dias, 120 horários de catálogo, 12.000 faixas; 10.500 posições teóricas, não quantidade de variáveis/alternativas |

As 9 referências sem grade não são prova suficiente de motivo de ausência, elegibilidade, bloqueio ou estado do solver. O PDF é RASCUNHO, não certificação de validade, publicação, qualidade ótima, configuração de entrada ou tempo de cálculo. O cruzamento não recupera demanda, histórico, política aprovada, catálogo de alternativas, decisões fixadas ou modo de geração do envelope. Não atribuir toda saída ao motor: a preparação e seleção TypeScript também participam. Os 728 não compõem uma única otimização; 124 × 42 = 5.208 é projeção ilustrativa, e 143 × 42 = 6.006 é envelope conservador de cadastros, não contagem real de decisões ativas. O máximo 250/42 é teste de capacidade, não carga típica.

**Exceção confirmada:** `planning-calendar.ts` e `planning_calendar.py` tratam 01–31/12/2026 com semana domingo–sábado como horizonte especial de 31 dias, incluindo 01–05 e 27–31 parciais. Não transformar dezembro automaticamente em seis semanas completas; demais meses seguem o horizonte técnico efetivo, distinto do mês visível. Natal fechado não é OFF. A grade visível não substitui histórico anterior/futuro e reservas de fronteira.

## 3. Novos achados de auditoria F34–F42

| ID | Prioridade | Achado / evidência | Ajuste obrigatório |
| --- | --- | --- | --- |
| F34 | P0 | O plano tratava 250/6 como parâmetro central; anexos mostram maior cadastro de 143 e grade de 124/31. | Dimensionar casos representativos da operação, sem remover 250/6 de capacidade. Registrar cadastro, participantes, dias ativos, entidades movíveis, domínio efetivo, faixas e densidade. |
| F35 | P0 | OPERACAO.md e TURNOS-E-RELATORIOS.md: “Só horários” sem grade prepara referências; com grade preserva classes dos dias. Solver.py:366–412 exige grade completa para HOURS_ONLY. | Separar preparação sem solve, HOURS_ONLY com grade e geração conjunta. Confirmar os modos efetivamente usados pelas duas filiais no ambiente, não presumir configuração. |
| F36 | P0 | generation.ts:61–264 já aplica elegibilidade, referência importada fixa, opções por duração/manual/lock; limita novas alternativas (12 por pessoa, 120 no catálogo). O PDF tem um código de trabalho por pessoa, não prova que só existia uma opção legal. | Reutilizar preparação TS e medir histograma de alternativas admissíveis antes/depois de filtros. Não permitir turnos de outros perfis nem congelar escolhas apenas por serem iguais na saída. |
| F37 | P0 | hints.py:109–216 já enumera máscaras semanais e verifica fronteiras; solver.py:490–544 usa variáveis diárias; optimization.py:676–860 mantém modelo conjunto, clones, bairros, orçamento e hints. | Não vender máscaras semanais, caches ou LNS como novidade do CP-SAT. Apenas representação central por padrões/automato seria hipótese distinta; deixá-la em reserva até perfil demonstrar benefício potencial. |
| F38 | P0 | Experimento 30/10: 140 execuções em 7 filiais, todas válidas, candidata reprovada em qualidade. PR #61: 45 commits, fechado sem merge, benchmark 115/6 148.176→150.192 pessoa-minutos, spread 10→12; comparação com seed compartilhada empatou. | Preservar baseline atual, testar Timefold primeiro, medir construção, primeiro incumbente, busca e pós-processamento; separar seed comum de construção própria. Histórico não prova impossibilidade de melhorar CP-SAT nem superioridade de Timefold. |
| F39 | P0 | A exceção dezembro tem calendário parcial, feriado fechado, proteção de referência e recuperação de presença de prazo maior. | Fixture obrigatória de 31 dias, casos de início/fim parcial, 25/12, recuperação admissível e grade anterior inválida, fronteiras com histórico; não só 115/42 genérico. |
| F40 | P0 | eligibility.ts exclui setor normalizado AFASTADOS da projeção operacional; ADMINISTRATIVO não é sinônimo. Aprendizes/curta jornada possuem regras de exclusão específicas; ENC/DUTY não é presença horária. | Proteger cadastro/histórico, não excluir todo ADMINISTRATIVO; testar referência base sem grade, MISSING, UNTIMED, inclusão/exclusão explícita e horários parcialmente zerados. |
| F41 | P1 | A principal métrica é qualidade no prazo, não volume de moves. Busca local pode atravessar soluções hard-negativas e perder tempo em movimentos que desfazem dois descansos ou cobertura. | Medir construção e recuperação separadas, contraexemplos de troca composta, seed verificada e sem seed. Preservar a melhor proposta externamente admissível; bloquear publicação/cancelamento incorretos. |
| F42 | P1 | Realidade de nove filiais não significa nove solves concorrentes; duas podem nem precisar de solve. | Simular sequência de solicitações e concorrência com busy/retry, fila interna zero; nenhuma execução combinada de 728 pessoas. Medir latência fim a fim por tipo de fluxo e efeito no host. |

Fontes internas, todas na main fixada: [OPERACAO.md](https://github.com/Marks013/PerfectUtilitares/blob/f78c691edbeaf16283f534bcacd8db1b4b7d5e66/docs/escalas/OPERACAO.md), [TURNOS-E-RELATORIOS.md](https://github.com/Marks013/PerfectUtilitares/blob/f78c691edbeaf16283f534bcacd8db1b4b7d5e66/docs/escalas/TURNOS-E-RELATORIOS.md), [plano histórico](https://github.com/Marks013/PerfectUtilitares/blob/f78c691edbeaf16283f534bcacd8db1b4b7d5e66/docs/escalas/PLANO-SOLVER-2026-10-29.md), [experimento de 30/10](https://github.com/Marks013/PerfectUtilitares/blob/f78c691edbeaf16283f534bcacd8db1b4b7d5e66/docs/escalas/FECHAMENTO-RESSALVAS-2026-10-30.md), [PR #61](https://github.com/Marks013/PerfectUtilitares/pull/61), [benchmark reprovado](https://github.com/Marks013/PerfectUtilitares/actions/runs/44961483320), `web/src/lib/escalas/{generation,eligibility,planning-calendar,solver-client,solver-transport,roster-quality,coverage-protection}.ts`, `web/ops/escalas/{solver,optimization,hints,planning_calendar,rest_configuration,runtime_settings}.py`. As observações de anexos foram processadas localmente; não anexar a fonte a este PR.

## 4. O que permanece e o que precisa mudar

**Não duplicar o que funciona:** importação FPRE136/FPHI105, classificação, preparação de horários, adaptação para 8h24 quando aplicável (não ampliar contratos explicitamente distintos), catálogo global, cálculo de demanda, referências, persistência, política aprovada, validação, comparação e exportação permanecem na aplicação. O motor recebe apenas decisões elegíveis e fatos necessários. O benchmark de kernel captura uma vez o envelope completo de requestSolver, incluindo parâmetros privados, mas sem segredos. O benchmark de produto usa as mesmas rotinas TypeScript.

**Não portar mecanicamente:** BoolVar duplicadas, clones de modelos por fase, snapshots por índice, micro-orçamento, hints específicos do CP-SAT, igualdades auxiliares, recortes codificados e reparos desenhados para a geometria CP-SAT. Preservar a intenção semântica dessas travas. A saída estrita continua compatível e não fabrica prova de ótimo/inviabilidade.

**Ordem de objetivos observada na main (`solver.py`:842–938):**

COVERAGE → SUNDAY_COVERAGE → SUNDAY_PEAK → MOVEMENT_COVERAGE → CLOSING_COVERAGE → UNTIMED_ROTATION → SUNDAY_BALANCE → REST_SPACING → LEADERSHIP → SATURDAY_BALANCE → REST_DISTRIBUTION → REST_ROTATION → PEOPLE_CHANGED → STABILITY → PREFERENCES → TIE_BREAK.

A lista é ordem nominal das fases, não uma especificação de pesos universal. O objetivo COVERAGE incorpora abertura de dezembro; guardas por setor/mês/domingo/fechamento/prioridade/cargo e picos são estabelecidas em momentos próprios; a recuperação especial possui caminho distinto. O seletor TS rejeita perda de cobertura protegida, liderança e janelas de descanso, admite certas melhorias operacionais antes do desempate de distribuição. G0 exige matriz de precedência condicional com conflitos deliberados, não copiar 16 níveis às cegas nem somar todas as penalidades. Em referência inicial inválida/incomparável usar os guardas e a semântica atuais; ausência de referência não é licença para relaxar regras.

## 5. Spike Timefold: modelo mínimo, depois prova completa

| Passo | Hipótese | Evidência necessária |
| --- | --- | --- |
| M0 | Reusar o catálogo de opções preparado; decompor fatos imutáveis vs decisões | Mapeamento reversível de WORK/OFF/DUTY/ABSENCE/HOLIDAY e de locks/atributos; mesmos dados de entrada e referência |
| M1 | Entidade diária com opção admissível, pin somente quando toda decisão é fixa | Testes de legalidade, contagem e zero de faixa (incluindo demanda sem trabalhador); medir cardinalidade, inicialização e score |
| M2 | Para horários fixos, conjunto OFF ou WORK no turno permitido (DUTY se aplicável); para multiopção, apenas domínio real | Verificar equivalência com todas as alternativas e exceções; sem inferir fixação pelo PDF |
| M3 | Busca de troca/mudança de dias, com movimento composto entre dias/semanas quando necessário | Contraexemplos 5x2, fronteiras, turnos e cobertura protegida. Testar movimentos que preservem número de descansos e participações. Não assumir swap nativo compatível com domínios distintos. |
| M4 | Comparar uma representação semanal somente se M1/M2/M3 mostrarem barreira estrutural | Precomputar padrões por perfil e estado de fronteira; medir quantidade de padrões, footprint e conectividade; prova de que não exclui soluções legais |
| M5 | Configurar score incremental e local search | Hard/medium/soft como primeira hipótese, BendableScore somente se precedência exigir; avaliar cache de intervalos, joins indexados e agregação com fatos explícitos de demanda. Sem recomputar todo mês a cada movimento. |
| M6 | Construção inicial + busca local padrão; comparar Late Acceptance/Tabu apenas após diagnóstico | Avaliar sem seed e seed comum válida; medir primeira solução aceita e curva de qualidade; limite de ajuste pré-registrado (poucas variantes), não varrer centenas de pesos. |

A documentação Timefold 2.8 confirma que local search parte de solução inicializada e mantém melhor solução encontrada, usa movimentos e pontuação incremental; termina por prazo sem prova matemática de ótimo. Para metas curtas, custo de inicialização, passos/moves e filtros precisam ser medidos. Ver https://docs.timefold.ai/timefold-solver/latest/optimization-algorithms/local-search , https://docs.timefold.ai/timefold-solver/latest/optimization-algorithms/optimization-algorithms , https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/performance , https://docs.timefold.ai/timefold-solver/latest/optimization-algorithms/overview . Não depender de Constraint Profiling Enterprise ou de serviço Preview. Configuração exata das APIs e BOMs só após build do spike.

**Armadilha importante:** hard zero interno não basta. Constraints sobre grupos criados por presença podem ignorar um setor/faixa com zero pessoas; testar explicitamente demand facts sem match. Não aceitar solução parcialmente inicializada, saída sem registros ou candidato hard-válido que o seletor TS rejeite. Se o melhor score interno não for a melhor proposta admissível, testar correção de score/guardas e seleção de incumbentes admissíveis, contabilizando custo; manter a referência não conta como nova geração.

## 6. Matriz de ensaios priorizada

Todos os cenários de CI são sintéticos, construídos de regras do código e estatísticas amplas (não copiar escalas reais ou grupos raros pessoa a pessoa). Manter fixtures de regressão existentes. Para dado real, execução local autorizada no ambiente controlado, sem payload/log externo.

| Família | Casos | Finalidade |
| --- | --- | --- |
| H0 | Só horários sem grade: perfis de 7h20/8h, quatro zeros, jornada curta, horário incompleto e manual | Paridade da preparação/exportação; não medir solve inexistente nem criar dias |
| H1 | HOURS_ONLY com grade completa (pequena e grande), bloqueio/ausência, referência fixa e múltiplas opções | Alterar só relógios de WORK não bloqueado; não alterar kind, dia ou quantidade |
| R0 | 1/1, 10/1, casos enumeráveis positivos e negativos, setores 1–2 pessoas, sem referência e referência inválida | Oráculo de regras, inviabilidade conhecida, transição, troca e presença zero |
| R1 | 50/4 e 115/6, 115/6 com lideranças UNTIMED, REST_ONLY e DAYS_AND_HOURS | Comparabilidade com regressões históricas, coortes, relógios e construção/reparo |
| R2 | Fixture sintética grande representativa: ~143 cadastros, ~124 participantes com grade, ~109 temporizados e ~15 sem relógio, mistura de grupos pequenos/grandes, ~14 turnos usados | Caso principal: dezembro 31 dias, sem copiar a distribuição pessoal; estimativa e confirmação separadas; seed comum e construção própria |
| R3 | Mesma família R2 em mês regular, 4–6 semanas técnicas, 40/42/44h, viradas, jornadas mistas, overnight, imports/ausências/locks | Continuidade de calendário e carga, sem generalizar a exceção dezembro |
| R4 | Dezembro com referência admitida, abertura, feriado 25/12, recuperação de presença por setor/cargo, 23s especial | Guardas de serviço protegido e aceitação condicional |
| S0 | 250/42; poucos valores e até 12 alternativas reais por perfil, variar densidade/12.000 faixas e bandas perto do limite | Capacidade máxima, tamanho de domínio e custo de construção; não declarar 250/42 típico |
| O0 | sequência sintética de nove filiais, 2 fluxo horário e 7 combinado, concorrência/cancelamento/falha/retry | Medir fila, 429, limpeza, isolamento; sem nove solves simultâneos |

Para comparação final, congelar casos de calibração e holdout separados antes de ajustar. Teste adversarial legal sem solução conhecida não é o mesmo que caso de inviabilidade matematicamente demonstrada. Para cada caso registrar tipo de operação, referências, presença de seed, tipo de semana, contagem de ativos/excluídos/fixos, distribuição de domínio, bandas de demanda, digest de código e configuração.

## 7. Protocolo enxuto de implementação e aceitação

| Entrega / PR futuro | Gates | Resultado concreto / stop |
| --- | --- | --- |
| E0 — especificação semântica e perfil da carga | G0 | Inventário exaustivo por sub-regra, teste positivo/negativo/fronteira e fonte; casos acima; medir em dados sintéticos a geometria da main; documentar campos não disponíveis. Sem nova dependência. |
| E1 — comparador e baseline | G0/G1 | Extrair fixture sem alteração de semântica; congelar payload/validador/baseline, harness kernel + fluxo produto, métricas, verificação de isolamento e falhas. Rodar CP-SAT atual e reproduzir relatório. |
| E2 — spike Timefold sem endpoints produtivos | G1 | Build ARM64/JDK/BOM fixo, M0–M3 em casos pequenos/50/4, prova da representação, perfis de montagem/score e primeira solução. Se não promissor, uma correção dirigida; se falhar, decidir SolverForge ou reserva. |
| E3 — regras e prioridades completas | G2/G4 | ConstraintVerifier, casos semânticos e diferencial com TS; confrontar 16 objetivos e guardas condicionais. Exigir todos os casos aplicáveis; não comparar modelo parcial como vencedor. |
| E4 — comparação decisiva de qualidade | G4/G5 | R1/R2/R3/R4/S0 com mesmos prazos/quotas e referências, curvas e holdout. Se não superior, não integrar. Se vencedor preliminar, confirmar contrato. |
| E5 — serviço e integração desabilitados | G3/G7 | /health /solve /cancel compatíveis, sem DB/credencial nova, admissão, cancelamento real, idempotência, rollback, E2E isolado. |
| E6 — capacidade e avaliação final | G5/G6/G7 | quota 1 CPU/1536 MiB/64 PIDs igual ao baseline; envelopes menores como ensaio separado, evidência ARM64, READY_IDLE, pressão, latência e limpeza. Medição passiva da A1 e teste autorizado depois do runner isolado. |
| E7 — decisão humana | G8 | Relatório de ganhos, riscos, limitações, SLO e janela aprovados; revisão de qualidade integral e plano de troca/retorno. |
| E8 — remoção condicional | G9 | Estabilidade comprovada e autorização; retirar runtime anterior só depois de rollback ensaiado e retenção de testes/referência. |

G0–G9 mantêm o significado da especificação; G3 pode ser concluído após seleção preliminar, mas antes de qualquer integração ou homologação de produto. E4 é comparação de kernel/avaliador, não autorização de serviço; em E6 repetir os gates afetados pelo adaptador. Não iniciar E7 se G0–G7 não estiverem aprovados. Não criar PR de código para candidatos de reserva antes de decisão registrada.

**Amostragem e custo de engenharia:** 5 pares de exploração por combinação, 30 pares para triagem dos cenários centrais; aprofundar somente o desafiante promissor em casos críticos. Aceite final proposto >=100 pares por combinação crítica pré-registrada (R2, R4, caso 50/4 ou 115/6 problemático e HOURS_ONLY representativo); 250/42 mantém estresse e amostra suficiente para gate de capacidade, escalando para 100 se crítico para SLO. Não multiplicar 100 por todos os cenários e configurações descartados. p99 apenas diagnóstico até plano amostral defensável; p95 acompanhado de incerteza e falhas. Pré-fixar margens de não inferioridade, orçamento de tuning, intervalos de confiança e critérios de exclusão. Semente 37 do CP-SAT permanece intacta; seeds alternativas da heurística pré-registradas. Analisar (a) construção sem seed de solução calculada pelo concorrente, (b) reparo da mesma seed válida, (c) end-to-end incluindo preparo/seleção TS. Não chamar de melhoria a referência mantida ou uma solução local TypeScript.

**Veto de decisão:** erro hard, incompletude, proteção perdida, violação de modo, ausência de cancelamento real, fuga de dados, regressão confirmada de segurança ou quebra de prazo/capacidade aprovado. Exigir não regressão nos casos/escopos protegidos e vantagem material em taxa de propostas aceitas, cobertura/faltas, latência, CPU-segundos ou memória sem piora material das demais métricas. Margens operacionais e SLO a aprovar antes dos ensaios finais; sem tolerância automática nas guardas de negócio. Se inconclusivo, manter referência e ampliar amostra somente se houver benefício provável. Não compensar filial pequena com ganho na maior; não escolher por score interno.

## 8. Dados restantes e proteção operacional

A main fornece schemas, política de referência, regras/guardas, defaults, código e regressões, histórico agregado e configuração Compose versionada. Ainda é necessário medir ou obter localmente: modo de cada filial e revisão efetiva, payload técnico preparado (incluindo históricos/ausências, datas, bounds, locks, seed, demanda e prova), parâmetros efetivamente salvos, digest de runtime implantado, contagem de domínio, CPU real/PSI/RSS/GC/threads/PIDs, tempos e SLO de outros projetos. Não deduzir essas informações dos anexos nem do default do repositório. Sem acesso autorizado/telemetria segura, manter a etapa bloqueada; não solicitar segredos nem exportar RH.

A VM A1 é compartilhada (4 OCPUs/24 GB informados). Benchmark primeiro em runner isolado ARM64, sempre sequencial, A/B–B/A, só um motor de teste ativo, sem rede externa/dados produtivos. Para HTTP usar rede interna descartável; para kernel sem rede. Nunca parar `escalas-solver` de produção, nem modificar quotas de terceiros. Testar 0,5/0,75 CPU e memória 1–1,5 GiB apenas em condições idênticas e com margem demonstrada. READY_IDLE com fila interna zero se vencedor exigir JVM; scale-to-zero desabilitado. Prazos normal 12/18/20 s e especial 23/27/32 s de busca/processo/transporte; cancelamento HTTP 3,5 s. Capturar custo de preparação, construção, otimização, serialização e validação separadamente e respeitar o deadline residual. Não conceder tempo extra à candidata. Ver [ativação e isolamento](ATIVACAO-INTELIGENTE-TIMEFOLD-A1-2026-11-25.md) e [especificação](ESPECIFICACAO-EXECUTAVEL-TIMEFOLD-2026-11-25.md).

**Auditoria atual:** anexos conferidos, regras e histórico do repositório inspecionados, estratégia revisada; nenhuma execução de solver, build de Timefold, benchmark, medição real de host, inventário exaustivo ou certificação jurídica realizada. Não há vencedor comprovado. Nenhum código ou produção alterado.
