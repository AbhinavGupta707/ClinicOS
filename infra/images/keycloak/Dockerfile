# syntax=docker/dockerfile:1.10
ARG MAVEN_IMAGE=maven:3.9.16-eclipse-temurin-21@sha256:c2a2c58516d160f43b50f12baa427ca86989e0bc942609e04aff61da5d9a7d74
ARG JAVA_RUNTIME_IMAGE=eclipse-temurin:21-jre-alpine@sha256:1a29e1fe337eb28b5bec30f0ee8ed29f0ff80ab6f75dcf9313efe82911065a52

FROM ${MAVEN_IMAGE} AS source-build
USER 0
RUN apt-get update && apt-get install -y --no-install-recommends python3 git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
ADD --checksum=sha256:07b284252100d825df27fb2145bc26c9c7430726502218e0c5cfbf3bebe94c1b \
    https://codeload.github.com/keycloak/keycloak/tar.gz/aa9fe3fba0c6cd5770f19a49378c55f4378cf544 /build/source.tar.gz
COPY infra/images/keycloak/security-boms.patch infra/images/keycloak/verify-source-build.py /build/
RUN mkdir source /out && tar -xzf source.tar.gz -C source --strip-components=1 \
    && cd source && git apply --check ../security-boms.patch && git apply ../security-boms.patch
WORKDIR /build/source
RUN mvn --batch-mode --no-transfer-progress -N help:effective-pom -Doutput=/out/effective-pom.xml \
    && python3 /build/verify-source-build.py effective /build/source /out
# Run the selected upstream server reactor's unit tests as part of the build.
# The external upstream testsuite is separate from this bounded image build.
RUN mvn --batch-mode --no-transfer-progress -T2 -DskipTestsuite -DskipExamples \
    -pl quarkus/deployment,quarkus/dist -am clean install \
    && mkdir /out/keycloak \
    && tar -xzf quarkus/dist/target/keycloak-26.7.4.tar.gz -C /out/keycloak --strip-components=1 \
    && python3 /build/verify-source-build.py distribution /build/source /out

FROM ${JAVA_RUNTIME_IMAGE} AS builder
COPY --from=source-build /out/keycloak/ /opt/keycloak/
RUN apk add --no-cache bash

ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true

RUN /opt/keycloak/bin/kc.sh build

FROM ${JAVA_RUNTIME_IMAGE} AS dependency-fetch

ARG AWS_RDS_CA_BUNDLE_SHA256=e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3

USER 0
RUN apk add --no-cache wget \
  && wget -q -O /tmp/aws-rds-global-bundle.pem \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  && echo "${AWS_RDS_CA_BUNDLE_SHA256}  /tmp/aws-rds-global-bundle.pem" | sha256sum -c -

FROM ${JAVA_RUNTIME_IMAGE}

LABEL org.opencontainers.image.title="ClinicOS Keycloak security rebuild" \
      org.opencontainers.image.version="26.7.4-clinicos.1" \
      org.opencontainers.image.base.name="eclipse-temurin:21-jre-alpine" \
      io.clinicos.keycloak.source-revision="aa9fe3fba0c6cd5770f19a49378c55f4378cf544"

ENV KC_RUN_IN_CONTAINER=true \
    LANG=en_US.UTF-8

USER 0
RUN apk upgrade --no-cache \
  && apk add --no-cache bash curl jq \
  && adduser -D -u 1000 -G root -h /opt/keycloak -s /sbin/nologin keycloak \
  && mkdir -p /etc/pki/ca-trust/extracted/java \
  && ln -s /opt/java/openjdk/lib/security/cacerts /etc/pki/ca-trust/extracted/java/cacerts

COPY --from=builder --chown=1000:0 /opt/keycloak/ /opt/keycloak/
COPY --from=source-build /out/source-build.json /out/effective-pom.xml /opt/clinicos/provenance/
COPY --from=dependency-fetch /tmp/aws-rds-global-bundle.pem /opt/clinicos/trust/aws-rds-global-bundle.pem
COPY --chown=1000:0 infra/docker/keycloak/production/clinic-os-realm.template.json /opt/clinicos/keycloak/clinic-os-realm.template.json
COPY --chown=1000:0 infra/images/keycloak/bin/bootstrap-keycloak /opt/clinicos/bin/bootstrap-keycloak
COPY --chown=1000:0 infra/images/keycloak/bin/entrypoint-keycloak /opt/clinicos/bin/entrypoint-keycloak

RUN rm -rf \
    /opt/keycloak/bin/client \
    /opt/keycloak/bin/kcadm.sh \
    /opt/keycloak/bin/kcreg.sh \
  && rm -f \
    /opt/keycloak/lib/lib/main/com.microsoft.sqlserver.mssql-jdbc-13.2.1.jre11.jar \
    /opt/keycloak/lib/lib/main/io.quarkus.quarkus-jdbc-mssql-3.33.3.2.jar \
  && chmod 0444 \
    /opt/clinicos/keycloak/clinic-os-realm.template.json \
    /opt/clinicos/trust/aws-rds-global-bundle.pem \
  && chmod 0555 \
    /opt/clinicos/bin/bootstrap-keycloak \
    /opt/clinicos/bin/entrypoint-keycloak

USER 1000:0

ENTRYPOINT ["/opt/clinicos/bin/entrypoint-keycloak"]
