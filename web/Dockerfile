# Momentum frontend: the built web app, served by nginx on port 8080.
# Build from the repo root, which holds the shared package and the lockfile:
#
#   docker build -f web/Dockerfile -t momentum-frontend .
#
# No secrets. The app calls /api on its own origin; this container's nginx forwards that to the
# backend over the Docker network (API_UPSTREAM, default backend:3001).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared shared
COPY web web
RUN npm run build -w web

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV API_UPSTREAM=backend:3001
# Templates are filled from the environment into conf.d when the container starts.
COPY web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY web/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
