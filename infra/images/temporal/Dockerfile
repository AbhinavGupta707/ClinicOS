ARG GO_BUILD_IMAGE=golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2
ARG TEMPORAL_SERVER_IMAGE=temporalio/server:1.31.2@sha256:b5ecdb8282bededae2a10c36e8d862e27d0bc2d247fc73c5416025997ab4a1da

FROM ${GO_BUILD_IMAGE} AS temporal-build

ARG TARGETARCH
ARG TEMPORAL_SOURCE_REVISION=19a774302c613da9adc4436ab14278ccdca8e0a5
ARG TEMPORAL_SOURCE_SHA256=e034c4ff9ef8ae7d4a326bddb9f6793bee6255285cc19f9b58874d8ee21eb3e8
ARG AWS_RDS_CA_BUNDLE_SHA256=e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3

RUN apk add --no-cache ca-certificates

WORKDIR /src
RUN wget -q -O temporal.tar.gz "https://github.com/temporalio/temporal/archive/${TEMPORAL_SOURCE_REVISION}.tar.gz" \
  && echo "${TEMPORAL_SOURCE_SHA256}  temporal.tar.gz" | sha256sum -c - \
  && tar -xzf temporal.tar.gz --strip-components=1 \
  && rm temporal.tar.gz

RUN wget -q -O /tmp/aws-rds-global-bundle.pem \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  && echo "${AWS_RDS_CA_BUNDLE_SHA256}  /tmp/aws-rds-global-bundle.pem" | sha256sum -c -

RUN CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/temporal-server ./cmd/server \
  && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/temporal-sql-tool ./cmd/tools/sql

RUN sed -i '/permissionsClaimName:/a\        audience: {{ default "clinic-os-temporal" (env "TEMPORAL_JWT_AUDIENCE") }}' common/config/config_template_embedded.yaml \
  && sed -i 's#rpcAddress: {{ (print "127.0.0.1:" $temporalGrpcPort) }}#rpcAddress: {{ default (print "127.0.0.1:" $temporalGrpcPort) (env "TEMPORAL_CLUSTER_METADATA_RPC_ADDRESS") }}#' common/config/config_template_embedded.yaml \
  && sed -i 's#httpAddress: {{ (print "127.0.0.1:" $temporalHTTPPort) }}#httpAddress: {{ default (print "127.0.0.1:" $temporalHTTPPort) (env "TEMPORAL_CLUSTER_METADATA_HTTP_ADDRESS") }}#' common/config/config_template_embedded.yaml \
  && grep -q 'TEMPORAL_JWT_AUDIENCE' common/config/config_template_embedded.yaml \
  && grep -q 'TEMPORAL_CLUSTER_METADATA_RPC_ADDRESS' common/config/config_template_embedded.yaml

FROM ${TEMPORAL_SERVER_IMAGE}

USER 0:0

RUN apk add --no-cache \
  curl \
  jq \
  libcrypto3=3.5.7-r0 \
  libssl3=3.5.7-r0 \
  postgresql17-client=17.10-r0

COPY --from=temporal-build /out/temporal-server /usr/local/bin/temporal-server
COPY --from=temporal-build /out/temporal-sql-tool /usr/local/bin/temporal-sql-tool
COPY --from=temporal-build /src/schema /etc/temporal/schema
COPY --from=temporal-build /src/common/config/config_template_embedded.yaml /etc/temporal/config/production.yaml
COPY --from=temporal-build /tmp/aws-rds-global-bundle.pem /etc/ssl/certs/aws-rds-global-bundle.pem
COPY --chown=1000:1000 infra/images/temporal/dynamicconfig/production.yaml /etc/temporal/dynamicconfig/production.yaml
COPY --chown=1000:1000 infra/images/temporal/bin/migrate-temporal /opt/clinicos/bin/migrate-temporal
COPY --chown=1000:1000 infra/images/temporal/bin/start-temporal /opt/clinicos/bin/start-temporal

RUN chmod 0444 /etc/ssl/certs/aws-rds-global-bundle.pem \
  && chmod 0555 /opt/clinicos/bin/migrate-temporal /opt/clinicos/bin/start-temporal /usr/local/bin/temporal-sql-tool \
  && chmod -R a-w /etc/temporal/schema /etc/temporal/dynamicconfig /etc/temporal/config \
  && test "$(stat -c '%u:%g' /etc/temporal/dynamicconfig/production.yaml)" = "1000:1000"

USER 1000:1000
