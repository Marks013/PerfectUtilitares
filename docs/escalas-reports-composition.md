# Composição dos relatórios PDF/XLSX

Tarefa `AUX-REPORTS-REBUILD`, revisão 1, despacho `AUX-REPORTS-REBUILD:r1:batch182`, gate182/reserva183. Data: 14/11/2026. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

## Plano delimitado

1. Conferir a rota existente, o descriptor de projeção, o cache e os renderizadores contra as decisões humanas finais. Preservar a integração existente e os quatro arquivos do PDF administrativo novo.
2. Reproduzir duas lacunas de composição: recusa HTTP do XLSX `ADMIN_FULL` apesar de o contrato permitir XLSX sem análises; parâmetros de filtro/contexto desconhecidos ou duplicados ignorados pela rota básica.
3. Corrigir somente os casos confirmados. Exercitar arquivos reais, alternância de projeções no mesmo cache, matriz de acesso, revisão e revogação final. Reutilizar as suítes de meses, nomes longos, pausas, limites e referências sem presença.
4. Preservar logs/configurações/hashes e amostras sintéticas úteis. Não executar banco, Solver, quality/build global, migração ou publicação.

## Decisões e integração já existentes

As últimas decisões humanas prevalecem sobre trechos históricos do plano: filial autorizada pode emitir PDF/XLSX básicos; importação, TXT e análises são administrativos. Nenhum XLSX contém Capacidade/Desfalques, incluindo o pedido de projeção administrativa. PDF administrativo mantém análises quando há dados compatíveis. Referência não comprova presença, ABSENCE não comprova férias e demanda simultânea não é mínimo diário de pessoas distintas.

A rota já usa `createEscalaExportDescriptor`, namespace/versão, principal, empresa, filial, revisão, modo e projeção no cache; autoriza antes da consulta e depois dos bytes/cache. O renderer básico já evita cálculos analíticos; XLSX já constrói apenas abas operacionais. Essa composição não será duplicada nem substituída por outra camada.

O endpoint básico oferece `mode=rest|hours|both`; não oferece filtros individuais/setoriais. Filtros administrativos pertencem ao endpoint existente de PDF operacional. Parâmetros não suportados precisam ser recusados, sem fingir filtragem ou devolver silenciosamente um conjunto maior.

## Lacunas reproduzidas e correções

As sete regressões focais falharam antes da correção, com evidência em `outputs/escalas-reports-composition/red.log`:

| Lacuna | Evidência anterior | Resultado corrigido |
| --- | --- | --- |
| XLSX administrativo recusado em rest/hours/both | Três requisições `ADMIN_FULL` receberam 400, embora o descriptor admita XLSX e fixe `mayIncludeAnalytics:false` | As três recebem 200 com XLSX real legível e apenas abas operacionais. A exigência de `report.analytics` continua; operadores não ganham o perfil administrativo. |
| Filtro/contexto desconhecido ou duplicado ignorado | Pedidos com setor, pessoa, `profile` ou revisão duplicada receberam 200 e geraram um arquivo que não aplicava o recorte solicitado | 400 estruturado antes de carregar workspace, consultar cache ou renderizar. Os parâmetros existentes e a normalização de `separateSectors` para XLSX foram preservados. |

A única alteração em implementação de produto foi `api/escalas/export/route.ts`: validar as chaves/duplicações da consulta e remover a recusa específica de XLSX administrativo. Não houve novo descriptor, cache, renderer, camada ou filtro simulado. Nenhuma matemática de cobertura foi alterada. Como os bytes e as regras de composição dos renderizadores permaneceram iguais, a versão de conteúdo/cache existente foi preservada.

Regressões novas na rota verificam os arquivos e a autorização, não apenas status: abas/XMLs do XLSX, matrícula textual, duração numérica de 504 minutos, revisão encaminhada ao serviço, alternância ADMIN_FULL/BASIC_SCHEDULE nas duas ordens com o mesmo principal/tenant/revisão, negação do perfil superior e revogação depois de um cache hit real. VIEWER, PLANNER e APPROVER de conta legada recebem arquivos básicos da filial e são recusados em ADMIN_FULL, nos dois formatos.

Em `export-analysis.test.ts`, os três modos básicos de PDF são lidos pelo PDF.js e spies dos cálculos reais comprovam que as funções analíticas não foram chamadas. Os testes já existentes de XLSX também comprovam ausência de cálculos e abas analíticas. Em `export-operational.test.ts`, três chamadas foram ajustadas para pedir explicitamente `separateSectors:true`: os testes se propõem a verificar páginas exclusivas por setor, mas dependiam do padrão antigo. As asserções de setores, pessoas e análises foram mantidas; o padrão compacto atual e a rota não foram alterados para satisfazer os testes.

A nova prova de cache copia os bytes antes de guardá-los para comparação, pois o PDF.js pode transferir e destacar o ArrayBuffer fornecido ao leitor. Esse ajuste é do teste, não do cache ou do arquivo entregue.

## Matriz final de composição e autoridade

| Principal e pedido | Resultado |
| --- | --- |
| ADMIN, PDF BASIC_SCHEDULE, rest/hours/both | Apenas folgas/horários e dados operacionais correspondentes; cálculos analíticos não executados. |
| ADMIN, PDF ADMIN_FULL, hours/both | Dados operacionais e análises de capacidade/desfalques sustentadas pelo domínio. Mínimos/referências continuam por faixa, sem conversão em mínimo diário de pessoas distintas. |
| ADMIN, PDF ADMIN_FULL, rest | Visão de folgas; não acrescenta análises de horários por causa do perfil. |
| ADMIN, XLSX BASIC_SCHEDULE ou ADMIN_FULL | Escala e/ou Horarios conforme modo, mais relação operacional Excluidos quando existente; nenhuma aba ou conteúdo de Capacidade/Desfalques. |
| VIEWER / PLANNER / APPROVER, BASIC_SCHEDULE PDF/XLSX | Permitido apenas com a capacidade do formato para a filial. O vínculo legado de publicar não concede analytics. |
| Qualquer não-ADMIN pedindo ADMIN_FULL | 403, inclusive XLSX, antes de cache/renderização. O nome da projeção enviado pelo navegador não concede autoridade. |
| Outra filial, revisão/cenário inadequado ou dados não disponíveis | Negativa estruturada pelos controles existentes; não há fallback para outra filial/revisão ou grade fabricada. |
| Acesso revogado após gerar ou reutilizar cache | JSON de negativa sem anexo PDF/XLSX. Guardas finais do endpoint básico preservadas. |
| HOURS_ONLY sem grade diária | Apenas horários/referências compatíveis; rest/both recusados pela rota. Referência não se torna calendário de presença ou folgas. |
| PDF administrativo específico | Endpoint `/api/escalas/operational-report`, com `report.analytics`, filtros/seleções próprios e guarda final já existente. Seu modelo e renderer não foram modificados. |

A rota básica não passa a oferecer filtros individuais/setoriais. Um pedido de `sector`/`employeeId` é recusado, em vez de uma exportação integral parecer filtrada. A seleção de seções/setores/data do PDF administrativo continua sendo validada pelo contrato e endpoint próprios. A visibilidade/montagem de botões da UI e o fluxo de sessão real não são certificados por esta revisão backend.

## Verificação executada

**139 testes aprovados em nove arquivos, sem exclusões**, incluindo os dois autotestes de isolamento. Suítes: export, export-analysis, export-operational, export-overflow, export-role-order, export-cache, export-projection-contract, rota export e guard. Elas exercitam bytes reais de PDF/XLSX, leitura das páginas/abas, dados tipados, revisão, nomes extensos, pausas, meses de 28/29/30/31 dias, ordenação, continuação, referências sem presença, dados estimados/confirmados/não apurados, projeções, limites do cache e negativas de acesso.

**Duas verificações adicionais de amostras passaram**, gerando e reabrindo cinco arquivos sintéticos. Dezembro tem 31 dias, nomes/cargos longos, intervalo real, ausência AF e a mesma revisão nas projeções básica e administrativa. O segundo cenário HOURS_ONLY não contém atribuições diárias. XLSX foi reaberto com `read-excel-file` e seus XMLs inspecionados; PDF foi lido com PDF.js. Não houve abertura manual no Excel ou avaliação visual humana dessas novas amostras.

Biome lint de sete fontes delimitadas e TypeScript delimitado aprovados. `git diff --check` aprovado. Não houve alteração visual no renderer; as imagens anteriores foram preservadas e não se repetiu captura ou instalação. A revisão não transforma teste de texto/geometria em prova de impressão física ou interação no navegador.

Nas suítes de rota, renderizadores e autorização são reais; autenticação, carregamento de workspace, persistência e capacidade de recursos são simulados. Nas suítes de arquivos, os modelos usam fixtures sintéticas. A barreira rejeita Prisma não simulado, sockets e fetch; URL de loopback é uma defesa complementar, não prova única de isolamento. Nenhum `.env`, banco ou Solver foi acessado.

## Fontes, hashes e preservação

Fontes alteradas neste lote: `web/src/app/api/escalas/export/route.ts`, seu teste, `web/src/lib/escalas/export-analysis.test.ts` e `export-operational.test.ts`. `export.ts`, descriptor e cache foram conferidos, mas não editados. Os quatro arquivos do PDF administrativo específico permaneceram byte a byte iguais entre a coleta anterior e a conferência final.

| Fonte final | SHA-256 |
| --- | --- |
| `api/escalas/export/route.ts` | `629eacfebadb277f30eec3bbaadf66626d34ad0bb414cb860493c9f5518501b6` |
| `api/escalas/export/route.test.ts` | `2ffd41afdc2c6207e9ad3a88ce3c7d6ae0a46844f668a707ab62bc8e9f877f13` |
| `lib/escalas/export-analysis.test.ts` | `a2c455e936156f4146bd3e3788002baa0d56dc4a164004a0d459588251871625` |
| `lib/escalas/export-operational.test.ts` | `39727c23fc6dccc9beace7e6183be912c170020fd8e7a623e9c9df6bfef838a8` |
| `lib/escalas/export.ts`, preservado | `f0e6a9481f2a2226fb49c1173ea0804dbfe2431fcc12f8289d402de3645fa0fe` |
| `lib/escalas/export-cache.ts`, preservado | `14eb19dd9ead11d1656489d45c823b426f0917765868a212245a26fa72036507` |
| `lib/escalas/export-projection-contract.ts`, preservado | `5902d6ab3225b7fa2c546115fc2d07a64fd2f26bdcf47662d5223c888f3f7ae9` |
| `lib/escalas/operational-report.ts`, preservado | `cbb86c3b6b44f7c8c4272dd43b7132eddd9916ed0358d83af7bef63864e12323` |
| `lib/escalas/operational-report.test.ts`, preservado | `d9efa0473019d8baa6dbddbcb0efb5f3d9d181a46bd781c14503be5f574d393c` |
| `lib/escalas/operational-report-pdf.ts`, preservado | `bab25a76a9ca57323bd1e034b6c215a7eefdc974b87e853c60d751353c1e590a` |
| `lib/escalas/operational-report-pdf.test.ts`, preservado | `f630221bb454e547a36ea8e8e287bbca2d315f43756a193658e76dcc0362ebad` |

Os planos foram lidos nos caminhos indicados pelo despacho: `plano-integrado.md` SHA `5d09be4fd02f949ed08bd735eaf7bc6862e472031156dd462b635d87a059e7fe`; `usuarios-permissoes.md` SHA `b8ab5761fcd442dfdd165b5f7fc319f0a0d3a3479abaf90911622e1110ffc1d2`; `revisao-planejamento.md` SHA `5a86653d170e64b80d56c5bf625621572479beb64cea146ccfade49e28bdcdc9`. Afirmações históricas desses planos não substituíram o estado real ou as decisões posteriores do despacho.

Evidências em `outputs/escalas-reports-composition`: `verify.cjs`, configurações Vitest/TypeScript, guard/autotestes, teste gerador de amostras, logs anteriores/finais/amostras/lint/tipos/cleanup, hashes e `LEIA-ME.md`. A reprodução cria cache em temporário próprio pelo helper; logs e amostras ficam na pasta de entrega. Context Mode foi descoberto e validado por `ctx_batch_execute` e `ctx_execute` para coleta, análise e hashes; escrita por patch nativo e execução por ferramentas nativas.

## Lacunas e liberação

Sem quality/build global, banco/PostgreSQL real, migração, servidor, Solver, cookie/SSR real, navegador, commit, push ou deploy. As limitações de fonte ausente e referências não sustentadas permanecem explícitas; nenhum dado foi inventado para emitir um arquivo. Nenhuma fonte de catálogo, serviço, acesso, UI ou Prisma foi alterada.

Entrega local concluída. Fontes deste lote ficam liberadas para revisão independente e integração; promoção permanece dependente dos gates globais e da autorização humana de release encaminhada pela coordenação. Nenhuma mensagem lateral ou subagente foi usado.
