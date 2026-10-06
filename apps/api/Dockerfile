# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Pinned to the exact Volta version in the root package.json — one answer to "which Node".
FROM node:22.23.2-alpine AS builder

# better-sqlite3 downloads a prebuilt binary for musl; the toolchain is the fallback when none
# matches, so the build does not break on a new Node or architecture.
RUN corepack enable && apk add --no-cache python3 make g++

WORKDIR /app

# The whole workspace: Nx resolves targets through the project graph, and a partial copy fails
# with "Cannot find configuration for task api:build". .dockerignore keeps the context small.
COPY . .

ENV NX_DAEMON=false
# Nx plugin workers use unix sockets whose paths include node_modules/.pnpm; /tmp keeps them short.
ENV NX_SOCKET_DIR=/tmp/nx

RUN pnpm install --frozen-lockfile

# dist/apps/api: the webpack bundle plus a generated package.json and pruned lockfile, completed by
# scripts/build/complete-api-package-json.mjs with what webpack cannot see (@prisma/client, prisma).
RUN pnpm nx build api

# Install the runtime dependencies OUTSIDE the workspace, or pnpm walks up to /app's root.
RUN mkdir /deploy && cp -r /app/dist/apps/api/. /deploy/ \
 && cp -r /app/apps/api/prisma /deploy/prisma \
 && cp /app/apps/api/prisma.config.ts /deploy/prisma.config.ts \
 && mkdir -p /deploy/src/persistence/prisma \
 && cp /app/apps/api/src/persistence/prisma/sqlite-url.ts /deploy/src/persistence/prisma/

WORKDIR /deploy

# Not `--frozen-lockfile`: the pruned lockfile predates the entries complete-api-package-json.mjs
# adds, which are therefore pinned to exact versions. better-sqlite3 needs its install script (the
# native binary); the prisma CLI needs its postinstall (schema engine) for `migrate deploy` at
# container start; the `false` entries are declined explicitly because pnpm fails when a build
# script is merely ignored.
RUN printf 'allowBuilds:\n  better-sqlite3: true\n  prisma: true\n  "@prisma/engines": true\n  "@nestjs/core": false\n  "@scarf/scarf": false\n  "@firebase/util": false\n  protobufjs: false\n' > pnpm-workspace.yaml \
  && pnpm install --prod \
  && rm pnpm-workspace.yaml

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22.23.2-alpine AS production

# better-sqlite3's native binary links against libstdc++, which alpine's node image lacks. The
# sqlite3 CLI is for consistent backups from inside the container:
#   docker exec <api> sqlite3 /data/lazykoins.db ".backup /data/backup.db"
RUN apk add --no-cache libstdc++ sqlite

WORKDIR /app
COPY --from=builder /deploy ./

ENV NODE_ENV=production
# The SQLite database lives on a volume: mount one at /data, or every redeploy starts empty.
# Run ONE replica — SQLite has a single writer, and two containers must never share the file.
ENV DATABASE_URL=file:/data/lazykoins.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3333
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3333/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending migrations, then start. `migrate deploy` never resets or drops, and on a current
# database is a no-op. A container that
# cannot bring the schema up to date must not serve — hence `&&`.
CMD ["sh", "-c", "npx prisma migrate deploy && node main.js"]
