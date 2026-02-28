# Base image with Bun
FROM oven/bun:1.2 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY packages/engine/package.json ./packages/engine/
COPY packages/nodes/package.json ./packages/nodes/
COPY packages/server/package.json ./packages/server/
COPY packages/queue/package.json ./packages/queue/
COPY packages/scaling/package.json ./packages/scaling/
COPY packages/app-server/package.json ./packages/app-server/
COPY packages/app-worker/package.json ./packages/app-worker/
RUN bun install --frozen-lockfile

# Copy source
FROM deps AS build
COPY . .

# Server target
FROM build AS server
EXPOSE 5678
CMD ["bun", "run", "packages/app-server/src/index.ts"]

# Worker target
FROM build AS worker
EXPOSE 5681
CMD ["bun", "run", "packages/app-worker/src/index.ts"]
