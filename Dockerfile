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
CMD ["node", "apps/api/dist/server.js"]
