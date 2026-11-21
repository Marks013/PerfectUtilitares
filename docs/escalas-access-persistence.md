# Persistência candidata para os acessos de Escalas

13/11/2026. Base `c10602c246f3ec7a5f4bf64ae805cddf3cb960ce`, branch isolada `codex/escalas-permissoes-isoladas`. A avaliação independente liberou este corte offline porque as reservas atuais do Central não incluem Prisma. A integração de sessões, serviços, rotas e relatórios continua aguardando a base integrada.

## Estado da entrega

O arquivo `web/prisma/schema.prisma` contém três modelos candidatos e três campos opcionais na sessão existente. O SQL correspondente está em `docs/sql/escalas-access-foundation.sql`, **fora da cadeia automática `web/prisma/migrations`**. Não executar CI, migrator, `db:deploy`, `build:deploy`, `migrate dev/deploy`, `db push` ou E2E isolado para aplicar essa mudança nesta etapa.

O schema candidato está à frente do histórico de migrações. Não liberar uma imagem ou cliente gerado desse estado como se schema e banco já estivessem alinhados. Nenhum banco foi conectado ou alterado; não foram criados operadores, permissões ou modos de acesso, nem alterado o seed. O cliente Prisma foi gerado somente no clone, no diretório ignorado pelo Git.

## Modelos e invariantes

| Modelo | Dados e restrições |
|---|---|
| `EscalaOperator` | Empresa, chave normalizada de nome, nome exibido, atividade, versão e datas. Inativo por padrão, versão inicial 1. Unicidade de nome por empresa; chave composta empresa/ID para referências. Não possui papel ADMIN nem conta fictícia em User. |
| `EscalaOperatorBranchGrant` | Empresa, operador, filial canônica, atividade e capacidades. Inativo por padrão, lista vazia. Vínculo único por empresa/operador/filial, FK composta para impedir operador de outra empresa. |
| `EscalaModuleAccessPolicy` | Um registro por empresa, modo e versão. Default ADMIN_ONLY, versão inicial 1. Nenhum registro é criado automaticamente. |
| `EscalaModuleSession` | Preserva campos, índices e vínculo de empresa existentes. Acrescenta operador, versão de permissões e versão da política, todos nullable e sem preenchimento retroativo. Sessão antiga permanece sem identidade operacional atribuída. |

O SQL acrescenta checks que o datamodel não expressa: versões positivas, nomes não vazios, filial canônica/não vazia, capacidades não nulas e apenas a lista operacional inicial, modo válido e coerência do vínculo da sessão. Capacidades administrativas, desconhecidas, elementos nulos e arrays com mais de uma dimensão são rejeitados. Alterar o catálogo delegável exige revisar também esse check, não somente uma constante TypeScript.

O vínculo da sessão aceita exatamente dois estados: três campos nulos, ou operador preenchido e duas versões não nulas/positivas. A expressão usa `IS NOT NULL` explicitamente porque uma condição CHECK que resulta em NULL não é uma negação no PostgreSQL. A restrição de capacidades distingue dimensionalidade antes de procurar elementos nulos. Referências: [constraints do PostgreSQL](https://www.postgresql.org/docs/current/ddl-constraints.html) e [funções de arrays](https://www.postgresql.org/docs/current/functions-array.html).

Versões da sessão não são FKs para as versões atuais: uma mudança administrativa precisa invalidar o acesso antigo sem impedir o incremento ou apagar a sessão histórica. A resolução de sessão compara essas versões posteriormente.

Operador com vínculos ou sessões não pode ser removido diretamente; o caminho administrativo previsto é desativar, incrementar versão e revogar. A expectativa de compatibilidade escolhida para exclusão completa de Tenant é preservar a cascata existente sem órfãos, enquanto a exclusão direta de operador referenciado deve falhar. O efeito de RESTRICT nessa cascata ainda não foi executado em PostgreSQL: o teste preparado exige essa expectativa e bloqueia promoção se ela não for atendida. Nesse caso, rever as FKs com evidência, sem afrouxar a preservação de referências apenas para fazer o teste passar. Não introduzir remoção de empresa/operador no painel de acesso desta etapa.

O schema não possui cadastro mestre de filiais Escalas. A FK composta protege empresa/operador, mas não prova existência da filial. O serviço futuro deve validar a filial na fonte canônica autorizada; não usar `UnimedBranch` nem um workspace de mês específico como identidade mestre improvisada.

## Fluxo de cadastro e alteração ainda necessário

O serviço administrativo deverá usar `normalizeEscalaOperatorUsername` antes de gravar a chave. A unicidade no banco protege a chave fornecida, não substitui a normalização Unicode/case/espaços da aplicação. Validar também nome exibido, filial e capacidades; manter erros de duplicidade estruturados, sem revelar outros tenants.

Criação e concessões precisam ser explícitas. Mudanças de nome, atividade, filial ou capacidade devem atualizar a versão e revogar sessões na mesma transação, com auditoria por IDs e sem payload pessoal integral. O controle de modo exige conta administrativa atual. A validação das quatro entradas administrativas foi preparada separadamente em [escalas-operator-administration.md](escalas-operator-administration.md); as operações transacionais ainda não foram implementadas ou ativadas.

`ADMIN_ONLY` em uma tabela não protege uma versão antiga que ignora essa tabela. O piso de recuperação só existe depois que a imagem de compatibilidade efetivamente bloquear todos os não administradores e houver prova das rotas, contas legadas e cookies antigos.

## Prova de migração preparada, ainda não executada

Arquivos preparados em `docs/sql/`:

1. `escalas-access-foundation.fixture-before.sql`: em PostgreSQL descartável cujo nome comece exatamente com `escalas_access_test_`, após as migrações existentes, cria duas empresas sintéticas e uma sessão legada **antes** do SQL candidato.
2. `escalas-access-foundation.sql`: aplica somente DDL aditivo e checks, em transação com limites de espera/execução. Nenhum INSERT, UPDATE, DELETE, DROP, TRUNCATE ou backfill de dados.
3. `escalas-access-foundation.verify.sql`: confere preservação exata da sessão anterior, ausência de cadastros/ativação automática, defaults, unicidade por tenant, FKs cruzadas, aliases de filial, capacidades proibidas/nulas/multidimensionais, vínculo parcial de sessão, versões e retenção histórica. Os dados da verificação são revertidos por ROLLBACK; a fixture anterior e o DDL ficam apenas no banco descartável.

Os scripts de fixture/verificação habilitam `ON_ERROR_STOP` e recusam outro prefixo de banco. Não usar credenciais de aplicação/produção. O prefixo é uma barreira adicional, não substitui comprovar que o banco é descartável e pertence ao teste. A suíte precisa ser executada com PostgreSQL da versão alvo e evidência de código de saída; uma leitura estática não a aprova.

Antes de promover: incorporar o commit consolidado do Central, recalcular diff/drift, executar a sequência acima, conferir schema e constraints efetivas, provar o comportamento de exclusão/cascata e compatibilidade das consultas antigas, e revisar índices/tempo de lock conforme o volume real. Depois registrar uma migração com a ordem correta e os checks manuais preservados. Não acrescentar agora o candidato ao histórico automático.

Recuperação futura deve preservar as tabelas aditivas e usar a imagem de compatibilidade validada; não fornecer um down script destrutivo nem restaurar o banco inteiro para remover UI. Ainda não existe autorização de ativação, commit/push ou implantação por esta entrega.

## Verificações efetivamente realizadas

- Prisma 7.10.0: schema original e schema candidato validados.
- Cliente gerado localmente com o lockfile existente.
- Diff schema→schema sem datasource ou shadow database: bloco gerado coincide exatamente com o bloco delimitado do SQL candidato.
- TypeScript da aplicação inteira: `tsc --noEmit --incremental false`, aprovado após a geração.
- Diff de schema: 53 linhas adicionadas, sem exclusão de campos/modelos existentes. Histórico automático de migrações preservado.

Revisão independente estática aprovou o candidato sem defeito bloqueante e confirmou a correspondência das nove capacidades. Indicou acrescentar testes separados de operador com somente grant, somente sessão e exclusão completa de Tenant. Esses cenários foram adicionados pelo pai ao script preparado; não foram executados nem receberam nova revisão independente.

Os comandos `psql` e `docker` não foram encontrados no ambiente local disponível; nenhum teste SQL foi executado. Não foram instaladas dependências adicionais nem utilizado um banco compartilhado. Os 68 testes das funções anteriores continuam sendo evidência dessas funções, não evidência da migração. Não houve quality, build, E2E, acesso ao servidor ou alteração de dados nesta etapa.

Atualização em 13/11: a consulta delimitada aos caminhos usuais de instalação Windows e ao Ubuntu local existente também não encontrou PostgreSQL/Docker utilizáveis. O usuário escolheu **aguardar um ambiente de testes existente**. Não instalar ou preparar um novo PostgreSQL para esta frente. A execução permanece pendente até identificar um ambiente existente, comprovar o isolamento e liberar seu uso com o responsável; nenhuma consulta desta avaliação utilizou banco ou credencial de produção.
