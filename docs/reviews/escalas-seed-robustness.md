# Robustez das sugestões de folgas e auditoria de liberação

Data: 18/11/2026. Base: `dd6b8d59abb50a3132b3fbcc9496179db9d3a0b6`.

## Estado da base

O hotfix que exclui setores inteiramente OFF do reaproveitamento automático está
na main. Isso não certifica implantação no servidor. Não houve acesso ao processo,
imagem em execução ou banco de produção nesta revisão.

A CI 44308519213 da base terminou reprovada. O job de imagens Docker passou.
O job Python 134816264875 executou 369 testes e encontrou quatro falhas em testes
de refinamento que pressupunham uma solução inicial deliberadamente ruim. Os
novos oito testes de recuperação de sugestões passaram nessa execução.
O job de dependências 134816264673 parou no npm audit: picomatch e dependentes
foram marcados com severidade alta. Não executar npm audit fix --force sem rever
a compatibilidade; o log sugeria downgrade incompatível de Vite. Não se removeu
a auditoria nem se alterou seu nível para contornar esse bloqueio.

## Mudanças

- Validação final no último grupo ativo de cada pessoa, não somente na última
  semana técnica. Isso impede que um vínculo parcial empreste descanso de um
  futuro desconhecido. A mesma validação de continuidade permanece em uso.
- Entradas vazias, pessoas sem datas ativas e candidatas vazias são recusadas
  sem exceções acidentais de min/max. Não se inventam dias para completar grades.
- Cancelamento e orçamento são conferidos antes de preparar grupos e antes de
  publicar uma sugestão individual. Resultados parciais de uma pessoa não saem.
- Índices de participação em grupos são construídos em uma passagem. Reutilizam-se
  conjuntos de datas ativas, sem alocar conjuntos vazios em cada consulta.
- O portfólio limitado continua com no máximo quatro máscaras por chamada. Sua
  diversidade considera também dias úteis: domingos diferentes não bastam quando
  todas as alternativas deixam as mesmas datas abertas inteiramente OFF.
- Cada destinatário reconstrói seu próprio horário e revalida bloqueios, ausências,
  feriados e continuidade. Nenhum cache global de grades ou dados pessoais existe.
- Mantido calendar_portfolio=False por padrão. Um ensaio mais rápido não justifica
  ativar universalmente um atalho que ainda pode concentrar folgas. Os chamadores
  que já solicitavam portfólio explicitamente recebem o aprimoramento.
- Quatro testes de refinamento isolam a recuperação inicial para continuar
  exercitando o caso difícil que lhes pertence. Suas asserções de cobertura,
  proteções e orçamentos não foram removidas. Recuperação real fica coberta por
  testes separados, inclusive novo cenário CP-SAT sem mocks de viabilidade.

Não há mudança em mínimos de pessoal, jornada, intervalos, regra domingo-sábado,
identidade dos dias, pesos dos objetivos ou orçamento de 12 segundos. HOURS_ONLY
continua sem redistribuir folgas. Não há alteração de escalas salvas ou deploy.

## Evidência local e limites

Os onze novos testes de lógica pura passaram após o patch. Na base, a mesma suíte
produziu cinco falhas e três erros. Inclui prazo vencido, cancelamento, horizonte
vazio, vínculo parcial, diversidade, determinismo, ausência de aliasing, bloqueios,
afastamentos, feriados e relógios próprios dos destinatários.

A execução local isolou por AST apenas dependências puras de datas/horas para
permitir importar o módulo sem OR-Tools. Isso NÃO é execução CP-SAT. Os testes
versionados usam imports normais e a CI executa o teste integrado adicional.
Sintaxe foi verificada. Não houve execução local de OR-Tools, Ruff, Docker,
TypeScript, E2E ou npm run quality. Consultar os checks do commit para evidência
remota; este documento não antecipa aprovação nem substitui o gate de release.

Antes de liberar: passar regressões Python, verificador independente, auditorias,
qualidade integral e procedimento AGENTS.md. Conferir o SHA da imagem realmente
executada no servidor. Depois gerar nova proposta em modo que permita mudar
folgas e revisar cobertura por setor/faixa. Não publicar automaticamente revisões
anteriores nem tratar uma sugestão viável como prova de cobertura suficiente.
