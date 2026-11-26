# Receives only the compiled upstream example and its public license.
# No compiler, Cargo cache, database client, service port, or RH input.
FROM ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b
COPY minimal-shift-scheduling /usr/local/bin/solverforge-smoke
COPY LICENSE /usr/share/licenses/solverforge/LICENSE
RUN test -x /usr/bin/timeout && test -x /usr/local/bin/solverforge-smoke
USER 1001:1001
ENTRYPOINT ["/usr/bin/timeout","--signal=TERM","--kill-after=1s","7s","/usr/local/bin/solverforge-smoke"]
