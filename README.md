# PerfectUtilitares

Suite web para validação manual de jornadas e edição de fotos 3x4, recriada a partir dos projetos legados para uma operação moderna em navegador.

## Módulos

- Autenticação com administração de usuários, empresas e permissões por módulo.
- Dashboard operacional.
- Jornada com validação manual, regras, histórico e importação do banco de horários por XLSX, CSV ou JSON.
- Fotos 3x4 com edição individual, lote, detecção facial, corte, redimensionamento, borda, ajustes e exportação.

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

## Deploy

Para servidor com Docker e Nginx Proxy Manager, consulte:

- [`web/DEPLOY_NGINX_PROXY_MANAGER.md`](./web/DEPLOY_NGINX_PROXY_MANAGER.md)

Por padrão, o container usa a porta interna `3000` e publica a porta externa `3002`.

## Referências de Migração

Os projetos legados foram usados apenas como referência local durante a recriação. O repositório publica o produto Web e a documentação de auditoria/paridade, sem carregar os fontes e builds antigos.
