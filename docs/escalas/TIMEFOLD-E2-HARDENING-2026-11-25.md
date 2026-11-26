# E2.3 — correções da auditoria Q01–Q15

Controle preservado: [PR #73](https://github.com/Marks013/PerfectUtilitares/pull/73), SHA 217427e0032b9d187c9e740a8708ffd551424f85, baseado em #72 a621675. [E2.2 45724898499](https://github.com/Marks013/PerfectUtilitares/actions/runs/45724898499) passou; smoke separado; 22 testes Java, auditoria 30 componentes sem correspondência OSV naquela consulta. CI geral ainda estava em execução quando a revisão iniciou. E2 válido **não é** aprovação de qualidade.

## Evidência de qualidade (5 pares por cenário, smoke excluído)

| Cenário | OR-Tools p50 desfalque | E2.1 Timefold | E2.2 Timefold | Pares E2.2 com regressão |
| --- | ---: | ---: | ---: | ---: |
| 10/1 | 1512 | 1512 | 1512 | 0/5 |
| 50/4 | 32256 | 34776 | 60984 | 5/5 |
| 10/1 reparo | 1512 | 1512 | 1512 | 0/5 |

E2.2 50/4: primeiro incumbente interno mediano 6.707085 s, produto 12.497641 s, CPU mediana 12.166302 s, pico cgroup 116019200 bytes. Maior regressão no horizonte: setor 7056→15624 (+8568 pessoas-minutos). Todos os 15 candidatos novos válidos em ambos os motores. A comparação de versões em sessões distintas é observacional. O aumento de desfalque não prova qual objetivo ou movimento o causou.

## Correções e limites

| ID | Tratamento |
| --- | --- |
| Q01 | Taxa pessoal 10000 × WORK / oportunidades, não número bruto. OFF imposto excluído; pessoas sem oportunidades excluídas. Coorte por setor e limite dominical efetivo (todos TIMED, 42h no recorte). Inclui oportunidades não inicializadas, sem inferir trabalho. |
| Q02 | Verificador agora reconstrói prefixo da regressão por setor/escopo, mas agregação do score ainda permite compensações. Proteger guardas por setor/role/banda do incumbente é E3, não inventar como hard nem importar grade CP-SAT para geração. |
| Q03 | Vetores numéricos por ordinal de setor, sem nomes/datas/pessoas; reconstrói perdas de horizonte/mês/domingos/fechamento/pico/presença; verifica delta, sinal, escopo/métrica/motivo e consistência raw/final. ROLE_TIME ainda depende do comparador TS. Testes de mutação. |
| Q04 | Mantido avaliador e política originais congelados; 16 objetivos e proteção privada completos pendentes E3. |
| Q05 | Booleanos sem coerção, enums suportados, data de admissão ISO, limites de política, campos privados desconhecidos recusados. Ajuste de comentário sobre OFF integralmente imposto: é isento, como no original. Não é schema completo; preflight TS/Python continua obrigatório. |
| Q06 | Movimentos compostos semanais ainda não implementados. A inicialização evita começar com 1200 variáveis nulas no 50/4, mas não altera vizinhanças durante busca. |
| Q07 | Construtor opcional de máscaras 5×2 por semana, combina até quatro semanas, testa janelas e padrões, respeita pins, cache por forma de restrições, maximiza ganho marginal de cobertura confirmada/estimada, domingo, presença, distribuição, estabilidade. Não prova factibilidade coletiva nem altera os hard constraints. Não sobrescreve seed completa. Timeout/falta de padrão retorna sem mutação parcial. |
| Q08 | Stream de cobertura estimada compartilhado explicitamente; bandas gerais usam contador, mapas de membros só para bandas com cargos. Medir efeito real, não supor ganho. |
| Q09 | Cache do mínimo total de cada banda e loop direto nos segmentos em vez de stream no hot path. |
| Q10 | Taxa dominical por data e coorte no mesmo nível da taxa pessoal; sem guarda de presença do incumbente, não equivale à política completa. |
| Q11 | Tempo do construtor, inicialização antes/depois e primeiro incumbente registrados. Contagem de avaliações/movimentos e perfil JFR/GC ainda pendentes, sem APIs internas. |
| Q12 | upload-artifact dos dois workflows Timefold atualizado para [v7.0.2](https://github.com/actions/upload-artifact/tree/cf430e030ddbb5b0abf93d22962f4752f3646cd9), runtime node24 e SHA fixado. E1/CI herdados não alterados; avisos de schema CycloneDX não significam API Timefold obsoleta. |
| Q13 | Ensaio DEFAULT→PATTERN no mesmo runner/imagens, 5 pares adicionais 50/4 com OR-Tools na mesma quota. Verifica hash de input, identidade, revision, evaluator, perfil e quota entre blocos. Ordem de blocos fixa: diagnóstico, não ablação perfeitamente contrabalanceada. Comparar E2.1/E2.2/E2.3 simultaneamente segue pendente. |
| Q14 | JVM quente não implementada; preservar medição fria e separar futura medição do serviço. |
| Q15 | Auditoria Java herdada validada; SO/JDK/plugins de build e revisão de redistribuição continuam pendentes. |

## Protocolo

1. Modelo corrigido DEFAULT: smoke de 1 par e 15 pares principais, com o mesmo comparador, quotas 1 CPU / 1536 MiB / 64 PIDs, prazo 12/18/20 s e seed Timefold 37.
2. Somente depois: PATTERN, 5 pares 50/4, mesmo runner, imagem, input e OR-Tools original. Orçamento do construtor de no máximo 1250 ms e até 2 s desde início da requisição, dentro dos 12 s totais. Sem leitura de resultados CP-SAT. Exigir APPLIED e todas as células inicializadas antes do solve; fallback não é evidência de ganho. Supervisor preservado.
3. Comparador independente verifica cada bloco e cruzamento de identidade; registra desfalque normalizado, regressões, primeiro incumbente interno, CPU e pico cgroup. Nenhuma vitória declarada apenas por validade. Comparação permanece exploratória e sem p95 certificável.
4. Nenhuma alteração de CPU/RAM por falta de evidência de pressão; ensaio 2 CPUs só isolado após diagnóstico. Nenhuma implantação, Oracle A1 ou dado de RH.

Validação do novo SHA pendente. Os limites do recorte E2 continuam explícitos.
