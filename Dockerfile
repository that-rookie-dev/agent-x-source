# syntax=docker/dockerfile:1
FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/tui/package.json packages/tui/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ packages/
RUN pnpm run build

# Production
FROM node:20-slim AS production
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=deps /app/packages/cli/node_modules ./packages/cli/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/tui/dist ./packages/tui/dist
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/engine/package.json ./packages/engine/
COPY --from=build /app/packages/tui/package.json ./packages/tui/
COPY --from=build /app/packages/cli/package.json ./packages/cli/
COPY package.json pnpm-workspace.yaml ./
COPY data/ data/

ENV NODE_ENV=production
ENV AGENTX_DATA_DIR=/data

VOLUME ["/data"]

ENTRYPOINT ["node", "packages/cli/dist/index.js"]
