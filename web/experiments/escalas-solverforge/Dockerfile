# Static, checksum-locked Rust build output is supplied by the isolated CI job.
# No shell, Java, Python, database client or extra network stack in the image.
FROM scratch
ARG SOURCE_REVISION
ARG UPSTREAM_REVISION
LABEL org.opencontainers.image.title="PerfectUtilitares synthetic SolverForge spike" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      perfectutilitares.solverforge.revision="${UPSTREAM_REVISION}" \
      perfectutilitares.escalas.experimental="SOLVERFORGE_PARTIAL_MODEL"
WORKDIR /app
COPY --chmod=0555 solverforge-spike /app/solverforge-spike
USER 1001:1001
ENTRYPOINT ["/app/solverforge-spike"]
