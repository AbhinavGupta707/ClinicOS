# syntax=docker/dockerfile:1.10

ARG NODE_IMAGE="node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f"
ARG LAMBDA_NODE_IMAGE="public.ecr.aws/lambda/nodejs:22-arm64@sha256:58a42d216451e95245daf5148481226be8297ad676823b92e3d52b8031404e20"

FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.json tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
COPY scripts/dependency-patches.mjs ./scripts/dependency-patches.mjs
RUN npm ci \
    && npm run build:shared \
    && npm run build --workspace @clinic-os/media-scanner \
    && find apps packages -type d -name node_modules -prune -exec rm -rf '{}' +

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts/dependency-patches.mjs ./scripts/dependency-patches.mjs
RUN npm ci --omit=dev --workspace @clinic-os/media-scanner --include-workspace-root=false

FROM ${LAMBDA_NODE_IMAGE} AS runtime
ARG SOURCE_REVISION="unknown"
# Reviewed AL2023 snapshot contains the curl, PCRE2 and RPM security fixes.
ARG AL2023_RELEASE="2023.12.20260930"
LABEL org.opencontainers.image.source="https://github.com/AbhinavGupta707/ClinicOS" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.title="ClinicOS GuardDuty Evidence Signer"
ENV NODE_ENV="production" \
    NODE_OPTIONS="--enable-source-maps"
RUN dnf upgrade --refresh --releasever="${AL2023_RELEASE}" -y \
    && dnf clean all \
    && rm -rf /var/cache/dnf
COPY --from=production-dependencies --chown=10001:10001 /workspace/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY --from=production-dependencies --chown=10001:10001 /workspace/packages/integrations/node_modules ${LAMBDA_TASK_ROOT}/packages/integrations/node_modules
COPY --from=build --chown=10001:10001 /workspace/apps/media-scanner/dist ${LAMBDA_TASK_ROOT}/apps/media-scanner/dist
COPY --from=build --chown=10001:10001 /workspace/packages/integrations/dist ${LAMBDA_TASK_ROOT}/packages/integrations/dist
COPY --from=build --chown=10001:10001 /workspace/apps/media-scanner/package.json ${LAMBDA_TASK_ROOT}/apps/media-scanner/package.json
COPY --from=build --chown=10001:10001 /workspace/packages/integrations/package.json ${LAMBDA_TASK_ROOT}/packages/integrations/package.json
# The Lambda service supplies the Runtime API. Package managers and the local-only Runtime
# Interface Emulator are not needed in production and would expand the executable attack surface.
# The RIC does not import this prebundled SDK. The handler carries its own locked
# AWS clients in /var/task; retain no vulnerable alternate SDK resolution path.
RUN rm -rf /var/runtime/node_modules/@aws-sdk \
    /var/lang/lib/node_modules/npm /var/lang/lib/node_modules/corepack /usr/local/bin/aws-lambda-rie \
    && rm -f /var/lang/bin/npm /var/lang/bin/npx /var/lang/bin/corepack
USER 10001:10001
CMD ["apps/media-scanner/dist/handler.handler"]
