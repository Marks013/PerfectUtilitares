# Redução adicional de desfalques — 11/11/2026

Referência: `1af697dbfc9a7023bd8c910076d2827df291e548`. Escopo: distribuição de folgas nas grades de teste 06/dezembro e 11/novembro, sem alterar demanda, horários de origem, regras ou afastamentos. A autorização posterior inclui commit, push e implantação.

## Achados comprovados e correções

1. O refinamento rápido encerrava após uma única troca, mesmo quando outros setores tinham trocas independentes e viáveis. Agora verifica até uma troca por setor, dentro do mesmo teto de 1.500 ms e 32 verificações individuais. As trocas são combinadas e verificadas integralmente antes de virar uma dica para o Solver. Não há alteração de domingo, horário, carga semanal ou referência de cobertura.
2. A união dos setores pequenos era sempre colocada antes de setores maiores, contrariando o ranking operacional já calculado. Agora a união permanece na posição do seu integrante mais prioritário; a seleção dos quatro grupos acontece depois da ordenação. Permanecem os critérios de domingo sem presença, setor vazio, déficit dominical e déficit total, além dos limites de 8/16/4.

A regressão de dois setores falhou primeiro com apenas uma troca realizada. As regressões de ordenação falharam em cinco verificações antes da correção. Os testes exercitam os módulos de produção.

## Comparação real antes da implantação

Mesmas revisões salvas, mesmas referências e mesma função de medição independente. Comparação da função anterior, carregada do Git, com o refinamento corrigido. Nenhuma revisão foi salva nessa comparação.

| Grade | Antes do refinamento | Função anterior | Função corrigida |
|---|---:|---:|---:|
| 06/dezembro — revisão 10 | 156.772 | 156.268 | 152.700 |
| 11/novembro — revisão 38 | 144.507 | 144.033 | 141.249 |

Unidade: pessoas-minutos de cobertura estimada não atendida. Nenhum setor piorou em relação à função anterior. Validação independente aprovada; referências intactas; domingos inalterados. Foram trocadas 18 marcações na 06 e 14 na 11, equivalentes a nove e sete pares trabalho/folga.

O equilíbrio de sábado é uma prioridade inferior à cobertura, não um bloqueio: sua dispersão passou de 38.000 para 40.000 na 06 e de 30.003 para 28.336 na 11. A alteração não relaxou qualquer restrição de sábado. O Solver mantém a prioridade de cobertura e a proteção dos domingos, sem prometer igualdade perfeita entre todos os colaboradores.

## Limites preservados

Um núcleo, 1536 MiB, um cálculo simultâneo e orçamento Python de 12 segundos. Não foram alterados bloqueios, afastamentos, restrições individuais, jornada semanal, fechamento, metas estimadas ou referências importadas compatíveis. Nenhuma nova dependência foi acrescentada.

O ganho do refinamento não é promessa de eliminar todas as lacunas. FEASIBLE continua significando uma solução válida sem prova de ótimo. Os resultados finais da geração completa, salvamento e exportação das duas grades devem acompanhar a entrega pós-implantação; as revisões anteriores permanecem preservadas.
