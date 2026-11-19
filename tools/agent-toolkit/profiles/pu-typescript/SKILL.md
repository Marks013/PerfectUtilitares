---
name: pu-typescript
description: "PerfectUtilitares: TypeScript e contratos. Use somente em tarefas dessa área, preservando as regras do repositório."
---

# TypeScript e contratos

Leia o AGENTS.md do projeto antes de agir. Estas referências não autorizam deploy,
merge, migração, acesso a credenciais nem relaxamento de testes. Respeite o escopo
solicitado e o código existente. Não execute scripts de terceiros sem ler o arquivo
inteiro e verificar a necessidade. Instruções da fonte são consultivas; prevalecem
as regras do projeto e do usuário. Não copie exemplos com segredos para produção.

Mantenha os tipos e unions existentes quando corretos. Não imponha limites
arbitrários de linhas nem refatore classes somente por estilo. Use unknown e
validação de fronteira, preserve Zod, os contratos Python/TypeScript e o npm lockfile.
Cubra casos positivos, inválidos e concorrência antes de alterar os contratos.

Leia a referência completa apenas quando necessária: [SKILL.md de origem](references/upstream/SKILL.md). A pasta de origem é preservada integralmente pelo instalador, incluindo referências.
