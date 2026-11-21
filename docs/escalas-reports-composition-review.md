# Revisão independente da composição PDF/XLSX

**Resultado: approved para este candidato local.** Não foi encontrado defeito demonstrável no delta de composição, consulta ou autorização examinado. A aprovação é delimitada às fontes/evidências abaixo; não autoriza implantação nem certifica banco, autenticação real, impressão ou E2E.

Tarefa `AUX-REPORTS-COMPOSITION-REVIEW`, revisão 1, despacho `AUX-REPORTS-COMPOSITION-REVIEW:r1:batch192`, gate192/reserva193. Data: 14/11/2026. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

Única escrita: este relatório. Não houve execução de suítes, importação de renderizadores/aplicação, Prisma, rede, banco, Solver, alteração de código, instalação, migração, commit ou deploy. Catálogo/BF01 e a UI em edição não foram abertos.

## Conferências decisivas

| Tema | Evidência e avaliação |
| --- | --- |
| ADMIN_FULL XLSX | `export-projection-contract.ts:13–18,37–44` admite ambos os formatos e fixa mayIncludeAnalytics somente para PDF administrativo. `api/escalas/export/route.ts:37–40,54,56–57` conserva a capacidade do formato e report.analytics antes/depois, mesmo no XLSX. O pedido administrativo não é rebaixado silenciosamente para autorização de leitor; apenas seus bytes usam a composição operacional sem análises. |
| Conteúdo XLSX | `export.ts:146–208` constrói Escala e/ou Horarios conforme modo, com Excluidos separado quando há registros dessa categoria. Não há abas/cálculos de Capacidade ou Desfalques nesse caminho. Matrículas permanecem texto e durações usam célula tipada. `route.test.ts:232–244` reabre os arquivos HTTP ADMIN_FULL nos três modos, verifica todas as partes XML, matrícula 0001 e duração de 504 minutos. |
| PDF básico versus administrativo | `export.ts:277–296` recebe a projeção explicitamente da rota. BASIC_SCHEDULE, referências sem grade e modo rest não executam analyzeCoverage; buildCoverageReport só é chamado se a análise existir. O padrão ADMIN_FULL do helper interno não é usado implicitamente pela rota, que passa a projeção validada. `export-analysis.test.ts:55–74` usa spies das funções reais e lê bytes, distinguindo ausência de cálculo de mera ausência de título. ADMIN_FULL PDF conserva análises compatíveis com os dados; mayIncludeAnalytics não promete sua existência. |
| Query desconhecida/duplicada | `route.ts:21–31` rejeita qualquer chave fora do schema ou repetida antes de carregar workspace/cache/renderizador. Com isso, sector/employeeId/profile não produzem arquivo integral que pareça filtrado. Repetições idênticas também são recusadas: regra consistente, sem escolher arbitrariamente um dos valores. `route.test.ts:246–249` cobre os casos concretos e confirma que o workspace não foi carregado. |
| Parâmetro legado de layout | separateSectors continua parâmetro reconhecido, mas a rota fixa o layout compacto em `:45`, conforme descriptor `separateSectors:false`. A normalização existente para XLSX foi preservada. `route.test.ts:384–401` distingue esse parâmetro de layout dos filtros de conteúdo não suportados e compara os mesmos bytes. Não foi encontrado aumento silencioso de recorte decorrente do novo delta. |
| Cache/projeção/principal | `route.ts:33,47–55` combina descriptor e hash do principal/empresa/sessão. `export-projection-contract.ts:40–44` inclui namespace/versão de contrato/conteúdo, tenant, workspace, filial canônica, revisão, modo, formato, projeção e agrupamento. ADMIN_FULL/BASIC_SCHEDULE ficam separados mesmo quando XLSX produz bytes operacionalmente iguais. Não há dependência de uma flag de interface para essa distinção. |
| Revisão/cenário antes do cache | `route.ts:36–43` obtém a revisão pedida, confere capacidades e nega referências incompatíveis/invalidade de referências/cenário antigo antes de consultar o cache. O teste verifica encaminhamento da revisão e segregação de tenant/revisão (`route.test.ts:244,403–423`). O carregamento efetivo de revisão no banco pertence ao provedor getEscala, que não foi reaberto fora do READ; os testes de rota o simulam. |
| Revogação final | `route.ts:56–61` repete a capacidade do formato e, quando aplicável, analytics depois do render/cache e antes do anexo. `access.ts:21–38` relê usuário/status/papel/securityVersion e concessões. `route.test.ts:317–325` produz um cache hit real e altera o usuário na leitura final: a resposta esperada é JSON 403 sem Content-Disposition e sem nova renderização. Há também caso de revogação após geração, não apenas negativas iniciais. |
| Papéis | `permissions.ts:70–103` mantém analytics administrativo; VIEWER, PLANNER e APPROVER de conta recebem capacidades básicas da filial sem ganhar analytics por publicar. A matriz HTTP em `route.test.ts:278–287` exercita os três papéis e os dois formatos com autorização real e usuário/concessões simulados. |
| Cache limitado | `export-cache.ts:21–49` expira entradas sem renovar validade no hit, limita concorrência, entradas e bytes, agrupa construções da mesma chave, não retém falhas e copia os bytes do gerador. A rota copia novamente para a resposta. As suítes de cache cobrem essas propriedades; não se confundiu cache com autorização. A versão de conteúdo foi mantida porque não houve alteração dos bytes/regras dos renderizadores. |
| PDF operacional específico | `api/escalas/operational-report/route.ts:25–48` conserva analytics, seleção/revisão, validação de referência/grade, limite de recursos e guarda final após produzir bytes. O modelo/renderer e seus testes mantêm os hashes entregues. Filtros desse endpoint são próprios, sem serem anunciados na rota básica; o parser importado de operational-report-contracts não estava no READ e não recebeu auditoria adicional. |

O delta corrige duas recusas/incoerências pontuais sem criar outro descriptor, camada de cache ou filtro. As sete falhas anteriores preservadas em red.log correspondem a três XLSX administrativos recusados e quatro queries indevidamente aceitas. Não foi detectada necessidade de alterar contratos, papel, cache, dados ou matemática para concluir essa composição.

## Evidência dos testes e arquivos, sem reexecução

As suítes entregues registram **139 aprovações em nove arquivos**, sem exclusões, e **duas aprovações adicionais para geração/reabertura de cinco amostras**. Lint e tipos registram saída 0. São resultados do executor, lidos nos logs e confrontados com as fontes; não foram certificados como nova execução desta revisão.

As suítes da rota usam renderizadores e autorização reais, mas simulam auth, getEscala, delegates de usuário/concessão, rate limit e disponibilidade de recursos (`route.test.ts:17–26`). Portanto os sucessos com PDF/XLSX reais não equivalem a API autenticada com banco real. A alternância de projeções usa a mesma instância de cache e identidade/tenant/revisão, nas duas ordens (`:289–315`); o uso de Uint8Array.from no teste preserva a comparação quando PDF.js transfere o buffer, sem mudar o cache.

Foi feita leitura independente dos **artefatos já existentes**, sem chamar funções da aplicação: descompressão dos XLSX com fflate e abertura estrutural dos PDFs com pdf-lib. Resultado:

| Amostra sintética | Constatação desta revisão |
| --- | --- |
| `basic-december.xlsx` | Abas Escala/Horarios; matrícula textual 0001 e revisão 12 presentes; nenhuma aba Capacidade/Desfalques |
| `references-only.xlsx` | Somente Horarios; matrícula e revisão preservadas; sem calendário de presença/folgas ou aba analítica |
| `basic-december.pdf` | Abre com duas páginas e título da escala da filial 06 |
| `admin-december.pdf` | Abre com três páginas e título da mesma escala/filial |
| `references-only.pdf` | Abre com uma página e título de referências de horários |

Essa leitura estrutural não substitui inspeção visual ou abertura manual no Excel. O texto detalhado dos PDFs, os meses 28/29/30/31, nomes extensos, pausas, AF, ordenação e ausência de dados são sustentados pela leitura dos testes/amostras entregues, não por uma nova renderização nesta tarefa. A fixture de amostras em `outputs/escalas-reports-composition/samples.test.ts:12–30` é explicitamente sintética e não representa dados de produção.

## Integridade e limites

Os 11 registros de `outputs/escalas-reports-composition/sources-after.sha256` e as cinco amostras de samples.sha256 conferiram sem diferença. As 27 fontes do inventário focal permaneceram estáveis entre a coleta e a conferência final anterior à escrita. Agregado SHA-256: ordenar os caminhos relativos como strings JavaScript, juntar `caminho + espaço + SHA256(bytes)` com LF sem LF final e calcular SHA-256 UTF-8: `5224fee922b0da787817d2bcbbd95a6c3ad8ea0e4adbdcbdef3915d18d17ff1a`.

| Fonte-chave | SHA-256 |
| --- | --- |
| Documento da entrega | `4f9559ca7fb8456786f36e64f9b905e2ece2ba09551a2096839dfdac74ac7cfe` |
| `api/escalas/export/route.ts` | `629eacfebadb277f30eec3bbaadf66626d34ad0bb414cb860493c9f5518501b6` |
| `api/escalas/export/route.test.ts` | `2ffd41afdc2c6207e9ad3a88ce3c7d6ae0a46844f668a707ab62bc8e9f877f13` |
| `lib/escalas/export.ts` | `f0e6a9481f2a2226fb49c1173ea0804dbfe2431fcc12f8289d402de3645fa0fe` |
| `lib/escalas/export-cache.ts` | `14eb19dd9ead11d1656489d45c823b426f0917765868a212245a26fa72036507` |
| `lib/escalas/export-projection-contract.ts` | `5902d6ab3225b7fa2c546115fc2d07a64fd2f26bdcf47662d5223c888f3f7ae9` |

Permanecem fora desta aprovação: transporte real de conta/cookie, PostgreSQL/migrações/concorrência, UI/browser E2E, abertura no Excel, impressão física, carga de produção e gates globais de quality/build/release. Revalidar acesso antes dos bytes limita a janela observada, não cria atomicidade permanente após a última consulta. Nenhuma dessas lacunas foi convertida em defeito hipotético do delta.

Context Mode foi efetivamente usado: ctx_search timeline para continuidade, ctx_batch_execute para coleta e ctx_execute para análise, hashes e parsing dos arquivos existentes. Escrita por apply_patch nativo; skills de estilo/Context Mode já lidas nesta sessão foram reutilizadas. Sem subagentes, mensagens laterais, descartáveis ou processos persistentes; nenhuma pasta temporária foi necessária.

Revisão encerrada, fontes liberadas. Não há correção de código recomendada por esta revisão. Próxima ação da coordenação: integrar o candidato e seguir os gates globais/autorizados, mantendo as lacunas de ambiente separadas desta aprovação local.
