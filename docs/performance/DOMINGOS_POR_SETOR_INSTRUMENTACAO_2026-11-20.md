# A07/A08 | Observabilidade da concentração dominical por setor

**Estado:** instrumentação sintética e conferência na grade. Não há meta operacional, nova regra de solver, permissão ou confirmação de cobertura aprovada por este documento.

## O que está sendo observado

O módulo `web/src/lib/escalas/sunday-sector-observations.ts` deriva informações **somente da grade exibida** e das referências existentes. As linhas são agrupadas por setor e pelos domingos **não explicitamente fechados** no mês visível, usando a mesma versão de calendário de descanso da validação. Não são contados como folga: feriado, ausência ou dia sem marcação confiável.

| Campo | Significado |
| --- | --- |
| `active` | Pessoas incluídas e com vínculo ativo na data |
| `off` / `lockedOff` | Descanso `OFF` informado e parte bloqueada |
| `timed` | Pessoas com presença horária conhecida no domingo, inclusive virada de turno no sábado; pausa não conta |
| `duty` | Trabalho `DUTY` sem horário conhecido, apresentado separadamente |
| `absent` / `holiday` | Ausência ou feriado da pessoa, jamais interpretados como folga |
| `unverified` | Pessoas para as quais a grade não comprova presença, descanso, afastamento ou feriado |
| `allOff` | Todos os participantes ativos daquela data com `OFF` explícito |

**Importante:** `timed = 0` significa somente zero presença *horária conhecida*; pode coexistir com trabalho sem horário ou dados incompletos. Não prova que o setor ficou descoberto. O aviso não autoriza publicar uma grade com erros de validação.

A interface em **Distribuição das folgas → Conferir domingos por setor** mostra os números sem elevar uma estimativa a mínimo obrigatório.

## Métricas de comparação no mesmo hardware

No benchmark sintético, para cada solução validada o relatório acrescenta:

- `sectorDaysAllOff`: domingos abertos com todos os ativos em `OFF`.
- `sectorDaysWithoutKnownService`: domingos abertos sem `WORK` horário conhecido nem `DUTY`. Pode incluir dado não verificado, contado em separado.
- `sectorDaysWithUnverifiedPresence`: domingos abertos em que alguma presença não pôde ser comprovada.
- `comparableOffSpread`: soma dos intervalos entre maior e menor quantidade de `OFF`, **somente entre domingos de um mesmo setor com o mesmo número de ativos, afastados e feriados**.

O resumo do benchmark inclui a mediana da variação de folgas e das datas sem presença conhecida para cada cenário/versão. Não há limiar de pessoal inventado, ponderação sobre segurança operacional, nem alegação automática de ganho de desempenho. As métricas são secundárias a erros de jornada, cobertura obrigatória e preservação de bloqueios.

O workflow `.github/workflows/escalas-synthetic-benchmark.yml` executa, nos PRs que alterem o Solver, a instrumentação ou a validação, quatro cenários: `team-10-week`, `team-12-four-weeks`, `branch-50-four-weeks`, `branch-115-six-weeks` e `branch-115-six-weeks-untimed`. O último inclui gerentes e encarregados sintéticos sem subordinação de horário (`UNTIMED`, sem turno importado e sem folgas fixas). Todos os cenários de um mesmo PR usam **o mesmo runner ARM e a mesma imagem isolada**, com cinco repetições por variante/cenário e artifact JSONL. A execução manual preserva um único cenário e permite cinco ou vinte repetições.

O verificador `web/scripts/escalas/verify-synthetic-metrics.py` confere todas as medições, repetições únicas, status viável, ausência de erros, métricas numéricas e consistência dos resumos. Também exige que todas as medições usem a mesma identidade da imagem Docker isolada (`sha256`), configurações limitadas e idênticas de CPU, memória, workers e parâmetros do Solver, além de carga do runner válida. Esses controles verificam consistência das evidências, não certificam identidade física do host nem estabilidade absoluta de desempenho. Também registra os deltas de cobertura sintética, dispersão de folgas e duração, indicando se os hashes das fontes do Solver são **idênticos** ou **diferentes**. A baseline metodologicamente compatível é `2657f4a6894d01df58db9e3353f3ff7421047fc1`; calendários diferentes não são comparáveis. Hashes idênticos não demonstram ganho algorítmico, e diferenças entre execuções podem decorrer da busca limitada por tempo.

**p95:** com cinco amostras o benchmark publica `maxSeconds`, mas `p95Seconds` fica `null` e `tailSampleSufficient=false`; com vinte amostras, reporta p95 de maneira explícita. Vinte medições ainda são evidência amostral limitada, não uma garantia de latência. Não foi criado bloqueio baseado em limiar operacional ou em suposta regressão estatística: esses critérios precisam ser definidos e revisados antes de bloquear merge. Os bloqueios automáticos continuam limitados a integridade dos dados sintéticos, conclusão viável e validação independente.

**Regressão observacional entre funções:** `web/src/lib/escalas/sunday-sector-observations.test.ts` inclui duas escalas inteiramente sintéticas para o mesmo setor (gerente e encarregado `UNTIMED`, operador e repositor `TIMED`). Todos têm uma folga dominical em duas semanas; quando as quatro folgas coincidem em um domingo, `comparableOffSpread=4` e há um dia com todos em `OFF`; quando alternam entre domingos, `comparableOffSpread=0`. O teste prova apenas que a observação identifica a concentração entre funções: **não** prova que o Solver já a corrige, nem estabelece mínimo obrigatório por setor.\n\nO cenário curto `team-10-week` cobre apenas um domingo (`2026-11-01`): um `comparableOffSpread` igual a zero nele não demonstra equilíbrio entre domingos. Os cenários de quatro e seis semanas são necessários para investigar a concentração ao longo do período.

Para encerrar **A08**, ainda será necessário analisar versões distintas com melhoria real, comparar os três tamanhos sintéticos em hardware/recursos equivalentes, p50/p95, memória, timeouts e faltas por setor, e decidir critérios de aceite. Para encerrar **A04**, um responsável habilitado deve confirmar mínimos reais por setor/faixa com identidade e revisão verificáveis no servidor. Para **A05**, precisa-se validar a identidade persistente da Filial 02 de Icaraíma antes de migrar calendários entre empresas.

Nenhuma escala ou registro pessoal foi alterado por esta instrumentação. Não usar este benchmark como autorização para deploy.
