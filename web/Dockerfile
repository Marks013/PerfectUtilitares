# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS builder
ARG AUTH_URL=http://localhost:3002
ARG NEXTAUTH_URL=http://localhost:3002
ARG APP_URL=http://localhost:3002
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV AUTH_URL=$AUTH_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV APP_URL=$APP_URL
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,id=perfectutilitares-next-cache,target=/app/.next/cache,sharing=locked \
    --mount=type=secret,id=sentry_auth_token,required=false \
    if [ -f /run/secrets/sentry_auth_token ]; then \
      export SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token)"; \
    fi; \
    npm run build

FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src/lib/jornada ./src/lib/jornada
RUN npm run prisma:generate
CMD ["sh", "-c", "npm run db:deploy"]

FROM deps AS pdf-worker-builder
COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run prisma:generate
RUN npm run build:pdf-worker
RUN npm prune --omit=dev --ignore-scripts

FROM base AS pdf-worker
ENV NODE_ENV=production
RUN apk add --no-cache \
    font-dejavu \
    font-liberation \
    libreoffice-calc \
    libreoffice-writer \
    qpdf
COPY --from=pdf-worker-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=pdf-worker-builder --chown=node:node /app/dist ./dist
USER node
CMD ["node", "dist/pdf-worker.mjs"]

FROM base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules/pdfkit/js/data ./node_modules/pdfkit/js/data
COPY --from=builder --chown=node:node /app/node_modules/pdfkit/js/data /ROOT/node_modules/pdfkit/js/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
