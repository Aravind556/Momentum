# Momentum backend: the API only (the web app is its own container, see web/Dockerfile).
# Build from the repo root, which holds the shared package and the lockfile:
#
#   docker build -f server/Dockerfile -t momentum-backend .
#
# Configuration (DATABASE_URL, BETTER_AUTH_SECRET, VAPID keys, …) comes from the environment at
# run time; nothing secret is baked into the image.

ARG NODE_VERSION=22

# ---- 1. Build: bundle the server (the shared package is bundled in) -------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
RUN npm run build -w server

# ---- 2. Production dependencies of the server only ------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force

# ---- 3. Runtime ------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/package.json ./server/
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/drizzle ./server/drizzle
USER node
WORKDIR /app/server
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run on start, then the server listens on $PORT.
CMD ["node", "dist/index.js"]
