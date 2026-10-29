# Verificação independente da geração e do dimensionamento de cobertura

Data: 29/10/2026. Estado: validação pré-publicação; geração final pela interface em produção ainda pendente. CSV original FPRE136, sete filiais, novembro de 2026, cenário de 42h. Nenhum dado pessoal foi incluído neste relatório.

## Critérios independentes

A conferência não utiliza o validador nem a função de presença do produto para calcular o esperado. Reconta atribuições, horas e presença por identidade, setor, cargo e minuto civil; pausa e horário não informado não contam como atendimento. Confere diretamente as indicações apresentadas pelo produto, inclusive faltas por cargo quando o total do setor não é suficiente para explicar a ocorrência.

Foram conferidas 3.900 semanas-pessoa completas: cinco dias de trabalho e duas folgas; horas semanais efetivas; máximo de cinco dias consecutivos; descanso entre jornadas; rodízio dominical; bloqueios, ausências, referências e inclusão preservados. Jornadas curtas importadas continuam como referência curta da simulação, sem afirmar contrato integral fictício.

## Resultado por filial

| Filial | Pessoas | Semanas-pessoa | Referência atendida antes | Depois | Maior diferença de folgas no mês | Maior diferença de domingos trabalhados | Indicações omitidas |
|---|---:|---:|---:|---:|---:|---:|---:|
| 02 | 62 | 372 | 82.75% | 83.65% | 2 | 1 | 0 |
| 06 | 121 | 726 | 87.26% | 87.99% | 2 | 1 | 0 |
| 07 | 143 | 858 | 88.06% | 88.37% | 2 | 1 | 0 |
| 08 | 81 | 486 | 86.27% | 86.84% | 2 | 1 | 0 |
| 11 | 92 | 552 | 86.92% | 87.69% | 2 | 1 | 0 |
| 16 | 53 | 318 | 85.66% | 86.96% | 2 | 1 | 0 |
| 18 | 98 | 588 | 85.93% | 87.04% | 2 | 1 | 0 |

A comparação das folgas utiliza grupos de setor/cargo com a mesma disponibilidade, modo de jornada e restrições explícitas. Diferença de até duas folgas no mês não contradiz duas folgas em cada semana completa: o mês civil começa e termina no meio das semanas técnicas. Nenhuma falha foi encontrada nos critérios obrigatórios e nenhuma estimativa ultrapassou o orçamento semanal do grupo.

## Melhoria decorrente do teste

A referência anterior distribuía em média cinco sétimos da presença em todos os dias, inclusive domingos, sem descontar suficientemente o rodízio dominical. A estimativa agora reserva a proporção do rodízio individual explícito para o domingo livre, redistribui o restante aos dias disponíveis e conserva o orçamento semanal. O arredondamento alterna entre semanas para grupos ímpares; não sugere todo domingo nem nenhum domingo indefinidamente. Histórico conhecido e decisões bloqueadas são respeitados; rascunho desbloqueado não é convertido em histórico obrigatório. Mínimos operacionais explicitamente informados permanecem intactos.

Os resultados são experimentais, obtidos com o mesmo CSV e limite de cálculo, sem alegação de ótimo global. A alteração melhora a coerência da referência; não cria demanda operacional real nem garante que todos os objetivos suaves sejam simultaneamente atendidos.

## Exemplos reais de horários sugeridos — filial 07

| Trabalho proposto | Intervalo | Trabalho efetivo | Pessoas com essa alternativa na execução |
|---|---|---|---:|
| 10:40–14:00 / 16:00–21:04 | 14:00–16:00 | 08:24 | 41 |
| 07:00–11:00 / 13:00–17:24 | 11:00–13:00 | 08:24 | 36 |
| 08:00–11:30 / 13:30–18:24 | 11:30–13:30 | 08:24 | 15 |
| 13:30–17:30 | Sem intervalo registrado | 04:00 | 6 |
| 09:00–13:00 / 15:00–19:24 | 13:00–15:00 | 08:24 | 6 |
| 08:00–12:00 / 14:00–18:24 | 12:00–14:00 | 08:24 | 5 |

A filial 07 contém 121 pessoas com jornada regular calculável, 6 referências curtas e 16 sem horário apurado. As contagens da última coluna não são um total de trabalhadores simultâneos.

## Desfalques estimados que continuam exigindo avaliação

Os exemplos abaixo são diferenças frente à referência estimada, não prova de necessidade de contratação. “Adicionais” significa pessoas naquela faixa e função, não vagas em tempo integral. A abertura/fechamento operacional não foi informada pelo CSV e não é presumida.

| Filial | Setor | Data | Faixa de desfalque | Trabalhando | Referência estimada | Adicionais na faixa |
|---|---|---|---|---:|---:|---:|
| 02 | FRENTE DE CAIXA | 2026-11-08 | 15:30–18:14 | 6 | 10 | 4 |
| 02 | FRENTE DE CAIXA | 2026-11-22 | 15:30–18:14 | 6 | 10 | 4 |
| 06 | AÇOUGUE | 2026-11-08 | 08:00–10:40 | 1 | 4 | 3 |
| 06 | AÇOUGUE | 2026-11-22 | 08:00–10:40 | 1 | 4 | 3 |
| 07 | AÇOUGUE | 2026-11-08 | 17:24–21:04 | 1 | 4 | 3 |
| 07 | AÇOUGUE | 2026-11-22 | 17:24–21:04 | 1 | 4 | 3 |
| 08 | AÇOUGUE | 2026-11-18 | 18:24–21:24 | 1 | 4 | 3 |
| 08 | ADMINISTRATIVO | 2026-11-08 | 08:30–10:40 | 1 | 5 | 4 |
| 11 | FRENTE DE CAIXA | 2026-11-08 | 11:30–13:00 | 3 | 9 | 6 |
| 11 | FRENTE DE CAIXA | 2026-11-22 | 11:30–13:00 | 3 | 9 | 6 |
| 16 | ADMINISTRATIVO | 2026-11-09 | 09:00–10:50 | 6 | 11 | 5 |
| 16 | ADMINISTRATIVO | 2026-11-09 | 15:00–16:30 | 8 | 14 | 6 |
| 18 | FRIOS E LATICINIOS | 2026-11-08 | 07:00–21:24 | 0 | 1 | 1 |
| 18 | FRIOS E LATICINIOS | 2026-11-22 | 07:00–21:24 | 0 | 1 | 1 |

As faixas foram comparadas à presença real da proposta e às indicações do projeto: zero faltas omitidas; pessoas sem horário, intervalos e afastamentos não aumentam a contagem. O atendimento medido não é disponibilidade garantida de todo setor ao longo da abertura real, pois essa demanda não foi fornecida. Quando houver necessidade operacional conhecida, ela deve ser informada como mínimo explícito e conferida como restrição obrigatória.

## Estado do teste final

Ainda será feita geração pela interface publicada, sugestão explícita de horários, conferência independente, aplicação, recarga e downloads reais. O resultado será acrescentado após sua execução, com revisão utilizada.
