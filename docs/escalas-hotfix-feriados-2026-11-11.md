# Correção da concentração de folgas após inclusão do calendário

A geração da revisão e647aa2 podia concentrar setores inteiros em folga em dias
abertos, apesar de os colaboradores permanecerem cadastrados com folgas variáveis.
A viabilidade técnica não constituía evidência suficiente de qualidade operacional.

## Causa e correção

O calendário inicialmente desativava as sementes equilibradas e o reaproveitamento
das grades anteriores. A simples remoção desse bloqueio não bastou: um baseline
legado com trabalho em feriado fechado ainda era considerado comparável. Após sua
rejeição pelo CP-SAT, a alternativa equilibrada passava diretamente à busca livre.

A correção filtra baselines incompatíveis com feriados, diferencia hints ausentes,
parciais e completas e valida a semente equilibrada completa com fixação antes de
liberar a busca. Não altera os 12 segundos, as restrições ou os objetivos existentes.

## Evidência real e limites

Prova com os 115 colaboradores reais da filial 06: `FEASIBLE` em 11,978s e zero erros
no validador TypeScript. Ocorrências de setor inteiro em folga em dia aberto caíram
de 11 para zero. Na mesma régua de demanda, o desfalque caiu de 231.452 para 143.218
pessoas-minutos, redução de 38,1%. Permaneceu 21,6% acima da referência antiga de
117.752; não se afirma recuperação integral da cobertura ou otimalidade.

A prova utilizou o runtime existente e o código atual em memória, sem salvar grades.
As grades concentradas foram preservadas no histórico; a recuperação criou novas
revisões de rascunho com as folgas anteriores e horários compatíveis com o fechamento.
