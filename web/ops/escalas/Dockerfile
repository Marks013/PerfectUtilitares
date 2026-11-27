# Build from web/: docker build -f ops/escalas/Dockerfile --target runtime .
# Exact official Rust multi-platform manifest; dependencies keep Cargo.lock.
FROM rust:1.100.0-alpine@sha256:8d0e82abfdf9a38071e07cabc5afba4ddbe077631a80e4e742a760c38beadc33 AS native
RUN apk add --no-cache git python3 musl-dev gcc binutils
WORKDIR /src
COPY experiments/escalas-solverforge /src/experiment
RUN git clone --depth 1 --branch v0.31.2 https://github.com/SolverForge/solverforge.git /src/upstream \
    && test "$(git -C /src/upstream rev-parse HEAD)" = 78889c3ff9fda158c70e6a1f67f8c7f0fdae922e \
    && python3 /src/experiment/prepare_workspace.py /src/upstream
ENV CARGO_TARGET_DIR=/native-target RAYON_NUM_THREADS=1
RUN cargo +1.100.0 build --locked --release --manifest-path /src/upstream/Cargo.toml -p perfectutilitares-solverforge-spike \
    && cmp /src/upstream/Cargo.lock /src/experiment/Cargo.lock \
    && cp /native-target/release/perfectutilitares-solverforge-spike /solverforge \
    && ! readelf -lW /solverforge | grep -q ' INTERP ' \
    && ! readelf -dW /solverforge | grep -q '(NEEDED)'

FROM cgr.dev/chainguard/wolfi-base@sha256:771146c2dfc880902a185f060c3db5571473c46b267edd98c3119c83068dfb61 AS application
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ESCALAS_SOLVER_BINARY=/usr/local/bin/solverforge
RUN apk upgrade --no-cache \
    && apk add --no-cache python-3.13=3.13.18_git20261030-r0 ca-certificates-bundle \
    && mkdir -p /usr/local/bin && ln -s /usr/bin/python3.13 /usr/local/bin/python
COPY --from=native --chmod=0555 /solverforge /usr/local/bin/solverforge
WORKDIR /app
COPY --chmod=0644 ops/escalas/solver.py ops/escalas/native_runner.py ops/escalas/server.py \
     ops/escalas/control.py ops/escalas/service_security.py ops/escalas/service_operations.py \
     ops/escalas/runtime_settings.py ops/escalas/model_input.py ops/escalas/planning_calendar.py \
     ops/escalas/rest_configuration.py ./
ARG SOURCE_REVISION=untracked
ARG BUILD_DATE=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="PerfectUtilitares SolverForge candidate" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      perfectutilitares.escalas.engine="solverforge" \
      perfectutilitares.escalas.qualification="experimental-not-production"
USER 1001:1001
RUN python -B -c 'import importlib.util,solver; assert callable(solver.solve); assert all(importlib.util.find_spec(n) is None for n in ("ortools","numpy","pandas","pip"))'
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=3).read()"]
CMD ["python", "server.py"]

# Test tools are separate and never copied into the runtime image.
FROM application AS development
USER root
RUN apk add --no-cache py3.13-pip && python -m venv --without-pip /opt/solver
COPY ops/escalas/development-requirements.txt /tmp/development-requirements.txt
RUN python -m pip --python /opt/solver install --require-hashes --only-binary=:all: -r /tmp/development-requirements.txt \
    && python -m pip --python /opt/solver check && rm /tmp/development-requirements.txt
ENV PATH=/opt/solver/bin:$PATH
USER 1001:1001

FROM application AS runtime
