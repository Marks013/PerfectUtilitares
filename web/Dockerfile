# syntax=docker/dockerfile:1.7
# PERFECT_PDF_FULL32_V2_2
# PERFECT_PDF_ADAPTIVE_V4_2

# Keep pinned Alpine releases and signature checks; permit an official HTTPS
# mirror when the default CDN is unreachable from the build network.
ARG ALPINE_APK_MIRROR=dl-cdn.alpinelinux.org
FROM node:24.20.0-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base
ARG ALPINE_APK_MIRROR
RUN case "$ALPINE_APK_MIRROR" in dl-cdn.alpinelinux.org|dl-3.alpinelinux.org) ;; *) exit 64 ;; esac \
    && sed -i "s|https://dl-cdn.alpinelinux.org/alpine/|https://${ALPINE_APK_MIRROR}/alpine/|g" /etc/apk/repositories \
    && apk add --no-cache libc6-compat openssl vips
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS node-runtime-base
ARG ALPINE_APK_MIRROR
RUN case "$ALPINE_APK_MIRROR" in dl-cdn.alpinelinux.org|dl-3.alpinelinux.org) ;; *) exit 64 ;; esac \
    && sed -i "s|https://dl-cdn.alpinelinux.org/alpine/|https://${ALPINE_APK_MIRROR}/alpine/|g" /etc/apk/repositories \
    && apk add --no-cache ca-certificates libc6-compat libstdc++ openssl
COPY --from=base /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM node-runtime-base AS runtime-base
RUN apk add --no-cache vips 'libexpat>=2.10.0-r0'

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
    npm run setup:env && npm run sync:check && npm run sync:pdfjs && npm run build:ferias-worker && npm exec -- next build && npm run postbuild && \
    find /app/.next/standalone -maxdepth 1 -type f \
      \( -name '.env' -o -name '.env.*' \) -delete

FROM node-runtime-base AS migrator
ENV NODE_ENV=production
COPY --from=migrator-deps --chown=1000:1000 /app/node_modules ./node_modules
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
ARG SOURCE_REVISION=untracked
ARG BUILD_DATE=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="PerfectUtilitares Migrator" \
      org.opencontainers.image.description="Migracoes e inicializacao do PerfectUtilitares" \
      org.opencontainers.image.source="https://github.com/Marks013/PerfectUtilitares" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
USER 1000:1000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node --import tsx prisma/seed.ts"]

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
    'giflib>=5.2.2-r2' \
    ghostscript \
    jbig2enc \
    python3 \
    pngquant \
    poppler-utils \
    qpdf \
    unpaper \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-por

FROM pdf-runtime AS pdf-office-deps
USER root
RUN apk add --no-cache py3-pip
COPY ops/pdf-worker/office-requirements.txt ops/pdf-worker/runtime-requirements.txt /tmp/
RUN --mount=type=cache,id=perfectutilitares-office-pip-py314-arm64,target=/root/.cache/pip,sharing=locked \
    python3 -m venv /opt/pdf-runtime \
    && /opt/pdf-runtime/bin/pip install --require-hashes --only-binary=:all: -r /tmp/runtime-requirements.txt \
    && /opt/pdf-runtime/bin/pip check \
    && /opt/pdf-runtime/bin/python3 -c 'from importlib.metadata import version; import ocrmypdf, pikepdf; assert [version(name) for name in ("pillow", "cryptography", "setuptools")] == ["13.0.0", "50.0.2", "84.2.1"]' \
    && /opt/pdf-runtime/bin/ocrmypdf --version \
    && python3 -m venv /opt/pdf-office \
    && /opt/pdf-office/bin/pip install --require-hashes --only-binary=:all: -r /tmp/office-requirements.txt \
    && /opt/pdf-office/bin/pip check \
    && /opt/pdf-office/bin/python3 -c 'from importlib.metadata import version; import pdfplumber, openpyxl, docx; assert [version(name) for name in ("pillow", "cryptography")] == ["13.0.0", "50.0.2"]' \
    && /opt/pdf-runtime/bin/python3 -m pip uninstall --yes pip \
    && /opt/pdf-office/bin/python3 -m pip uninstall --yes pip \
    && /opt/pdf-runtime/bin/python3 -c 'from importlib.util import find_spec; import ocrmypdf, pikepdf; assert find_spec("pip") is None' \
    && /opt/pdf-office/bin/python3 -c 'from importlib.util import find_spec; import pdfplumber, openpyxl, docx; assert find_spec("pip") is None'

FROM pdf-runtime AS pdf-worker
# Keep the runtime zlib fix even when an older base layer is reused.
RUN apk add --no-cache 'zlib>=1.3.2-r1'
ENV PDF_OFFICE_PYTHON=/opt/pdf-office/bin/python3 \
    PDF_OFFICE_SCRIPT=/app/pdf-office/office-export.py \
    PATH=/opt/pdf-runtime/bin:$PATH \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1
COPY --from=pdf-office-deps /opt/pdf-runtime /opt/pdf-runtime
COPY --from=pdf-office-deps /opt/pdf-office /opt/pdf-office
COPY src/lib/pdf/office-export.py src/lib/pdf/office-export-word.py src/lib/pdf/office-export-excel.py /app/pdf-office/
COPY --from=pdf-worker-deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=pdf-worker-builder --chown=1001:1001 /app/dist ./dist
COPY --chown=1001:1001 src/lib/pdf/mono-xobject-resample.py ./mono-xobject-resample.py
COPY --chown=1001:1001 src/lib/pdf/jpeg-xobject-resample.py ./jpeg-xobject-resample.py
COPY ops/container-health/pdf-worker-healthcheck /usr/local/bin/pdf-worker-healthcheck
RUN chmod 0555 /usr/local/bin/pdf-worker-healthcheck \
    && command -v pngquant \
    && command -v unpaper \
    && test "$(command -v python3)" = "/opt/pdf-runtime/bin/python3" \
    && test "$(command -v ocrmypdf)" = "/opt/pdf-runtime/bin/ocrmypdf" \
    && test "$(head -n 1 /opt/pdf-runtime/bin/ocrmypdf)" = "#!/opt/pdf-runtime/bin/python3" \
    && for package in py3-pillow py3-cryptography py3-setuptools; do \
      if apk info --exists "$package"; then \
        echo "Unexpected system Python package: $package" >&2; exit 1; \
      fi; \
    done
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
RUN apk add --no-cache 'zlib>=1.3.2-r1'
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/dist/ferias-workbook-worker.cjs ./dist/ferias-workbook-worker.cjs
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
