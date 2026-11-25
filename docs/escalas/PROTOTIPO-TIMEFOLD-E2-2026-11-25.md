# E2.1 — Timefold Community: primeiro núcleo experimental

PR anterior #71, SHA 7387733c9fcb6b8ea0932dd5f323d58798ee138f: 32/32 resultados válidos, 26 novas propostas efetivas (cinco HOURS_ONLY sem alteração, uma recuperação protegida retida), CI geral, smoke e paridade aprovados. Referência da main f78c691edbeaf16283f534bcacd8db1b4b7d5e66. Este PR é empilhado sobre #71, sem merge, sem modificação da main, sem código produtivo e sem acesso à Oracle A1.

## Decisão e escopo

Primeiro provar a biblioteca Timefold Solver Community 2.8.0 em Java 21, no comparador stdin/stdout existente. Não implantar Quarkus, HTTP, fila, cancelamento ou persistência antes da seleção matemática. A escolha é um spike da biblioteca, não alteração do plano de serviço posterior. Java 21, versão fixa do core/test via BOM, Jackson 2.22.4 para JSON e JUnit em escopo de teste. Imagens de build e runtime fixadas por manifest digest. Auditoria de dependências/licença/SBOM/CVE e Maven Wrapper para futura integração ainda pendentes; Maven fixado pela imagem de build, não pelo host.

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

12 s de orçamento normal de modelagem/busca; limite residual desconta mapping e margem de 500 ms, resultado depois do prazo interno é UNKNOWN. O container do comparador mantém deadline de transporte e limpeza. O primeiro evento de solução factível no score interno é métrica diagnóstica (não necessariamente aceita pelo TS). RSS do JVM não é inventado a partir de heap. Cgroup/CPU-segundos, warm JVM, cancelamento real, deadline residual completo de construção de SolverFactory e primeira solução validada externamente permanecem gates posteriores. Nenhuma execução local está comprovada até o workflow do SHA concluir.

Fontes primárias consultadas: https://docs.timefold.ai/timefold-solver/latest/quickstart/hello-world/hello-world-quickstart ; https://docs.timefold.ai/timefold-solver/latest/domain-modeling/modeling-planning-problems ; https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/score-calculation ; https://docs.timefold.ai/timefold-solver/latest/upgrading-timefold-solver/upgrade-from-v1 ; https://github.com/TimefoldAI/timefold-solver/releases . Stack Quarkus permanece condicional ao resultado.
