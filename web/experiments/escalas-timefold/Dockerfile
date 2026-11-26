# Synthetic experiment. No untracked vendor JDK in any parent layer.
FROM ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b AS java-runtime
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH
ENV LANG=C.UTF-8
RUN set -eu; \
    apt-get -o APT::Update::Error-Mode=any update; \
    DEBIAN_FRONTEND=noninteractive apt-get -o 'Dpkg::Options::=--path-include=*' install -y --no-install-recommends ca-certificates 'openjdk-21-jre-headless=21.0.13.1+2-1~24.04.1'; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /opt/java; \
    arch=$(dpkg --print-architecture); \
    case "$arch" in arm64|amd64) ;; *) exit 1 ;; esac; \
    ln -s "/usr/lib/jvm/java-21-openjdk-$arch" /opt/java/openjdk; \
    test -x /usr/bin/timeout
COPY verify-jdk.sh /usr/local/bin/verify-jdk
RUN /bin/sh /usr/local/bin/verify-jdk runtime && java -version

FROM ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b AS toolchain-download
RUN set -eu; \
    apt-get -o APT::Update::Error-Mode=any update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl; \
    mkdir -p /verified/maven; \
    archive=/tmp/apache-maven-3.10.2-bin.tar.gz; \
    curl --fail --silent --show-error --location --retry 3 --max-time 180 \
      https://dlcdn.apache.org/maven/maven-3/3.10.2/binaries/apache-maven-3.10.2-bin.tar.gz -o "$archive" \
      || curl --fail --silent --show-error --location --retry 3 --max-time 180 \
      https://archive.apache.org/dist/maven/maven-3/3.10.2/binaries/apache-maven-3.10.2-bin.tar.gz -o "$archive"; \
    printf '%s  %s\n' '57d2db6b37e7582119137ade544557bba741b29e62109ef81539a2bdfd6d0e641fdd5d8edb014af1816d0510deac6fac8f347433b3a1aa36316ba85aa77b8119' "$archive" | sha512sum -c -; \
    tar -xzf "$archive" -C /verified/maven --strip-components=1; \
    rm "$archive"

FROM java-runtime AS build
RUN set -eu; \
    apt-get -o APT::Update::Error-Mode=any update; \
    DEBIAN_FRONTEND=noninteractive apt-get -o 'Dpkg::Options::=--path-include=*' install -y --no-install-recommends \
      'openjdk-21-jre-headless=21.0.13.1+2-1~24.04.1' 'openjdk-21-jdk-headless=21.0.13.1+2-1~24.04.1'; \
    rm -rf /var/lib/apt/lists/*; \
    /bin/sh /usr/local/bin/verify-jdk build
ENV MAVEN_HOME=/usr/share/maven
ENV PATH=/usr/share/maven/bin:$PATH
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
FROM java-runtime AS runtime
WORKDIR /app
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="PerfectUtilitares synthetic Timefold E2 spike" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      perfectutilitares.escalas.experimental="E2_PARTIAL_MODEL"
COPY --from=build /build/target/escalas-timefold-spike-0.1.0.jar /app/spike.jar
COPY --from=build /build/lib /app/lib
USER 1001:1001
ENTRYPOINT ["/usr/bin/timeout","--signal=TERM","--kill-after=1s","17s","java","-XX:ActiveProcessorCount=1","-XX:MaxRAMPercentage=55","-XX:+ExitOnOutOfMemoryError","-Djava.io.tmpdir=/tmp","-cp","/app/spike.jar:/app/lib/*","br.perfectutilitares.escalas.spike.SpikeMain"]
