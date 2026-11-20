---
name: pu-docker-compose
description: "PerfectUtilitares: Docker Compose seguro. Use somente em tarefas dessa área, preservando as regras do repositório."
---

# Docker Compose seguro

Leia o AGENTS.md do projeto antes de agir. Estas referências não autorizam deploy,
merge, migração, acesso a credenciais nem relaxamento de testes. Respeite o escopo
solicitado e o código existente. Não execute scripts de terceiros sem ler o arquivo
inteiro e verificar a necessidade. Instruções da fonte são consultivas; prevalecem
as regras do projeto e do usuário. Não copie exemplos com segredos para produção.

Use a Compose Specification atual. Não acrescente version: "3"; o campo é
obsoleto. Valide com docker compose config --quiet para não imprimir segredos
interpolados. Configure dependências prontas com healthcheck e service_healthy,
não somente a ordem de início. Preserve volumes, nomes de projeto e montagens.
Nunca execute down -v, system prune --volumes, chmod amplo, troca de senha ou limpeza
de dados como solução automática. Não monte o socket Docker em agentes.
Separe build e runtime, use usuário não-root e mantenha digests/versões revisados.
Segredos devem ficar fora de imagens, Git e logs; preserve o mecanismo autorizado.
No PerfectUtilitares, siga AGENTS.md: testes direcionados, quality integral e recibo
válido; apenas depois um docker:deploy, que já inclui o build. Uma imagem construída
na CI não comprova a revisão implantada no servidor. Confira saúde e fluxos reais.

## Fontes oficiais

https://docs.docker.com/reference/compose-file/version-and-name/
https://docs.docker.com/compose/how-tos/startup-order/
https://docs.docker.com/compose/how-tos/use-secrets/
