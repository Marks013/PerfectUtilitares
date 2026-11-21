# Pacote versionado de acesso e aprovação de Escalas

`AUX-ACCESS-MIGRATION-PACKAGE r1` · despacho `AUX-ACCESS-MIGRATION-PACKAGE:r1:batch274` · gate274/reserva275 · 14/11/2026. Checkout `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

**Resultado: pacote de fontes composto e conferido offline, pronto para revisão independente. Não aplicado a banco e não liberado para integração/implantação.** Continua vigente a escolha de aguardar PostgreSQL de testes existente. A base futura ainda precisa ser reconciliada com Central/ec1bf2d; este trabalho não fez essa integração.

## Alterações e proveniência

Nova migração: `web/prisma/migrations/20261114072100_escalas_scoped_access/migration.sql`, posterior a `20261113041144_escala_shift_catalog`. Nenhuma migração antiga foi editada, movida ou renumerada. Os cinco arquivos históricos em docs/sql permanecem intactos, inclusive instruções e guardas dos verificadores.

| Fonte/resultado | SHA-256 |
| --- | --- |
| Candidato de acesso `docs/sql/escalas-access-foundation.sql` | `3ea81e4403a1f401d9c16cbc8b553bc579f125cdb4ffe36ed751fb96ceccf41e` |
| Candidato de aprovação `docs/sql/escalas-approved-policy.sql` | `3222ee3badf5c4d88a8997d909be76b29b957817e96d2ee2380bbff081b67235` |
| Migração composta | `7acbec90ed81bc368691a3c36df1a124ed23e5afe3aad57e29c81c6c93312fa1` |
| Schema antes dos comentários, reconstruído | `44b1c2101d203ff393ba32ed7e8032a7c724ed674b1eddd9015de5ab843ccbfc` |
| Schema depois dos comentários | `76d6613c63e0b00947ec804814ecd716f8891029e77750af8d1c500e8d01ed8c` |

O hash anterior do schema foi reconstruído revertendo exatamente as duas substituições de comentário; não é apresentado como uma captura de bytes feita antes da edição. O diff Prisma entre essa reconstrução e o arquivo atual é vazio. Models, campos, enums e atributos não foram alterados nesta tarefa. As alterações estruturais já presentes no Git diff pertencem ao candidato anterior e foram preservadas.

`schema.prisma:304,1231` agora aponta a nova migração no lugar dos comentários de SQL retido fora da cadeia. Os documentos/SQLs candidatos continuam históricos, sem reescrita. O diagnóstico anterior de cadeia incompleta é atendido **no pacote de fontes atual**; isso não comprova que algum banco foi atualizado.

## Composição, ordem e atomicidade

`outputs/escalas-access-migration-package/compose.cjs` extrai os corpos dos dois candidatos desde seus marcadores de schema diff, mantém também os checks/triggers manuais e retira apenas seus envelopes externos de transação. A migração usa um único BEGIN/COMMIT, com lock_timeout de 5 segundos e statement_timeout de 30 segundos por instrução (`migration.sql:4–6,252`). Não concatena dois commits independentes. Os corpos preservados coincidem exatamente com os candidatos normalizando CRLF; há conferência reproduzível por compose.cjs --verify.

Sequência:

1. Acrescentar os três campos nullable à sessão existente; criar EscalaOperator, EscalaOperatorBranchGrant e EscalaModuleAccessPolicy; criar chaves/índices antes das FKs compostas (`:12–86`).
2. Aplicar checks de versão/nomes, filial canônica, capacidades, modo e coerência completa do vínculo da sessão (`:89–121`).
3. Acrescentar approvedPolicyVersionId nullable à revisão; criar EscalaBranchPolicyVersion e suas chaves; relacionar revisão, tenant, aprovador e origem por tenant (`:128–170`). A relação circular revisão↔origem aprovada é criada somente depois de ambas as tabelas e das chaves necessárias existirem.
4. Acrescentar checks de versões, identidade, período, origem, hash, revogação e envelope do snapshot; criar função e trigger de imutabilidade antes do único commit (`:173–252`).

Pré-requisitos encontrados na cadeia anterior: User(tenantId,id), EscalaWorkspace/EscalaRevision e unicidade tenant/workspace/revision em `20261026160000_add_escala_workspaces`; sessão legada em `20261029190000_escalas_operational_session`; função escala_canonical_branch_code em `20261030190000_canonical_escala_branch_identity`. A migração nova não recria esses objetos nem depende de SQL externo para defini-los.

Não há INSERT, UPDATE, DELETE, DROP, TRUNCATE, seed ou backfill no corpo executável do novo pacote. O trigger contém a negação de DELETE, não uma exclusão de dados. Operadores e concessões nascem inativos; capacidades vazias; política tem default ADMIN_ONLY e nenhuma linha é criada automaticamente. Nenhum nome recebe ADMIN, nenhum User existente é modificado e nenhuma aprovação é inventada.

Campos novos de sessão e referência aprovada são nullable e sem backfill, preservando linhas legadas no estado não vinculado. Checks de capacidades mantêm NOT NULL, rejeição de nulos/dimensões inválidas e whitelist operacional; não passam a delegar importação, TXT, gestão administrativa ou publicação. A FK do aprovador demonstra tenant/existência, não papel ADMIN; normalização de nome, autorização atual e recomposição do hash continuam responsabilidades da aplicação.

Os checks e o trigger de aprovação foram conservados integralmente: conteúdo/histórico não podem ser alterados/apagados; revogação registrada não pode ser revertida ou trocada. O schema Prisma não expressa essas proteções adicionais. A expectativa de cascata na exclusão completa de Tenant com FKs RESTRICT de operador permanece uma hipótese dos verificadores históricos, ainda não executada; qualquer incompatibilidade deve bloquear a promoção e ser resolvida com evidência, sem enfraquecer o isolamento multi-tenant nesta etapa.

## Verificações offline executadas

- Prisma instalado: validate do schema atual e do baseline reconstruído sem os quatro modelos/campos desta fatia, ambos exit 0.
- migrate diff **schema→schema**, sem flags de datasource, diretório de migrations ou shadow database: exit 0. As **24 instruções DDL** dos dois blocos Prisma candidatos equivalem ao DDL gerado, comparadas como multiconjunto após remover comentários e normalizar espaços. A ordem final de criação/FKs foi examinada separadamente.
- Diff antes/depois dos dois comentários: migração vazia. A composição mantém um único par de comandos de transação e os dois corpos históricos completos. As 49 fontes históricas inventariadas mantiveram seus hashes. Guardas escalas_access_test_ e rollback dos verificadores não foram removidos.
- Verificação nativa de composição/DDL/defaults/preservação aprovada em verification.json. `git diff --check` aprovado no recorte.

O baseline foi derivado do schema atual removendo somente modelos, campos/relações e índices da fatia de acesso/aprovação; a lista de remoções está em provenance.json. Isso verifica o delta candidato, **não representa replay de toda a cadeia antiga nem introspecção de um banco**. A comparação de DDL não executa, interpreta em PostgreSQL ou certifica o comportamento dos checks/triggers.

Configuração Prisma sintética no temporário próprio, sem import de dotenv, datasource fictício de loopback na porta 1 e cwd nesse temporário. O CLI recebeu config explícita; não foi aberto/copiado .env. Um preload bloqueou sockets/fetch do processo Node. Os comandos foram limitados a validate e diff entre arquivos; não houve generate, db push, migrate dev/deploy, SQL, instalação ou alteração de node_modules. O help do CLI local foi consultado para confirmar os argumentos da versão instalada.

Evidências em `outputs/escalas-access-migration-package/`: provenance.json, verification.json, diff.sql, comments.sql, logs/JSON dos quatro checks e scripts prepare.cjs/check.cjs/compose.cjs/verify.cjs. Prepare recria somente schemas/config sintéticos no temporário próprio; check aceita apenas os quatro modos offline documentados, sem descoberta/conexão automática a host. O manifesto final preserva os hashes das fontes e evidências.

## Percurso futuro — somente após reserva/autorização de PostgreSQL

**Instalação limpa:** em banco de testes existente e reservado, conferir identidade não produtiva e histórico de migrações; aplicar a cadeia versionada completa até a nova migração. Conferir objetos, defaults, FKs, índices e trigger no catálogo real, e executar operações reais da aplicação. Não usar db push para mascarar problemas da cadeia. Repetir migrate deploy sem novas migrações deve não criar efeitos adicionais; o SQL isoladamente não é idempotente, pois o controle de aplicação é do migrator/checksum.

**Upgrade com dados:** preparar o mesmo alvo na cadeia anterior, parando em 20261113041144, e executar o fixture histórico `docs/sql/escalas-access-foundation.fixture-before.sql` antes do pacote novo. Ele exige prefixo escalas_access_test_ e grava duas empresas sintéticas/sessão legada. Complementar o cenário anterior com usuários, concessões legadas, workspace e revisões sintéticas representativas e inventário de conteúdo/contagens/hashes; o fixture existente sozinho não cobre todos esses dados. Aplicar a nova migração versionada, não os candidatos históricos separadamente. Exigir sessão original idêntica, campos novos nulos, papéis/contas intocados, nenhum operador/grant/política/approval criado implicitamente, revisões/input/status preservados e nada órfão. A fixture complementar e essa execução ainda não foram produzidas/testadas nesta entrega.

**Reutilizar os verificadores sem bypass:** executar escalas-access-foundation.verify.sql após o fixture/upgrade; ele testa defaults fechados, unicidade, whitelist, nulos, versões, vínculo completo, FKs entre tenants e exclusões esperadas, encerrando com ROLLBACK. Depois executar escalas-approved-policy.verify.sql com ON_ERROR_STOP, mantendo seu guard e ROLLBACK: testa envelope, período/origem, hash de formato, unicidade, FKs, imutabilidade e revogação. Seu snapshot/hash são fixtures de armazenamento, não uma aprovação válida de aplicação. Preparar aprovação verdadeira pela API continua necessário.

Os nomes perfectutilitares_e2e_... do runner nativo não atendem ao prefixo obrigatório desses verificadores. Usar percurso de banco de testes próprio autorizado compatível com escalas_access_test_; não renomear a guarda, falsificar identidade do banco ou presumir que autorizar o runner libera outro destino. O pacote não contém procedimento que escolha host, leia credenciais ou conecte automaticamente.

**Falha/recuperação:** obter backup lógico de teste antes do upgrade e provar restauração em alvo separado autorizado, conferindo registros antigos e aplicação. Provocar falha intermediária/timeout em cópia de teste para verificar rollback do único envelope e estado de _prisma_migrations; resolver registro de falha somente depois de comprovar o estado real, sem reset/drops de dados. Medir bloqueios/tempo de índices na sessão com volume representativo. Não há prova desses efeitos offline.

Após aplicação bem-sucedida, não fornecer down destrutivo que apague operadores, sessões ou histórico aprovado. Preferir correção aditiva e recuperação ensaiada. Voltar uma imagem antiga exige comprovar que ela ainda impede acesso não administrativo; existir ADMIN_ONLY no banco não protege código antigo que ignore a política. Base que já tenha recebido DDL candidato manualmente exige inventário e reconciliação de histórico antes de migrate deploy; esta migração não tenta adivinhar ou eliminar objetos existentes.

## Limites e liberação

Nenhum banco, SQL, host, container, serviço, instalação, Solver, quality/build, commit, push ou deploy foi executado. A UI ativa, backend e contratos não foram modificados nem compilados. Não foi gerado cliente Prisma. A evidência comprova composição/equivalência offline; PostgreSQL real, instalação limpa, upgrade, recuperação, concorrência e autorização ponta a ponta continuam pendentes.

Context Mode efetivo: ctx_execute para análise/contagens/equivalência e ctx_batch_execute para ordem de dependências e guardas. Sem fallback nem escrita por Context Mode; patch nativo compôs a migração e alterou os dois comentários, e scripts nativos gravaram apenas artefatos/configuração temporária autorizados. Temporário próprio concluído ao fim, sem processo pendente. Recursos da reserva275 liberados para revisão independente; integração/implantação continuam suspensas.
