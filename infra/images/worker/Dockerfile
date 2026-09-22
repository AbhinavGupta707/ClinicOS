# syntax=docker/dockerfile:1.10

# Temporal's native bridge is built for glibc, not Alpine/musl.
ARG NODE_IMAGE="node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e"
ARG NODE_RUNTIME_IMAGE="gcr.io/distroless/nodejs22-debian13:nonroot@sha256:5e9868cc8ef163e86378ff90de23ca031f5bb8b2023d4f3288a5e740698919d4"

FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.json tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci \
    && npm run build:shared \
    && npm run build --workspace @clinic-os/worker \
    && find apps packages -type d -name node_modules -prune -exec rm -rf '{}' +

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --omit=dev --workspace @clinic-os/worker --include-workspace-root=false \
    && mkdir -p /runtime-dependencies \
    && find apps packages -type d -name node_modules -prune -exec sh -c \
      'mkdir -p "/runtime-dependencies/$(dirname "$1")"; cp -a "$1" "/runtime-dependencies/$1"' _ '{}' \;

FROM ${NODE_RUNTIME_IMAGE} AS runtime
ARG SOURCE_REVISION="unknown"
LABEL org.opencontainers.image.source="https://github.com/AbhinavGupta707/ClinicOS" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.title="ClinicOS Worker"
ENV NODE_ENV="production" \
    NODE_OPTIONS="--enable-source-maps" \
    WORKER_HEALTH_PORT="3001"
WORKDIR /workspace
COPY --from=production-dependencies --chown=10001:10001 /workspace/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /workspace/apps/worker ./apps/worker
COPY --from=build --chown=10001:10001 /workspace/packages ./packages
COPY --from=production-dependencies --chown=10001:10001 /runtime-dependencies/ ./
COPY --from=build --chown=10001:10001 /workspace/package.json ./package.json
USER 10001:10001
EXPOSE 3001
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["apps/worker/dist/main.js"]
