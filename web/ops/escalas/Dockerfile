# Wolfi supplies maintained glibc libraries and CPython security backports.
# Both stages share one interpreter; only the wheel environment crosses stages.
FROM cgr.dev/chainguard/wolfi-base@sha256:771146c2dfc880902a185f060c3db5571473c46b267edd98c3119c83068dfb61 AS python-base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apk upgrade --no-cache \
    && apk add --no-cache python-3.13=3.13.18_git20261030-r0 ca-certificates-bundle

FROM python-base AS dependencies
RUN apk add --no-cache py3.13-pip \
    && python3.13 -m venv --without-pip /opt/solver
WORKDIR /app
COPY requirements.txt ./
RUN python3.13 -m pip --python /opt/solver install --require-hashes --only-binary=:all: -r requirements.txt \
    && python3.13 -m pip --python /opt/solver check

# Optional CI tools have their own target and never enter the runtime image.
FROM dependencies AS development
ENV PATH=/opt/solver/bin:$PATH
COPY development-requirements.txt ./
RUN /usr/bin/python3.13 -m pip --python /opt/solver install --require-hashes --only-binary=:all: -r development-requirements.txt \
    && /usr/bin/python3.13 -m pip --python /opt/solver check

FROM python-base AS runtime
ENV PATH=/opt/solver/bin:$PATH
COPY --from=dependencies /opt/solver /opt/solver
WORKDIR /app
RUN python -c 'from importlib.util import find_spec; from ortools.sat.python import cp_model; import numpy, pandas, ssl, sqlite3, zlib; from zoneinfo import ZoneInfo; assert ZoneInfo("America/Sao_Paulo"); assert ssl.create_default_context().get_ca_certs(); assert find_spec("pip") is None'
ARG SOURCE_REVISION=untracked
ARG BUILD_DATE=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="PerfectUtilitares Escalas Solver" \
      org.opencontainers.image.description="Otimizador de escalas do PerfectUtilitares" \
      org.opencontainers.image.source="https://github.com/Marks013/PerfectUtilitares" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
COPY solver.py hints.py optimization.py weekend_balance.py server.py control.py worker.py service_security.py service_operations.py \
     policy_reference.py policy-reference.json runtime_settings.py diagnostics.py leadership.py model_input.py rest_quality.py ./
USER 1001:1001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=3).read()"]
CMD ["python", "server.py"]
