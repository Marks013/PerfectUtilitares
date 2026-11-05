# Auditoria incremental — PDF, interface e confiabilidade — 05/11/2026

## Resultado e rastreabilidade

Correções implementadas diretamente em `/home/ubuntu/PerfectUtilitares`.
Revisão de execução: `3ef1b80074ab3edf365354a0a5ae2d66cb6e68a5`.
App, worker PDF e Solver publicados nessa revisão; banco preservado.
O commit posterior deste relatório não modifica os arquivos de execução das imagens.

Esta etapa priorizou falhas concretas de compactação, uploads, acesso e interface.
A revisão independente ocorreu em paralelo à implementação. Não representa uma
certificação de todos os fluxos possíveis de todos os módulos.

## Checklist concluído

- [x] Reprodução de quatro falhas antes da correção: consentimento contraditório,
  candidato vazio e mensagem de arquivo supostamente já otimizado.
- [x] `RASTER` só achata conteúdo quando `allowSemanticLoss=true` e
  `preserveTextLayer=false`. Flags contraditórias escolhem o caminho preservador.
- [x] Candidatos vazios, inválidos ou sem redução não vencem a seleção.
  Candidatos finais sem ganho são descartados antes de renderização/extração caras.
- [x] Intermediário Ghostscript maior continua elegível para refinamento;
  regressão confirma que a saída OCRmyPDF menor ainda pode ser aproveitada.
- [x] Refinamento OCRmyPDF opcional limitado a 30 segundos. Não é repetido
  em cor/cinza após redução validada de pelo menos 15%; bilevel/JBIG2 mantém
  a oportunidade de refinamento lossless. Isso não promete o menor PDF possível.
- [x] Processos de imagem e seus descendentes ficam em grupo próprio no Linux.
  Timeout e saída do lançador encerram somente esse grupo, seguindo o padrão
  já usado na conversão Office. Nenhum processo compartilhado foi interrompido.
- [x] Escolhas visuais explícitas têm preferência entre candidatos aprovados
  e com redução mínima suficiente. Alternativas estruturais permanecem disponíveis;
  ajustes não aplicados continuam identificados, sem fingir conversão.
- [x] Falhas de integridade visual/estrutural também são registradas na decisão
  de preservar o original, inclusive nos caminhos monocromáticos e de refinamento.
- [x] PNG/PDF.js/Poppler verificam dimensões antes da alocação/renderização:
  40 MP, 8.192 pixels por lado e 80 MP por lote. `UserUnit` é considerado.
  Batches PDF.js destroem a tarefa ao terminar. Páginas normais, recorte e rotação
  mantiveram as regressões existentes.
- [x] PDF, imagem e Office rejeitam assinaturas divergentes no início do envio.
  Validações completas posteriores continuam necessárias; assinatura não prova
  sozinha que um documento é válido.
- [x] Os três uploads cancelam a origem sem bloquear a limpeza nem mascarar o erro.
  Limites: 30 segundos sem novo chunk e cinco minutos no total, mesmo com bytes
  pingados. Falha temporária retorna o contrato existente `UPLOAD_FAILED`/503,
  com orientação para conferir a conexão e reenviar.
- [x] Expiração aplicada no acesso, não apenas na retenção periódica.
  `QUEUED/RUNNING` continuam consultáveis. A reserva de fila revalida
  `expiresAt > agora` atomicamente após esperar os locks.
- [x] Exclusão física continua repetível pelo proprietário após falha temporária,
  inclusive quando o job já foi marcado `EXPIRED`. Downloads e novos usos
  não recebem essa exceção; outro proprietário continua sem acesso.
- [x] Trava síncrona evita cliques duplicados antes da resposta de criação.
  Estado ocupado aparece antes da requisição e é liberado em `finally`.
- [x] Ausência de redução não é mais atribuída automaticamente a arquivo
  “já otimizado”. A interface informa ausência de redução segura e oferece
  orientação, original para download e detalhes por arquivo.
- [x] Barra de progresso com nome e valores acessíveis. UI/UX Pro Max orientou
  feedback e recuperação; identidade visual e controles existentes foram preservados.
- [x] Execução de subprocessos extraída para `compression-process.ts`, mantendo
  387 módulos abaixo do limite vigente de 725 linhas, sem aumentar exceções.

## Verificação de código e dependências

- Prisma, TypeScript, lint, 28 testes operacionais, knip e gates de módulos/rotas
  aprovados. Suíte de cobertura executada uma vez: 308 arquivos, 2.345 testes
  aprovados e três ignorados.
- O primeiro TypeScript detectou `Promise.withResolvers` em um teste novo,
  incompatível com a biblioteca ES2022 do projeto. O teste foi corrigido sem
  elevar o alvo do projeto. A sequência restante do gate foi concluída.
- Após o ajuste final de orçamento/processos e sua extração, 19 regressões
  direcionadas, TypeScript, lint e limites de módulos foram aprovados.
  O teste adicional de timeout não foi contado retroativamente na suíte completa.
- Cobertura: 66,44% linhas; 60,24% funções; 64,43% statements; 57,67% branches.
  Os limiares anteriores foram mantidos. Interface continua com cobertura parcial.
- 73/73 rotas com teste dedicado e cenário funcional 2xx; a rota DELETE alterada
  mantém sucesso e cobre falha 503 seguida de nova exclusão 204.
- `npm audit`: zero vulnerabilidades no app, worker e migrator.
  `security:python`: 38 versões fixadas, zero avisos conhecidos OSV.
  Não foi necessário incluir ou substituir bibliotecas.
- Gate Trivy das quatro imagens: zero HIGH/CRITICAL e metadados OCI corretos.
  O scanner 0.74.0 emitiu avisos de versão disponível e metadados EOL ausentes
  para Alpine 3.24; eles não foram suprimidos nem tratados como CVEs.
  Não se infere suporte de sistema operacional apenas desse aviso.
- Uma construção conjunta. Next compilou em 14,8 s e concluiu TypeScript.
  Compose validado com acesso aos arquivos protegidos, sem exibir seu conteúdo.

## Evidência real em produção

### PDF fornecido pelo usuário

Teste com o documento original de 12 páginas, usando Equilibrado, 150 DPI,
tons de cinza e qualidade 72:

| Medida | Resultado |
| --- | --- |
| Entrada | 11.001.183 bytes |
| Saída efetivamente baixada | 3.938.942 bytes |
| Redução | 64,20% |
| Fila e processamento até conclusão | 10.380 ms |
| Páginas | 12, preservadas |
| Texto extraído | 37.547 caracteres, comparados em todas as páginas |
| Geometria e rotação | Comparadas em todas as páginas, preservadas |
| Tratamento | JPEG_XOBJECT_RECOMPRESSION |
| Origem/alvo | 300 DPI / 150 DPI, tons de cinza |
| Ajustes não aplicados | Nenhum |
| Validação semântica do motor | Aprovada |

Texto e geometria foram comparados integralmente. A verificação visual do motor
continua amostral; não se declara identidade de pixels após recompressão com perdas.
O arquivo não foi alterado no computador do usuário, incorporado ao Git ou exposto
nos logs. Somente o job criado por este teste foi excluído, com HTTP 204.

### Navegador e isolamento de acesso

- E2E dedicado publicado em `web/e2e/pdf-compression-safety.spec.ts`, executado
  contra a aplicação de produção, sem banco ou ambiente isolado.
- PDF sintético de 3.148.834 bytes gerou saída de 222.809 bytes.
  Fluxo após criação: 6.714 ms; teste completo: 16,6 s.
- Download aberto e conferido; página e texto/OCR preservados, cinza e DPI aplicados.
- Dois cliques enquanto a criação estava pendente resultaram em uma única requisição.
  Barra acessível e layout sem transbordamento em 390 e 1.280 pixels.
- Job sintético separado teve apenas sua própria expiração antecipada no banco.
  Antes da limpeza periódica, consulta, download, novo upload e fila retornaram 404.
  Outro proprietário também recebeu 404. Exclusão do próprio job retornou 204.
- Os jobs real e sintéticos foram removidos. Não foram alteradas grades, contas,
  dados de terceiros, segredos ou permissões.
- Três amostras de GET da página PDF: 903, 108 e 108 ms, HTTP 200,
  `nosniff` e `X-Frame-Options: DENY`. São medições simples do desktop,
  não p95 de produção nem benchmark de navegação/renderização.
- App, worker, Solver e banco saudáveis. Imagens anteriores preservadas
  nas tags `rollback-pdf-safety-20261105T1945`.

## Limites e decisões explícitas

- `next-auth@5.0.0-beta.32` foi reavaliado no registro oficial: continua na
  tag beta, sem depreciação; a tag estável é 4.24.15, de outra linha de API.
  Não surgiu falha concreta que justificasse trocar a autenticação ou fazer
  downgrade incompatível com os contratos atuais. O caráter beta permanece
  um risco de manutenção, não uma vulnerabilidade npm detectada.
- Não foi executada a suíte E2E isolada, nem teste de carga, acompanhando a
  orientação de usar produção e validação proporcional aos fluxos afetados.
  As regressões já existentes dos demais módulos passaram no gate de código.
- Uma auditoria e esta cobertura não garantem todas as interfaces, PDFs malformados,
  documentos arbitrários ou latência sob qualquer carga. Ganhos e segurança são
  os efetivamente medidos nesta revisão, não promessas universais.

Referências: [registro oficial NextAuth](https://registry.npmjs.org/next-auth)
e [auditoria anterior de runtime e dependências](AUDITORIA-PENDENCIAS-2026-11-05.md).
