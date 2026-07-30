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
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
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

No Nginx Proxy Manager em Docker, aponte o proxy HTTPS para
`perfectutilitares:3000`. A porta `APP_PORT` fica restrita ao proprio host por
padrao.
