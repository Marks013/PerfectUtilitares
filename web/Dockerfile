# syntax=docker/dockerfile:1.7

FROM node:24.19.0-alpine AS base
RUN apk add --no-cache libc6-compat openssl vips
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

FROM base AS deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS prisma-generated
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN PRISMA_ALLOW_LOCAL_FALLBACK=true npm run prisma:generate

FROM base AS builder
ARG AUTH_URL=http://localhost:3002
ARG NEXTAUTH_URL=http://localhost:3002
ARG APP_URL=http://localhost:3002
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV AUTH_URL=$AUTH_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV APP_URL=$APP_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
COPY --from=prisma-generated /app/node_modules ./node_modules
COPY . .
COPY --from=prisma-generated /app/src/generated/prisma ./src/generated/prisma
RUN --mount=type=cache,id=perfectutilitares-next-cache,target=/app/.next/cache,sharing=locked \
    --mount=type=secret,id=sentry_auth_token,required=false \
    if [ -f /run/secrets/sentry_auth_token ]; then \
      export SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token)"; \
    fi; \
    npm run setup:env && npm run sync:check && npm run sync:pdfjs && npm exec -- next build && npm run postbuild && \
    find /app/.next/standalone -maxdepth 1 -type f \
      \( -name '.env' -o -name '.env.*' \) -delete

FROM base AS migrator
ENV NODE_ENV=production
COPY --from=prisma-generated /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY --from=prisma-generated /app/src/generated/prisma ./src/generated/prisma
COPY scripts ./scripts
COPY src/lib/jornada ./src/lib/jornada
COPY src/lib/prisma-adapter.ts ./src/lib/prisma-adapter.ts
COPY src/lib/system/seed-admin.ts ./src/lib/system/seed-admin.ts
COPY src/lib/unimed/defaults.ts ./src/lib/unimed/defaults.ts
USER node
CMD ["sh", "-c", "npm run db:deploy"]

FROM prisma-generated AS pdf-worker-builder
COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build:pdf-worker
RUN npm prune --omit=dev --ignore-scripts

FROM base AS pdf-worker
ARG SOURCE_REVISION=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
ENV NODE_ENV=production
RUN apk add --no-cache \
    font-dejavu \
    font-liberation \
    libreoffice-calc \
    libreoffice-writer \
    poppler-utils \
    postgresql-client \
    qpdf
COPY --from=pdf-worker-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=pdf-worker-builder --chown=node:node /app/dist ./dist
COPY ops/container-health/pdf-worker-healthcheck /usr/local/bin/pdf-worker-healthcheck
RUN chmod 0555 /usr/local/bin/pdf-worker-healthcheck
USER node
HEALTHCHECK --interval=60s --timeout=10s --start-period=45s --retries=3 CMD ["/usr/local/bin/pdf-worker-healthcheck"]
CMD ["node", "dist/pdf-worker.mjs"]

FROM base AS runner
ARG SOURCE_REVISION=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apk add --no-cache postgresql-client
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/node_modules/@img ./node_modules/@img
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules/pdfkit/js/data ./node_modules/pdfkit/js/data
COPY --from=builder --chown=node:node /app/node_modules/pdfkit/js/data /ROOT/node_modules/pdfkit/js/data
COPY --from=builder --chown=node:node /app/node_modules/pdfjs-dist/cmaps ./node_modules/pdfjs-dist/cmaps
COPY --from=builder --chown=node:node /app/node_modules/pdfjs-dist/standard_fonts ./node_modules/pdfjs-dist/standard_fonts
COPY --from=builder --chown=node:node /app/node_modules/pdfjs-dist/wasm ./node_modules/pdfjs-dist/wasm
COPY ops/container-health/app-readiness /usr/local/bin/app-readiness
RUN chmod 0555 /usr/local/bin/app-readiness
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 CMD ["/usr/local/bin/app-readiness"]
CMD ["node", "server.js"]
