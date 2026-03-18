FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder
WORKDIR /app

RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# Copy all workspace packages and apps
COPY packages/ packages/
COPY apps/gateway/ apps/gateway/
COPY apps/control-ui/ apps/control-ui/

# Install all dependencies
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# 1) Build shared package
RUN pnpm --filter @9lives/shared build

# 2) Build gateway
RUN pnpm --filter @9lives/gateway build

# 3) Build control-ui (Vite)
RUN pnpm --filter @9lives/control-ui build

# ---- Production image ----
FROM --platform=$TARGETPLATFORM node:22-bookworm-slim
WORKDIR /app

RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    cups-client \
    chromium \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/gateway/package.json apps/gateway/

RUN pnpm install --prod --no-frozen-lockfile --ignore-scripts

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/gateway/dist apps/gateway/dist

# Copy UI dist to a fixed location inside the container
COPY --from=builder /app/apps/control-ui/dist /app/ui-dist

# Copy migration SQL and bootstrap
COPY apps/gateway/src/storage/pg/migrations/ apps/gateway/dist/storage/pg/migrations/
COPY apps/gateway/bootstrap/ bootstrap/

EXPOSE 18789

USER root

CMD ["node", "apps/gateway/dist/index.js"]

