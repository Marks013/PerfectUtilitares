# Contrato HTTP de acesso de Escalas v1

Marco AUX-ACCESS-API-CONTRACT revisão 3 da tarefa AUX-ACCESS-FUNCTIONAL:r2:human-shift-catalog, que substitui r1:batch87, sobre a base reconciliada `8651e77b108cd3026d50707dea60c03963c9faaf`. DTOs compartilhados em `web/src/lib/escalas/access-contracts.ts`, com imports de tipos no frontend. Este documento fixa a interface para integração paralela; a disponibilidade efetiva depende da implementação e verificação registradas em `escalas-access-functional.md`. A publicação do contrato não ativa login ou migração.

## Sessão e precedência

`GET /api/escalas/access/session` retorna `{access, context}`. `context` segue `EscalaClientAccess`: canal ACCOUNT/USERNAME, rótulo, administrador, todas as filiais somente para administrador e lista de filiais/capacidades. ExpiresAt é ISO UTC. Conta administrativa autenticada tem precedência sobre qualquer cookie do módulo; nenhuma união de privilégios. Contas bloqueadas não recorrem ao cookie.

`POST` na mesma rota recebe somente `{username}`. O nome identifica um operador cadastrado e ativo, nunca cria um usuário. Não é autenticação forte e não protege contra personificação de quem conhece o nome. ADMIN_ONLY bloqueia entrada operacional; SCOPED exige policy, versões e grants atuais. Cookie antigo sem operador/versões não concede acesso em SCOPED. Falha de infraestrutura é erro, não autorização. `DELETE` revoga o cookie atual; não encerra a conta administrativa.

## Administração de operadores

`GET /api/escalas/access/admin` é administrativo e retorna `{policy:{mode,version},operators:[{id,username,displayName,active,permissionVersion,branchGrants}]}`. Cada grant contém filial canônica, active e capacidades explícitas. Lista vazia não gera permissões padrão.

`POST` recebe um comando fechado:

- CREATE_OPERATOR: username, displayName, active, branchGrants.
- UPDATE_OPERATOR: operatorId, expectedPermissionVersion, username, displayName, active.
- REPLACE_BRANCH_GRANTS: operatorId, expectedPermissionVersion, branchGrants.
- REVOKE_SESSIONS: operatorId, expectedPermissionVersion.
- SET_ACCESS_MODE: mode ADMIN_ONLY/SCOPED e expectedVersion (0 apenas quando ainda não existe registro; a primeira versão persistida é 1).

Sucesso retorna o mesmo DTO de administração atualizado. Alterações de operador/grants incrementam sua versão e revogam sessões em transação. Mudar modo incrementa a policy e revoga sessões do módulo no tenant. Não há criação automática de administrador. Não enviar usernameNormalized, tenant, autor ou versões internas como autoridade. Conflitos de revisão retornam 409.

## Aprovação por período e modelos

`GET /api/escalas/approved-policy?branchCode=...&startDate=...&endDate=...` exige leitura da filial e retorna `{policies:[{id,branchCode,startDate,endDate,visibleMonth,version,approvedAt,revokedAt,regimeModels:[{id,label}]}]}`. A busca é pelo período técnico exato, sem transportar meses ou expor o JSON protegido completo.

`POST` é administrativo. APPROVE recebe `input`, `origin:null|{workspaceId,revision}`, `selectedSeedAssignments` e `regimeModelSelections` conforme o DTO. Autor, tenant, data, versão e hash são gerados/resolvidos no servidor. Quando houver origem, a revisão persistida e seu CAS devem corresponder ao input aprovado. Uma aprovação pode existir antes do workspace. Sucesso retorna `{policy}` (201). REVOKE recebe somente id, preserva conteúdo/histórico e retorna `{revoked:true}`. Reimportação de colaboradores/afastamentos é outra tarefa, não uma ação deste contrato.

## Workspace e alterações

As rotas e ações existentes são preservadas para o administrador. As novas ações de `POST /api/escalas` são:

| Ação | Campos além de action | Resultado |
| --- | --- | --- |
| CREATE_APPROVED | approvedPolicyVersionId | Workspace 201 montado no servidor, período exato da aprovação. |
| SAVE / VALIDATE | id, expectedRevision, input | Workspace salvo / validação da entrada comparada com a revisão canônica. |
| APPLY_PROPOSAL | id, expectedRevision, input, proposalProof | Workspace salvo após conferir assinatura, escopo e revisão atual. |
| ADD_EMPLOYEE | id, expectedRevision, regimeModelId, name, registration | Workspace atual com uma nova pessoa; ID/contrato/vínculo são resolvidos no servidor. |
| ADMIN_REBASE | id, expectedRevision, approvedPolicyVersionId | Nova revisão administrativa vinculada à aprovação exata, sem sobrescrever histórico. |

O workspace inclui `approvedPolicyVersionId:string|null`. Legado nulo continua disponível ao administrador; restrito recebe ESCALA_CONFIG_APPROVAL_REQUIRED. CREATE com input livre é administrativo. VALIDATE sem referência continua reservado ao administrador; operação restrita sempre informa id/CAS. SAVE manual é distinto de APPLY_PROPOSAL: o cliente não pode apresentar generationBasis como prova de geração.

GENERATE e o resultado terminal da geração com job acrescentam `proposalProof` ao resultado que já contém `proposalInput`, `result`, `validation` e `preparation`. A prova assinada expira, vincula tenant/principal/sessão/workspace/revisão/aprovação e o conteúdo proposto. Guardar a prova enquanto o rascunho for exatamente o resultado devolvido; edições subsequentes não devem tentar reutilizá-la como nova proposta. O backend não executa Solver para autenticar a prova. Sessão/grants/aprovação devem continuar válidos no SAVE final.

Regras/contexto/jornada/regime/histórico/eligibilidade/proveniência são protegidos. Nome e preferências operacionais podem mudar com capacidade correspondente; inclusão exige modelo aprovado. Alterações de horários usam intenções e endpoints de catálogo existentes, preservando ABSENCE/HOLIDAY/locks. O navegador não fornece autoridade para mudar admissão/desligamento, regimes ou criar marcações de catálogo. Aprovação não cria presença ou histórico real. Uma nova pessoa sem vínculo datado aprovado permanece com vínculo desconhecido; não se inventa admissão no início do mês.

## Downloads

### Definir turnos e atribuir turnos são ações distintas

A criação e a alteração de definições no catálogo são exclusivamente administrativas. `shift.manage` no grant operacional permite selecionar/atribuir somente turnos já existentes e permitidos ao colaborador e ao período, após conferir tenant, filial, compatibilidade e revisão. Não permite inventar marcações, escolher código inexistente ou criar turno por payload de override/troca. A UI só exibe definição quando `context.channel === "ACCOUNT"`, `administrator` e `allBranches` forem verdadeiros. Atribuição exige esse contexto administrativo ou exatamente um grant da filial canônica com `shift.manage`; duplicidade canônica nega. O helper `escalaCatalogActions` usa o normalizador puro existente e explicita essa distinção visual sem ampliar o parser de capacidades. Isso não substitui autorização no servidor.

O contrato existente de catálogo/troca é preservado nesta etapa com enforcement do servidor. A integração integral de cadastro, filtros por filial/colaborador/setor/turno/matrícula e exportação coerente de turnos e vínculos colaborador–turno pertence à próxima tarefa AUX-SHIFT-CATALOG-INTEGRATION. Não há novos controles ou filtros fictícios neste contrato. Essa futura integração deverá conferir e baixar exatamente o mesmo conjunto e versões, sem omissões silenciosas ou seleção automática de referência ambígua. TXT/manifestos continuam administrativos; seleção operacional não habilita exportação de integração.

`GET /api/escalas/export` conserva os parâmetros existentes `id`, `revision?`, `format`, `mode=rest|hours|both` e `separateSectors=true|false`, e aceita projection BASIC_SCHEDULE/ADMIN_FULL. Padrão: BASIC_SCHEDULE. PDF e XLSX básicos exigem capacidade específica na filial. ADMIN_FULL é PDF administrativo; XLSX nunca contém análises, Capacidade ou Desfalques. Projeção efetiva entra nos bytes renderizados e na identidade do cache. TXT/manifestos, importações e relatório gerencial permanecem administrativos. A mudança visual dos relatórios será outra fatia; preserve as funções de exportação existentes.

## Erros e proteção HTTP

Falhas seguem `{error:{code,message}}`, Cache-Control privado/no-store e status existente: 400 formato, 401 sessão ausente/expirada, 403 capacidade/escopo/campos, 404 recurso do tenant não encontrado, 409 CAS/configuração/proposta incompatível, 422 domínio, 503 infraestrutura. Códigos relevantes: ESCALA_ACCESS_REQUIRED, ESCALA_ACCESS_UNAVAILABLE, ESCALA_ACTION_FORBIDDEN, ESCALA_BRANCH_FORBIDDEN, ESCALA_CONFIG_APPROVAL_REQUIRED, ESCALA_CONFIG_REVOKED, ESCALA_PROTECTED_INPUT, ESCALA_PROPOSAL_INVALID e ESCALA_STALE_REVISION. Mensagens não carregam payload pessoal ou credenciais.

Writes mantêm origem/CSRF, JSON fechado, limites de bytes e rate limit. GET não modifica dados. Jobs/polling reautorizam o recurso e o proprietário. Nunca ativar username-only enquanto uma rota puder contornar o enforcement. SQL, concorrência PostgreSQL e E2E real continuam dependentes do ambiente existente autorizado.
