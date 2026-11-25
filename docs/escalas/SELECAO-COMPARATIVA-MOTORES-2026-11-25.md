# Seleção comparativa de motores de otimização para Escalas

> **Prioridade operacional revisada:** consultar primeiro o [roteiro de execução](ROTEIRO-EXECUCAO-ESCALAS-2026-11-25.md) e a [especificação executável](ESPECIFICACAO-EXECUTAVEL-TIMEFOLD-2026-11-25.md). A primeira comparação é OR-Tools atual × Timefold Community. SolverForge é a segunda opção condicional; CP-SAT reformulado, SCIP/HiGHS e híbridos ficam em reserva. A referência é o produto real, não o benchmark genérico.

Revisão 25/11/2026, sem benchmarking do PerfectUtilitares. Pergunta: qual abordagem oferece superioridade e eficiência para este problema, abstraindo linguagem e arquitetura? Nenhum vencedor presumido. A decisão abaixo antecede integração definitiva. Referência: main f78c691edbeaf16283f534bcacd8db1b4b7d5e66.

## 1. Características matemáticas do problema

Até 250 pessoas x 42 dias (10.500 posições, antes de alternativas). Cada posição admite OFF, DUTY ou turnos elegíveis conforme vínculo, relógio, feriado, ausência, bloqueio e modo. Restrições temporais cruzam dias e semanas (descanso, horas, rodízio, histórico/futuro, turnos overnight); cobertura acopla pessoas por cargo/setor/faixa e escopos publicados. Três modos de geração e recuperação de presença em dezembro tornam importante distinguir construir do zero de reparar uma escala válida. A função objetivo não é uma soma global simples: há vetos, precedência condicional e múltiplas métricas. Prazo normal 12 s de busca, recuperação 23 s; 1 CPU/1536 MiB/64 PIDs do solver atual e quotas menores em experimento. Quantidade de posições não mede sozinha complexidade; alternativas, folga da demanda, densidade de restrições, tamanho dos grupos e qualidade da seed importam.

## 2. Parecer por família (não ranking empírico)

| Candidato | Força potencial | Risco que precisa ser demonstrado | Prioridade de prova |
| --- | --- | --- | --- |
| OR-Tools CP-SAT atual | Propagação, aprendizagem, busca inteira; pode provar inviabilidade/ótimo quando termina com prova; baseline funcional atual | Construção e refinamento caros, limites por fase, grande espaço combinatório. | Obrigatório, não retirar. |
| CP-SAT com modelo melhorado | Padrões legais compactos, menos decisões redundantes, seed e decomposição que preserva acoplamentos; potencial ganho sem trocar motor | Redução indevida do domínio ou alteração da prioridade, falsa vantagem por mais tuning. | Reserva: somente hipótese de representação central distinta e perfil mensurado; não alterar a baseline. |
| Timefold Community 2.8.0 | Busca local incremental, construção e movimentos compostos; boa hipótese para reparo/reotimização com incumbent válido | Hard infeasible pode persistir; não prova INFEASIBLE/OPTIMAL pela terminação; restrições estreitas podem criar barreiras; recursos avançados comerciais não disponíveis. | Desafiante principal na busca local madura. |
| SolverForge 0.31.2 | Busca local incremental, heurísticas de construção, movimentos agrupados, scores hierárquicos, licença Apache-2.0 informada pelo repo | Versão 0.x/API recente, qualidade sob restrições do projeto e estabilidade não provadas, benchmark publicado pelo próprio fornecedor. | Segundo desafiante condicional; maturidade e ganho precisam de hipótese concreta. |
| SCIP / HiGHS (MILP por padrões) | Programação inteira com limites/prova; modelo de cobertura linear + padrões legais por pessoa | Explosão de padrões e relaxações fracas se modelagem ingênua; não garante boa solução em 12 s. | Reserva: triagem de uma formulação compacta somente se houver hipótese justificável. |
| Gurobi / CPLEX | MIP de alto desempenho, possíveis referências de qualidade | Licença comercial, sem orçamento/autorização; não supor ganho automático. | Referência opcional, não dependência. |
| ALNS / matheurística / branch-and-price | Grandes vizinhanças, reparo por programação inteira e padrões legais | Custo de pesquisa/implementação e necessidade de provar cada regra | Alternativa de segunda rodada se nenhum motor isolado superar baseline; sem implementar todos agora. |

A classificação é hipótese técnica, não ranking de velocidade. Avaliar eficiência pelo produto (propostas novas válidas no prazo, qualidade protegida, CPU-segundos e memória) em igualdade de recurso. Linguagem e arquitetura não são fatores de desempate nesta seleção; segurança/licença/compatibilidade são gates separados de adoção.

## 3. Evidência pública e crítica

Em 19/11/2026, a página de benchmark do SolverForge divulgou INRC-II (37 instâncias, 5 solvers, orçamentos 1/10/60 s). Valores divulgados de viabilidade hard:

| Motor (versão testada) | 1 s | 10 s | 60 s |
| --- | ---: | ---: | ---: |
| SolverForge 0.31.2 | 35/37 | 37/37 | 37/37 |
| Timefold 2.8.0 | 6/37 | 37/37 | 37/37 |
| HiGHS 1.16.0 | 10/37 | 30/37 | 32/37 |
| OR-Tools 9.15.6755 | 3/37 | 3/37 | 9/37 |

Fonte: https://solverforge.org/benchmarks/ , run 28b1cb08-03f4-4148-87f5-4ca6f32ebf4a, harness 94bccba67924, finalizado 19/11/2026. A execução de Timefold com orçamento 10 s teve 37/37 retornos acima do prazo segundo a própria tabela, média 11,65 s. Portanto 37/37 não significa 37 respostas em <=10 s. A mesma tabela compara custos apenas nos casos viáveis; não comparar média de 3/37 do CP-SAT com 37/37 de outro motor. No conjunto completo viável de Timefold/SolverForge, Timefold apresentou menor custo médio em 10 e 60 s; SolverForge encontrou mais casos viáveis no orçamento de 1 s. A classificação do site prioriza viabilidade no gate anterior. Não reproduzimos o harness, não verificamos tuning, recursos, todas as formulações ou distribuição de seeds independentemente. Dados de enfermagem não reproduzem as políticas de dezembro, modos de geração, cobertura protegida, relógios, quotas e avaliador do PerfectUtilitares. Fonte de parte interessada, útil para levantar candidatos e não para certificar vencedor.

A literatura do INRC-II também mostra que métodos diferentes são competitivos: Mischek/Musliu em programação inteira multietapas (https://doi.org/10.1007/s10479-017-2623-z); busca local com grandes vizinhanças e simulated annealing (https://doi.org/10.1007/s10479-020-03527-6); abordagem híbrida fix-and-optimize e simulated annealing (https://www.sciencedirect.com/science/article/abs/pii/S0360835220302655); competição e testbed (https://doi.org/10.1007/s10479-018-2816-0). Não extrapolar resultados quantitativos desses trabalhos ao nosso conjunto.

Documentação primária consultada:
- Timefold 2.8 algoritmos: https://docs.timefold.ai/timefold-solver/latest/optimization-algorithms/optimization-algorithms ; score e domínio https://docs.timefold.ai/timefold-solver/latest/introduction ; desempenho e limites Enterprise https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/performance .
- CP-SAT, significados dos status: https://developers.google.com/optimization/cp/cp_solver .
- SolverForge 0.31.2: https://docs.rs/crate/solverforge/0.31.2 ; https://solverforge.org/docs/status-and-roadmap/ ; https://github.com/SolverForge/solverforge . A disponibilidade de funcionalidades e estabilidade são declarações do projeto; testar versão fixada.
- SCIP: https://scipopt.org/ ; HiGHS: https://highs.dev/ .
- Timefold release: https://github.com/TimefoldAI/timefold-solver/releases/tag/v2.8.0 ; Quarkus LTS: https://quarkus.io/releases/ ; patch: https://quarkus.io/blog/quarkus-3-40-1-2-released/ .

## 4. Experimentos mínimos e decisão

T0: congelar inventário e baseline, preparar fixture sintética comum e avaliador TS, obter solução exata dos casos pequenos enumeráveis. T1: CP-SAT atual × Timefold, casos pequenos, 50/4 e spike de representação, sem seed e seed comum. T2: regras completas, casos operacionais sintéticos representativos da maior filial (31 dias em dezembro), HOURS_ONLY com grade, referências sem grade, 115/6, 250/6, recuperação de dezembro e holdout; curvas e recursos iguais. Somente se a primeira comparação falhar, for inconclusiva ou revelar hipótese concreta de ganho adicional, avaliar SolverForge; CP-SAT reformulado, SCIP/HiGHS e híbridos ficam em reserva. Não comparar protótipos parciais como soluções completas. T3: só vencedor preliminar passa a adaptação de contrato e gates operacionais. Ordem, amostragem e stop no roteiro.

Não restringir prematuramente a solução a Java/Python, nem forçar substituição. Se Timefold ganhar, seguir plano Java. Se SolverForge/MILP ganhar, abrir revisão específica do plano para aquele motor, não implementar arquitetura Timefold por inércia. Se CP-SAT atual ganhar ou os dados forem inconclusivos, manter OR-Tools; uma formulação compactada somente se investigação posterior justificar. Um híbrido só será considerado com orçamento total idêntico, sem somar prazos nem exigir dois motores ativos pesados; se desempenho não justificar complexidade, descartar. O protocolo, gates e métrica de aprovação constam em [especificação executável](./ESPECIFICACAO-EXECUTAVEL-TIMEFOLD-2026-11-25.md).

Parecer: Timefold é candidato forte, sobretudo para melhoria de uma grade válida, mas nem teoria nem benchmark público demonstram que é o melhor para Escalas. O principal resultado da etapa de planejamento é um método falsificável para escolher, não uma promessa de superioridade.
