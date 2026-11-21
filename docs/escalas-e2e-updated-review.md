# Revisão independente das fontes E2E e do harness

**Resultado: rejected para a fonte local atual.** Há um defeito P1 no encerramento do cenário nominal obrigatório: a fixture exige a exclusão de uma conta que o próprio cenário tornou aprovadora de configurações imutáveis. Não se recomenda executar o pacote como candidato aprovado antes de corrigir essa expectativa de limpeza. Nenhuma execução PostgreSQL ou E2E funcional foi realizada, nem autorizada por este parecer.

Tarefa `AUX-E2E-SCENARIOS-REVIEW r1`; despacho `AUX-E2E-SCENARIOS-REVIEW:r1:batch309`; gate309 `dab120ef77fe0d9c205ea96b3b127296a8dea5259f7288b2cba5c9f471e86931`; reserva310. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`. Revisão em 14/11/2026.

## E2ER01 — P1: cleanup exige apagar o aprovador preservado por FK

**Local principal:** `web/e2e/escalas-access-fixtures.ts:115` e `:116`. Confiança alta no conflito de contratos; o HTTP real ainda não foi executado.

O helper cria o ADMIN proprietário e registra seu ID antes dos demais usuários (`:72`, `:81`). `approve()` usa a sessão desse ADMIN (`:99` a `:104`). O caso nominal chama a aprovação duas vezes em `web/e2e/escalas-scoped-access.spec.ts:59` e `:64`, e sempre chama `scope.cleanup()` no finally (`:273`).

A revogação usada na limpeza apenas preenche `revokedAt`; ela não remove a linha nem troca `approvedById` (`web/src/lib/escalas/approved-policy-service.ts:57` a `:63`). O aprovador persistido é o ator da aprovação (`:88`). A relação composta entre aprovação e User usa `onDelete: Restrict` (`web/prisma/schema.prisma:318`). Logo, revogar e remover os workspaces não torna essa conta removível.

A seguir a fixture envia DELETE para cada ID e exige 200, começando pelo ADMIN aprovador. A rota chama `deleteAccountWithAdminInvariant` (`web/src/app/api/admin/users/[id]/route.ts:219`), que executa exclusão física (`web/src/lib/users/account-mutations.ts:174`). A violação referencial P2003 é traduzida pela rota para 404/TENANT_NOT_FOUND (`route.ts:51` a `:59`), e não 200. Com as constraints do candidato aplicadas, até um cenário cujas asserções funcionais tenham passado termina em falha na limpeza. A primeira falha também interrompe a tentativa de limpar as contas seguintes; o finally ainda fecha os contextos.

**Reprodução delimitada realizada:** extraí a função cleanup atual, sem modificá-la, e executei-a em contexto VM com contratos em memória: uma aprovação retida, seu aprovador e outra conta; REVOKE responde 200 e DELETE do aprovador responde 404 conforme o ramo P2003 da rota. Resultado: `Expected 200; received 404`; a segunda conta não recebe DELETE; os dois contextos são fechados. Não houve importação de produto, processo, rede, serviço ou banco nesse ensaio. A prova confirma o fluxo do helper diante da recusa; não se apresenta o stub como execução da FK ou como E2E real. Evidência em `outputs/escalas-e2e-updated-review/cleanup-contract-reproduction.json`.

**Menor correção recomendada:** a fixture deve distinguir contas que assinaram aprovações e preservar essas identidades históricas até o descarte do banco exclusivo pelo harness. Se for necessário desativá-las antes, usar a operação administrativa existente de bloqueio, sem apagar aprovação ou enfraquecer FK/trigger. Continuar a limpeza independente dos demais recursos e agregar falhas. Não resolver aceitando indiscriminadamente 404, omitindo o finally, marcando o caso como skip ou removendo a asserção de sucesso funcional.

**Verificação após correção, ainda não executada:** teste puro do cleanup com aprovador retido e conta removível, incluindo falha em um recurso; depois, no ambiente autorizado, executar o cenário nominal com as duas aprovações reais e conferir resultado do caso, fechamento dos contextos, descarte do banco exato e lifecycle da fase. Nenhuma alteração de produto é necessária para essa correção de fixture.

## Demais critérios revisados

| Critério | Evidência e avaliação estática |
|---|---|
| Identidades próprias | `escalas-access-fixtures.ts:21` exige opt-ins e captura local; `:46` exige tenant novo por 201; `:58`/`:69` usam convites/aceite reais; `:73` cria contexto separado. O nominal usa uma página sem login administrativo e confirma OPERATIONAL/administrator=false (`escalas-scoped-access.spec.ts:78`). O ADMIN fica em outro contexto. |
| Precedência de conta | `escalas-scoped-access.spec.ts:219` a `:229` copia o cookie nominal para contas reais e exige que OPERATOR sem grants continue sem acesso, enquanto ADMIN continua administrativo. Isso não mascara os passos nominais anteriores. |
| Negações e operações reais | O nominal exige negações de tenant/filial, campos administrativos, importação, SYNC, publicação e arquivos administrativos (`:94` a `:134`), atribuição de turno existente por PREVIEW_SWAP/APPLY_SWAP (`:137` a `:151`), geração com HTTP 200, FEASIBLE/OPTIMAL, validação válida e aplicação real (`:168` a `:193`). As respostas não são substituídas por mocks de sucesso. |
| Seletores | Os nomes acessíveis da entrada nominal, seleção por filial/ano/mês, formulário aprovado, importação e catálogo correspondem aos componentes atuais. `escalas-selection.ts:7` escolhe o ID salvo e verifica o cabeçalho; `:27` abre disclosures por controles. A conferência estática não prova visibilidade, tempo de carregamento ou sucesso no navegador. |
| Importação | `escalas-import-replacement.spec.ts:27` prova por asserções que PREVIEW não grava, A/B vira B/C somente após confirmação, dupla ativação envia uma aplicação e resposta canônica preserva ID/histórico. `:54` cobre ausência fora do recorte e dias removidos; `:134` cobre paginação parcial. `escalas-absences.spec.ts:152` cobre colisão protegida e manutenção dos registros na geração. |
| Resposta perdida/cancelamento | Em `escalas-import-replacement.spec.ts:103` e `:167`, route.fetch executa a solicitação real e exige 200 antes de perder/reter a resposta. O teste confere revisão/conteúdo gravados, ausência de retry e mensagem de incerteza. Cancelar a espera não é tratado como rollback. O atraso de PREVIEW (`:192`) devolve resposta real, sem fabricar sucesso. |
| PDF/XLSX/TXT por papel | O nominal aquece ADMIN_FULL e verifica PDF básico posterior, nega modalidades administrativas/TXT, compara bytes reais baixados e usa parsers (`escalas-scoped-access.spec.ts:197`). O catálogo verifica modalidades, cinco filtros, seleção explícita, zeros de matrícula, CRLF e conteúdo dos TXT (`escalas-shift-catalog.spec.ts:34`, `:104`, `:228`). Os TXT são comparados ao manifesto e o cenário manual também possui horários literais esperados (`:173`). |
| Revogação/entrega | O nominal retém a solicitação antes de chegar ao servidor, revoga grants e exige 401 JSON/nenhum download (`:247`). Isso cobre revogação antes da autorização da request; não prova corrida interna durante renderização ou entrega já iniciada no servidor. |
| Casos privados | `escalas-real-csv.spec.ts:13` e o primeiro caso de `escalas-absences.spec.ts:27` continuam condicionados a arquivos privados. Não foram abertos. Os 37 casos listados incluem esses dois condicionais; sua listagem não conta como aceite obrigatório nem como execução. Os cenários sintéticos permanecem separados. |

## Harness: integração e limites

A partição usa a mesma lista nominal em `web/scripts/e2e-suite-plan.mjs:2` a `:8` e `web/playwright.config.ts:18`; mantém um worker e nominal sem retry. O parser de argumentos (`e2e-suite-plan.mjs:11`) preserva os filtros admitidos e rejeita overrides de configuração, saída, shard, paralelismo e seleção persistida. `selectedPhases()` (`:77`) rejeita união vazia/duplicada. O runner coleta com os mesmos argumentos antes de alocar recursos (`run-isolated-e2e.mjs:260`) e não encaminha pass-with-no-tests à execução (`:470`).

`phaseEnvironment()` (`e2e-suite-plan.mjs:38`) remove aliases administrativos herdados, define credenciais sintéticas próprias por fase, mantém o seed em principal e aplica o slug novo somente ao runtime nominal. `run-isolated-e2e.mjs:408` a `:416` usa seedEnv antes do boot; os processos da aplicação/worker e o Playwright recebem env do runtime (`:442`, `:451`, `:470`). A criação posterior do tenant nominal continua sendo responsabilidade da fixture, com exigência de 201. A leitura transitiva liberada na fila314 confirmou diretamente ADMIN_EMAIL antes de SEED_ADMIN_EMAIL, ADMIN_PASSWORD antes de SEED_ADMIN_PASSWORD e upsert do slug indicado (`web/prisma/seed.ts:132`, `:140`, `:141`). Portanto semear previamente o slug nominal impediria a criação própria por 201; a separação implementada evita esse conflito.

Cada fase selecionada usa nome de banco/artefatos próprio e conclui o ciclo antes da seguinte (`:276` a `:286`). Os parâmetros comuns substituem banco, app/auth URL, segredos e captura de e-mail (`:374` a `:407`); os processos não recebem o ambiente já mutado da fase anterior. Os recursos de infraestrutura entram em cleanupPhase (`:479`), que tenta as etapas posteriores mesmo após rejeição de uma etapa; execução e limpeza falhas propagam erro (`:518`). Isso é evidência estática e de testes puros arquivados, não prova de encerramento real de processos, remoção de containers ou DROP DATABASE.

Continuam limites operacionais explicitados nos documentos: host PostgreSQL deve ser escolhido/reservado externamente; CI, loopback, prefixo de banco e flags não concedem autorização. A descoberta existente do runner não foi executada. A política de task-temp/rastreamento do executor ainda precisa ser compatibilizada com o futuro host; o runner usa mkdtemp e IDs próprios, não o helper global. O checkout de execução precisa ser exclusivo porque geração, predev, cópias para standalone e restauração de arquivos do Next não constituem isolamento de escritores concorrentes. Interrupção do processo não demonstra execução de finally.

O documento de ambiente anterior contém números de linha e descrição de lacunas já superadas pelas entregas posteriores (importação, partição e migração). Foi tratado como histórico de restrições e decisão de aguardar ambiente existente, não como inventário atual das fontes.

## Integridade e evidência examinada

| Entrada | SHA-256 |
|---|---|
| docs/escalas-e2e-updated.md | `522dcc92173a7ea922498c3da919a006fa1f61d9172b67516965619bdc87c68b` |
| outputs/escalas-e2e-updated/manifest.json | `cb028233bd8e427e51487adeb2209e45327bd50a198fa3331690c58f213db0e5` |
| docs/escalas-e2e-harness.md | `5f51c9f5b396dd5b981e74810301e460f6ce5e1ef2cbfb6f08777d7387bef15e` |
| outputs/escalas-e2e-harness/manifest.json | `f21d4e63c61627a1f07fb76f216f008389b28dc8aada33b32f053334dd24d94a` |
| web/e2e/escalas-access-fixtures.ts | `18bb6fa9e3182127e8298198cf1571cf1dae1db6e778053b16758ecfe649e661` |

As 15 fontes E2E têm uma supersessão esperada: escalas-scoped-access.spec.ts. Nos controles anteriores, playwright.config.ts e run-isolated-e2e.mjs também foram substituídos pela entrega do harness. Os três hashes atuais correspondem ao manifesto posterior; não houve divergência inesperada. As seis fontes e os 33 artefatos do harness conferem. O manifesto da revisão registra os hashes atuais utilizados, a reprodução e as diferenças esperadas.

As provas arquivadas mostram transpilação/lint/tipos e listagem, além de seis testes puros do planejador. A configuração real listou 36+1 casos de Escalas, filtros 0+1 e 8+0 e vazio 0+0 rejeitado; não executou hooks ou casos. As oito sugestões informativas anteriores do runner não foram reclassificadas como novos erros. Não repeti essas suites. O único ensaio novo foi o fluxo puro e delimitado do cleanup descrito acima.

## Ferramentas, escopo e liberação

Context Mode efetivo: ctx_batch_execute na coleta; ctx_execute para parsing, hashes, leitura delimitada e reprodução em memória; ctx_search para consulta indexada. Uma consulta rg com wildcard literal em caminhos Windows retornou os error 123; foi substituída por enumeração limitada de nomes via fs no ctx_execute. Não houve indisponibilidade do Context Mode. Escrita somente por apply_patch nativo nas entregas desta revisão.

Não foram criados arquivos temporários nem processos persistentes; a reprodução foi executada em memória, sem APIs externas disponíveis ao código isolado. Nenhum runner, seed, Prisma generate, E2E, quality/build, instalação, serviço, host, banco ou produção foi executado/acessado. Nenhum arquivo privado, .env ou credencial foi aberto. Produto e evidências alheias preservados. Recursos da reserva310 liberados ao coordenador. A correção recomendada fica com o autor; a espera pelo ambiente existente permanece vigente.
