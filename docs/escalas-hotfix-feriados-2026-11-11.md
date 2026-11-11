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

## Setores pequenos e afastamentos

A validação posterior detectou um caso residual na filial 11: de três pessoas no
Balcão Padaria, uma estava afastada e as duas disponíveis ficaram de folga juntas.
A distribuição ainda utilizava o tamanho nominal do grupo em vez da disponibilidade
diária. A correção usa exposição efetiva sem afastados e uma penalidade preferencial
para esvaziar o grupo; não transforma a estimativa em mínimo operacional obrigatório.
Um baseline válido pode ser reavaliado quando deixa setor inteiro de folga em dia
aberto, com pelo menos duas pessoas disponíveis e estimativa positiva. Demanda zero
e fechamento não acionam essa tentativa.

Prova real a partir da revisão 36, sem mudar calendário, régua ou forçar regeneração:
zero setores inteiros de folga nas condições acima, uma pessoa do Balcão Padaria em
cada domingo, 131 afastamentos preservados e zero erros do validador. O desfalque
passou de 93.076 para 90.864 pessoas-minutos. A filial 06 não foi recalculada nesse ajuste.
