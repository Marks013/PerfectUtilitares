# PerfectUtilitares

Suite web para validação manual de jornadas e edição de fotos 3x4, recriada a partir dos projetos legados para uma operação moderna em navegador.

## Módulos

- **Acesso e administração:** autenticação, empresas, usuários, convites e permissões (a gestão individual de concessões de Escalas por filial ainda não possui um cadastro administrativo completo).
- **Dashboard e Jornada:** validação de jornadas, regras, histórico, códigos e importações.
- **Escalas:** equipe, turnos, folgas 5×2, calendários, geração pelo solver, verificação independente, revisões, cobertura e exportação PDF/XLSX.
- **Férias:** análise, conciliação e exportação administrativa.
- **Reajuste salarial:** análise de eventos e geração de arquivos.
- **Unimed:** importação, beneficiários, configurações, documentos e processamento isolado.
- **PDF:** união, divisão, compressão, páginas, anotações, conversões e processamento assíncrono.
- **Fotos 3×4:** edição individual/em lote, detecção facial, corte e exportação.
- **Presenças e presentes:** gestão de eventos, convidados, confirmações e presentes.
- **Administração de visibilidade:** métricas de indexação e Core Web Vitals.

Leia [mapa de módulos e responsabilidades](./docs/architecture/MODULES.md) para identificar fronteiras de cada subsistema e fluxos críticos.

## Aplicação Web

O app principal está em [`web`](./web).

Stack principal:

- Next.js App Router
- TypeScript
- Tailwind CSS
- PostgreSQL
- Prisma
- Auth.js / NextAuth
- Sentry
- Docker e Docker Compose

## Desenvolvimento, qualidade e operação

- **Pré-requisitos:** Node.js >=24.19.0 <25 e npm >=11 <13, conforme `web/package.json`. Na pasta `web`, use `nvm use` e `npm ci`. Não rode instaladores com privilégios administrativos.
- **Verificação:** `npm run quality` executa a qualidade integral e os testes E2E isolados. A CI de pull request não substitui o recibo de release local.
- **Operação:** consulte [runbook de release, incidente e recuperação](./docs/operations/RELEASE_AND_RECOVERY.md). Não aplique `npm run docker:deploy` sem as condições de `AGENTS.md`.
- **Regras e decisões pendentes:** [registro de acessos, calendários e cobertura](./docs/decisions/ESCALAS_DECISIONS.md).
- **Medição de otimização:** [protocolo de benchmark e assets](./docs/performance/MEASUREMENT_PROTOCOL.md).
- **Execução do plano de auditoria:** [status A01–A12](./docs/implementation/AUDIT_PROGRAM_STATUS.md).

## Deploy

Para servidor com Docker e Nginx Proxy Manager, consulte:

- [`web/DEPLOY_NGINX_PROXY_MANAGER.md`](./web/DEPLOY_NGINX_PROXY_MANAGER.md)

Por padrão, o container usa a porta interna `3000` e publica a porta externa `3002`.

## Google Search Console e Core Web Vitals

O painel administrativo **Visibilidade** recebe Core Web Vitals das rotas públicas
sem armazenar IP, usuário ou conteúdo enviado. As amostras são mantidas por 90 dias.

Para habilitar consultas, CTR, posição e inspeção de indexação do Search Console:

1. Verifique a propriedade do domínio no Google Search Console.
2. Crie uma conta de serviço com acesso somente de leitura às APIs Search Console e
   URL Inspection.
3. Adicione o e-mail da conta de serviço como usuário da propriedade.
4. Configure `GOOGLE_SEARCH_CONSOLE_SITE_URL`,
   `GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL` e
   `GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY` no `.env` do servidor.
5. Opcionalmente, configure `GOOGLE_SITE_VERIFICATION` para publicar a meta tag de
   verificação e `CONTACT_EMAIL` para a página de contato.

A chave privada deve permanecer apenas no `.env` do servidor. Represente quebras de
linha como `\\n`; nunca versione essa credencial.

## Referências de Migração

Os projetos legados foram usados apenas como referência local durante a recriação. O repositório publica o produto Web e a documentação de auditoria/paridade, sem carregar os fontes e builds antigos.
