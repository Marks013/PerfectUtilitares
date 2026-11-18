# Correção de reaproveitamento de folgas sincronizadas

Data: 18/11/2026.
Base: `8b01062559a7f4e19703a5299b0cb7a068428f32`.

## Escopo

Em `_feasibility_hints`, setores detectados como inteiramente de folga em uma
data aberta com demanda estimada positiva não podem ser reutilizados apenas
por apresentarem uma grade completa. A seleção de `comparable` agora exclui
`empty_sectors` e encaminha esses setores ao balanceador existente.

A mudança afeta sugestões iniciais, não restrições. Preserva bloqueios,
afastamentos, feriados, turnos e o modo HOURS_ONLY. Não altera a convenção
semanal, os objetivos, mínimos de cobertura ou orçamento do solver. Não
reescreve escalas salvas nem demonstra a origem da sincronização inicial.
Setores inteiramente bloqueados continuam bloqueados.

## Verificação realizada

- Sintaxe dos dois arquivos Python e `git diff --check`: aprovados.
- Oito testes das funções reais de sugestões, isoladas por AST: aprovados.
  Sem a correção, a mesma suíte apresenta cinco falhas, contando subcasos.
- Exemplo sintético de 12 pessoas e cinco semanas domingo-sábado: 12 padrões
  distintos e nenhuma data aberta inteiramente sem WORK nas sugestões.
- Os testes versionados usam imports normais do projeto. O isolamento por AST
  foi somente uma limitação do ensaio local, sem OR-Tools instalado; não
  substitui execução CP-SAT, validação independente ou testes de integração.

A suíte completa do solver, Ruff, Docker, E2E e `npm run quality` não foram
executados localmente nesta revisão. A CI existente executa regressões Python
no push para main; o resultado deve ser conferido para o SHA deste commit.
Nenhum teste foi desativado. Nenhuma implantação foi executada.

## Antes da implantação

Executar os testes direcionados e a suíte completa do solver, depois o gate
integral e o procedimento de release definidos em AGENTS.md. Após implantação
validada, gerar uma nova proposta em um modo que permita redistribuir folgas;
HOURS_ONLY preserva os dias, e revisões antigas não são corrigidas no deploy.
Validar cobertura por setor e por data antes de publicar a nova proposta.
Não colocar dados pessoais, cenários reais ou credenciais no repositório.
