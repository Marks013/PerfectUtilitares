# Verificação independente da geração e do dimensionamento de cobertura

Data: 29/10/2026. Estado: geração final executada pela interface em produção, com proposta aplicada e persistência conferida. CSV original FPRE136, sete filiais, novembro de 2026, cenário de 42h. Nenhum dado pessoal foi incluído neste relatório.

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

Geração real executada no Hiper pela interface publicada. A jornada foi selecionada em 42h, a opção de manter entrada e intervalo foi aplicada explicitamente, e o rascunho foi confirmado antes da geração. Resultado FEASIBLE, conferência independente sem falhas; não se afirma ótimo matemático global. Proposta aplicada e salva, seguida de recarga e downloads reais da revisão correta.

## Geração real publicada — Hiper (primeira conferência, antes da recuperação do legado)

- Código executado: 0a5286ba5b093d2fec00bccbe4a8680f3670186f. Revisão anterior 7; após sugestão de horários, geração e aplicação: 9. Situação DRAFT; nenhuma publicação formal.
- Tempo da geração e conferência: 15.54 segundos; zero erros de página.
- 136 colaboradores incluídos; 816 semanas-pessoa completas; maior sequência 5 dias; menor interjornada observada 756 minutos. Nenhuma falha independente.
- Maior diferença mensal entre grupos comparáveis: 2 folgas e 1 domingo trabalhado.
- Atendimento da referência estimada: 88.31%; zero indicações de desfalque omitidas; 1765 faixas indicadas conferidas contra presença recalculada. Não é garantia de atendimento operacional.
- PDF: 140149 bytes; 16 páginas; arquivo realmente baixado e aberto após recarga.
- XLSX: 111012 bytes; 4 planilhas; arquivo realmente baixado e aberto após recarga.

Exemplos efetivos da geração aplicada:

| Horário proposto | Intervalo | Trabalho efetivo | Pessoas nessa alternativa |
|---|---|---|---:|
| 10:40–14:00 / 16:00–21:04 | 14:00–16:00 | 08:24 | 40 |
| 07:00–11:00 / 13:00–17:24 | 11:00–13:00 | 08:24 | 36 |
| 08:00–11:30 / 13:30–18:24 | 11:30–13:30 | 08:24 | 15 |
| 09:00–13:00 / 15:00–19:24 | 13:00–15:00 | 08:24 | 6 |
| 08:00–12:00 / 14:00–18:24 | 12:00–14:00 | 08:24 | 5 |
| 06:30–10:30 / 12:30–16:54 | 10:30–12:30 | 08:24 | 4 |

## Recuperação do legado e revisões finais

As grades já salvas continham 19 exclusões automáticas herdadas, com o motivo exato “Jornada curta: não ampliada automaticamente”. Elas foram reintegradas por operações normais da API, com revisão otimista, geração, conferência independente, aplicação e leitura subsequente. Nenhum cadastro removido pelo usuário foi recriado, e nenhuma exclusão manual com outro motivo foi alterada. As matrículas foram comparadas com os arquivos históricos reais das revisões anteriores, sem expor dados pessoais neste relatório.

| Filial | Revisão final | Pessoas incluídas | Exclusões legadas corrigidas | Referências curtas preservadas | Semanas-pessoa completas | Referência estimada atendida | Ausências preservadas |
|---|---:|---:|---:|---:|---:|---:|---:|
| 07 | 11 | 142 | 6 | 6 | 852 | 88.41% | 0 |
| 08 | 15 | 81 | 6 | 6 | 486 | 86.84% | 0 |
| 11 | 10 | 92 | 7 | 7 | 532 | 81.89% | 120 |

Zero falhas nos critérios obrigatórios e zero indicações mensais de desfalque omitidas. Os grupos comparáveis da última conferência consideram também afastamentos, decisões bloqueadas, histórico conhecido e horários permitidos, evitando comparar pessoas com disponibilidades diferentes. A diferença observada permaneceu em até duas folgas mensais e um domingo trabalhado.

Na filial 08, uma primeira comparação do teste incluiu os dias técnicos de outubro/dezembro porque a revisão legada não continha visibleMonth. O produto já inferia corretamente novembro a partir do horizonte mensal completo. O oráculo independente foi corrigido para comparar a cobertura mensal exibida; as verificações de jornadas e descansos continuam incluindo todo o horizonte técnico. Não houve alteração de dados para mascarar a comparação nem remoção de verificações de restrições.

A menor cobertura da filial 11 é um resultado do cenário salvo, que conserva os 120 registros de afastamento, e não é comparável diretamente ao CSV sem essas ausências. Não foi prometida cobertura integral.

## Exemplos atuais de desfalques na grade final

| Filial | Setor | Data | Faixa | Trabalhando | Referência estimada | Pessoas adicionais estimadas na faixa |
|---|---|---|---|---:|---:|---:|
| 07 | AÇOUGUE | 2026-11-08 | 17:24–21:04 | 1 | 4 | 3 |
| 07 | AÇOUGUE | 2026-11-22 | 17:24–21:04 | 1 | 4 | 3 |
| 08 | AÇOUGUE | 2026-11-18 | 18:24–21:24 | 1 | 4 | 3 |
| 08 | ADMINISTRATIVO | 2026-11-08 | 08:30–10:40 | 1 | 5 | 4 |
| 11 | FRENTE DE CAIXA | 2026-11-08 | 11:30–13:00 | 3 | 9 | 6 |
| 11 | FRENTE DE CAIXA | 2026-11-22 | 11:30–13:00 | 3 | 9 | 6 |

A quantidade adicional respeita funções não intercambiáveis: pode ser maior que a simples subtração entre o total de pessoas do setor e a referência, se houver excedente de uma função e falta de outra. Não equivale automaticamente a vagas de contratação.

## Conferência final em produção

- Código publicado: 9361719e485986f2b0d6027b2edf6f7b5a5a9f4c. Aplicação, worker, solver e banco saudáveis; migração concluída.
- /escala disponível por link com tela de senha; /escalas redireciona. APIs e sessão sem autorização retornam 401. O smoke autenticado não alterou a revisão lida.
- Zero erros de página e zero respostas 5xx no smoke final. Larguras 375, 768 e 1280 px sem transbordamento; central de revisão e referências curtas conferidas na interface real.
- Depois da recuperação do legado, Hiper revisão 11: PDF 144377 bytes e 16 páginas; XLSX 115122 bytes e 3 planilhas. Ambos realmente baixados e abertos com leitores independentes.
- Regressões dos modos folgas/horários/ambos aprovadas no build de produção. Após a correção apenas explicativa da referência diária, foram reaproveitados os testes não afetados; os arquivos foram repetidos somente quando a revisão dos dados mudou.

Conclusão: propostas viáveis e operacionalmente conferidas, com horários e folgas coerentes com os dados disponíveis. FEASIBLE não é prova de ótimo matemático global, e a cobertura automática continua sendo estimativa. Os desfalques restantes estão disponíveis por setor, horário e função para decisão operacional.
