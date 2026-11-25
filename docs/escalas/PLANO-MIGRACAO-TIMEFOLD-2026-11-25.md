# Plano integral de substituição OR-Tools por Timefold Solver

Estado: PLANEJAMENTO PARA REVISÃO. Nenhuma implantação, teste com dados reais, exclusão do OR-Tools ou alteração de configuração do servidor está autorizada por este documento.

Referência auditada em 2026-11-25: main f78c691edbeaf16283f534bcacd8db1b4b7d5e66. Revalidar o SHA antes de qualquer implementação. Documentos complementares obrigatórios:
- MATRIZ-TRAVAS-TIMEFOLD-2026-11-25.md: inventário de regras e gambiarras CP-SAT.
- STACK-JAVA-TIMEFOLD-2026-11-25.md: bibliotecas, versões, plugins, segurança e dimensionamento.

## Meta e princípio de redução de complexidade

Substituir integralmente o mecanismo de otimização Python/OR-Tools CP-SAT por uma implementação dedicada Java/Timefold, mantendo comportamento e regras aprovados do PerfectUtilitares. NÃO portar tentativas heurísticas manuais, propagadores auxiliares, booleanos e clones do CP-SAT quando Timefold já fornece mecanismos de busca nativos.

O motor novo será dono de calcular um planejamento, não de autenticar usuários, gravar PostgreSQL, administrar tenants, inferir direitos trabalhistas, publicar escalas ou alterar históricos. O projeto continua a usar os validadores independentes TypeScript para decidir se a proposta pode ser aceita.

## Arquitetura

1. Biblioteca alvo: Timefold Solver Community Edition 2.8.0 (Java 21+, Apache-2.0). Timefold 2.x é a linha atual em 25/11/2026. Não misturar com exemplos 1.x nem com Spring Boot 3. Timefold Cloud/Platform e serviço nativo em Preview não serão escolhidos para o contrato privado inicial.
2. Integração: Quarkus 3.40 LTS com módulo oficial timefold-solver-quarkus, em container isolado web/ops/escalas-timefold/. Quarkus REST Jackson para DTOs separados das Planning Entities. Escolher versões exatas e dependências controladas via BOMs.
3. Contrato privado a preservar: GET /health; POST /solve com body {input}; POST /cancel; Authorization Bearer com segredo montado; X-Request-ID e X-Cancel-Token; limite de entrada 8 MiB, sanitização de erros, timeout, cancelamento e no-store. Converter apenas DTOs estáveis, jamais objetos internos Timefold em contratos públicos.
4. Next.js continuará responsável por autenticação de usuário, autorização, revisão, aprovação de política, banco, publicação, history, proposta assinada, isolamento de tenant, auditoria, comparação de cobertura, rollback e verificação independente.
5. No período de testes, o OR-Tools segue intocado e é o comparador. Timefold executa apenas com fixtures sintéticas isoladas sem conexão ao banco. Shadow opcional em homologação somente depois de gates técnicos e sem salvar respostas Timefold.
6. Atualizar ESCALAS_SOLVER_URL e o serviço escalas-solver no Compose **somente após aprovação explícita para implantação**. Nunca trocar de motor silenciosamente nem habilitar por parâmetro de cliente.

## Modelo limpo, em vez de tradução do CP-SAT

Planning Solution: quadro de funcionários, calendário, intervalos de turno, demandas e políticas como fatos imutáveis, e decisões de cada empregado/data.

Planning Entity: dia ativo do empregado; planejamento variável via valor AssignmentOption, incluindo WORK com shiftId, DUTY sem relógio, OFF. ABSENCE, HOLIDAY, WORK/OFF bloqueados e períodos publicados devem ser fixados e validados. Padrões de horas existentes restringem as alternativas em vez de inventar relógios.

Regras:
- Hard: descanso obrigatório, compatibilidade de cargo/turno/horário, contrato/intervalos, licenças, férias/ausências, dias bloqueados e serviço explicitamente obrigatório/protegido. Sem hard score negativo aceito.
- Medium: minimizar desfalque estimado por setor/cargo/faixa e perda de serviço existente, respeitando prioridades de negócio estabelecidas. Estimativas não viram mínimos hard sem aprovação.
- Soft: justiça de domingos e sábados entre grupos comparáveis, descanso espaçado, estabilidade, preferências e liderança conforme semântica aprovada.
- HardMediumSoftScore do Timefold usa inteiros long na versão 2.x; usar pontos por minuto, sem double. Não dobrar pesos enormes para simular níveis. Se três níveis não expressarem a prioridade comprovada, testar BendableScore conscientemente.
- Uso nativo: Construction Heuristic, Local Search, pinning, Value Ranges, Constraint Streams, SolverManager, terminação e ConstraintVerifier. Não reproduzir toda a máquina de fases e bairros CP-SAT.

A regra de HOURS_ONLY preserva o tipo de cada dia e deixa ajustar somente horários permitidos. REST_ONLY preserva as referências de turno quando houver WORK. Um @PlanningPin indiscriminado congelaria também o horário em HOURS_ONLY: filtrar opções ou separar entidades/variáveis conforme teste de domínio.

## Proteções de resultado, status e operação

- Validar o DTO de entrada em Java, sem confiar apenas no Zod do Next.js. Preservar schemaVersion 1, timeZone America/Sao_Paulo, semana MONDAY/SUNDAY de acordo com versão salva, datas do mês, regras de 40/42/44h e transições aprovadas, jornadas com segmentos após meia-noite e calendários publicados anterior e futuro.
- Quarkus recebe pedido privado autenticado, com tokens de cancelamento opacos e segredo montado. SolverManager oferece execução e terminateEarly; serviço precisa preservar a semântica de estado da operação e impedir ocupação da CPU após cancelamento HTTP.
- Timefold com hard score 0 e solução completa + validação TypeScript = FEASIBLE, não OPTIMAL. Timeout sem proposta completa admissível = UNKNOWN. Não declarar INFEASIBLE apenas porque a heurística esgotou o tempo.
- Aceitação independente preserva referencia por seção/faixa, horas e folgas bloqueadas, direitos aplicáveis, modo de geração, continuidade de outras semanas e métricas de cobertura. Uma melhora em outro cenário não compensa desfalque local.
- Segurança não nativa do motor: evitar logar nomes, matrículas, corpo JSON, secrets, modelo, traces de score com PII, dump de heap ou métricas por colaborador. Nenhuma rede pública do solver; nenhuma nova credencial de banco.

## Portas de decisão

| Porta | Resultado obrigatório para avançar |
| --- | --- |
| G0 Inventário | Todas as regras atuais classificadas e assinadas; fontes de verdade e casos de fronteira enumerados |
| G1 Spike | Java 21, Quarkus e Timefold compilam em CI isolada e executam um exemplo de uma semana |
| G2 Regras hard | Testes unitários por restrição (ConstraintVerifier), completos e compatíveis com TypeScript |
| G3 Contrato | /solve, /cancel, /health, auth, idempotência e timeout compatíveis, sem acesso a banco ou PII nos logs |
| G4 Paridade | Entradas controladas e mesmo cenário, sem violação; estados DAYS_AND_HOURS, REST_ONLY e HOURS_ONLY |
| G5 Cobertura/qualidade | Não aumentar faltas de pessoas-minutos por setor/cargo/faixa em 10/1, 50/4, 115/6; domingos e descanso sem regressão |
| G6 Capacidade | p50/p95, RSS, GC, memória, CPU, startup e testes de pico até 250 pessoas/42 dias medidos com margem real |
| G7 E2E isolado | Testes Playwright, verificador independente, persistência descartável e recuperação/rollback completos |
| G8 Implantação | Somente autorização posterior, qualidade total/release gates e procedimento de troca/retorno ensaiado |
| G9 Remoção | Depois de estabilidade, retirar Python/OR-Tools e scripts de CP-SAT, preservar testes semânticos e fallback de rollback |

Qualquer falta de cobertura, dia ilegal, perda de registro protegido, resultado incompleto, falha de autenticação/cancelamento ou degradação de latência/capacidade bloqueia G8. A aplicação não pode apresentar solução Timefold sem verificador independente.

## Fases propostas

F0: congelamento lógico da especificação, não da main, com auditoria de regras e licenças. Aprovação da matriz.
F1: protótipo Java isolado, projeto Maven/Quarkus/Timefold sem endpoint conectado ao app. Testes simples e Dockerfile com limites.
F2: regras hard e três modos de geração, calendário civil/histórico/futuro, preservação de referências. ConstraintVerifier com casos fronteira.
F3: cobertura por cargo/horário e metas soft, Score semântico e testes de prioridade. Sem reprodução de fases CP-SAT.
F4: endpoints compatíveis, auth secret-file, requestId/cancelToken, cancelamento, limites, readiness e métricas sanitizadas.
F5: paridade sintética com datasets 1/1, 10/1, 50/4, 115/6, 250/6. Mesmas entradas, limite de CPU e tempo, JVM aquecida, cinco ou mais repetições por semente/configuração. Instrumentar a qualidade independentemente e não confiar na comparabilidade do score entre motores.
F6: integração desabilitada por padrão em Compose CI e testes Playwright isolados com DB descartável. Teste de falha, rollback e conflito de revisão.
F7: homologação e decisão explícita; sizing em host real, security review, evidência de qualidade e qualidade local completa, sem dados reais externos.
F8: troca controlada no servidor, health/latency/qualidade monitorados e retorno ao OR-Tools se falhar.
F9: após estabilização autorizada, remoção completa de CP-SAT/Python e documentação/scripts obsoletos; garantir que nenhum consumidor dependa do processador antigo.

## Dimensionamento e desempenho

A Oracle VM.Standard.A1.Flex do usuário tem **4 OCPUs ARM64 e 24 GB RAM, compartilhados com outros projetos**. O Compose do PerfectUtilitares já declara quotas de CPU superiores à capacidade física quando somadas (PostgreSQL 1,0, app 1,5, PDF 2,0 e solver Python 1,0), embora quotas não indiquem utilização real. O Timefold NÃO receberá 2 OCPUs ou 3-4 GiB por padrão. Ensaios iniciais em ambiente isolado usarão um teto piloto de 0,50 a 0,75 OCPU e 1,0 a 1,5 GiB, ajustável somente mediante medição, sem comprometer serviços existentes. Se esses limites não forem suficientes para regras, qualidade e tempo, o deployment será reprovado em vez de tomar CPU/memória dos outros projetos.

Benchmark representativo precisa rodar Java em production mode, com compilador JIT C2 ativo e warmup medido. Não avaliar desempenho por quarkus:dev nem assumir que native-image/GraalVM é mais rápido; a própria documentação Timefold registra que JIT frequentemente vence na busca.

## Ativação inteligente por demanda (VM compartilhada)

Adotar inicialmente ativação lógica: Timefold executa somente quando pedido, com uma operação por vez, quota rígida e admissão sob pressão. O motor pode ficar pronto e ocioso entre pedidos, sem gastar CPU de busca. Escala-a-zero física por desligamento/partida automática é opcional e só será adicionada após prova de ganho de memória, testes de cold start e controlador de host com privilégio mínimo. O Next.js jamais recebe o Docker socket. Uma fila curta ou recusa controlada protege os outros projetos quando o host estiver pressionado; cancelar e terminar operações não autoriza publicar proposta incompleta. Toda alteração do protocolo de status de operações precisa de testes e versão.

Especificação detalhada: [ATIVACAO-INTELIGENTE-TIMEFOLD-A1-2026-11-25.md](ATIVACAO-INTELIGENTE-TIMEFOLD-A1-2026-11-25.md). A prova de não interferência sobre outros serviços é condição formal de G6 e G8.

## Publicação/rollback

A aplicação mantém snapshot e revisão; nenhuma proposta é publicada automaticamente. Antes de mudança de endpoint, executar npm run quality completo vinculado à fonte exata em checkout limpo, validar Compose com segredos sem revelá-los, um único npm run docker:deploy conforme AGENTS.md, health e E2E pós-release. O rollback deve voltar para imagem e URL anteriores sem reverter dados do Postgres ou destruir históricos. Produção só com aprovação posterior.

## Evidências públicas a seguir

- https://docs.timefold.ai/timefold-solver/latest/introduction
- https://docs.timefold.ai/timefold-solver/latest/quickstart/overview
- https://docs.timefold.ai/timefold-solver/latest/quickstart/quarkus/quarkus-quickstart
- https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/overview
- https://docs.timefold.ai/timefold-solver/latest/domain-modeling/modeling-planning-problems
- https://docs.timefold.ai/timefold-solver/latest/using-timefold-solver/benchmarking-and-tweaking
- https://quarkus.io/releases/
