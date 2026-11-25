# E2.1 — Timefold Community: primeiro núcleo experimental

PR anterior #71, SHA 7387733c9fcb6b8ea0932dd5f323d58798ee138f: 32/32 resultados válidos, 26 novas propostas efetivas (cinco HOURS_ONLY sem alteração, uma recuperação protegida retida), CI geral, smoke e paridade aprovados. Referência da main f78c691edbeaf16283f534bcacd8db1b4b7d5e66. Este PR é empilhado sobre #71, sem merge, sem modificação da main, sem código produtivo e sem acesso à Oracle A1.

## Decisão e escopo

Primeiro provar a biblioteca Timefold Solver Community 2.8.0 em Java 21, no comparador stdin/stdout existente. Não implantar Quarkus, HTTP, fila, cancelamento ou persistência antes da seleção matemática. A escolha é um spike da biblioteca, não alteração do plano de serviço posterior. Java 21, versão fixa do core via BOM (inclui ConstraintVerifier na série 2.x), Jackson 2.22.4 para JSON e JUnit em escopo de teste. Imagens de build e runtime fixadas por manifest digest. Auditoria de dependências/licença/SBOM/CVE e Maven Wrapper para futura integração ainda pendentes; Maven fixado pela imagem de build, não pelo host.

Escopo admitido estritamente: branch SYNTH, fixtures 01–07/11 ou 01–28/11/2026, semana domingo–sábado, v3, simulação, 42h, até 50 pessoas TIMED de horário fixo e sem histórico, contrato variável ANY, sem feriado, sem ausência, sem mudança de turno, sem proteção privada, sem jornada mista. A entrada é o envelope real do cliente, com preflight Python da baseline. Outras entradas devolvem 400 SPIKE_UNSUPPORTED_INPUT. O modelo não é produto geral, não recebe CSV/DB, não expõe API, não produz declaração de publicação.

| Mapa inicial | Implementação / limitação |
|---|---|
| M0/M1/M2 | WORK/OFF por colaborador/dia, relógio fixo de 504 minutos, mapeamento reversível, sábado e locks pinados. FUTURE, DUTY, ABSENCE, HOLIDAY e overrides ainda recusados. |
| Restrições hard | Janelas de 5 trabalhos/semana, até 5 dias consecutivos de trabalho, até 2 OFF variáveis, domingos consecutivos conforme cap, padrão variável não repetir o mesmo par em todas as semanas comparáveis, geometria estática de interjornada e descanso semanal para o relógio fixo. |
| M5 | Constraint Streams, HardMediumSoftScore: cobertura confirmada hard e estimada medium, mudanças soft. Bandas split por limites civis e segmentos WORK, máximo das sobreposições de mesmo escopo. Não confundir esse score com os 16 objetivos ou com o verificador TypeScript; proteção setorial e liderança não estão portadas. |
| M3/M6 | Construction Heuristic e busca local padrão da biblioteca, com seed de aleatoriedade 37. Grade comum e _initialAssignments se presentes, sem solução do concorrente. Não há seletor de movimento composto próprio neste commit. |
| Segurança | Entrada limitada a 8 MiB, respostas FEASIBLE/UNKNOWN somente, sem prova matemática inventada, validação TS obrigatória, sem credencial, rede, volume ou dados reais. |

Os testes de ConstraintVerifier cobrem zero de atendimento (inclusive setor sem empregado), intervalo de refeição, cargo, limite de dias e repetição de folgas. A comparação usa a mesma entrada e imagem da baseline, 1 CPU/1536 MiB/64 PIDs, A/B alternado, cinco pares para 10/1 e 50/4 e grade comum 10/1, frio. Modelo parcial: números são diagnóstico de construção, conectividade e qualidade, nunca decisão de superioridade. Não liberar E3/E4 automaticamente. Se ausência de incumbente válido em caso central, diagnosticar antes de expandir. A rotina TypeScript continua sendo oráculo final; não aceitar FEASIBLE interno como prova externa.

## Prazos e métricas

12 s de orçamento normal de modelagem/busca; limite residual desconta mapping e margem de 500 ms, resultado depois do prazo interno é UNKNOWN. O container do comparador mantém deadline de transporte e limpeza. Um watchdog cooperativo pede terminateEarly antes do deadline absoluto; o container continua responsável pela limpeza em falha de cooperação. O primeiro evento de solução factível no score interno é métrica diagnóstica (não necessariamente aceita pelo TS). RSS do JVM não é inventado a partir de heap. Cgroup/CPU-segundos, warm JVM, cancelamento real, prova de limite absoluto sob construção lenta de SolverFactory e primeira solução validada externamente permanecem gates posteriores. Nenhuma execução local está comprovada até o workflow do SHA concluir.

Fontes primárias consultadas: https://docs.timefold.ai/timefold-solver/latest/quickstart/hello-world/hello-world-quickstart ; https://docs.timefold.ai/timefold-solver/latest/domain-modeling/modeling-planning-problems ; https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/score-calculation ; https://docs.timefold.ai/timefold-solver/latest/upgrading-timefold-solver/upgrade-from-v1 ; https://github.com/TimefoldAI/timefold-solver/releases . Stack Quarkus permanece condicional ao resultado.


## Correção de compatibilidade da primeira compilação (25/11/2026)

A execução [45702737624](https://github.com/Marks013/PerfectUtilitares/actions/runs/45702737624) falhou na leitura do POM, antes de compilar ou medir o Timefold: Maven não encontrou versão gerenciada para timefold-solver-test. A CI geral e o benchmark E1 passaram no mesmo SHA 9d509913dc92d9d3889f0decec8ca4164a82e016. O erro é de compatibilidade da implementação inicial, não evidência sobre a qualidade matemática.

A [migração oficial 1.x → 2.x](https://docs.timefold.ai/timefold-solver/latest/upgrading-timefold-solver/upgrade-from-v1), seções 2.1.16, 2.1.17 e 2.1.20, confirma que as APIs de teste estão no core, que o módulo separado foi removido e que PlanningId mudou de pacote. Removida a dependência obsoleta; imports de ConstraintVerifier e PlanningId atualizados para os pacotes 2.x. Conferidos também os imports de score e os collectors long, configuração de prazo e evento de incumbente contra a documentação e código público da versão. Não alterada a versão 2.8.0, score, regras, limites, sementes, fixtures ou critérios de aceitação. Adicionado teste de inicialização e solve real com grade sintética válida e dois dias pinados; total de sete testes Java. Surefire falha se não descobrir nenhum teste. O build e as medições do novo SHA permanecem pendentes de execução; G1 não aprovado.


## Correção de inicialização do domínio (25/11/2026)

[Execução 45707002387](https://github.com/Marks013/PerfectUtilitares/actions/runs/45707002387), commit 52f0a910c6f3e52191402dd9cfc8b19d9ed15de7: dependências e compilação Java resolvidas; sete testes descobertos e sete erros na construção do ConstraintVerifier, todos no acesso ao campo privado Roster.bands anotado com ProblemFactCollectionProperty. O benchmark não chegou a executar. Causa: os acessores antigos tinham nomes de record (bands(), days(), state(), score()) em classes Java comuns, não getters JavaBean. A [documentação Timefold 2.x sobre acesso a campos](https://docs.timefold.ai/timefold-solver/latest/upgrading-timefold-solver/upgrade-from-v1) e os logs confirmam o requisito de acesso público.

Correção: getters/setters JavaBean para todos os campos de instância de Roster e Day, inclusive os oito campos anotados e os fatos usados na clonagem; aliases existentes delegam aos getters, sem duplicação de anotações nem alteração das variáveis/score. Fatos e segmentos continuam copiados para listas imutáveis; os setters de fatos existem para infraestrutura do modelo, não são variáveis de planejamento. DomainAccessTest verifica public constructor e tipo/acesso de todos os getters e setters antes da prova de score; teste real do solver também verifica preservação dos fatos, das identidades e dos pins. Oito testes Java previstos. Não foi alterado o modelo matemático, política de aceitação, orçamento, dependências, quotas ou casos. A aprovação depende do novo workflow, não de inspeção estática. Ambiente da conversa com JDK 21, mas sem Maven/Docker e sem resolução DNS do Maven Central, impedindo execução local integral.


## Auditoria E2.1 — correções prioritárias (25/11/2026)

Evidência preservada: [45709123324](https://github.com/Marks013/PerfectUtilitares/actions/runs/45709123324), SHA 6c04f16. Build Java e 8 testes aprovados, OR-Tools 15/15, Timefold 0/15 (HTTP 500), 0 pares comparáveis. Nenhuma conclusão sobre qualidade. Os logs anteriores descartavam o motivo interno. Encontrado defeito concreto que explica a falha: Timefold 2.8.0 em [TerminationConfig.calculateTimeMillisSpentLimit](https://github.com/TimefoldAI/timefold-solver/blob/v2.8.0/core/src/main/java/ai/timefold/solver/core/config/solver/termination/TerminationConfig.java#L356-L364) rejeita Duration com nanos não múltiplos de 1000; SpikeMain fornecia Duration.ofNanos(residual) e o teste usava segundos inteiros. Corrigido arredondamento para baixo em milissegundos no config e na chamada, com teste de valor fracionário e solve real. O diagnóstico do adapter agora preserva códigos de erro e estágio/tipo sanitizados. O smoke real 10/1 com 1 par antecede as 15 comparações; falha interrompe a rodada completa.

| Achado | Tratamento nesta revisão |
|---|---|
| A01 | Bandas disjuntas por dia/setor/tipo; máximos por cargo, min total max(geral, soma cargos), falta max(falta total, soma faltas cargo). Constraint Streams agrupam membros por cargo; setores sem presença continuam pontuados. Avaliação TS normalizada via coverageQuality em demandas estimadas; a métrica histórica independentShortage permanece rotulada separadamente. Testes overlap/cargo/sem presença. |
| A02 | Recalcula flags, contagem, identidade global, prazos, p50, desfalques normalizados e comparabilidade; testes de mutação. |
| A03 | Exige todas as 5 execuções válidas no prazo em cada cenário; em criação sem referência, 5 propostas novas do motor. Retenção no reparo é válida mas não nova e fica fora dos pares comparáveis. |
| A04 | Pendente E3: 16 objetivos/guardas; não autoriza E4. |
| A05 | Testes Java de mapeamento e rejeição; smoke real obrigatório antes de medir. |
| A06 | Grade salva parcial pode pinçar locks legítimos; _initialAssignments explícito continua exigindo grade completa. |
| A07/A08 | Movimentos compostos, pré-indexação adicional e custo do collector de cargos: medir após obter primeiro baseline válido; não introduzir API Preview nem novos pesos antes de diagnóstico. |
| A09 | Corrigida precisão de prazo; resposta FEASIBLE que excede orçamento durante montagem/serialização torna-se UNKNOWN. Watchdog e cleanup mantidos. Garantia absoluta sob travamento depende de supervisão externa (pendente). |
| A10/A11 | CPU-segundos, memória cgroup e JVM aquecida permanecem pendentes; RSS não é heap. |
| A12 | Auditoria de dependências/SBOM/CVEs pendente antes de integração; sem atualização especulativa de versões. |

A validação da nova revisão depende dos checks. Nenhuma regra de negócio, baseline, recurso, política de privacidade ou autorização de produção foi flexibilizada. A comparação de um modelo parcial continua exclusivamente exploratória.


### Regressão da revisão f22b426

[Workflow 45710152795](https://github.com/Marks013/PerfectUtilitares/actions/runs/45710152795): 14/15 testes Java aprovados (DomainAccess 1/1, RosterConstraints 10/10, WireModel 3/4). Verificador Python E2 5/5. O único teste Java reprovado detectou o guard INCOMPLETE_SEED comentado por duas sequências literais de barra invertida+n. Corrigido com linhas reais e bloco if explícito. Novos casos exigem códigos exatos para seed parcial/vazia/duplicada e conflito com lock; seed completa válida aceita, grade salva parcial continua aceita. Não houve benchmark no SHA anterior, pois a etapa de teste falhou. Nenhuma alteração de regra de produção.


### A10 — recursos comparáveis (instrumentação inicial)

Os dois adapters leem contadores reais de cgroup v2 no namespace privado do próprio container, imediatamente antes da resposta: CPU cumulativa (usage_usec), pico de memória total (memory.peak em bytes), limite de memória, razão quota/período de CPU e limite de PIDs. Isso inclui inicialização e trabalho de todos os processos/threads do container até a amostragem. Não é RSS, heap, memória disponível da A1, nem medição externa após encerramento. A imagem OR-Tools continua construída da main congelada, sem alteração Python produtiva; somente o wrapper experimental ganha a amostragem. O comparador rejeita contadores inválidos e quotas divergentes; contadores não disponíveis permanecem null, com contagem de cobertura da amostra e sem substituição por zero. O verificador independente confere mediana CPU e pico máximo observados, e o smoke passa pelo verificador mesmo quando a CLI falha. Há testes Java, TS e Python de valores válidos, ausentes e inconsistentes. A10 parcialmente resolvido: a coleta em ARM64 ainda exige confirmação, assim como capacidade da VM, custo após a resposta, JVM quente e concorrência. Sem mudanças de algoritmo, regra, orçamento ou quota. Total previsto: 19 testes Java, 6 testes Python E2, mais os testes TS do comparador.
