# One image, three entry points: the API, the worker and the built PWA.
#
# A single build stage installs and compiles the whole workspace once, because
# the three share most of their dependency tree. The runtime stages then take
# only what each needs.

# --- build ------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" CI=true
RUN corepack enable

# Manifests first: this layer only rebuilds when a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/pricing-engine/package.json packages/pricing-engine/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Drop everything that only the build needed.
RUN pnpm prune --prod

# --- api --------------------------------------------------------------------
FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production

# openssl is required by the Prisma query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

CMD ["node", "apps/api/dist/main.js"]

# --- worker -----------------------------------------------------------------
FROM node:24-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker ./apps/worker

USER node
CMD ["node", "apps/worker/dist/main.js"]

# --- web --------------------------------------------------------------------
# Static files only; Caddy serves them.
FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv/web
COPY infra/Caddyfile /etc/caddy/Caddyfile
