# Correções operacionais da interface — AUX-UI-RECOVERY-FIX r1

Data: 2026-11-14. Execução direta, sem novos escritores ou despachos.

## Escopo e autorização

Despacho `AUX-UI-RECOVERY-FIX:r1:batch128`, gate128 `2efbfd559ba51b43c9aaac8d40ea487948d257fbaf794e139c8e54f20f783344`, reserva129. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`, HEAD de referência `8651e77b108cd3026d50707dea60c03963c9faaf`.

Correções dos quatro achados de `docs/escalas-ui-independent-review.md` e do TS2322 comunicado pelo Maestro durante o fechamento. Escrita limitada aos componentes, a este relatório e a `outputs/escalas-ui-recovery-preview/`. Alterações concorrentes foram preservadas. Nenhuma mudança em contratos, backend, rotas, SSR, banco, Solver, catálogo F09/F10 ou produção.

## Resultado

| Achado | Comportamento corrigido |
| --- | --- |
| IR01 — P1 | Toda reentrada cria um novo escopo visual e carrega uma lista autorizada nova. Bloquear o acesso invalida operações, reconciliação e salvamento pendentes; respostas antigas são verificadas antes de alterar estado ou emitir bloqueio por 401. Não existe retomada automática de SAVE na reentrada. |
| IR02 — P2 | O formulário de novo funcionário mantém nome, matrícula e modelo quando um SAVE alheio altera a revisão. A aprovação é consultada novamente. Os campos só são limpos após sucesso confirmado do próprio cadastro ou descarte escolhido. |
| IR03 — P2 | Falha na consulta de aprovação é exibida como erro recuperável. A mensagem de aprovação ausente só aparece após consulta concluída, sem erro e sem aprovação válida. |
| IR04 — P2 | Entrada e consulta de aprovação têm prazo de 15 segundos. A entrada permite cancelar e tentar novamente; consultas permitem nova tentativa após erro. Respostas atrasadas não substituem o contexto novo, mesmo quando o transporte ignora o cancelamento. |
| TS2322 — integração | O editor valida cada capacidade recebida e cria uma cópia mutável com o conjunto restrito aceito pelo comando. Uma capacidade administrativa incompatível bloqueia o envio com mensagem que identifica filial e permissão; a seleção original permanece disponível. Sem `any`, coerção que esconda incompatibilidade, ampliação de capacidades ou filtragem silenciosa. |

Nome, flags administrativas ou igualdade de filial não são usados como prova de identidade. Como o contrato não fornece um identificador estável de principal, toda reentrada reinicia o escopo. O rascunho da grade fica isolado no armazenamento da sessão. Sua oferta de recuperação depende de nova leitura autorizada do planejamento e da correspondência exata de filial e período; restaurá-lo exige escolha explícita. Conflitos, recuperação e mensagens do planejamento anterior também ficam atrás da autorização de leitura atual.

A configuração de 8h/9h e a criação ou alteração de definições de turnos continuam administrativas. A filial pode atribuir turnos existentes conforme a permissão concedida. O teste de papéis confirma que a filial não recebe a ação de adicionar turno.

## Verificação executada

- Vitest: **7 arquivos, 37 testes aprovados** — acesso/contexto, prazos e cancelamento, cliente operacional, papéis, recuperação/persistência de rascunho e conversão de permissões.
- Biome: **9 arquivos aprovados**, com avisos tratados como falha, sem correção automática.
- TypeScript: editor de permissões e seu teste, por `tsconfig.operator-slice.json`, sem emissão nem incremental: **aprovado**. O fechamento integrado de tipos permanece com o Maestro.
- `git diff --check` no escopo: aprovado.
- Chrome headless: **3 cenários aprovados**, sem erros de página. Evidências persistidas antes da conclusão dos temporários.

O cenário de troca de acesso produz conflito e rascunho em A, bloqueia uma leitura pendente, entra em B, recebe o 401 antigo e verifica ausência dos dados de A, ausência de SAVE/GET de A em B e nova consulta da lista de B. Ao retornar a A, a recuperação só aparece depois de abrir novamente o planejamento autorizado e não gera SAVE automático.

O cenário de formulário altera a revisão por um SAVE separado durante o preenchimento, confirma preservação dos três campos e verifica limpeza somente no sucesso do ADD_EMPLOYEE. Também cobre erro 503 sem mensagem de aprovação ausente, consulta pendente, prazo, resposta atrasada, repetição e descarte explícito. O cenário de entrada cobre prazo, repetição para B, cancelamento explícito e respostas tardias de A.

## Evidências e reprodução

Diretório: [outputs/escalas-ui-recovery-preview](../outputs/escalas-ui-recovery-preview/).

- [verification.json](../outputs/escalas-ui-recovery-preview/verification.json): comandos, códigos de saída, verificações e registros sintéticos de requisições.
- [manifest.json](../outputs/escalas-ui-recovery-preview/manifest.json): SHA256 de fontes, testes, configuração, runner, logs e imagens. Conferência final: zero divergências de artefatos e fontes; fontes estáveis durante a execução.
- [vitest.log](../outputs/escalas-ui-recovery-preview/vitest.log), [lint.log](../outputs/escalas-ui-recovery-preview/lint.log) e [types-operator-slice.log](../outputs/escalas-ui-recovery-preview/types-operator-slice.log).
- [A com conflito](../outputs/escalas-ui-recovery-preview/ir01-a-conflict.png), [B após resposta atrasada](../outputs/escalas-ui-recovery-preview/ir01-b-clean-after-late-response.png), [recuperação autorizada e explícita](../outputs/escalas-ui-recovery-preview/ir01-authorized-explicit-recovery.png).
- [Cadastro preservado](../outputs/escalas-ui-recovery-preview/ir02-preserved-after-unrelated-save.png), [erro 503](../outputs/escalas-ui-recovery-preview/ir03-503-without-missing-approval.png), [prazo da entrada](../outputs/escalas-ui-recovery-preview/ir04-login-timeout-retry.png), [B após cancelamento](../outputs/escalas-ui-recovery-preview/ir04-b-after-cancelled-late-login.png).

[verify-recovery.cjs](../outputs/escalas-ui-recovery-preview/verify-recovery.cjs) recebe como argumento uma pasta temporária própria criada pelo helper `task-temp.ps1`. Executa os testes, lint e tipos; compila a fixture nessa pasta; abre o Chrome instalado e preserva os resultados no diretório de evidências. O navegador é fechado no `finally`.

A fixture usa os componentes React e o hook reais. [model-bridge.tsx](../outputs/escalas-ui-recovery-preview/model-bridge.tsx) compartilha a única instância real do hook com a view somente no bundle de teste. [recovery-harness.tsx](../outputs/escalas-ui-recovery-preview/recovery-harness.tsx) substitui fetch por respostas sintéticas controladas, inclusive promessas que ignoram abort. Nenhum servidor, banco, cookie real ou dado pessoal é acessado. O CSS usa os módulos existentes e tokens mínimos; esta evidência valida comportamento, não equivalência visual com o aplicativo completo.

## Arquivos e SHA256 verificados

Todos os caminhos abaixo são relativos a `web/src/components/escalas/`.

| Arquivo | SHA256 |
| --- | --- |
| operational-access.tsx | `ca9feda12a43077affc593f74b45e8a9228aec8b5a7e4bb4ff377593998ee143` |
| operational-client.ts | `3b21d5113bd6b9c66bb54576ca0399564740fda5d03916bf6fd495c4bde29e47` |
| use-escalas-workspace.ts | `30e552df01183027c3b6cbda2bfebcfa12ec8bd50c3e3acf256466188f6b14df` |
| escalas-workspace.tsx | `aa3a04bce5b5835f9a59baa63fad89353c41e77dda1909b698535b67c0be4717` |
| approved-forms.tsx | `988d6fded230764db558318ddefbc65353633be8f8aa8b92cea8564efe9c7509` |
| operator-administration.tsx | `8ece0028907a04e68f5f796e8e06b1c14d7279aaf8af7ae94faced1b094d018e` |
| operator-administration.test.ts | `0ad95850f583db512650eae885fa07d99d64f4295f001967da9c47ae47ec5cc4` |
| access-context.test.tsx | `2fabd47c85deae26f4024233bd8e025be4696866450d1ee3123bd023a1ccc0da` |
| access-request-recovery.test.ts | `6f4228f0680e58175e7da50f1fdfa9ba1bb3d9c0066e5698a5c45a6789c03e21` |

Os hashes de entrada de `access-contracts.ts`, `access-view.ts`, `types.ts` e da revisão independente foram reconferidos e permaneceram iguais aos liberados para esta fatia.

## Critérios e limites

Foram aplicados os critérios de clareza de estado, ajuda junto aos controles, foco seguro e recuperação explícita das orientações de interface já carregadas. Sem mudança estética ampla. Context Mode foi efetivamente utilizado (`ctx_execute` para hashes/análise/agregação e `ctx_batch_execute` para leituras independentes); a busca de continuidade não trouxe resultado útil e não fundamentou as conclusões. Edições foram feitas pela ferramenta nativa de patch.

Não foram executados qualidade global, build, tipos globais, deploy ou E2E de produção. Nenhuma chamada real de autenticação, revogação ou banco foi validada nesta fatia. Cancelar no cliente não desfaz uma escrita já aceita pelo servidor. A autoridade de acesso e a validação das permissões continuam pertencendo ao backend.

Os processos de verificação terminaram e o navegador foi fechado. Os logs, imagens e manifestos necessários foram preservados fora da pasta descartável; os temporários próprios podem ser concluídos sem perder as evidências.
