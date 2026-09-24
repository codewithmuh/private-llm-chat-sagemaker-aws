# syntax=docker/dockerfile:1

# The web container: the Next.js app as a standalone Node server on port 3000.
#
# Build it from the REPOSITORY ROOT: the docs pages (/docs) are the Markdown
# files in docs/, and the landing page's model table comes from
# ml/models/catalog.json. Both are read at build time only; the pages are
# static, so nothing from docs/ or ml/ is needed at runtime.
#
#   docker build -f frontend/Dockerfile -t llmchat-web .
#   docker buildx build --platform linux/amd64,linux/arm64 -f frontend/Dockerfile -t llmchat-web .
#
# NEXT_PUBLIC_API_URL is baked into the JavaScript at BUILD time:
#   ""  (default)           same origin: CloudFront/ALB sends /api/* to Django
#   http://localhost:8000   local development (API on its own port)
#   docker build -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 -t llmchat-web .
#
# What gets sent to Docker is limited by the root .dockerignore.

ARG NODE_VERSION=24-alpine

# ---- 1. dependencies (cached until package.json / package-lock.json change)
FROM node:${NODE_VERSION} AS deps
WORKDIR /app/frontend
# Some native Node modules expect glibc symbols; this shim keeps them happy on Alpine.
RUN apk add --no-cache libc6-compat
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. build
# Same layout as the repository, so "../docs" and "../ml/models" resolve from
# /app/frontend exactly as they do from frontend/ on your machine.
FROM node:${NODE_VERSION} AS build
WORKDIR /app/frontend
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/frontend/node_modules ./node_modules
COPY docs/ /app/docs/
COPY ml/models/ /app/ml/models/
COPY frontend/ ./
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
COPY --from=build --chown=node:node /app/frontend/public ./public
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./.next/static

# The official Node images ship an unprivileged "node" user (uid 1000).
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
