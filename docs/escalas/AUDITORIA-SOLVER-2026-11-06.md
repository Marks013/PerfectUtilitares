# Auditoria do Solver de Escalas — 06/11/2026

## Correções

- Reutilizar admissibilidade e ocupação de turno por data dentro de cada cálculo. Fechamentos comuns usam busca por conjunto. Ausências e bloqueios continuam individuais.
- Montar descanso e ocupação civil percorrendo só as datas ativas da pessoa. Sem alterar restrições, pesos, prioridades ou o orçamento de 12 segundos.
- Encerrar operação vencida como `TIMED_OUT` antes de tentar o cancelamento remoto. A atualização condicional não sobrescreve conclusão ou cancelamento concorrentes; uma proposta tardia não pode concluir a operação vencida.

## Comparação no servidor

Leitura das revisões salvas das filiais 07, 08 e 11, sem aplicar ou salvar propostas. Mesmas entradas preparadas e mesmo contêiner Python/OR-Tools. Mediana de cinco amostras alternadas após aquecimento, da entrada até a primeira chamada CP-SAT, incluindo as sugestões iniciais. A representação integral do modelo inicial foi idêntica antes e depois nas três filiais.

| Filial | Montagem antes | Montagem depois | Redução | Desfalque estimado dos setores no mês | Aos domingos |
| --- | ---: | ---: | ---: | ---: | ---: |
| 07 | 1.112,42 ms | 1.004,13 ms | 9,7% | 74.946 → 71.884 | 14.238 → 13.734 |
| 08 | 603,82 ms | 545,28 ms | 9,7% | 46.539 → 46.539 | 7.003 → 7.003 |
| 11 | 724,10 ms | 648,12 ms | 10,5% | 46.969 → 46.969 | 3.081 → 3.081 |

Desfalques em pessoas-minutos, calculados separadamente da função objetivo com os indicadores setoriais do mês. Uma execução completa por versão e filial, todas `FEASIBLE`, válidas no verificador TypeScript e sem dia pendente. O tempo total ficou entre 12,07 s e 12,23 s; a montagem mais rápida libera tempo de busca, não reduz o prazo total.

Na filial 07, três setores pioraram na comparação de execuções independentes, um deles aos domingos, apesar do ganho agregado. As proteções por setor e domingo em relação ao incumbente de cada busca foram mantidas. O comparativo não demonstra melhora universal ou repetibilidade sob prazo de relógio.

## Verificação

- Gate de código web: 2.427 testes passaram, 3 pulados; 73/73 rotas com cenário funcional 2xx.
- Bateria Python focada: 135 de 137 passaram na primeira execução completa. Os dois testes restantes falhavam também na revisão anterior: exigiam três chamadas CP-SAT mesmo quando objetivos já estavam provados sem busca. Ambos passaram após exigir pelo menos um timeout de busca e conferir a proposta válida preservada. A regressão de cache e afastamento individual também passou.

## Dependências e pendências

- OR-Tools `9.15.6755` em execução; [release estável](https://github.com/google/or-tools/releases/tag/v9.15) mais recente na consulta. Python `3.13.18`. Mantidos o lock e os hashes. Auditoria OSV de 38 versões Python sem avisos conhecidos.
- Continuidade pode expandir uma entrada válida acima dos 5 MiB do transporte interno. Cenário sintético de 250 pessoas: 4.115.827 bytes no salvamento e 5.846.025 bytes após anexar histórico e futuro. O serviço retornou 413; o cliente ainda classifica como indisponibilidade. Correção futura deve alinhar os limites ou compactar a entrada mantendo um teto de memória e resposta clara.
- A otimização reaplica limites de proteção idênticos entre fases. Deduplicação é candidata a reduzir preparação, mas não foi incluída sem uma comparação própria de cobertura e tempo.
