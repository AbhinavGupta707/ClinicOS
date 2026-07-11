ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.7.0@sha256:2eb3cd316835c990e69e26ade292ffa78f6fb0db7d5fc6377463c162e1979ac0
ARG JAVA_RUNTIME_IMAGE=eclipse-temurin:21-jre-alpine@sha256:3f08b13888f595cc49edabea7250ba69499ba25602b267da591720769400e08c

FROM ${KEYCLOAK_IMAGE} AS builder

ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true

RUN /opt/keycloak/bin/kc.sh build

FROM ${JAVA_RUNTIME_IMAGE} AS dependency-fetch

ARG JACKSON_DATABIND_VERSION=2.21.4
ARG JACKSON_DATABIND_SHA256=3888e9e69ab66fbacaacc9aea0e9ffbf15368288e4aca468b024dba11c09fbf9
ARG AWS_RDS_CA_BUNDLE_SHA256=e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3

USER 0
RUN apk add --no-cache wget \
  && wget -q -O /tmp/jackson-databind.jar \
    "https://repo1.maven.org/maven2/com/fasterxml/jackson/core/jackson-databind/${JACKSON_DATABIND_VERSION}/jackson-databind-${JACKSON_DATABIND_VERSION}.jar" \
  && echo "${JACKSON_DATABIND_SHA256}  /tmp/jackson-databind.jar" | sha256sum -c - \
  && wget -q -O /tmp/aws-rds-global-bundle.pem \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  && echo "${AWS_RDS_CA_BUNDLE_SHA256}  /tmp/aws-rds-global-bundle.pem" | sha256sum -c -

FROM ${JAVA_RUNTIME_IMAGE}

ENV KC_RUN_IN_CONTAINER=true \
    LANG=en_US.UTF-8

USER 0
RUN apk upgrade --no-cache \
  && apk add --no-cache bash curl jq \
  && adduser -D -u 1000 -G root -h /opt/keycloak -s /sbin/nologin keycloak \
  && mkdir -p /etc/pki/ca-trust/extracted/java \
  && ln -s /opt/java/openjdk/lib/security/cacerts /etc/pki/ca-trust/extracted/java/cacerts

COPY --from=builder --chown=1000:0 /opt/keycloak/ /opt/keycloak/
COPY --from=dependency-fetch /tmp/jackson-databind.jar /opt/keycloak/lib/lib/main/com.fasterxml.jackson.core.jackson-databind-2.21.2.jar
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
    /opt/keycloak/lib/lib/main/io.quarkus.quarkus-jdbc-mssql-3.33.2.1.jar \
  && chown 1000:0 /opt/keycloak/lib/lib/main/com.fasterxml.jackson.core.jackson-databind-2.21.2.jar \
  && chmod 0444 \
    /opt/clinicos/keycloak/clinic-os-realm.template.json \
    /opt/clinicos/trust/aws-rds-global-bundle.pem \
    /opt/keycloak/lib/lib/main/com.fasterxml.jackson.core.jackson-databind-2.21.2.jar \
  && chmod 0555 \
    /opt/clinicos/bin/bootstrap-keycloak \
    /opt/clinicos/bin/entrypoint-keycloak

USER 1000:0

ENTRYPOINT ["/opt/clinicos/bin/entrypoint-keycloak"]
