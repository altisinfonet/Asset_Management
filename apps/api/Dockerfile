# syntax=docker/dockerfile:1.7
# Backend image: ONE image, many roles (`api` | `worker` | `scheduler` | `migrate`).
# Build from the monorepo root:  docker build -f apps/api/Dockerfile .
# Targets: dev (compose, dev deps + watch) and runtime (final, the only image that is shipped).

# Node 24 LTS slim, pinned by digest (bump with Renovate/Dependabot).
ARG NODE_IMAGE=node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

# ---------------------------------------------------------------- base
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    CI=true
# Activates the pnpm version pinned in the root package.json "packageManager" field.
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------- deps
# Manifests and lockfile only, so this layer is reused until dependencies change.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/schemas/package.json packages/schemas/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui-tokens/package.json packages/ui-tokens/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@assettracker/api..."

# ---------------------------------------------------------------- build
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
# The API contract is bundled into dist at build time and served at /v1/openapi.json (scripts/bundle-openapi.mjs).
COPY docs/engineering/openapi.yaml docs/engineering/openapi.yaml
# `...` = the api plus the workspace packages it depends on, built in topological order.
RUN pnpm --filter "@assettracker/api..." run build
# Self-contained production tree: compiled dist, migrations, prod node_modules only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @assettracker/api deploy --prod /out

# ---------------------------------------------------------------- dev (compose)
FROM build AS dev
ENV NODE_ENV=development
WORKDIR /repo/apps/api
USER node
CMD ["pnpm", "dev", "api"]

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=dev
ARG APP_VERSION
ENV NODE_ENV=production \
    GIT_SHA=${GIT_SHA} \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
# The image never runs npm/npx (ENTRYPOINT is node); the CLI bundled in the base image only adds CVEs
# (brace-expansion, undici inside /usr/local/lib/node_modules/npm) and attack surface. Removed.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# Non-root (uid 1000 from the base image); no secrets or shell tooling are added.
USER node
EXPOSE 3000
# Role = first argument (or APP_ROLE): api | worker | scheduler | migrate
ENTRYPOINT ["node", "dist/main.js"]
CMD ["api"]
