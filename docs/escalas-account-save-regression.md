# Regressão de autoridade no SAVE de conta

Data: 14/11/2026. Tarefa `AUX-ACCOUNT-SAVE-REGRESSION`, revisão 1, despacho `AUX-ACCOUNT-SAVE-REGRESSION:r1:batch174`, gate174/reserva175. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

## Resultado

**A condição foi reproduzida e corrigida no serviço.** Antes da correção, um SAVE iniciado como APPROVER aceitou desbloqueio explícito depois de a concessão da filial mudar para PLANNER, mantendo a conta inalterada, e retornou revisão 2. Depois, o mesmo teste recebe `403 ESCALA_ACTION_FORBIDDEN`, sem escrita de workspace, revisão ou auditoria.

Esta conclusão confirma o defeito no fluxo real do serviço com persistência simulada. Não demonstra ocorrência em produção, transporte de cookie, execução de um UPDATE real ou concorrência PostgreSQL. A revisão antecedente foi conferida com SHA-256 `16d168e9887867964e0fd88e7ed6ed145a8f0d89dc36911e918809306d8bcdd2`; ela havia classificado corretamente a condição como ainda não reproduzida.

## Experimento antes/depois

Os quatro casos adicionados em `service.test.ts` exercitam `saveEscala`, `getEscala` e autorização reais, com delegates Prisma simulados. Uma fixture existente fornece revisão e aprovação coerentes. A conta tem papel global OPERATOR, status ACTIVE, empresa constante e `securityVersion:7`; seu objeto é congelado. A concessão separada começa APPROVER, com leitura inicial confirmando `canPublish:true`.

O teste prepara uma cópia da entrada canônica e muda somente `locked:true` para `locked:false` de uma atribuição existente. A atribuição original, seu horário e o histórico são preservados. O wrapper de `$transaction` muda apenas o papel da mesma concessão para PLANNER imediatamente antes de chamar o callback transacional. O mock da leitura de concessões devolve uma cópia do estado atual, permitindo observar a mudança nas leituras finais. Não há alteração da conta ou de sua versão para provocar uma negativa artificial.

| Caso | Antes | Depois |
| --- | --- | --- |
| APPROVER inicial, PLANNER antes da transação, desbloqueio explícito | Aceito, revisão 2; expectativa de 403 falhou | 403; zero chamadas de update do workspace, criação de revisão ou auditoria; entrada original intacta |
| PLANNER estável, edição ordinária de nome | Permitido | Permitido, revisão 2; bloqueio preservado |
| APPROVER inicial, PLANNER antes da transação, edição ordinária de nome | Permitido | Permitido, revisão 2; bloqueio preservado |
| APPROVER estável, desbloqueio explícito sem alterar atribuição/horário/histórico | Permitido | Permitido, revisão 2; dados originais preservados |

A execução focal anterior apresentou **1 falha, 5 aprovações e 101 casos fora da seleção**: quatro casos desta tarefa e dois autotestes foram efetivamente executados. O arquivo de teste permaneceu idêntico entre a execução anterior e posterior. `red.log` conserva a resposta indevidamente aceita; `sources-before.sha256` identifica o código avaliado.

## Correção mínima

Foram acrescentadas quatro linhas ao serviço. `service.ts:333–335` identifica chaves anteriormente bloqueadas e verifica se o corpo bruto de um SAVE manual pede desbloqueio explícito. `service.ts:397` exige `workspace.publish` atual para a mesma filial, dentro da transação final e antes de qualquer escrita, somente nesse caso.

SAVE ordinário continua exigindo salvar; não passou a exigir publicar genericamente. Publicação mantém sua autorização própria. APPLY_PROPOSAL continua com capacidade de aplicar, prova, escopo e CAS existentes. Comparações de campos protegidos, preservação de registros, aprovação e histórico não foram relaxadas. Nenhum contrato, guard de acesso, schema, rota, UI ou Solver foi alterado.

A leitura final da autoridade resolve a condição reproduzida. Ela não promete serialização absoluta contra qualquer escritor externo que altere concessões depois dessa leitura sem adotar a coordenação da aplicação. Concorrência de banco permanece objeto de validação integrada posterior.

## Verificação e evidências

Execução posterior: **127 testes aprovados em quatro arquivos, 1 caso excluído**. Seleção: `service.test.ts`, `operational-input-policy.test.ts`, `access.test.ts` e os dois autotestes do guard. O caso `carries real Python-shaped` foi excluído para não executar o transporte de Solver. A suíte de catálogo não foi repetida, pois não há alteração relevante nessa frente.

Biome lint dos dois arquivos modificados aprovado. TypeScript delimitado a esses arquivos aprovado, sem estado incremental ou geração de cliente. `git diff --check` aprovado. Sem quality/build global, banco, migração, instalação, servidor, cookie/SSR real, commit, push ou deploy.

Artefatos preservados em `outputs/escalas-account-save-regression`: configurações Vitest/TypeScript, guard e autotestes, `verify.cjs`, logs anterior/posterior/lint/tipos/cleanup, hashes antes/depois, patch mínimo e instruções de reprodução. O verificador usa URL sintética e bloqueia Prisma não simulado, sockets e fetch; os autotestes passaram nas duas execuções. Nenhum `.env` foi lido. Temporários de verificação foram marcados Complete após salvar os logs.

| Fonte | SHA-256 |
| --- | --- |
| `service.ts` antes da correção | `16253dd271a36d5fa9d3eef4843f3a5ba1e524551ebbcefa67f6776a026ec4b2` |
| `service.ts` depois da correção | `b989e008b3e27db091e8280079f20b2f9a4f7b00d0357515ee011f0cac67dcd5` |
| `service.test.ts`, igual nas duas execuções | `750f30e4f1736f8c7a87556138568da3b190e6f353bf2597210823f7afeb2717` |

Remover somente as quatro linhas acrescentadas do conteúdo final recompõe o hash inicial, sem escrever ou reverter o arquivo. Isso delimita a correção em relação às demais mudanças locais preservadas.

Ferramentas efetivamente usadas: `ctx_batch_execute` para coleta delimitada, `ctx_execute` para análise útil e hashes; edições por patch nativo e verificações por execução nativa. As skills já lidas nesta sessão foram reutilizadas. Não houve subagentes ou mensagens laterais.

## Liberação

Entrega local concluída; `service.ts`, `service.test.ts` e demais recursos deste lote ficam liberados. A próxima etapa é a revisão independente e a validação integrada autorizada; não houve promoção para produção. Não se declara encerrada a revisão separada de autenticação real de conta ou de cookie/SSR.
