# Revisão independente do pacote de migração de acesso

**Resultado: approved para o pacote local revisado. Não autoriza implantação.**

Tarefa `AUX-ACCESS-MIGRATION-REVIEW r1`; despacho `AUX-ACCESS-MIGRATION-REVIEW:r1:batch282`; gate282/reserva283; 14/11/2026. Revisão somente de leitura do produto, no clone `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

Não foi encontrado defeito concreto que exija alteração do candidato. A aprovação cobre a composição integral, a coerência estática das dependências e a preservação das proteções dos dois SQLs candidatos. Não comprova que a cadeia execute em PostgreSQL, que os triggers/constraints atuem corretamente em um banco real ou que a aplicação esteja pronta para produção. A integração continua suspensa para congelamento, reconciliação com ec1bf2d e testes no ambiente existente reservado pelo responsável.

## Evidência e conclusão técnica

As referências abaixo a `migration.sql` apontam para `web/prisma/migrations/20261114072100_escalas_scoped_access/migration.sql`.

| Área | Evidência estática | Conclusão |
|---|---|---|
| Composição e ordem | `migration.sql:4`, `:10`, `:126`, `:252`; comparação independente dos corpos completos dos candidatos, incluindo checks e trigger | Os corpos de foundation e approved-policy aparecem integralmente e nessa ordem, com 5.210 e 7.296 caracteres após normalizar CRLF. Há um BEGIN/COMMIT externo e limites locais de lock de 5 s e statement de 30 s. Foram removidos somente os envelopes duplicados e comentários de apresentação, sem remoção de guarda executável. |
| Pré-requisitos históricos | `20261026160000_add_escala_workspaces/migration.sql:2`, `:24`, `:38`; `20261029190000_escalas_operational_session/migration.sql:1`; `20261030190000_canonical_escala_branch_identity/migration.sql:7` | A cadeia anterior define a chave composta de User, Revision, a sessão e a função de filial canônica utilizadas. A nova pasta vem depois de `20261113041144_escala_shift_catalog`. |
| Tenant e integridade referencial | `migration.sql:59`, `:80`, `:86`, `:152`, `:161`, `:167`, `:170` | Operador de grant/sessão, aprovação de revisão, aprovador e revisão de origem usam FKs compostas com tenant. As chaves únicas referenciadas existem. A FK do aprovador não prova papel ADMIN ou atividade; essa responsabilidade continua na aplicação. |
| Sessões e dados antigos | `migration.sql:12`, `:114`, `:128`; `schema.prisma:294`, `:1284` | Os campos novos são nullable, sem backfill. Sessão legada com os três campos de identidade operacional nulos é admitida; vínculo parcial ou versão não positiva é rejeitado pelo check explícito. A referência de aprovação antiga continua nula. Não há DML, seed, mudança de papéis ou aprovação implícita neste pacote. |
| Defaults, capacidades e índices | `migration.sql:22`, `:36`, `:47`, `:56`, `:65`, `:71`, `:95`, `:110`, `:158` | Operadores/grants nascem inativos, capacidades vazias, política com default ADMIN_ONLY/version 1. Capabilities exige array não nulo, formato unidimensional quando não vazio, sem elemento nulo e dentro da lista permitida. Índices e unicidades correspondem ao recorte do schema. |
| Aprovação e imutabilidade | `migration.sql:175`, `:180`, `:187`, `:198`, `:202`, `:204`, `:236` | Há validação de versões, filial, período, origem completa, formato de hash e envelope JSON relacionado às colunas. O trigger rejeita DELETE antes de acessar NEW; rejeita alteração do conteúdo e alteração/reversão de revogação já registrada. A primeira revogação preserva conteúdo e está sujeita à data mínima. |

O default ADMIN_ONLY não cria linhas de política nem modifica contas administrativas existentes. `LEGACY` continua aceito no armazenamento para compatibilidade, enquanto o contrato de administração expõe ADMIN_ONLY/SCOPED (`web/src/lib/escalas/access-contracts.ts:25`, `:35`). A documentação de foundation exige negar modo ausente/desconhecido/LEGACY no módulo novo (`docs/escalas-access-foundation.md:16`). Esta revisão não auditou todos os consumidores nem atribui à migração a proteção de uma imagem antiga que ignore a política.

O SQL deliberadamente não recompõe o SHA-256 nem valida todo o modelo de domínio. A responsabilidade está explicitada em `migration.sql:235` e `docs/escalas-approved-policy.md:79`. A equivalência com o schema não substitui a rechecagem transacional de autorização, hash, origem e revogação no serviço.

## Limites da prova offline

**AMR-L01 — Limitação de proveniência, sem defeito demonstrado no SQL.** `outputs/escalas-access-migration-package/prepare.cjs:5` parte do schema atual e reconstrói o anterior revertendo exatamente dois comentários. O hash `44b1c210…` não é uma captura anterior independente. O diff vazio entre esses dois arquivos confirma que aquelas substituições são comentários; não prova que nenhuma edição anterior de datamodel tenha ocorrido. O relatório do executor declara corretamente essa limitação. Não se emite afirmação global sobre o histórico de edição do schema.

**AMR-L02 — Equivalência estrutural parcial, sem runtime demonstrado.** `prepare.cjs:8` remove os quatro modelos e as relações/campos/índices correspondentes para sintetizar o baseline; `check.cjs:6` compara arquivos, não um banco criado pela cadeia antiga. `verify.cjs:6` extrai somente os blocos Prisma dos candidatos e `:7` ordena as instruções normalizadas. Os 24 DDL equivalentes são evidência útil de alinhamento entre o modelo atual e aqueles candidatos, mas não provam a ordem executável, o baseline real das migrações ou os checks/triggers manuais. Esta revisão complementou a prova com a leitura das dependências e a comparação integral dos dois corpos SQL; continua sem replay em PostgreSQL.

**AMR-L03 — Comportamento real ainda pendente; gate de promoção mantido.** `docs/sql/escalas-access-foundation.verify.sql:163` explicita a expectativa de preservar a exclusão completa de Tenant sem órfãos, apesar de FKs de operador com RESTRICT. A execução correspondente (`:173`) ainda não ocorreu. Isso não é classificado aqui como falha reproduzida. A semântica de RESTRICT impede adiar sua checagem, mas o resultado dessa cadeia concreta deve ser observado em PostgreSQL. Aprovações também preservam referências por RESTRICT e trigger; não se pode generalizar o cenário de cascata da foundation para a exclusão de históricos aprovados.

Os 49 arquivos históricos do inventário são **5 arquivos em docs/sql e 44 em web/prisma/migrations**, não 49 migrações SQL. Os hashes preservam a comparação desde aquele inventário; não certificam que não houve alteração anterior a ele. Conferi as quatro fontes, os 17 artefatos e o relatório contra o manifesto, além dos 49 registros históricos: 71 comparações, 69 caminhos distintos devido a duas fontes SQL também presentes no inventário histórico, sem divergências. O próprio manifesto foi conferido separadamente contra o SHA informado no despacho. As leituras iniciais e finais mantiveram os hashes esperados.

## Upgrade, execução e recuperação pendentes

O percurso em `docs/escalas-access-migration-package.md:57` a `:67` é adequado como plano ainda não executado: aplicar a cadeia versionada em alvo existente autorizado; não aplicar também os candidatos avulsos; preparar dados representativos antes do upgrade; comparar sessões, contas, workspace/revisões e ausência de registros criados implicitamente; verificar objetos no catálogo e operações reais; repetir migrate deploy sem novos efeitos.

O guard `escalas_access_test_` permanece nos fixtures/verificadores históricos. O prefixo `perfectutilitares_e2e_` do runner não o satisfaz. Nenhum bypass foi introduzido ou é autorizado por esta revisão. A fixture histórica isolada não cobre todos os dados do upgrade; o complemento e sua execução continuam pendentes.

O plano de recuperação exige backup e restauração ensaiada em alvo autorizado, falha intermediária/timeout para comprovar rollback e inspeção de `_prisma_migrations` antes de resolver falha. Os limites de tempo não provam ausência de bloqueio nem desempenho aceitável. Não há down destrutivo; depois do sucesso, a direção é correção aditiva ou recuperação previamente ensaiada. Uma base que tenha recebido DDL candidato manualmente precisa de reconciliação antes do deploy. O pacote não resolve essa situação silenciosamente.

Consultas primárias confirmam os limites interpretativos: PostgreSQL documenta [constraints e ações referenciais](https://www.postgresql.org/docs/current/ddl-constraints.html) e [NEW/TG_OP/retorno em triggers](https://www.postgresql.org/docs/current/plpgsql-trigger.html); Prisma documenta que [migrate deploy aplica migrações pendentes sem detectar drift, resetar a base ou gerar artefatos](https://docs.prisma.io/docs/cli/v7/migrate/deploy). Essas fontes esclarecem semântica; não constituem execução do pacote nem confirmação da versão do PostgreSQL do futuro ambiente.

## Hashes do candidato e entradas

| Caminho | SHA-256 |
|---|---|
| web/prisma/migrations/20261114072100_escalas_scoped_access/migration.sql | `7acbec90ed81bc368691a3c36df1a124ed23e5afe3aad57e29c81c6c93312fa1` |
| docs/sql/escalas-access-foundation.sql | `3ea81e4403a1f401d9c16cbc8b553bc579f125cdb4ffe36ed751fb96ceccf41e` |
| docs/sql/escalas-approved-policy.sql | `3222ee3badf5c4d88a8997d909be76b29b957817e96d2ee2380bbff081b67235` |
| web/prisma/schema.prisma | `76d6613c63e0b00947ec804814ecd716f8891029e77750af8d1c500e8d01ed8c` |
| docs/escalas-access-migration-package.md | `7eee9974fe3646b1ee3d8bb41aee4527ba0b45635b9161af841bbad88af7136b` |
| outputs/escalas-access-migration-package/manifest.json | `7d47354ebce244ed533f769406e9b8179d6bc15b9daee8577039ca1680206677` |

## Execução da revisão e liberação

Context Mode efetivo: ctx_batch_execute para coleta e ctx_execute para análise/JSON/hashes; consultas indexadas via ctx_search. Edição somente nativa deste relatório e do manifesto da revisão. Consulta web restrita a documentação primária; Caveman Browse não foi necessário. As suites offline aprovadas não foram reexecutadas. Nenhum SQL/DDL, banco, serviço, Prisma generate, E2E, UI, Solver, quality/build, instalação, commit ou deploy foi executado.

Não foram criados temporários nem processos persistentes próprios; não há diretório temporário a concluir. Fontes e artefatos alheios preservados. Recursos desta revisão liberados ao coordenador; a decisão de aguardar o ambiente existente e todos os gates de integração/implantação permanecem em vigor.
