# Web image: the built client served by Caddy, which also terminates HTTPS
# (automatic certificates) and forwards /api to the API. Build from the repository root:
#   docker build -f deploy/web.Dockerfile -t cpm-web .
FROM node:24.22.1-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace client --workspace shared --include-workspace-root=false
COPY shared shared
COPY client client
RUN npm run build -w client

FROM caddy:2.11.6-alpine
COPY deploy/Caddyfile deploy/storage-*.caddy /etc/caddy/
COPY --from=build /app/client/dist /srv
