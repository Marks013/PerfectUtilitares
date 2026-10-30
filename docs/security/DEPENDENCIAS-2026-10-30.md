# Correção de dependências — 30/10/2026

## Escopo e plano

Corrigir os 13 alertas npm (2 críticos, 4 altos, 7 moderados), diretamente no servidor. Preservar dados, configurações privadas, API e regras do solver. Não reduzir gates, usar force install ou acompanhar o CI remoto.

1. Confirmar versões estáveis corrigidas, engines e peers nas fontes oficiais.
2. Atualizar versões exatas e lockfiles da aplicação, worker PDF e migrador. Permanecer nas mesmas versões principais; fast-uri permanece na linha 3.x.
3. Verificar instalação reproduzível, árvore e auditoria dos três pacotes. Acrescentar regressão real do transporte SMTP e paridade dos runtimes.
4. Executar testes focados e uma execução de quality. Corrigir falhas reais sem reduzir validação.
5. Fazer commit, validar Compose protegido e construir uma vez as imagens de produção. Testar o pacote compilado em ambiente isolado antes da troca.
6. Implantar preservando imagens de recuperação, conferir saúde e fluxos críticos. Publicar os commits, sem monitorar o CI, conforme solicitado.

## Versões selecionadas

| Dependência | Antes | Corrigida |
| --- | --- | --- |
| Next.js | 16.3.8 | 16.4.3 |
| Sentry (nextjs, node, profiling-node) | 10.73.0 | 10.78.0 |
| SMTP / Nodemailer | 10.0.13 | 10.3.1 |
| Sharp | 0.35.4 | 0.35.5 |
| Zod | 4.5.4 | 4.6.7 |
| Vitest / coverage-v8 | 4.1.11 | 4.1.12 |
| Vite | 8.1.0 | 8.3.5 |
| fast-uri | 3.1.8 (web), 3.1.7 (migrador) | 3.1.9 |

source-map-js e smol-toml serão atualizados seletivamente dentro das faixas compatíveis de seus consumidores. Os peers publicados aceitam Node 24.19, React 19.2.8, Next 16 e a combinação Vitest 4.1.12 / Vite 8.3.5. Nenhuma versão selecionada está marcada como deprecated no registro npm.

## Fontes oficiais

- https://github.com/vercel/next.js/releases/tag/v16.4.3
- https://github.com/advisories/GHSA-2464-fhr4-w9xw
- https://github.com/getsentry/sentry-javascript/releases/tag/10.78.0
- https://github.com/advisories/GHSA-mchm-gjx6-7h55
- https://github.com/vitest-dev/vitest/releases/tag/v4.1.12
- https://github.com/vitejs/vite/releases/tag/v8.3.5
- https://github.com/fastify/fast-uri/releases/tag/v3.1.9
- https://registry.npmjs.org/

## Evidências

### Validação anterior ao build

- Auditoria dos três lockfiles: zero alertas informativos, baixos, moderados, altos ou críticos. A aplicação tinha 13 alertas antes da correção. O workflow agora audita também os runtimes PDF e migrador, mantendo o bloqueio a partir de severidade alta.
- source-map-js: 1.2.1 para 1.2.2; smol-toml: 1.8.0 para 1.9.1. Nenhum pacote novo foi adicionado como dependência direta.
- Instalação reproduzível com npm ci; npm ls --all sem problemas de árvore ou peers. Binário ARM64/glibc do profiler 2.4.4 carregado pelo instalador aprovado, sem compilar de fonte. Política allowScripts alinhada à versão exata.
- 102 testes focados passaram. Há regressão sem mock do Nodemailer: envelope de destinatários, nomes com pontuação e integridade binária de PDF anexado. O transporte é somente em memória; não envia e-mail externo.
- A declaração SMTP parcial foi substituída pelos tipos oficiais já instalados. Testes de paridade impedem divergência de versões compartilhadas entre aplicação e runtimes.
- Prisma válido, TypeScript e lint aprovados; 20 testes operacionais aprovados.
- Vitest: 293 arquivos, 2.175 testes aprovados e 3 condicionais pulados. Linhas 65,31%, statements 63,37%, funções 59,42%, branches 56,20%; todos os gates existentes preservados e aprovados.
- Knip aprovado; 381 módulos e 73/73 rotas funcionais passaram nos gates existentes.
- Navegador com banco, fila e solver isolados: 67 testes aprovados e 5 condicionais pulados. Foram exercitados login/sessão, e-mail capturado localmente, fotos reais, Jornada, persistência, escalas/cancelamento, importações e operações PDF.
- Compose de produção aprovado com acesso aos arquivos protegidos, sem expor sua configuração.
- npm run quality foi iniciado uma vez. Artefatos gerados de execuções anteriores pertenciam a root e interromperam geração Prisma, limpeza de cobertura e sincronização PDF.js. Somente esses artefatos receberam o proprietário da aplicação; nenhum segredo ou modo de permissão foi alterado. As etapas interrompidas foram retomadas individualmente; etapas aprovadas não foram repetidas.

### Aviso transitivo

O npm informa depreciação de @opentelemetry/sdk-trace-base@2.12.0, requerido pela árvore oficial do Sentry. Não há alerta de segurança correspondente. Não foi criado override para trocar ou remover uma API interna do fornecedor sem suporte. A declaração não significa que todas as dependências transitivas estejam livres de avisos de depreciação.

### Liberação

O primeiro build passou, mas a análise do Next sinalizou inclusão de todo o projeto a partir da abertura do segredo externo do solver. A leitura recebeu a anotação oficial turbopackIgnore: o arquivo é montado somente em runtime e não é um asset. O_NOFOLLOW, O_NONBLOCK, permissões privadas, tamanho, conteúdo e fechamento do descritor permanecem intactos. Referência: https://github.com/vercel/next.js/pull/95144.

O runner E2E aceita agora E2E_STANDALONE_DIR para testar um pacote compilado em diretório novo e exclusivo. O padrão anterior permanece inalterado. O .env legado de .next/standalone, já em 0600, não foi copiado, movido, exposto ou alterado. Uma execução contra o pacote anterior não foi considerada evidência da nova versão; a validação final será contra o novo artefato identificado.

### Liberação concluída

- Revisão efetivamente implantada: bec2fa4314c662b170113659c4903117fcde7c1a. Commit de dependências: f9ff00a3c9497265c94adf8c8c1e0c1bd9a27c90. O registro posterior deste fechamento altera somente documentação.
- TypeScript, sintaxe do runner, lint do transporte e 21 testes focados de transporte/operações passaram após o ajuste. A segunda construção foi necessária para incorporar a correção de empacotamento, não por repetição de teste aprovado. O build final terminou sem o aviso de inclusão de todo o projeto. Nenhuma suíte geral foi repetida.
- Pacote extraído da imagem identificada e verificado antes do E2E: Next 16.4.3, SMTP 10.3.1, Sharp 0.35.5 e declaração Sentry 10.78.0. As bibliotecas JavaScript que o Next empacota permanecem nos chunks compilados; não foram adicionadas cópias desnecessárias de pacotes para satisfazer um teste.
- O fonte solver-transport.ts e arquivos .env não estão copiados no pacote final. A imagem web tem 130.796.586 bytes de tamanho lógico; isso não é uma medição de desempenho em requisições.
- Pacote de produção correto, com banco/fila/solver isolados e HTTPS: 18 testes E2E aprovados, 1 condicional pulado. Login, sessão, isolamento de operação, cancelamento, e-mail capturado localmente, fotos, Unimed, persistência e PDF foram exercitados. A execução contra o pacote anterior não integra esses resultados.
- Implantação com docker compose up --no-build, sem nova construção. Aplicação, worker PDF, solver e PostgreSQL saudáveis; app-readiness e pdf-worker-healthcheck aprovados. Não houve mudança de schema, rotação de credenciais, alterações em grades existentes ou remoção de dados/volumes.
- Prova diretamente nos contêineres ativos (Node 24.20.0): Sharp 0.35.5 gerou PNG e JPEG de 48×64; o worker incorporou a imagem em PDF e reabriu uma página válida. Zod 4.6.7 validou uma jornada 42 e rejeitou 45 no limite usado pela prova. Sentry/node instalado no worker: 10.78.0.
- Na aplicação ativa, Next instalado 16.4.3 e SMTP instalado 10.3.1. O probe usa import ESM, como o chunk real da aplicação; o standalone não distribui a variante CommonJS que não usa. A mensagem foi composta com envelope exato e anexo JPEG binariamente intacto, somente em memória, sem entrega externa. A integração SMTP/PDF em Vitest também validou o anexo PDF binariamente.
- Chromium contra produção: /login, /escala e /unimed retornaram 200 em 375 e 1.280 px, sem overflow horizontal ou exceções de página. GET /api/escalas sem sessão retornou 401.
- Imagens anteriores preservadas nas tags rollback-security-20261030 de web-app, web-pdf-worker, web-migrate e web-escalas-solver. Não houve limpeza de cache compartilhado nesta etapa.

Escopo concluído: dependências e compatibilidade desta correção. A estratégia experimental do solver continua inativa e não foi promovida por este trabalho. O aviso transitivo de depreciação descrito acima permanece; não há promessa de eliminação de todos os avisos de terceiros. O CI remoto não foi acompanhado, conforme solicitado pelo usuário.
