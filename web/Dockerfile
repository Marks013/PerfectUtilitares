# syntax=docker/dockerfile:1.7
# PERFECT_PDF_FULL32_V2_2
# PERFECT_PDF_ADAPTIVE_V4_2

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS base
RUN apk add --no-cache libc6-compat openssl vips
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS runtime-base
RUN apk add --no-cache ca-certificates libc6-compat libstdc++ openssl vips
COPY --from=base /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS migrator-deps
COPY ops/migrator/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --omit=dev

FROM base AS pdf-worker-deps
COPY ops/pdf-worker/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --omit=dev

FROM deps AS prisma-generated
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN PRISMA_ALLOW_LOCAL_FALLBACK=true npm run prisma:generate

FROM base AS builder
ARG AUTH_URL=http://localhost:3002
ARG NEXTAUTH_URL=http://localhost:3002
ARG APP_URL=http://localhost:3002
ARG CONTACT_EMAIL=admin@perfectutilitares.com
ARG GOOGLE_SITE_VERIFICATION
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV AUTH_URL=$AUTH_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV APP_URL=$APP_URL
ENV CONTACT_EMAIL=$CONTACT_EMAIL
ENV GOOGLE_SITE_VERIFICATION=$GOOGLE_SITE_VERIFICATION
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
COPY --from=migrator-deps /app/node_modules ./node_modules
COPY ops/migrator/package*.json ./
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY --from=prisma-generated /app/src/generated/prisma ./src/generated/prisma
COPY scripts ./scripts
COPY src/lib/jornada ./src/lib/jornada
COPY src/lib/prisma-adapter.ts ./src/lib/prisma-adapter.ts
COPY src/lib/auth/password.ts ./src/lib/auth/password.ts
COPY src/lib/system/seed-admin.ts ./src/lib/system/seed-admin.ts
COPY src/lib/unimed/defaults.ts ./src/lib/unimed/defaults.ts
USER node
CMD ["sh", "-c", "npm run db:deploy"]

FROM prisma-generated AS pdf-worker-builder
COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build:pdf-worker

FROM runtime-base AS pdf-runtime
ENV NODE_ENV=production
RUN apk add --no-cache \
    font-dejavu \
    font-liberation \
    libreoffice-calc \
    libreoffice-writer \
    ghostscript \
    jbig2enc \
    ocrmypdf \
    poppler-utils \
    postgresql-client \
    qpdf \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-por

FROM pdf-runtime AS pdf-worker
COPY --from=pdf-worker-deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=pdf-worker-builder --chown=1001:1001 /app/dist ./dist
COPY --chown=1001:1001 src/lib/pdf/mono-xobject-resample.py ./mono-xobject-resample.py
COPY ops/container-health/pdf-worker-healthcheck /usr/local/bin/pdf-worker-healthcheck
RUN chmod 0555 /usr/local/bin/pdf-worker-healthcheck
ARG SOURCE_REVISION=untracked
ARG BUILD_DATE=1970-01-01T00:00:00Z
ENV SOURCE_REVISION=${SOURCE_REVISION}
LABEL org.opencontainers.image.title="PerfectUtilitares PDF Worker" \
      org.opencontainers.image.description="Processador isolado de PDFs do PerfectUtilitares" \
      org.opencontainers.image.source="https://github.com/Marks013/PerfectUtilitares" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
USER 1001:1001
HEALTHCHECK --interval=60s --timeout=10s --start-period=45s --retries=3 CMD ["/usr/local/bin/pdf-worker-healthcheck"]
CMD ["node", "dist/pdf-worker.mjs"]

FROM runtime-base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apk add --no-cache postgresql-client
COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/node_modules/@img ./node_modules/@img
COPY --from=builder --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=builder --chown=1001:1001 /app/public ./public
COPY --from=builder --chown=1001:1001 /app/node_modules/pdfkit/js/data ./node_modules/pdfkit/js/data
COPY --from=builder --chown=1001:1001 /app/node_modules/pdfkit/js/data /ROOT/node_modules/pdfkit/js/data
COPY --from=builder --chown=1001:1001 /app/node_modules/pdfjs-dist/cmaps ./node_modules/pdfjs-dist/cmaps
COPY --from=builder --chown=1001:1001 /app/node_modules/pdfjs-dist/standard_fonts ./node_modules/pdfjs-dist/standard_fonts
COPY --from=builder --chown=1001:1001 /app/node_modules/pdfjs-dist/wasm ./node_modules/pdfjs-dist/wasm
COPY ops/container-health/app-readiness /usr/local/bin/app-readiness
RUN chmod 0555 /usr/local/bin/app-readiness
ARG SOURCE_REVISION=untracked
ARG BUILD_DATE=1970-01-01T00:00:00Z
ENV SOURCE_REVISION=${SOURCE_REVISION}
LABEL org.opencontainers.image.title="PerfectUtilitares Web" \
      org.opencontainers.image.description="Aplicacao web do PerfectUtilitares" \
      org.opencontainers.image.source="https://github.com/Marks013/PerfectUtilitares" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 CMD ["/usr/local/bin/app-readiness"]
CMD ["node", "server.js"]
