# syntax=docker/dockerfile:1

# The web container: the Next.js app as a standalone Node server on port 3000.
#
#   docker build -t llmchat-web frontend
#   docker buildx build --platform linux/amd64,linux/arm64 -t llmchat-web frontend
#
# NEXT_PUBLIC_API_URL is baked into the JavaScript at BUILD time:
#   ""  (default)           same origin: CloudFront/ALB sends /api/* to Django
#   http://localhost:8000   local development (API on its own port)
#   docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 -t llmchat-web frontend

ARG NODE_VERSION=24-alpine

# ---- 1. dependencies (cached until package.json / package-lock.json change)
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Some native Node modules expect glibc symbols; this shim keeps them happy on Alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. build
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. runtime: only the standalone server and static files
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# `.next/standalone` contains server.js plus the few node_modules it needs.
# Static assets and public/ are not included in it, so copy them next to it.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# The official Node images ship an unprivileged "node" user (uid 1000).
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
