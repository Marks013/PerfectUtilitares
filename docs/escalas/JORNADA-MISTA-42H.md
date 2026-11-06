# Escalas: jornada mista de 42 horas

## Uso

Escolha 42h na etapa Jornada semanal. Abra Jornada mista de 42h (opcional) e marque os setores que deseja simular. O seletor sugere os nomes de Frente de Caixa, Açougue e Balcão quando existem na equipe; não marca setores automaticamente. Gere uma proposta, confira e exporte como rascunho. Sem seleção, a referência uniforme de 42h permanece em 8h24 de trabalho por dia.

O Solver distribui três dias de 8h e dois de 9h por semana completa, com duas folgas. Nos dias longos, os dois blocos de 4h30 são separados por exatamente 3h de intervalo não trabalhado; são 12h entre entrada e saída. As alternativas diurnas tentam manter entrada ou saída da referência. Os dias longos são escolhidos pela cobertura, não fixados em dias da semana. Em semanas parciais, ausências não são compensadas artificialmente e há no máximo dois dias longos. Descansos, bloqueios, fechamentos e regras de domingo permanecem ativos. A opção não se aplica a referências curtas preservadas, pessoas sem horário informado ou semanas com limite efetivo de 40h.

Os mínimos manuais de cobertura permanecem obrigatórios. Na cobertura estimada, as alternativas de 8h e 9h dividem a mesma contribuição esperada da pessoa; não representam dois colaboradores. Alterar a seleção invalida a grade anterior para geração e exportação atualizadas.

## Configuração e publicação

A interface mostra decisões simples e agrupa exceções na Revisão técnica. Descansos, limite de dias consecutivos e intervalo mínimo são calculados pelo backend a partir das regras existentes; o formulário não exige editar esses números. Feriados, fechamentos e opções de simulação permanecem disponíveis. Valores salvos não são sobrescritos.

O regime misto é uma simulação de negociação. Não cria, revisa nem confirma documento sindical; não libera publicação operacional. PDF e XLSX identificam a simulação e mostram as variantes reais de horário. O cenário de 8h24 continua sujeito à conferência de autorização existente. A formalização do acordo, sua vigência e seu alcance devem ser verificados antes de qualquer liberação operacional.

Referências oficiais: [Emenda Constitucional 141/2026, arts. 6 e 7](https://www2.camara.leg.br/legin/fed/emecon/2026/emendaconstitucional-141-16-outubro-2026-800062-publicacaooriginal-181622-pl.html) e [CLT compilada, arts. 59 e 71](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm).

## Validação focada

- CP-SAT: cobertura tardia em duas datas, distribuição 3×8h e 2×9h, outro setor uniforme, intervalo fixo, ausência, bloqueio e corte de 40h.
- TypeScript: conferência independente de 2.520 minutos, bloqueio de publicação e rejeição de horários longos incompatíveis.
- Filial 08: Açougue e Frente de Caixa selecionados apenas em memória, 3.192 atribuições, 156 semanas completas no padrão, zero dias pendentes. PDF e XLSX gerados sem gravar a grade. A proposta foi viável; as fases secundárias não provaram melhora dentro do prazo.
