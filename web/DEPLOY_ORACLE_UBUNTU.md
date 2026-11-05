# Deploy em Ubuntu com Docker

## Preparar a revisão

A fonte de produção é o checkout Git em `/home/ubuntu/PerfectUtilitares`.
Trabalhe sobre um commit revisado e uma árvore limpa. Não copie uma árvore de
staging sobre esse checkout: a sincronização por `rsync --delete-delay` foi
desativada porque contorna o histórico Git e pode remover arquivos locais.

Execute os comandos em `/home/ubuntu/PerfectUtilitares/web`, com acesso ao
`.env` e aos arquivos protegidos referenciados pelo Compose. Não imprima o
resultado completo de `docker compose config`: ele pode incluir segredos.

```bash
git status --short --branch
docker compose config --quiet
npm run quality
```

## Publicar

`npm run docker:deploy` valida o checkout, constrói as imagens com o commit
identificado e aguarda a saúde dos serviços. Não habilite a limpeza de cache
Docker no deploy rotineiro: o builder pode atender outros projetos.

Antes de substituir o app ou o worker, aguarde a conclusão dos PDFs ativos.
Atualize os dois juntos na mesma revisão. Preserve imagens anteriores para
rollback e valide as migrações aplicáveis antes de recriar serviços.

O serviço `migrate` executa as migrações e o seed inicial. O seed não redefine
administradores existentes. Para rotacionar senha, use a operação explícita
`npm run admin:rotate-password`. O contêiner do app apenas inicia o servidor web.

Após a publicação, confira `docker compose ps`, as revisões do app e do worker
e os fluxos afetados no navegador. No Nginx Proxy Manager, use
`perfectutilitares:3000` como destino HTTPS. Por padrão, a porta `APP_PORT`
fica vinculada ao host local.
