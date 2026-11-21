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

O workflow `.github/workflows/escalas-synthetic-benchmark.yml` executa, nos PRs que alterem a instrumentação, os três cenários `team-10-week`, `branch-50-four-weeks` e `branch-115-six-weeks` no **mesmo runner e na mesma imagem**, com cinco repetições por variante/cenário e um artifact JSONL. A execução manual ainda permite escolher só um cenário. Os valores não comprovam ganho de desempenho quando `baseline` e `corrected` contêm as mesmas fontes do Solver. A baseline metodologicamente compatível é `2657f4a6894d01df58db9e3353f3ff7421047fc1`; calendários diferentes não são comparáveis.

O cenário curto `team-10-week` cobre apenas um domingo (`2026-11-01`): um `comparableOffSpread` igual a zero nele não demonstra equilíbrio entre domingos. Os cenários de quatro e seis semanas são necessários para investigar a concentração ao longo do período.

Para encerrar **A08**, ainda será necessário analisar versões distintas com melhoria real, comparar os três tamanhos sintéticos em hardware/recursos equivalentes, p50/p95, memória, timeouts e faltas por setor, e decidir critérios de aceite. Para encerrar **A04**, um responsável habilitado deve confirmar mínimos reais por setor/faixa com identidade e revisão verificáveis no servidor. Para **A05**, precisa-se validar a identidade persistente da Filial 02 de Icaraíma antes de migrar calendários entre empresas.

Nenhuma escala ou registro pessoal foi alterado por esta instrumentação. Não usar este benchmark como autorização para deploy.
