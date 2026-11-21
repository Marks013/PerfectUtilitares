# Revisão independente do acesso a Escalas

## Correções de AR01 e AR02 — 14/11/2026

Revalidação no estado atual do clone: **154 testes aprovados em 5 arquivos, 1 excluído da seleção**, incluindo serviço, exportação TXT, rotas de PDF/TXT e isolamento. `git diff --check` dos seis arquivos da correção passou. O lint atual desses arquivos encontrou dois avisos `noNonNullAssertion` em `service.ts`, no trecho posterior de importação administrativa (`adminImport`), fora dos deltas AR01/AR02. Esse trabalho em andamento foi preservado; o resultado anterior de lint abaixo pertence ao corte original da correção. Nenhuma nova alteração de implementação foi necessária para os dois P2.

Após autorização do usuário, os dois achados P2 foram corrigidos neste clone. As seções seguintes preservam o corte original da revisão e seus hashes; não descrevem o estado posterior às correções.

Entrega de coordenação: `AUX-ACCESS-REVIEW-FIX r1`, origem no turno humano `01a1d816-26c4-7ef0-a072-a36d8721aa94`. Escrita direta neste chat, sem redistribuição. Fontes liberadas ao concluir esta entrega. DTOs e contratos públicos preservados; nenhuma alteração em `shift-catalog/export.ts` foi necessária, pois a confirmação da autoridade de download fica na rota HTTP.

- **AR01:** `saveEscala` agora exige `schedule.apply` para a filial sempre que recebe uma proposta assinada, tanto na entrada quanto dentro da transação final, antes de verificar novamente a prova e persistir. A exigência independe de alterações nas marcações. Preservadas assinatura, escopo, aprovação, bloqueios e CAS; o caminho de salvamento manual não recebeu essa exigência incondicional.
- **AR02:** as rotas do PDF administrativo e do TXT repetem, respectivamente, `report.analytics` e `export.integration` depois de produzir o arquivo e antes de construir a resposta. Bloqueio, rebaixamento e mudança da versão de segurança durante a emissão devolvem 403/JSON, sem anexo. Mantidos os caminhos de seleção, revisão, empresa e manifesto existentes.
- **Regressões executadas:** proposta `HOURS_ONLY` assinada, com marcações idênticas e metadados diferentes, é recusada sem aplicar e aceita com a capacidade; retirada de aplicar antes da confirmação transacional impede qualquer escrita. Para PDF/TXT, mudanças de status, papel e versão de segurança durante a emissão impedem entrega. O PDF é realmente renderizado antes da mudança simulada. TXT1/TXT2 passam pelo serviço de exportação real e são comparados byte a byte na resposta HTTP. Autorização real com persistência simulada nesses novos cenários de arquivos.
- **Evidência antes/depois:** a primeira execução apresentou 10 falhas nas novas verificações: aplicação sem capacidade foi aceita, arquivos revogados foram entregues, faltou a segunda leitura de autorização e a retirada transacional de aplicar retornou conflito de prova em vez da negativa explícita esperada. Após a correção: **150 testes aprovados em 5 arquivos, 1 teste excluído da seleção**. A seleção abrange `service.test.ts`, `shift-catalog/export.test.ts`, as duas suítes de rotas de arquivos e dois autotestes de isolamento. O caso `carries real Python-shaped` permaneceu excluído conforme o procedimento anterior; não houve execução de Solver Python.
- **Outras verificações:** Biome lint dos seis arquivos TypeScript modificados aprovado; TypeScript delimitado aos mesmos arquivos aprovado, sem geração de cliente ou compilação incremental. O ambiente de testes usa mock Prisma padrão que falha em acessos não simulados e bloqueio de sockets/fetch; seus dois autotestes passaram. Nenhum banco, segredo ou servidor foi usado.

Arquivos de implementação alterados: `web/src/lib/escalas/service.ts`, `web/src/app/api/escalas/operational-report/route.ts` e `web/src/app/api/escalas/turnos/export/route.ts`. Regressões em `web/src/lib/escalas/service.test.ts`, `web/src/lib/escalas/shift-catalog/export.test.ts` e `web/src/app/api/escalas/operational-report/route.test.ts`. Alterações anteriores e trabalho concorrente preservados. Não houve commit ou deploy. Quality/build global, migrações, PostgreSQL concorrente e E2E continuam fora desta verificação local; os demais riscos da revisão não foram declarados resolvidos.

## Corte original da revisão

Data: 14/11/2026. Despacho `AUX-ACCESS-REVIEW:r1:batch138`, gate138 `25de39213fd61243b87ca2c1fd5cb64cfd7df9ff626a4fc6632ca6221d2e8410`, reserva139.

Revisão estática no clone `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`. Única escrita desta revisão: este relatório. Não houve execução de testes, importação de Prisma, acesso à rede/banco/servidor, alteração de código, migração, instalação, commit ou publicação. Componentes de interface não foram inspecionados; a entrega concorrente do chat05 fica fora desta avaliação.

## Resultado

Dois defeitos de autorização identificados por leitura do fluxo. Ambos precisam de regressões executadas pelo responsável pela implementação. Não foram reproduzidos em runtime nesta revisão. A revisão não aprova produção, migrações ou concorrência PostgreSQL. As barreiras existentes são substanciais, mas os resultados das suítes entregues não eliminam os cenários abaixo.

### AR01 — P2: aplicação de proposta dispensa `schedule.apply` quando as marcações não mudam

**Evidência:** `web/src/lib/escalas/operational-input-policy.ts:42` exige `schedule.apply` somente quando os arrays de marcações diferem; a linha 43 retorna imediatamente para uma proposta assinada. `web/src/lib/escalas/service.ts:329` exige apenas `workspace.save` na entrada, verifica a prova nas linhas 336 e 393 e, na confirmação transacional, exige novamente apenas salvar, salvo as outras intenções específicas das linhas 394–396. `web/src/app/api/escalas/route.ts:65` encaminha `APPLY_PROPOSAL` diretamente a esse caminho.

**Cenário demonstrável no código:** uma concessão nominal contém `workspace.read`, `workspace.save` e `schedule.generate`, mas não `schedule.apply`. A preparação de referências `HOURS_ONLY`, sem presença diária, pode preservar exatamente as marcações e produzir novos dados de preparação. O caminho de `service.ts:464–476` define `needsRegeneration:false`, calcula `generationBasis` e assina a proposta. Ao aplicar essa proposta íntegra, a igualdade das marcações evita a checagem de aplicação; a prova libera a comparação dos demais campos. O usuário consegue persistir a aplicação e avançar a revisão sem a capacidade correspondente. Uma geração que retorna as mesmas marcações também alcança a mesma condição. Isso não permite forjar conteúdo arbitrário nem ignorar a assinatura; o defeito é a autorização da ação depender do resultado do cálculo.

**Critério de correção:** `APPLY_PROPOSAL` deve exigir `schedule.apply` para a filial, independentemente das diferenças de conteúdo, na entrada e dentro da transação final. Manter assinatura, sessão, aprovação, preservação e CAS. O salvamento manual continua usando suas regras próprias.

**Menor regressão:** adaptar a fixture de `service.test.ts:1145` para manter `workspace.save`, retirar somente `schedule.apply` e usar uma proposta válida com marcações idênticas e metadados de preparação diferentes. Esperar 403 e nenhuma escrita de workspace/revisão/auditoria; repetir com `schedule.apply` e comprovar sucesso. O teste atual retira também `workspace.save` (`service.test.ts:1147`), portanto falha antes de isolar essa capacidade. O teste puro em `operational-input-policy.test.ts:40` também não cobre a aplicação sem diferença nas marcações.

### AR02 — P2: relatórios administrativos e TXT não repetem a autorização antes da entrega

**Evidência:** `web/src/app/api/escalas/operational-report/route.ts:25` exige `report.analytics`, mas há esperas posteriores por limite, workspace, capacidade e PDF. Após `await exportOperationalReportPdf(...)`, as linhas 47–50 entregam os bytes sem conferir a autoridade atual. Em `web/src/app/api/escalas/turnos/export/route.ts:26–30`, `export.integration` também é conferida somente antes da reconstrução do arquivo. `web/src/lib/escalas/shift-catalog/export.ts:184–195` carrega o manifesto, consulta dados e renderiza sem repetir a capacidade administrativa ao retornar.

**Cenário demonstrável no código:** o administrador começa uma emissão autorizada; sua conta é bloqueada, perde o papel ou muda a versão de segurança depois da última consulta de acesso ao workspace, enquanto a renderização/consulta restante ainda está em andamento. Os caminhos continuam até a resposta com o arquivo. A reautorização do workspace durante a carga não cobre uma revogação posterior. A rota geral de exportação já trata esse mesmo intervalo em `web/src/app/api/escalas/export/route.ts:53–54`, inclusive após cache/renderização.

**Critério de correção:** depois de produzir os bytes e antes de montar a resposta, repetir `report.analytics` ou `export.integration`, respectivamente, usando o estado atual da conta. Preservar isolamento de empresa, seleção, revisão e proprietário do manifesto. Erro de acesso deve entregar JSON estruturado, sem os bytes preparados. Essa checagem final limita o intervalo observado; não representa garantia absoluta contra qualquer mudança após a própria checagem.

**Menor regressão:** em cada rota, iniciar com administrador válido e alterar o retorno do leitor de usuário para bloqueado/rebaixado durante uma dependência aguardada posterior à carga do workspace. Esperar 403 e ausência de PDF/TXT na resposta. Manter um sucesso com arquivo real. Para TXT, testar o serviço real com persistência simulada: o teste de transporte atual substitui `downloadTurnoExport` e a própria autorização (`turnos/export/route.test.ts:2–14`). O teste de revogação da exportação geral (`export/route.test.ts:285–295`) oferece o padrão existente.

## Riscos e lacunas, separados dos defeitos

1. **Desbloqueio por APPROVER com permissão alterada durante SAVE.** `service.ts:339` e `:358` usam `current.canPublish`, obtido antes da transação, para autorizar desbloqueio explícito. A confirmação de um SAVE comum (`:392`) verifica salvar, sem repetir publicar nem a comparação com as capacidades atuais. A passagem de uma concessão de conta APPROVER para PLANNER preserva salvar (`permissions.ts:89–93`). É uma janela potencial se o escritor da concessão não alterar `User.securityVersion` ou não usar coordenação equivalente. Não classificada como defeito confirmado porque o escritor de concessões de conta está fora do READ autorizado. Correção preventiva: verificar a autoridade de desbloqueio dentro da transação. Regressão proposta: mudar a concessão entre a leitura inicial e a confirmação, mantendo versão de segurança constante, e exigir rejeição sem escrita. Para verificar se o cenário é alcançável pela aplicação, localizar o escritor real de `EscalaBranchAccess` exige ampliar o escopo de leitura.
2. **Autenticação de conta e projeção SSR dependem de código externo ao escopo.** `access.server.ts` consome `requireSession` de `web/src/lib/api/security.ts`; `page.tsx:11` e `account-access-view.server.ts:12–13` dependem de `auth` de `web/src/auth.ts`. Os dois caminhos externos não foram abertos. A política de endpoints relê usuário/status/papel e observa alteração de versão durante a mesma requisição (`access.ts:25–32`), mas a invalidação de um cookie antigo entre requisições depende desses provedores. A projeção visual de ADMIN, por si só, não é prova de autorização atual. A inspeção desses dois arquivos seria necessária para concluir sobre autenticação de conta ponta a ponta.
3. **PostgreSQL, migrações e concorrência real pendentes.** Foram lidas as relações compostas do schema; não foram lidos/executados os SQLs, pois não constam no READ autorizado. Callbacks de `$transaction` simulados não demonstram espera de locks, visibilidade após espera, rollback, deadlock, integridade de triggers ou comportamento sob dois clientes reais. O lock por empresa aparece em emissão/revogação/administração/aprovação e escritas finais; a presença desse código não valida sua execução no banco.
4. **Reimportação substitutiva continua sem implementação nesta entrega.** A regra registrada em `docs/escalas-approved-policy.md:90–94` exige substituir presentes/ausentes no escopo do arquivo, tanto para colaboradores quanto para afastamentos, com revisão e atomicidade. A rota atual de importação devolve prévia (`import/route.ts:69–70`). Não apresentar esse caminho como substituição persistida, nem como aprovação de novo regime.
5. **Validação integrada da interface pendente.** A entrega registra TS2322 no componente de administração em trabalho do chat05. Esse componente não foi lido nem alterado. SSR estático não demonstra troca de identidade no navegador, limpeza de estado, recuperação após sessão vencida ou fluxos de uso completos.

## Matriz de rotas, sucesso e autoridade

“Real” abaixo significa a função exercitada no código do teste, com persistência/autenticação externas simuladas; não significa execução nesta revisão ou comunicação com banco real.

| Rota/ação | Sucesso lido nos testes | Fronteira de autoridade e limite da evidência |
| --- | --- | --- |
| `/access/session` GET/POST/DELETE | Entrada nominal, cookie, contexto, precedência de conta e revogação em `access/session/route.test.ts:28–103`; emissor e leitor têm suítes próprias | Transporte simula emissão/leitura; `operator-session-issuer.test.ts` e `operator-session-store.test.ts` cobrem adaptadores. Resolver real distingue sessão, operador, versões e concessões. Sem navegador/cookie real. |
| `/access/admin` GET/POST | `operator-admin-service.test.ts:27–54` chama HTTP, normaliza nome, persiste concessões e confirma versão/revogação | Serviço e `requireEscalaCapability` reais; guard de identidade, persistência e transação simulados. O teste de rota isolado substitui o serviço. |
| `/approved-policy` GET/POST | `approved-policy-service.test.ts:46–72` aprova, lista, carrega e revoga | Serviço/builder/autorização reais com guard e banco simulados. Origem estrangeira e hash corrompido rejeitados nas linhas 74–88. Sem trigger/SQL real. |
| `/escalas` GET | `route.test.ts:84` lista/abre resposta privada; `service.test.ts:754–790` restringe filial/empresa e revisão | Transporte substitui serviços e parte do acesso. Serviço separado exercita leitores de persistência simulados. Não comprova identidade real. |
| CREATE / CREATE_APPROVED / ADD_EMPLOYEE / ADMIN_REBASE | Serviço cria de aprovação e salva proveniência em `service.test.ts:1088`; rebase em `:1186`; caminho HTTP genérico em `route.test.ts:93` | Criação confere seed exata e aprovação na transação (`service.ts:117–133`). Inclusão acrescenta a pessoa ao workspace atual (`:166–182`), sem reconstruir a equipe da seed. Casos por ação não equivalem a sucesso integrado HTTP+DB. |
| SAVE / VALIDATE / APPLY_PROPOSAL / PUBLISH / DELETE | CAS/publicação no serviço; proposta genuína em `service.test.ts:1154–1165`; APPROVER em `:1200–1206` | Persistência e Solver simulados; guardas puras reais. AR01 e risco de desbloqueio permanecem. Prova vincula conteúdo, identidade, sessão, revisão, aprovação e estado de acesso; não é autorização independente para aplicar. |
| START / GENERATE / STATUS / CANCEL | Transporte em `route.test.ts:48–67`; serviço gera sem escrita e rejeita revogação em `service.test.ts:1167–1172` | Operação usa proprietário derivado de sessão, tenant, revisão e estado/CAS; retorno do job repete autorização (`solve-operations.ts:132`). Sem processo Solver ou corrida de banco real. |
| `/export` PDF/XLSX | PDF/XLSX reais inspecionados em `export/route.test.ts:259–283`; cache/revisão/tenant e revogação nas linhas 285–313 | Política real com usuário/concessões e workspace simulados. Projeção básica não inclui análises; ADMIN_FULL exige analytics e apenas PDF. Reautorização após renderização/cache presente. |
| `/import` GET/POST | Modelo e CSV real em `import/route.test.ts:30–74` | Autorização substituída no teste; produção exige `import.manage` e filial. Prévia sem persistência. Não valida reimportação substitutiva. |
| `/operational-report` GET | PDF real da revisão salva em `operational-report/route.test.ts:33–48` | Guard, workspace e capacidade administrativa substituídos. Falta regressão com autorização real e revogação final: AR02. |
| `/turnos` GET / SYNC / PREVIEW_SWAP / APPLY_SWAP | Respostas funcionais em `turnos/route.test.ts:41–64`; suítes de catálogo/troca separadas | Transporte substitui catálogo/troca; testes de domínio substituem fronteira de autorização. SYNC exige `settings.manage`; troca exige `shift.manage`, aprovação/modelo e SAVE final. Não tratar catálogo nominal como definição administrativa livre. |
| `/turnos/export/manifest` POST e `/turnos/export` GET | Manifesto selecionado em `manifest/route.test.ts:28`; TXT1/TXT2 com CRLF em `export/route.test.ts:25–31` | Serviço/autoridade substituídos no transporte. Produção exige `export.integration`, proprietário, período/revisão/hash do manifesto. AR02 também se aplica ao retorno TXT. |
| Página `/escala` | Seis cenários em `page.test.tsx:23–67`: anônimo, ADMIN, nominal, conta operacional, bloqueada e falha de armazenamento | Projeções reais com leitores externos simulados e conteúdo do workspace substituído. Não é smoke de navegador nem prova da validade atual de uma conta autenticada. |

## Barreiras confirmadas por leitura

- Precedência de conta sem união com cookie nominal; respostas de conta diferentes de 401 não habilitam fallback (`access.server.ts`).
- Políticas desconhecidas, concessões canônicas duplicadas, operador inativo e versões inválidas negam acesso. Sem concessão não há padrão amplo (`permissions.ts`, `permission-scope.ts`, `operator-session-policy.ts`).
- Emissão usa token aleatório, hash persistido, cookie assinado e versões; revalida antes de responder. Administração incrementa versão e revoga sessões sob o mesmo lock. Saída revoga a sessão específica.
- Aprovação é conferida por empresa, conteúdo/hash, origem, filial/período/mês e estado de revogação. CREATE aprovado compara a entrada derivada com a seed exata. Alterações administrativas protegidas invalidam a referência anterior; rebase cria revisão explícita.
- Campos protegidos são comparados antes da preparação; ausência, feriado e bloqueio desconhecido não viram trabalho desbloqueado. Proposta adulterada falha na assinatura; revisão concorrente falha no CAS.
- XLSX monta somente Escala/Horarios/Excluidos em `export.ts:188–208`. PDF básico usa projeção restrita. Cache tem versão de conteúdo e principal, além de reautorização antes de entregar. Isso não estende automaticamente a garantia às rotas de AR02.

## Evidência e estabilidade do corte

O relatório da implementação informa 450 testes aprovados em 34 arquivos, um caso POSIX ignorado, lint de 66 arquivos e tipos delimitados de backend aprovados. São resultados atribuídos à entrega, não reexecutados nem certificados nesta revisão. A leitura de testes distingue transporte com serviço simulado de serviço/autorização reais com persistência simulada. Nenhum teste foi importado para contar casos ou reproduzir resultados.

Os 207 arquivos `.ts/.tsx` sob `web/src/lib/escalas` e `web/src/app/api/escalas` permaneceram estáveis entre o início e o encerramento da leitura. Agregado SHA-256: ordenar os caminhos absolutos com a ordenação padrão de JavaScript; para cada arquivo compor `caminho relativo + espaço + SHA-256(bytes)`; juntar com LF, sem LF final; calcular SHA-256 UTF-8.

| Objeto | SHA-256 |
| --- | --- |
| Agregado inicial e final dos 207 arquivos | `4694d7a71ad41727a63a52034a7eac5f719bbb0117fa663e868c360876b69283` |
| `docs/escalas-access-functional.md`, inicial e final | `251d9d29b2a6ddafe70fec7de1c84c1df89adb40f7cdc0bcc9722ca5c94dcf03` |
| Contrato congelado `access-contracts.ts`, inicial e final | `c00eab12193033610979c4274e07e0f673aa42e31d38fc8b9693d92a24be02f0` |
| `docs/escalas-access-api-contract.md`, inicial e final | `ae54c287a05859ada188806d706e5deaa7311d7c08a6bb6cc0ac983ce1c4c38f` |
| `docs/escalas-approved-policy.md`, corte final | `e496eba4ca69f2711e43c5fafcb179ffd6ecd9e946d4328b64db4dedfd4620ed` |
| `web/prisma/schema.prisma`, corte final | `44b1c2101d203ff393ba32ed7e8032a7c724ed674b1eddd9015de5ab843ccbfc` |
| `web/src/app/(app)/escala/page.tsx`, corte final | `46835899189a9613a29573a76924c657a0a03dacea47731fb882e678f49a2234` |
| `web/src/app/(app)/escala/page.test.tsx`, corte final | `7456aaa1c1fac1a49169c1624384d1e39e4269056d44f5c6fc6c26706d75675e` |
| `web/src/lib/escalas/service.ts` | `d6223eebe22cbffef22c92faaebee2f3ad0d0af4dcc5bd29d87df0d42d5a2865` |
| `web/src/lib/escalas/operational-input-policy.ts` | `96a6cf3d939143642c00f41ee614790c472f4c7d2c2cea023ca3f408edae54ca` |
| `web/src/app/api/escalas/operational-report/route.ts` | `57e8d6a44c4e533e17a633619f58a960c5fa20f82f87133ffe32f773d94f38b4` |
| `web/src/lib/escalas/shift-catalog/export.ts` | `7cc792eaa5cabb7d8df370bab7539ddef91aa07ce54acdb1cbebb558a648a7b8` |

Coleta e análise usaram `ctx_execute`, validado nesta tarefa; a escrita usou `apply_patch`. Não houve criação de arquivos descartáveis, processos de apoio ou mensagens laterais. Este relatório encerra a revisão delimitada, mantendo pendentes as correções, regressões e verificações de ambiente descritas acima.
