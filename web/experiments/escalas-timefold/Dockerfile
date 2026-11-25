# Disposable synthetic spike only. Base manifests pinned from Docker Official Images.
FROM maven:3.9.16-eclipse-temurin-21-noble@sha256:af3a049b2808ffaeccd31e2c2eba0d47776468d1e4f2fd6c1f9fd2f89aabf602 AS build
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -B -ntp -C verify dependency:tree dependency:copy-dependencies -DincludeScope=runtime -DoutputDirectory=/build/lib
FROM eclipse-temurin:21-jre-noble@sha256:54999a956a8bf8be9af0052790a6a832bf91a62fad3199fd194c3cc28057fc62
WORKDIR /app
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="PerfectUtilitares synthetic Timefold E2 spike" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      perfectutilitares.escalas.experimental="E2_PARTIAL_MODEL"
COPY --from=build /build/target/escalas-timefold-spike-0.1.0.jar /app/spike.jar
COPY --from=build /build/lib /app/lib
USER 1001:1001
ENTRYPOINT ["java","-XX:ActiveProcessorCount=1","-XX:MaxRAMPercentage=55","-XX:+ExitOnOutOfMemoryError","-Djava.io.tmpdir=/tmp","-cp","/app/spike.jar:/app/lib/*","br.perfectutilitares.escalas.spike.SpikeMain"]
