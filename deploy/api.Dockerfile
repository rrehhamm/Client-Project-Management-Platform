# API image (Node 24). Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t cpm-api .
# On start it applies pending migrations, makes sure the storage bucket exists,
# then starts the API (see docker-compose.prod.yml).
FROM node:24.22.1-alpine3.24

WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests first, so dependency layers are cached between code changes.
# (client/package.json is needed because the lockfile lists every workspace.)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# postinstall runs prisma generate, which needs the schema
COPY server/prisma server/prisma
COPY server/prisma.config.js server/
RUN npm ci --workspace server --workspace shared --include-workspace-root=false --include=dev \
  && npm cache clean --force

COPY shared shared
COPY server server

USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node scripts/init-storage.js && exec node src/server.js"]
