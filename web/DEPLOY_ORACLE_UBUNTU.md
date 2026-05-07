# Deploy em Ubuntu com Docker

## Preparar ambiente

```bash
cd web
npm run setup:env
```

Revise o `.env` gerado antes de subir:

- `AUTH_URL` e `APP_URL`: URL publica do sistema.
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: credenciais sincronizadas pelo seed.
- `RESEND_API_KEY` e `RESEND_FROM_EMAIL`: envio dos convites.
- `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`: Sentry.

## Subir containers

```bash
docker compose up -d --build
docker compose logs -f app
```

O container da aplicacao executa automaticamente:

1. `prisma migrate deploy`
2. `npm run prisma:seed`
3. `next start`

O seed cria/atualiza o admin do `.env`, cria o tenant padrao e mantem as regras iniciais de jornada.

## Checks rapidos

```bash
docker compose ps
docker compose exec app npm run prisma:validate
docker compose exec app npm run typecheck
```

Para producao, aponte o proxy HTTPS do servidor para `app:3000` ou para a porta publicada `3000`.
