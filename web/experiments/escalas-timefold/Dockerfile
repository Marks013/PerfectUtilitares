# Disposable synthetic spike only. Base manifests pinned from Docker Official Images.
# Verified patch archives, isolated from the build and runtime filesystem.
FROM maven:3.9.16-eclipse-temurin-21-noble@sha256:af3a049b2808ffaeccd31e2c2eba0d47776468d1e4f2fd6c1f9fd2f89aabf602 AS toolchain-download
ARG TARGETARCH
RUN set -eu; \
    case "$TARGETARCH" in \
      arm64) arch=aarch64; jdk=8c72816a6b308842d5ed1f13e5826b69c567da4784f7238d7e800efa71fe54b1; jre=52bc58323d9266538a6361a3cf8365fc1186dd9510d7f33f623681c4aabb7e72 ;; \
      amd64) arch=x64; jdk=bb8a93f9ae6e7a693b2b721e85dbeff26ae1a77447985a8d7afcdd9c7cf6222e; jre=18f44fab9065217f3ba61d0eef8a7b5f3c3713aa7293001b0d4ac10ede3850f0 ;; \
      *) exit 1 ;; \
    esac; \
    mkdir -p /verified/jdk /verified/jre /verified/maven; \
    for kind in jdk jre; do \
      if [ "$kind" = jdk ]; then digest="$jdk"; else digest="$jre"; fi; \
      file=$(printf 'OpenJDK21U-%s_%s_linux_hotspot_21.0.13.1_2.tar.gz' "$kind" "$arch"); \
      curl --fail --silent --show-error --location --retry 3 --max-time 180 \
        "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13.1%2B2/$file" -o "/tmp/$file"; \
      printf '%s  %s\n' "$digest" "/tmp/$file" | sha256sum -c -; \
      tar -xzf "/tmp/$file" -C "/verified/$kind" --strip-components=1; \
      rm "/tmp/$file"; \
    done; \
    archive=/tmp/apache-maven-3.10.2-bin.tar.gz; \
    curl --fail --silent --show-error --location --retry 3 --max-time 180 \
      https://dlcdn.apache.org/maven/maven-3/3.10.2/binaries/apache-maven-3.10.2-bin.tar.gz -o "$archive" \
      || curl --fail --silent --show-error --location --retry 3 --max-time 180 \
      https://archive.apache.org/dist/maven/maven-3/3.10.2/binaries/apache-maven-3.10.2-bin.tar.gz -o "$archive"; \
    printf '%s  %s\n' '57d2db6b37e7582119137ade544557bba741b29e62109ef81539a2bdfd6d0e641fdd5d8edb014af1816d0510deac6fac8f347433b3a1aa36316ba85aa77b8119' "$archive" | sha512sum -c -; \
    tar -xzf "$archive" -C /verified/maven --strip-components=1; \
    rm "$archive"

FROM maven:3.9.16-eclipse-temurin-21-noble@sha256:af3a049b2808ffaeccd31e2c2eba0d47776468d1e4f2fd6c1f9fd2f89aabf602 AS build
RUN test "$JAVA_HOME" = /opt/java/openjdk && rm -rf /opt/java/openjdk /usr/share/maven
COPY --from=toolchain-download /verified/jdk/ /opt/java/openjdk/
COPY --from=toolchain-download /verified/maven/ /usr/share/maven/
RUN java -version 2>&1 | grep -F '21.0.13.1' && mvn --version | grep -F 'Apache Maven 3.10.2'
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -B -ntp -C verify dependency:tree dependency:copy-dependencies -DincludeScope=runtime -DoutputDirectory=/build/lib
# Only the explicitly requested audit target executes the extra Maven plugin.
# Runtime build remains independent of OSV and ships no audit artifacts/tools.
FROM build AS dependency-audit
RUN mkdir -p /audit && \
    mvn -B -ntp -C dependency:tree -DoutputFile=/audit/dependency-tree.txt && \
    mvn -B -ntp -C org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeBom \
      -DoutputDirectory=/audit -DoutputName=runtime -DoutputFormat=json \
      -DincludeProvidedScope=false -DincludeSystemScope=false -DincludeTestScope=false -Dcyclonedx.skipAttach=true && \
    mvn -B -ntp -C org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeBom \
      -DoutputDirectory=/audit -DoutputName=with-tests -DoutputFormat=json \
      -DincludeProvidedScope=false -DincludeSystemScope=false -DincludeTestScope=true -Dcyclonedx.skipAttach=true && \
    cd /build/lib && sha256sum *.jar > /audit/runtime-jars.sha256
FROM scratch AS audit-export
COPY --from=dependency-audit /audit/ /
FROM eclipse-temurin:21-jre-noble@sha256:54999a956a8bf8be9af0052790a6a832bf91a62fad3199fd194c3cc28057fc62
WORKDIR /app
RUN test "$JAVA_HOME" = /opt/java/openjdk && rm -rf /opt/java/openjdk
COPY --from=toolchain-download /verified/jre/ /opt/java/openjdk/
RUN test -x /usr/bin/timeout && java -version 2>&1 | grep -F '21.0.13.1'
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="PerfectUtilitares synthetic Timefold E2 spike" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      perfectutilitares.escalas.experimental="E2_PARTIAL_MODEL"
COPY --from=build /build/target/escalas-timefold-spike-0.1.0.jar /app/spike.jar
COPY --from=build /build/lib /app/lib
USER 1001:1001
ENTRYPOINT ["/usr/bin/timeout","--signal=TERM","--kill-after=1s","17s","java","-XX:ActiveProcessorCount=1","-XX:MaxRAMPercentage=55","-XX:+ExitOnOutOfMemoryError","-Djava.io.tmpdir=/tmp","-cp","/app/spike.jar:/app/lib/*","br.perfectutilitares.escalas.spike.SpikeMain"]
