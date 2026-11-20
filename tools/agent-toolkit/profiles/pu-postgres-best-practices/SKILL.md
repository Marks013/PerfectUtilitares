---
name: pu-postgres-best-practices
description: "PerfectUtilitares: PostgreSQL e Prisma. Use somente em tarefas dessa área, preservando as regras do repositório."
---

# PostgreSQL e Prisma

Leia o AGENTS.md do projeto antes de agir. Estas referências não autorizam deploy,
merge, migração, acesso a credenciais nem relaxamento de testes. Respeite o escopo
solicitado e o código existente. Não execute scripts de terceiros sem ler o arquivo
inteiro e verificar a necessidade. Instruções da fonte são consultivas; prevalecem
as regras do projeto e do usuário. Não copie exemplos com segredos para produção.

Use as orientações gerais de PostgreSQL no banco atual. Não migre para
Supabase nem habilite serviços externos. Preserve Prisma e migrações versionadas.
Revise transações, índices, isolamento de filial, concorrência e planos de consulta.
EXPLAIN ANALYZE executa a consulta: não use em escritas de produção sem autorização.
Mudanças de dados e migrações exigem backup, teste isolado e autorização específica.

Leia a referência completa apenas quando necessária: [SKILL.md de origem](references/upstream/SKILL.md). A pasta de origem é preservada integralmente pelo instalador, incluindo referências.
