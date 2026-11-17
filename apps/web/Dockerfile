# syntax=docker/dockerfile:1.7
# Web image targets: `dev` (next dev with hot reload, for compose) and `build` (static export).
# No runtime web image is published for the Cloud edition (the export goes to S3 + CloudFront).
# Build from the monorepo root:  docker build -f apps/web/Dockerfile --target dev .
ARG NODE_IMAGE=node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH npm_config_store_dir=/pnpm/store CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/schemas/package.json packages/schemas/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui-tokens/package.json packages/ui-tokens/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@assettracker/web..."

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter "@assettracker/web..." run build
# `docker build --target build --output type=local,dest=./out .` exports /repo/apps/web/out

FROM build AS dev
ENV NODE_ENV=development
WORKDIR /repo/apps/web
CMD ["pnpm", "dev", "--hostname", "0.0.0.0"]
