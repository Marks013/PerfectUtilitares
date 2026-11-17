# Revisão do calendário operacional e das barreiras de liberação

Data: 17/11/2026.

Base de produção no GitHub: `bee04e27dd0fa252d0fa9d3c2b4295bc44f44c39`.
Primeira versão revisada do PR #35: `1fb5f8fc5d56928f0b050ba38e1c6f7a99b3a015`.

## Escopo e estado real

Foram revisados os cinco arquivos originalmente acrescentados pelo PR, os
consumidores de calendário no TypeScript/Python, a integração existente de
`SUNDAY_PEAK`, o Dockerfile e as falhas da CI desse PR. Este commit corrige a
fundação de calendário e contratos de testes. **Não ativa a semana nova na
aplicação e não implanta o PR.** Não houve acesso ao processo nem ao banco de
produção; o estado em execução no servidor não foi certificado.

A implementação de `SUNDAY_PEAK` já pertence à base. Seus objetivos, proteções
por setor e reserva de tempo foram preservados. Não se alteraram jornada,
intervalos, regras individuais de domingo, bloqueios, feriados ou limites de
busca para obter aprovação dos testes.

## Problemas corrigidos

### R01: entradas malformadas assumiam o calendário legado

Em TypeScript, valores como `false`, `0`, `[]` ou uma string podiam resultar em
`MONDAY` porque o acesso à propriedade devolvia `undefined`. Em Python, entradas
correspondentes podiam produzir `AttributeError`, e `None` explícito era tratado
como ausência de metadado. As implementações agora rejeitam metadados inválidos
com erro de domínio. Apenas o argumento omitido ou um objeto sem a propriedade
representa o legado. Objetos JavaScript com protótipo não convencional são
recusados; objetos de protótipo nulo continuam suportados.

### R02: criação mensal e horizonte direto tinham limites diferentes

`planningMonthPeriod` limitava o planejamento a 2000..2099, mas `planningWeeks`
podia aceitar uma semana iniciada em 1999. Uma validação interna compartilhada
agora confere domínio, alinhamento e duração de 7..42 dias em ambos os caminhos.
As utilidades de data civil continuam aceitando datas históricas de 1900..2099.

### R03: fim de semana falhava no limite da data civil

O fim da semana era calculado reparsando o início. Para `1900-01-01` na convenção
SUNDAY, o início é `1899-12-31`, fora do domínio de entrada do parser. O fim agora
é calculado diretamente da data recebida, produzindo `1900-01-06`. Os limites
aritméticos da semana podem atravessar 1900/2100; isso não amplia o domínio dos
horizontes de planejamento.

### R04: testes isolados não substituíam a verificação padrão

Foram acrescentados testes Vitest no diretório de origem, além dos testes Node
sem dependências e Python. Os casos cobrem tipos inválidos, bissexto, fronteiras,
todos os comprimentos de 1 a 6 semanas, imutabilidade e isolamento dos resultados.
A comparação de 2.400 calendários mantém um oráculo independente de dias da
semana e de inclusão do mês; não depende apenas de as duas linguagens concordarem.
O teste Node também confere quatro fusos do processo hospedeiro.

### R05: trabalho desnecessário no workflow específico

O workflow de paridade deixa de empacotar/publicar uma cópia extensa do código a
cada execução. Execuções superadas do mesmo PR são canceladas. As etapas Python
e Node são independentes: uma falha de Python não oculta o resultado Node, mas
continua reprovando o job. As permissões permanecem somente de leitura, as ações
continuam fixadas por SHA e não há deploy nem acesso a segredos de produção.

### R06: verificações antigas divergiam dos contratos atuais

A CI anterior `44091256506` parou em dois avisos de lint e em quatro verificações
Python. A análise comparou as expectativas com o código, sem desativar testes:

- `roster-order.test.tsx`: substitui duas asserções não nulas por uma verificação
  explícita de existência das pessoas sintéticas necessárias.
- `test_mixed_warm_start.py`: verifica o construtor adiado de sugestões e a recusa
  de troca de horário ambígua em jornada mista. A grade viável e a entrada devem
  permanecer intactas. Não exige mais um mapa antecipado que a produção não usa.
- `test_daily_coverage.py`: duas datas distintas devem participar da proteção
  agregada do setor. Não se reinstalam limites diários genéricos que impediriam
  redistribuir folgas. Os testes de proteções diárias explicitamente configuradas
  permanecem existentes.
- `test_polish_priorities.py`: o tempo operacional não é reservado antecipadamente
  para cosméticos. Há também um teste separado de divisão uniforme entre quatro
  objetivos operacionais de mesmo peso.
- `test_solver.py`: a ausência não entra no denominador de oportunidades de
  domingo nem vira crédito de descanso. O teste confere os termos reais enviados
  ao objetivo e a cobertura obrigatória, em vez de impor uma única contagem final
  de domingos incompatível com a preservação de presença do incumbente.

## Estrutura e custo

O calendário é uma função pura, sem dependências do otimizador, banco ou horário
local. A validação do horizonte é centralizada em cada linguagem. A expansão
mensal não constrói mais todas as datas apenas para descartá-las após validar.
Isso elimina alocações desnecessárias nessa função, mas não representa uma
melhoria medida no tempo do solver, que ainda não consome esse módulo.

Não houve aumento do orçamento de 12 segundos, relaxamento de cobertura,
alteração da enumeração dos dias ou mudança nos objetivos dominicais.

## Verificação e limitações

Antes das mudanças: 6 testes Python e 4 Node passaram; os novos casos expõem
lacunas que esses testes não cobriam.

Após as correções, executado localmente:

```sh
cd web
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/escalas -p test_planning_calendar.py -v
node --experimental-strip-types --test scripts/escalas/planning-calendar.test.mjs
```

Resultado local: **12 testes Python e 10 Node aprovados**, incluindo as 2.400
combinações mês/convenção (2.396 aceitas e quatro rejeições de fronteira previstas).
O ambiente local possui Python 3.13.5 e Node 22.16.0; não possui OR-Tools nem Docker.
Não foi possível executar localmente Vitest, as regressões CP-SAT, o build da
aplicação ou o gate de qualidade completo. Os resultados remotos de cada commit
devem ser conferidos nos checks do PR; este documento não antecipa aprovação.

Os erros antigos da CI não devem ser confundidos com regressões introduzidas
pela fundação, que acrescentava arquivos ainda não consumidos pela produção.
Novas falhas reveladas após desbloquear as primeiras etapas precisam ser
analisadas, não silenciadas.

## Pendências bloqueantes da funcionalidade

1. `EscalaInput`, `schema.ts` e a fronteira Python ainda não negociam a convenção.
   A entrada legada não pode ser reinterpretada implicitamente.
2. `dates.ts`, `workspace-model.ts`, `labor-rules.ts`, contagens semanais,
   sugestões, reparos e verificação independente precisam usar a mesma convenção.
3. A migração deve criar nova proposta com origem e revisão explícitas. O serviço
   continua protegendo a identidade por filial/período. Nenhuma data de empregado
   pode ser deslocada; publicações e bloqueios são compromissos a reconciliar.
4. `HOURS_ONLY`, assinaturas de cenário, recibos de candidata, comparabilidade,
   listagem, relatórios e exportações precisam de testes integrados.
5. Só depois dessa integração o módulo Python deve entrar no `COPY` explícito do
   Dockerfile. O smoke atual de `sunday_peak` já é feito pelo usuário 1001 e deve
   ser preservado e ampliado para os novos imports efetivamente usados.

A etapa presente continua sendo uma base revisada, não a entrega funcional da
regra domingo-sábado. O PR deve permanecer em rascunho enquanto faltarem esses
itens e o gate completo.

## Liberação e reversão

Não há autorização de release derivada dos testes isolados. Seguir `AGENTS.md`:
validar os testes direcionados, executar `npm run quality` completo, registrar o
mesmo conteúdo em commit e usar o recibo válido com checkout limpo. Para release
em contêiner, um `npm run docker:deploy` já inclui build. Conferir saúde e fluxos
reais depois da implantação.

Depois que revisões SUNDAY existirem, uma reversão precisa manter um leitor dos
dois formatos. Não voltar a um binário que rejeite essas revisões. Nenhuma
reescrita de histórico Git, migração de dados, merge na main ou deploy é realizada
por este commit de revisão.
