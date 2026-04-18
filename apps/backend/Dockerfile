# syntax=docker/dockerfile:1.7
# Multi-stage build для NestJS backend.
# Запускается из корня монорепо: `docker build -f apps/backend/Dockerfile .`

FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json ./
COPY apps/backend/package.json apps/backend/
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @gmd/backend...

FROM deps AS builder
WORKDIR /repo
COPY apps/backend/ apps/backend/
RUN pnpm --filter @gmd/backend prisma generate
RUN pnpm --filter @gmd/backend build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache wget
WORKDIR /app

COPY --from=builder /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/turbo.json ./
COPY --from=builder /repo/apps/backend/package.json apps/backend/package.json
COPY --from=builder /repo/apps/backend/dist apps/backend/dist
COPY --from=builder /repo/apps/backend/prisma apps/backend/prisma
COPY --from=builder /repo/apps/backend/node_modules apps/backend/node_modules
COPY --from=builder /repo/node_modules node_modules

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O- http://localhost:3001/healthz || exit 1

CMD ["node", "apps/backend/dist/main.js"]
