# syntax=docker/dockerfile:1.7
# Production image: the Fastify API serving the built web app on one origin.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/contracts/package.json packages/contracts/
# Only the API's runtime dependencies; workspace packages are already bundled into dist.
RUN pnpm install --frozen-lockfile --prod --filter @pump/api && pnpm store prune
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
ENV HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist
USER node
EXPOSE 3000
# Migrations run at every start, before the server: they skip what's already applied and hold
# an advisory lock, so this is safe on hosts without a separate pre-deploy step (such as
# Render's free instances) and when two instances start at once. `exec` hands PID 1 to Node so
# it receives SIGTERM and shuts down cleanly.
CMD ["sh", "-c", "node apps/api/dist/migrate.js && exec node apps/api/dist/server.js"]
