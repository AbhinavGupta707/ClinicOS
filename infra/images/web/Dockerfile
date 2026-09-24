# syntax=docker/dockerfile:1.10

ARG NODE_IMAGE="node:22.22.2-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f"

FROM ${NODE_IMAGE} AS build
ENV NEXT_TELEMETRY_DISABLED="1"
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.json tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci && npm run build:shared && npm run build --workspace @clinic-os/web \
    && find apps packages -type d -name node_modules -prune -exec rm -rf '{}' +

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --omit=dev --workspace @clinic-os/web --include-workspace-root=false \
    && mkdir -p /runtime-dependencies \
    && find apps packages -type d -name node_modules -prune -exec sh -c \
      'mkdir -p "/runtime-dependencies/$(dirname "$1")"; cp -a "$1" "/runtime-dependencies/$1"' _ '{}' \;

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_REVISION="unknown"
LABEL org.opencontainers.image.source="https://github.com/AbhinavGupta707/ClinicOS" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.title="ClinicOS Web"
ENV NODE_ENV="production" \
    NEXT_TELEMETRY_DISABLED="1" \
    HOSTNAME="0.0.0.0" \
    PORT="3000"
WORKDIR /workspace
RUN apk add --no-cache --upgrade libcrypto3=3.5.8-r0 libssl3=3.5.8-r0 \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -rf /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && addgroup -S -g 10001 clinicos \
    && adduser -S -D -H -u 10001 -G clinicos clinicos
COPY --from=production-dependencies --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /workspace/apps/web/.next ./apps/web/.next
COPY --from=build --chown=10001:10001 /workspace/apps/web/server ./apps/web/server
COPY --from=build --chown=10001:10001 /workspace/apps/web/lib/cp14-session ./apps/web/lib/cp14-session
COPY --from=build --chown=10001:10001 /workspace/apps/web/package.json /workspace/apps/web/next.config.mjs ./apps/web/
COPY --from=build --chown=10001:10001 /workspace/packages ./packages
COPY --from=production-dependencies --chown=10001:10001 /runtime-dependencies/ ./
COPY --from=build --chown=10001:10001 /workspace/package.json ./package.json
USER 10001:10001
EXPOSE 3000
CMD ["node", "apps/web/server/start.mts"]
