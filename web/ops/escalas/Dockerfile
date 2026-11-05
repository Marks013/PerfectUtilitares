FROM python:3.13-slim@sha256:d98cc29d3266e535dd9da1099688d9cb3ca4753813571e071763d17725460962
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update \
    && apt-get upgrade --yes --no-install-recommends \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' apt)" ge 3.0.4 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --only-binary=:all: -r requirements.txt \
    && pip check \
    && python -m pip uninstall --yes pip \
    && python -c 'from importlib.util import find_spec; from ortools.sat.python import cp_model; assert find_spec("pip") is None'
ARG SOURCE_REVISION=untracked
ARG BUILD_DATE=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="PerfectUtilitares Escalas Solver" \
      org.opencontainers.image.description="Otimizador de escalas do PerfectUtilitares" \
      org.opencontainers.image.source="https://github.com/Marks013/PerfectUtilitares" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
COPY solver.py hints.py optimization.py weekend_balance.py server.py control.py worker.py service_security.py service_operations.py ./
USER 1001:1001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=3).read()"]
CMD ["python", "server.py"]
