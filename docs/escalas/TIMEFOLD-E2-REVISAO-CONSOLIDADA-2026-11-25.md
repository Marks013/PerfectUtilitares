# Revisão consolidada E2.4 — correções e ensaios no mesmo commit

Solicitação: corrigir os achados em conjunto, sem publicar correções fragmentadas. PR #74 permanece draft, com o controle anterior preservado por SHA 335efcc09f1410266f70c6e5fb5be03a1294e33f. Main f78c691, PR #71, PR #72 a621675 e PR #73 217427e permanecem congelados. Nenhum acesso à A1, dados de RH, deploy ou merge.

## Evidência antes desta revisão

[Workflow 45726644799](https://github.com/Marks013/PerfectUtilitares/actions/runs/45726644799), 31/31 Java, 12/12 verificador, 15 pares principais + smoke e 5 pares de ablação PATTERN; todas as propostas válidas e novas. [Auditoria Java 45726644711](https://github.com/Marks013/PerfectUtilitares/actions/runs/45726644711): 13/13 testes, 22 runtime e 8 teste, zero correspondências OSV, nenhuma licença pendente na triagem. CI E2E em andamento no início desta revisão. Não houve aprovação da qualidade operacional 50/4.

| Medição 50/4 | OR-Tools no bloco DEFAULT | Timefold DEFAULT | OR-Tools no bloco PATTERN | Timefold PATTERN |
| --- | ---: | ---: | ---: | ---: |
| Desfalque p50 (pessoas-minutos) | 32256 | 53424 | 32256 | 25704 |
| Produto p50 (s) | 12.906203 | 12.521818 | 12.861232 | 12.487192 |
| CPU p50 (s) | 12.567255 | 12.188548 | 12.524829 | 12.139642 |
| Pico cgroup (bytes) | 191983616 | 118005760 | 191315968 | 123428864 |
| Primeiro incumbente interno p50 (s) | não medido | 5.383074 | não medido | 1.868328 |
| Inicialização p50 (s) | não medido | 0 | não medido | 0.389888 |
| Regressões pareadas | controle | 5/5 | controle | 5/5 |

PATTERN reduziu o desfalque total em 51.8868% frente a DEFAULT e 20.3125% frente a OR-Tools. Entretanto, em todos os pares o primeiro desfalque regressivo foi dominical, 0→1008 pessoas-minutos em um setor. A primeira repetição também mostrou uma data de setor sem presença (ordinal 17) e spread dominical setorial de 5000, contra zero no OR-Tools. Esses detalhes não aparecem como primeiro motivo porque a comparação retorna na primeira regressão. Não declarar vencedor nem inferir que aumentar CPU resolverá. As medidas de memória permanecem muito abaixo de 1536 MiB.

## Pacote consolidado

- **Q02/Q04:** construtor privilegia o ganho dominical após cobertura confirmada, antes do desfalque total; ensaia até duas passagens de substituições de padrões completos por pessoa, rejeitando trocas que prejudiquem presença previamente exclusiva, cobertura confirmada/total/dominical dentro de seu setor. O candidato inicial completo deve passar nas regras individuais e cobertura confirmada antes de congelar tetos por setor (total, domingos, pico) e presença diária. São tetos da própria seed, não da resposta do CP-SAT. Nível soft superior pune violações dos tetos; segundo nível, ativo somente com a seed protegida, busca recuperar cobertura dominical; os seis níveis anteriores mantêm ordem relativa. Nenhum objetivo estimado vira restrição legal hard. A resposta do motor não pode ser FEASIBLE com violação do primeiro nível de proteção. A avaliação final utiliza o comparador e também o seletor original completo (bloqueios, cobertura, liderança, janela de descanso, distribuição e equilíbrio quando aplicáveis); a seleção é diagnóstico, não substitui a resposta do candidato pelo CP-SAT. Verificador registra explicitamente ambos os tipos de regressão e o workflow exige zero regressões nos cinco pares PATTERN, além de factibilidade. Mesmo se passar, trata-se de um gate E2 exploratório, não E4.
- **Q06/Q07:** vizinhança composta de substituição de máscaras pessoais durante a construção/refinamento, com cache de padrões válidos, pins preservados, seleção integral antes de alterar a grade. Polimento opcional para quando expira seu prazo e mantém a última seleção completa. Não usa APIs Preview/impl do Timefold. Busca Timefold subsequente mantém seletores padrão; movimentos compostos especializados dentro do Local Search ainda são um trabalho distinto. Orçamento do construtor continua 1250 ms e até 2 s do início, dentro dos 12 s.
- **Q11:** SolverManager/ SolverJob públicos de Timefold 2.8.0 (parallelSolverCount=1) permitem contagens reais de avaliações de score e movimentos, duração da busca, e supervisor cooperativo. Evento entregue ao consumidor é assíncrono e pode omitir incumbentes intermediários; primeiro evento entregue e fallback de resultado final rotulados separadamente, sem equiparar a métrica anterior de listener síncrono. Limites interno/externo preservados. Sem APIs internas ou novo pacote comercial.
- **Q13:** workflow de diagnósticos reconstrói os três controles de commits exatos #72/#73/#74 e a revisão corrente. 6 variantes (OR-Tools, E2.1, E2.2, E2.3 DEFAULT/PATTERN, revisão PATTERN), seis rotações, cada variante em cada posição uma vez, mesmos bytes e avaliador, 1 container por vez. Comparação com OR-Tools por rodada; contadores novos não são inventados para controles antigos (spike histórico omitido expressamente). Resultados agregados somente, sem propostas/identidades pessoais. Continua exploratório (6 amostras/variante).
- **Q14:** três invocações do mesmo envelope em uma JVM, cada uma com domínio e manager novos, com prazo próprio de 12 s. Supervisor do lote de 53 s + 1 s, máximo 3 invocações; transporte experimental de lote 56 s, separado dos limites normais. Medir duração interna, incremento CPU, pico acumulado e qualidade. Replay das três respostas pelo TS valida cada grade, sem confundir tempo de replay com latência real de serviço. Não é Quarkus/HTTP quente, nem prova de capacidade da A1.
- **Q15:** novo workflow independente inventaria/escaneia imagens exatas de build e runtime com [Trivy v0.76.2 ARM64](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2), arquivo verificado SHA-256 ab9d51f86e6a5fb936f605faff6b593ac51bc378fff4d3e8b9d58358b9c367c3. Scanner local com banco de avisos público, inventário Java/OS, conferência dos quatro plugins Maven explicitamente fixados, versões Java e IDs de imagem. High/Critical exigem revisão, cobertura ausente não passa como limpa, incluindo JDK instalado por tar sem reconhecimento pelo scanner. Não é certificação de JDK, SBOM de todos os binários nem revisão jurídica. Nenhuma atualização especulativa de versões. Avisos de segurança dependem da consulta ao banco na execução.
- Q01/Q03/Q05/Q08/Q09/Q10/Q12 preservados, com testes reforçados; sem alteração de inputs, baseline, avaliador produtivo, banco ou limites reais da VM.

## Limites da equivalência dos 16 objetivos

A fonte de verdade é [solver.py da main congelada](https://github.com/Marks013/PerfectUtilitares/blob/f78c691edbeaf16283f534bcacd8db1b4b7d5e66/web/ops/escalas/solver.py#L861-L879). A lista abaixo é rastreabilidade do recorte, não aprovação de E3.

| Objetivo original | Estado no candidato E2.4 |
| --- | --- |
| COVERAGE | desfalque geral/cargo + tetos setoriais estimados da própria seed; sem toda proteção privada/cutover |
| SUNDAY_COVERAGE | nível e recuperação sob tetos; sem histórico/calendário completo |
| SUNDAY_PEAK | pico setorial existente é aproximação (horizonte, não exatamente objetivo Python) |
| MOVEMENT_COVERAGE | fora do escopo, entrada recusada |
| CLOSING_COVERAGE | seletor original verifica; não há nível equivalente no Java |
| UNTIMED_ROTATION | fora do escopo, entrada recusada |
| SUNDAY_BALANCE | oportunidades/coortes/datas no recorte; não há todo histórico |
| REST_SPACING | seletor externo e regras hard do recorte; objetivo completo pendente |
| LEADERSHIP | seletor externo; movimento prioritário/UNTIMED fora do escopo |
| SATURDAY_BALANCE | sábado fixo no recorte; generalização pendente |
| REST_DISTRIBUTION | presença diária/guardas e seletor externo; não equivalente |
| REST_ROTATION | variação de duas folgas hard e polimento; objetivo completo pendente |
| PEOPLE_CHANGED | não há objetivo separado |
| STABILITY | mudanças de dia salvo; relógio fixo |
| PREFERENCES | preferências não admitidas; objetivo pendente |
| TIE_BREAK | seed e ordem determinística; objetivo original não portado |

E3 (dezembro, horários variáveis, contratos mistos, históricos, afastamentos, lideranças sem relógio, proteções privadas e 16 objetivos completos) permanece explicitamente não certificado. Não é seguro prometer equivalência total em um spike restrito a 50 pessoas e 7/28 dias. A consolidação trata os defeitos e os instrumentos do E2, não cria uma falsa autorização de integração.

## Recursos e validação

Mantidos 1 OCPU / 1536 MiB / 64 PIDs e 12/18/20 s por tentativa normal, mesma seed 37 e Java 21/Timefold 2.8.0. O pico anterior PATTERN foi ~117.7 MiB, sem evidência de pressão de RAM. Experimentos de 2 CPUs e capacidade compartilhada somente após não-inferioridade/avaliação específica. Diagnósticos e scanner rodam exclusivamente em GitHub-hosted ARM64; nenhum recurso produtivo foi acessado.

Todos os testes novos, build Java completo, desempenho, scanner e gates aguardam execução do commit consolidado. Ambiente de conversa dispõe de JDK, mas não Maven/Docker; não alegar compilação real sem CI. Um único commit, preservando os SHAs de evidência anteriores.
