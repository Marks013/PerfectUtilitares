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

Build e validação do pacote compilado ainda pendentes neste checkpoint. Não há mudança de regras do solver nem ativação da estratégia experimental. O CI remoto será conferido pelo usuário, conforme solicitado.
