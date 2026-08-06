# PerfectUtilitares — Prisma 7 pós-V5

## Escopo

Esta etapa deve ser aplicada **somente depois da V5**. Ela atualiza a camada de acesso a dados sem alterar modelos, tabelas ou migrações SQL.

- Prisma ORM e Prisma Client: `6.19.3` → `7.9.1`;
- driver adapter PostgreSQL: `@prisma/adapter-pg@7.9.1`;
- driver `pg@8.22.0` e tipos `@types/pg@8.20.0`;
- novo generator `prisma-client`, com saída em `src/generated/prisma`;
- imports atualizados para o client gerado;
- todas as instâncias de `PrismaClient` recebem o adapter PostgreSQL;
- preservação explícita de timeout de conexão de 5 s e timeout ocioso de 300 s;
- limites de pool separados: app 10, worker 5 e migrator 2;
- extração do parâmetro Prisma `schema=` da URL antes de entregá-la ao `pg`;
- ajustes no Docker para transportar o client gerado aos estágios de build e migração;
- teste unitário da configuração do adapter e smoke de conexão `SELECT 1`.

O Prisma 8/Prisma Next não faz parte desta atualização, pois ainda não é a linha estável recomendada para a aplicação.

## Pré-condição

Conclua a V5 e confirme que o repositório está limpo ou contém apenas o diretório `alteracao-prisma7` recém-extraído.

```bash
cd /home/ubuntu/PerfectUtilitares
bash alteracao-v5/validar_v5.sh . --build
git status --short
```

## Aplicação

```bash
cd /home/ubuntu/PerfectUtilitares

git switch -c chore/prisma7-adapter-pg   || git switch chore/prisma7-adapter-pg

python3 alteracao-prisma7/aplicar_prisma7.py . --check
python3 alteracao-prisma7/aplicar_prisma7.py . --apply
bash alteracao-prisma7/atualizar_lock_prisma7.sh .
bash alteracao-prisma7/validar_prisma7.sh . --build
```

O aplicador é idempotente e usa hashes da base V5. Se algum arquivo divergir, ele encerra antes de alterar o projeto.

## Teste real de conexão

Depois do build:

```bash
bash alteracao-prisma7/validar_runtime_prisma7.sh .
```

O resultado esperado inclui:

```text
OK: Prisma 7 conectou ao PostgreSQL e executou SELECT 1.
Smoke de runtime Prisma 7 concluído com sucesso.
```

## Implantação

```bash
cd /home/ubuntu/PerfectUtilitares/web

docker compose up -d --build
docker compose ps
docker compose logs --tail=200 migrate app pdf-worker
```

Não execute `docker compose down -v`.

Como não há mudança de schema, o rollback consiste apenas em voltar o commit/imagem anterior; não é necessária reversão do banco.

## Git

```bash
cd /home/ubuntu/PerfectUtilitares

git status --short
git diff --check
git add web alteracao-prisma7
git commit -m "chore(prisma): atualiza para Prisma 7 com adapter PostgreSQL"
git push -u origin chore/prisma7-adapter-pg
```

## Revisão 5.1.1

Esta revisão parte da V5 já corrigida para `nodemailer@9.0.4` e preserva o
override global `"nodemailer": "$nodemailer"`. A alteração evita reintroduzir
a vulnerabilidade GHSA-p6gq-j5cr-w38f durante a migração para Prisma 7.
