# Auditoria crítica da migração para Timefold Solver

Data: 2026-11-25. Estado: AUDITORIA DOCUMENTAL, SEM execução Java no host, sem deploy, sem mudança de backend ou dados. Base: PerfectUtilitares main f78c691edbeaf16283f534bcacd8db1b4b7d5e66 e documentação do PR #70 no commit 86bdd5e668c2878eb8323834c0605212dfe03df6. Este documento inclui constatações do código-fonte, informações de documentação externa e hipóteses que só um spike confirma.

## Sumário e veredito

Arquitetura **factível, mas migração ainda NÃO aprovada**. Há cinco bloqueios principais antes de implementar a integração: (1) inventário R01-R20 não comprova exaustividade; (2) hierarquia de score ainda sem equivalência de todas as prioridades; (3) modelo dia/pessoa pode ficar grande para a CPU compartilhada; (4) sem evidência de um incumbente hard-válido em 12 segundos; (5) falta a medição de latência/recursos da VM A1 ARM64.

Parecer de engenharia: manter Timefold Community 2.8.0 + Quarkus 3.40.1.2 + JDK 21 AArch64 como candidatos **sujeitos a smoke de dependências e integração**. Não instalar complementos comerciais, não portar microgerenciamento CP-SAT e não trocar o motor da main neste PR.

## Registro de achados e ações

| ID | Prioridade | Achado verificável / risco | Ajuste obrigatório e prova |
| --- | --- | --- | --- |
| F01 | P0 | R01-R20 são grupos amplos, não provas de todas as regras da aplicação. Há centenas de testes Python/TS e o solver foi alterado depois do antigo PR #61. | Mapear cada sub-regra com ID, fonte main e teste positivo + negativo. Congelar semanticamente a fonte para cada benchmark, revalidar main a cada PR. G0 bloqueia sem rastreabilidade. |
| F02 | P0 | Apenas Hard/Medium/Soft não reproduz automaticamente a ordem existente entre cobertura por setor/cargo, domingos, fechamento, pares, liderança etc. Uma melhora agregada pode mascarar piora local. | Aprovar tabela de precedência com contraexemplos; validar se HardMediumSoftScore de 2.x basta; se não, prototipar BendableScore (long em 2.x) ou proteção por cenário. Nunca confiar só em soma por grupo; comparação independente por faixa. |
| F03 | P0 | Entidade empregado/dia cria até 250 x 42 = 10.500 entidades; múltiplas opções diárias geram domínio grande. Limitar CPU a 0,5 pode reduzir drasticamente moves/s. | Spike comparativo de modelo empregado/dia, bloco semanal e alternativa mais compacta por opções admissíveis; não levar valores inválidos para a busca. Comparar tempo de inicialização, score incremental, RAM, moves/s e soluções hard-válidas. |
| F04 | P0 | Busca de Timefold é heurística; com 12s não há promessa de encontrar grade hard-válida em 250/6 semanas. Quarkus dev-mode não serve para benchmark. | Medir tempo até primeira solução admissível, p95 até resposta válida e qualidade sob quota A1; reter incumbente existente se houver timeout. Se só funcionar com orçamento maior que o contrato permite, G5/G6 reprovados, sem aumentar limites silenciosamente. |
| F05 | P0 | O contrato Zod TS de saída é estrito; os metadados de fases CP-SAT não existem nativamente no Timefold. | Adaptador retorna status, assignments, message e wallTimeSeconds corretos e só campos adicionais documentados. Omitir optimization quando não houver tradução legítima; nunca fabricar OPTIMAL, INFEASIBLE, bounds ou fases. Testar a recepção do cliente e o fluxo de publicação completo. |
| F06 | P0 | Bloqueio total de entidade em HOURS_ONLY impediria a edição de shiftId mantendo o tipo WORK; RECORDS de histórico/dia após meia-noite são críticos. | Provar por modo quais campos são imutáveis e quais movíveis; usar pinning apenas onde todo o valor for fixo, ou modelar variável de turno separada. Casos adversariais de WORK/OFF bloqueados, DUTY sem horas, feriado, futuro publicado e virada civil. |
| F07 | P0 | A1 tem 4 OCPUs/24 GB mas hospeda outros projetos; quotas Compose do próprio projeto somam mais de 4 CPU e não medem uso efetivo. | Inventário/medição passiva de CPU, MemAvailable, PSI, RSS+cgroup e latências de DB/app/PDF; ensaio JVM sob quotas conservadoras sem forçar host real. Nenhuma CPU exclusiva. Critério de não interferência por SLO dos demais serviços. |
| F08 | P1 | O Quickstart geral apresenta service integration como Stable, mas a página específica Getting started: building a service (2.8) continua identificada como Preview. | Não declarar módulo service-parent estável. Biblioteca embutida em Quarkus customizado fica como opção principal pelo contrato privado; fazer spike da opção service-parent somente se seu endpoint, lifecycle, auth e cancel forem compatíveis. |
| F09 | P1 | Score API mudou em 2.x: os tipos *LongScore foram incorporados aos tipos Score e int scores foram removidos. Guias 1.x/2.7 podem aparecer em busca pelo caminho latest. | Usar exclusivamente exemplos/API 2.8, HardMediumSoftScore e BendableScore com valores long. Compilar release Java 21, tests e dependency:tree antes de implementar regras. |
| F10 | P1 | Constraint Profiling avançado é Enterprise, mesmo que exista propriedade de config. Além disso, Score Analysis pode revelar empregados. | Community: usar JFR, GC, RSS, move-evaluation/s, métricas agregadas e ConstraintVerifier; não habilitar profiler Enterprise sem licença e teste. Relatórios de diagnóstico sem IDs de funcionários. |
| F11 | P1 | Cinco repetições permitem apenas observação exploratória; p95 de cinco pontos é o valor máximo, com baixa confiança. Tempo por relógio não é completamente reproduzível sob CPU concorrida. | Baseline exploratória 5 execuções; aceite formal >=30 medições de latência quente por cenário/configuração, >=30 startups frias se scale-to-zero; >=5 sementes determinísticas com ao menos 5 execuções cada para qualidade, hardware/pressão iguais e intervalos de variabilidade. Não trocar seed para esconder regressão. |
| F12 | P1 | SolverManager agenda tarefas e pode enfileirar; parallel-solver-count=1 não garante fila máxima 1. Um HTTP /solve normal expira por volta de 20 s, antes que startup+espera+12s caiba. | Gate de admissão externo à fila do SolverManager, deadline absoluto e uma tarefa ativa. READY_IDLE por padrão; scale-to-zero não habilitado; testar cancelamento em QUEUED/STARTING/SOLVING, resultados tardios e ID duplicado. |
| F13 | P1 | Não existe telemetria real do host no diálogo; 0,5-0,75 CPU e 1-1,5 GiB são envelopes tentativos, não capacidade certificada. | Só definir thresholds de PSI, GC, RSS e CPU após baseline de períodos de pico/vale dos projetos. Em pressão ou telemetria ausente, rejeição/espera limitada, nunca overcommit automático. Medir CPU/RAM ociosos do JVM no processo real. |
| F14 | P1 | Janela de otimização curta pode levar score hard negativo ou plano incompleto, mesmo com solução boa no começo. Hard 0 interno não substitui checagem cross-language. | Exigir preenchimento de todas as decisões e validação independente TS sem ERROR; comparar também proteção de cobertura por setor/cargo/faixa e dados publicados. Se não houver candidato admissível, conservar referência e retornar UNKNOWN/erro apropriado. |
| F15 | P1 | Constraint Streams com join cartesiano ou calculando cobertura minuto-a-minuto em todo move pode gerar enorme sobrecarga. | Pré-computar janelas por turno/setor/cargo/fuso como fatos imutáveis; usar groupBy/joiner somente quando reduz cardinalidade; evitar I/O remoto e cálculos mutáveis dentro do score. Comparar modelagem simples antes de otimizar selectores. |
| F16 | P1 | O rollback do endpoint não garante recuperabilidade se schemas/operation states mudarem. | Fase de homologação deve ensaiar atualização de schema versionada/reversível, status de cancelamento e falhas de runtime; nenhuma perda de revisão/prova/publicação. Não conectar Java ao banco. |
| F17 | P0 | Se dois motores forem medidos simultaneamente na VM A1, a concorrência distorce CPU/RSS/latência e pode prejudicar outros projetos. Desligar o serviço PRODUTIVO de escalas para testar também interromperia geração e cancelamentos. | Benchmark de OR-Tools e Timefold SEMPRE sequencial em containers descartáveis/ambiente isolado, com orçamento idêntico; encerrar processo de teste antes do próximo; alternar ordem A/B e B/A em blocos; nunca parar o escalas-solver produtivo. Ensaiar eventual parada apenas no stack de homologação e, no cutover, em janela expressamente autorizada e sem jobs ativos. |

## Condições corrigidas da documentação oficial de 2026

- Timefold Solver 2.8.0 (novembro/2026) é JVM Java 21+, Quarkus 3.x; Quarkus 3.40.1.2 é LTS com correções de segurança. **Compatibilidade de versões exatas não testada ainda.**
- A edição Community tem Constraint Streams, score incremental, Construction Heuristic, Local Search, pinning e SolverManager. O Constraint Profiling avançado é Enterprise; não depender dele.
- Timefold 2.x remove os nomes de tipos HardMediumSoftLongScore e BendableLongScore, substituídos por HardMediumSoftScore e BendableScore com valores long.
- O serviço opinativo Timefold 2.8 tem documentação geral dizendo Stable e quickstart específico marcando Preview. Tratar como Preview até resolução pela equipe/compilação e estabilidade de API; manter biblioteca Timefold em Quarkus próprio.
- Quarkus Health distingue readiness de liveness; nenhum deles prova que houve warmup do JIT ou que uma escala 250/6 será resolvida a tempo.
- quarkus.timefold.solver.daemon=true é modo de planejamento contínuo, **não hibernação da JVM**; permanecer READY_IDLE com daemon=false e nenhum solve ativo.
- Terminação por tempo interrompe busca quando vence o prazo, não prova otimalidade e pode produzir resultados diferentes com competição por CPU. Terminações por step count e seed fixa ajudam a depurar reproduzibilidade mas não substituem ensaios de latência real.

## Estratégia de benchmark e gates revisados

### Isolamento de motores na comparação OR-Tools × Timefold

**Regra central:** não executar duas buscas pesadas simultaneamente, mas também não desligar a instância produtiva de OR-Tools. No repositório, o serviço produtivo chama-se `escalas-solver` no Compose e atende `/solve` e `/cancel`. Parar esse container enquanto a aplicação estiver em uso torna a geração indisponível e pode interromper a operação ativa. O atual servidor Java ainda não foi implantado.

**Harness recomendado:** gerar a mesma fixture sintética e a mesma referência de cobertura; iniciar um único container descartável da imagem baseline sob CPU, RAM e PIDs limitados; executar, registrar hashes/metadados sanitizados, encerrar e verificar que não há processo órfão. Repetir com a imagem Timefold em outro container descartável. Não reutilizar o serviço de produção nem usar volume/banco/secret de RH. Em validação final, alternar a sequência `OR-Tools -> Timefold` e `Timefold -> OR-Tools` por blocos para conter viés de temperatura/cache/carga. Aquecimento da JVM deve acontecer na sua própria janela, sem contabilizar artificialmente como tempo de busca; registrar separadamente tempo frio e quente.

**Local de teste:** preferir runner CI ARM64 isolado. Se a Oracle A1 compartilhada for indispensável, executar ensaio restrito fora do horário de pico, mediante admissão por pressão do host e sem reservar CPU/RAM dos demais projetos. Um serviço Python ocioso praticamente não usa CPU de busca, mas pode manter RAM; a decisão de parar o serviço de produção exige medição real e autorização, não suposição.

**Parada controlada somente em homologação:** `docker compose stop <servico-de-teste>` interrompe containers sem removê-los; não executá-lo no Compose de produção. Antes de parar em staging, verificar jobs 0, cancelamentos concluídos e readiness de outros componentes; após o teste, restaurar o serviço de homologação e validar health. Uma janela produtiva de troca definitiva exige plano específico de rollout/rollback e autorização posterior.

**Reprovação:** sobreposição de buscas, perda de acesso ao solver produtivo, CPU/RAM acima do envelope, OOM, processo órfão, ausência de hashes de entrada/versão ou monitoramento incompleto invalida o benchmark.

Fonte Docker Compose: https://docs.docker.com/reference/cli/docker/compose/stop/ ; Timefold Benchmarker (paralelismo limitado e execução sequencial): https://docs.timefold.ai/timefold-solver/latest/using-timefold-solver/benchmarking-and-tweaking ; Docker cgroups: https://docs.docker.com/engine/containers/resource_constraints/ .

### Três níveis de prova

1. **Semântica (determinística):** catálogo de fixtures sintéticas com datas/horários reais e casos negativos, ConstraintVerifier para cada regra. Mesma entrada produz mesmo status de restrições e os validadores TS aceitam candidato completo. Qualquer violação hard impede o progresso.
2. **Qualidade (estatística + determinística):** entrada idêntica, mesma base de cobertura e política; pelo menos cinco sementes controladas com cinco repetições por combinação em hardware reservado do CI ARM64; registrar status, seeds, hash de código, score por categoria sem PII, pessoa-minutos por faixa e distribuição de domingo. Desempate por métrica de negócio, não score interno. Pioras em 50/4 ou 115/6 não se compensam.
3. **Operação (host compartilhado):** >=30 observações para p95 quente por cenário, >=30 cold start se solicitado, monitoramento RSS/cgroup, GC, CPU, PSI e efeito no p95 de Next.js/PDF/DB. Medir também carga cruzada em staging, sem estressar projetos reais. Validar limite da espera, recusa segura, cancelamento e readyness.

### Portões mínimos

G0: rastreabilidade exaustiva por regra e teste; G1: versões exatas compilando no Linux ARM64; G2: todo hard semanticamente equivalente; G3: contrato/auth/cancelamento; G4: referência e constraints não pioram; G5: 250×42 e latência/qualidade com CPU conservadora; G6: não interferência em outros projetos; G7: E2E sem deploy; G8: autorização do usuário para implantação; G9: remoção enraizada após janela de estabilidade e rollback.

**STOP imediato:** licença comercial exigida sem aprovação, tratamento de dados pessoais fora de controles, hard score negativo, proposta incompleta, per-scope coverage regression, falha de cancelamento, recurso/latência superior ao orçamento aprovado, aplicação de proposta em revisão desatualizada.

## Próximos PRs técnicos recomendados (não criados aqui)

- P1: compile-only Maven/JDK21/Quarkus3.40/Timefold2.8 ARM64, sem URL nem container produtivo; verificar BOM, plugin, segurança e startup, sem modelo completo.
- P2: modelo A/B de entidade diária vs semanal, Value Range por modo, benchmarks de volume de decisões e first feasible em datasets sintéticos.
- P3: constraints hard, testes por ID do inventário e verificador TS, sem pontuação estética ou endpoints.
- P4: prioridades/score com contraexemplos, cobertura por faixa, API privada compatível.
- P5: teste de recursos READY_IDLE e E2E isolado. Considerar escala-a-zero apenas depois do aceite de startup/segurança.
- P6: solicitação independente de autorização de implantação após todas as portas verdes.

## Fontes rastreáveis

**Projeto:** web/ops/escalas/solver.py, optimization.py, hints.py, coverage_comparison.py, coverage_service_protection.py, model_input.py; web/src/lib/escalas/types.ts, schema.ts, solver-client.ts, solver-transport.ts, validation.ts, roster-quality.ts, solve-operations.ts; web/docker-compose.yml; .github/workflows/ci.yml; PR #61 fechado sem merge.

**Externas, consultadas 2026-11-25:**
- Timefold 2.8 e Java: https://docs.timefold.ai/timefold-solver/latest/introduction
- Timefold 2.x quebra de Score: https://docs.timefold.ai/timefold-solver/latest/upgrading-timefold-solver/upgrade-from-v1
- Timefold Quarkus e SolverManager: https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/library/quarkus e https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/library/library-integration
- Guia Service Preview (atenção à diferença com overview): https://docs.timefold.ai/timefold-solver/latest/quickstart/service/getting-started e https://docs.timefold.ai/timefold-solver/latest/quickstart/overview
- Timefold Enterprise constraint profiling, escala: https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/performance
- Modelos e score: https://docs.timefold.ai/timefold-solver/latest/domain-modeling/modeling-planning-problems e https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/overview
- Reprodutibilidade: https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/solver-diagnostics
- Quarkus LTS/patch: https://quarkus.io/releases/ e https://quarkus.io/blog/quarkus-3-40-1-2-released/
