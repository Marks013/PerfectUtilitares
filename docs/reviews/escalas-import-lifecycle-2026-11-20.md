# Auditoria pontual: ciclo de importação de equipe e afastamentos

Base: `1690c3b7fcefe3ca4fd314fbcd4d9b3a5ac8ad34` (main consolidada).
Data: 20/11/2026. Escopo: componentes de prévia e regressões sintéticas.

## Problemas e alterações

1. Equipe e afastamentos liam JSON antes de examinar 401. Uma resposta vazia
   ou HTML não acionava o desbloqueio. O status agora é tratado antes do corpo,
   somente se a requisição ainda pertence ao contexto ativo.
2. Equipe identificava o contexto apenas por filial/início/jornada. Não cancelava
   requisições ao sair e permitia reativar uma resposta após trocar A/B/A. Um
   identificador crescente, cancelamento e validação do contexto impedem esse
   reaproveitamento, inclusive quando o transporte demora a respeitar aborto.
3. Prévias concluídas não podiam sobreviver à perda de acesso. Equipe e afastamentos
   agora as invalidam; desbloquear não ressuscita uma aprovação anterior.
4. A aplicação de equipe usava o input capturado pelo callback. Agora consulta o
   input atual e as escolhas atuais, chama a reconciliação existente e consome a
   prévia. Bloqueios, afastamentos e metas novos não são apagados por uma captura
   anterior. Contextos incompatíveis exigem nova análise.
5. Afastamentos também rejeita callbacks de um arquivo anterior. Timers são
   liberados ao trocar cenário/arquivo, perder acesso ou desmontar o componente.
6. Equipe rejeita arquivo vazio, extensão inválida e tamanho superior a 512 KB
   antes de enviar. O limite já existia no servidor e continua sendo validado lá.
   O cliente não substitui autorização ou validação do conteúdo na API.
7. Respostas sem os campos estruturais necessários da prévia não são publicadas
   na interface. Esta checagem defensiva não é um novo contrato completo de parser.

## Invariantes e propriedade da interface

Usam-se `Field`, botões, classes e regiões de status existentes. Mantidos CSV/XLSX
para equipe e CSV FPHI105 para afastamentos. Não se importam dados médicos.
`mergeImport`/`mergeAbsenceAssignments` continuam responsáveis pela reconciliação;
nenhuma duplicação do parser ou alteração da política de folgas foi introduzida.
A key da equipe inclui período, calendário, equipe e referências revisadas.
Registros diários e metas não invalidam o parser: a aplicação deve preservá-los
reconciliando o input mais recente. Não se concede permissão por esta checagem.
Não há biblioteca nova, mudança de lock, banco, rota, solver ou cobertura.
Cancelamento é do pedido cliente e do aproveitamento do resultado; não se afirma
que ele interrompa todo processamento já iniciado no servidor.

## Evidência de regressão e limites

- `44733202208` não é contraprova do produto: detectou recursão indevida no
  auxiliar de travessia do teste. Corrigido antes da comparação funcional.
- `44733946917` executou componentes originais da base com os testes corrigidos.
  As dez verificações marcadas `[regression]` falharam nos comportamentos previstos.
  Houve também falha de resposta incompleta e uma de timeout; a última não é
  classificada como defeito da base, pois AbortSignal.timeout não usa esse relógio
  simulado. Duas preservações já existentes e os 20 testes anteriores passaram.
- `44734353967`, fonte `3394e37`, aprovou os testes direcionados, o typecheck,
  lint sem avisos e a verificação de tamanho. O ensaio chama os handlers reais e
  a reconciliação, mas simula hooks/rede; não substitui montagem real no navegador.
- O E2E novo usa somente o banco descartável com `E2E_MUTATION=1`. Intercepta
  apenas uma resposta 401, verifica ausência de escrita, depois usa parser, SAVE
  e GET reais para confirmar matrícula textual, folgas explícitas e dia bloqueado.
  A limpeza remove somente a proposta criada pelo próprio teste.

A CI integral do PR deve comprovar a revisão final, incluindo os dois testes de
identidade e o navegador. Este relatório não antecipa seu resultado. Nenhum teste
existente foi removido, ignorado ou teve expectativa enfraquecida nesta auditoria.
O workflow temporário direcionado foi removido da árvore de entrega.

## Liberação

Sem deploy, dados de produção ou publicação de escala. A integração na main deve
respeitar os checks e o método do repositório. Uma aprovação na CI não substitui
o recibo local de `npm run quality`, o checkout limpo e a verificação do runtime
exigidos em AGENTS.md para implantação. Não se afirma ganho de tempo no solver:
a otimização desta mudança evita uploads inadequados e resultados obsoletos.
