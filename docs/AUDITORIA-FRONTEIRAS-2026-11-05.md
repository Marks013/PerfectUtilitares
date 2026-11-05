# Auditoria incremental — requisições, documentos e entregas — 05/11/2026

## Estado da entrega

Código publicado em `bfef47c3628550d2d6ea1d6f1187705ff3918e42`.
App, worker PDF e Solver têm essa revisão; banco preservado.
Este relatório é um commit posterior somente de documentação e não exige rebuild.
As correções abaixo estão concluídas. A recuperação automática após queda de
worker está somente mitigada e tem uma etapa pendente explícita.

Trabalho executado diretamente no servidor. Sentry ficou fora das alterações.
Dois agentes fizeram revisão independente, somente leitura, com Context Mode.

## Correções concluídas

- [x] Leitor comum para JSON e multipart: limites reais de bytes continuam
  aplicados sem depender de Content-Length. Acrescentados 30 segundos sem
  receber novo chunk e cinco minutos de prazo total. Pingos de dados não
  renovam o orçamento total. Cancelamento de origem travado não retém a resposta.
- [x] Limite de tamanho mantém HTTP 413. Prazo excedido retorna HTTP 408,
  `REQUEST_TIMEOUT`, com orientação para conferir a conexão e reenviar.
  JSON/formulário inválido mantém HTTP 400. UTF-8 fragmentado e arquivo
  multipart real mantiveram seus dados.
- [x] Convites administrativos e recuperação de senha verificam o recibo
  Resend. Erro do provedor ou resposta sem identificador não é aceito como
  envio confirmado. Os envios Presença reutilizam a mesma validação.
  Aceitação pelo provedor não significa entrega final na caixa do destinatário.
- [x] Recuperação pública de senha mantém HTTP 200 e corpo genérico também
  na falha de envio. O convite inválido é removido quando possível. O registro
  local contém apenas evento fixo, sem destinatário, token ou mensagem bruta.
  Isso fecha distinção por status/corpo nesse caminho, não certifica ausência
  de análise por tempo de resposta.
- [x] Documento PDF Unimed vencido não chega à leitura do artefato, inclusive
  quando SUCCEEDED. Preservada a consulta de RUNNING e o escopo por empresa e
  sessão. Limpeza anterior de DRAFT/QUEUED permanece.
- [x] Relatório Presença consulta um item além do teto. Mais de 10.000 resultados
  retorna erro claro em vez de gerar CSV parcial silencioso. O filtro por
  resposta continua disponível. Exportação paginada acima desse teto não foi
  implementada nesta etapa.
- [x] CSV Presença neutraliza fórmulas também quando precedidas por espaços ou
  controles de linha/tabulação. Colunas e ordenação existentes preservadas.

## Fila PDF: mitigação entregue, recuperação ainda pendente

Uma reentrega que encontra PdfJob RUNNING não é mais confirmada silenciosamente.
Ela lança `PDF_PROCESSING_ALREADY_RUNNING`, sem executar outro conversor nem
apagar entradas. Entregas de trabalhos terminais continuam idempotentes.

Isso **não recupera automaticamente um trabalho órfão**. Após queda/OOM, ele
ainda pode permanecer RUNNING até a retenção existente identificar seis horas
sem atualização. Esgotar tentativas de fila não prova que o conversor anterior
parou. O timeout do PgBoss também pode coexistir com um callback antigo.

Etapa necessária para recuperação definitiva, ainda NÃO implementada:

1. Identificar cada tentativa por token exclusivo e manter uma lease de execução.
2. Interromper cálculo/subprocessos ao perder lease ou receber aborto da fila.
3. Condicionar progresso, artefatos e estado terminal ao token vigente, impedindo
   que uma tentativa antiga publique ou sobrescreva o resultado da nova.
4. Validar queda real, perda de conexão, timeout, duplicata ativa e sucesso
   terminal preservado, sem matar processos compartilhados.

Não foi aplicado reclaim indiscriminado de RUNNING nem lock de sessão isolado:
sem fencing, ambos podem permitir execução concorrente e gravação tardia.

## Verificação final

- Prisma, TypeScript, lint, 28 testes operacionais, knip, limite de módulos e
  gate de rotas aprovados.
- Suíte final: 309 arquivos, 2.366 testes aprovados e três ignorados.
  A revisão de privacidade exigiu corrigir o endpoint e atualizar um teste
  antigo que esperava propagação do erro. A suíte foi repetida após esses ajustes;
  não se declara que todos os testes passaram na primeira execução.
- Cobertura: 66,56% linhas; 60,34% funções; 64,54% statements; 57,77% branches.
  Limiares mantidos, sem exclusões novas.
- 73/73 rotas com teste dedicado e cenário funcional 2xx. As duas rotas alteradas
  têm testes de sucesso e dos novos comportamentos, não apenas autenticação.
- 388 módulos dentro do gate; zero exceções legadas.
- npm audit de dependências de produção do app: zero vulnerabilidades conhecidas.
  Nenhuma dependência foi adicionada ou substituída nesta etapa.
- Scan das quatro imagens: zero HIGH/CRITICAL, metadados e revisão OCI aprovados.
  Avisos do scanner sobre metadados EOL Alpine e classificação de severidade
  permanecem avisos da ferramenta, não foram suprimidos ou contados como CVEs.
- Compose validado com acesso aos arquivos protegidos, sem exibir conteúdo.
  Uma construção conjunta; compilação Next em 19,1 s e TypeScript em 3,7 s.
  Nenhum rebuild durante a implementação.
- Antes do reinício: zero trabalhos PDF ativos e zero processos de cálculo
  Solver. App, worker PDF e Solver atualizados uma vez; banco não reiniciado.
- Imagens anteriores preservadas em
  `rollback-audit-boundaries-20261105T2023`. Nenhuma migração ou seed executada.

## Validação em produção

Um E2E dedicado executado no navegador contra a aplicação publicada:

- Entrada sintética real: 3.148.834 bytes; saída baixada: 222.807 bytes.
- Fila e processamento após criação: 6.310 ms; teste completo: 15,7 s.
- Tons de cinza e DPI aplicados, página e marcador OCR preservados.
- Duplo clique resultou em uma única criação; progresso acessível e ausência
  de transbordamento em 390 e 1.280 pixels.
- O próprio job foi excluído com HTTP 204, sem alterar documentos de terceiros.

No endpoint público de senha, requisições sem conta válida confirmaram:
JSON malformado 400, e-mail sintaticamente inválido 200 genérico e corpo acima
do teto 413. Não houve envio real de e-mail ou criação de usuário de teste.

Validações de recibo do provedor, documento Unimed vencido e relatório Presença
usam regressões direcionadas com dependências controladas; não se afirma envio
externo real ou exportação de 10.001 convidados do banco de produção.
Não foi executada suíte E2E isolada, carga ou benchmark p95.

## Limites preservados

NextAuth permanece na linha beta já documentada; nenhuma migração arriscada
foi feita sem falha concreta. Cobertura de interface continua parcial.
Não se declara segurança absoluta ou funcionamento de documentos arbitrários.

Referências internas:
[auditoria PDF anterior](AUDITORIA-PDF-CONFIABILIDADE-2026-11-05.md) e
[auditoria de runtime](AUDITORIA-PENDENCIAS-2026-11-05.md).

## Continuação: trabalhos PDF interrompidos

- A manutenção do worker consulta a entrega correspondente em lotes de até
  50 trabalhos. Entregas em espera, ativas ou com nova tentativa não são
  alteradas. Depois da janela de dois minutos, uma entrega terminal sem
  resultado encerra o trabalho como falha. Entrega ausente exige 24 horas
  sem atualização; erros de consulta não equivalem a ausência.
- Progresso e publicação verificam `RUNNING` e o início da tentativa. A saída
  e sua validade são gravadas na mesma transação. Um callback abortado não
  reenfileira nem publica depois de perder a execução.
- A reconciliação não remove arquivos nem estende a retenção. Se o prazo
  original já venceu, o trabalho pode aparecer como expirado em vez de falho.

### Reexecução automática

Se a entrega original falhar sem encerrar o trabalho e ainda houver entrada
dentro do prazo, o worker publica uma única nova execução. A geração e a
entrega são gravadas na mesma transação, com ID próprio e o mesmo grupo de
concorrência. Trabalhos cancelados, vencidos ou já recuperados não voltam à
fila. Não há extensão da retenção nem nova contabilização de uso.

Gravações da tentativa antiga não valem na nova geração. Aborto da fila ou
perda da posse interrompe subprocessos do próprio trabalho; código síncrono
em execução para no próximo ponto de verificação. O controle da geração não
depende de os subprocessos terem encerrado para proteger a publicação.

A migração é aditiva. Em reversão de imagem, aguarde trabalhos recuperados
saírem de `QUEUED` e `RUNNING` antes de restaurar o worker antigo; não remova a coluna.
