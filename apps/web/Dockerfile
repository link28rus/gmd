# syntax=docker/dockerfile:1.7
# Multi-stage build для Next.js 15 web (standalone output).
# Запускается из корня монорепо: `docker build -f apps/web/Dockerfile .`

FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @gmd/web...

FROM deps AS builder
WORKDIR /repo
COPY apps/web/ apps/web/
# NEXT_STANDALONE=true включает output: 'standalone' в next.config.ts
# (локально не делаем standalone из-за Windows EPERM на symlinks).
ENV NEXT_STANDALONE=true
# NEXT_PUBLIC_* inline'ятся при `next build` — прокидываем через build-arg.
ARG NEXT_PUBLIC_YANDEX_MAPS_API_KEY=
ENV NEXT_PUBLIC_YANDEX_MAPS_API_KEY=$NEXT_PUBLIC_YANDEX_MAPS_API_KEY
RUN pnpm --filter @gmd/web build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache wget
WORKDIR /app

# Next.js standalone output: self-contained server.js + минимальный node_modules
COPY --from=builder /repo/apps/web/.next/standalone/ ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
# public/ появится, когда дизайнер добавит статику; сейчас в репо пусто.

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O- http://localhost:3000/api/healthz || exit 1

CMD ["node", "apps/web/server.js"]
