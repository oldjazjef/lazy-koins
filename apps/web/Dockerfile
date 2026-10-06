# The web app (apps/web) behind nginx; /api is proxied to the API container.

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22.23.2-alpine AS builder

RUN corepack enable
WORKDIR /app

# The whole workspace: Nx needs the project graph, the app imports libs/ui through path mappings.
COPY . .

# `pnpm install` runs `prisma generate` through the root prepare hook even for a frontend build;
# prisma.config.ts falls back to a placeholder, so no DATABASE_URL is needed.
ENV NX_DAEMON=false
ENV NX_SOCKET_DIR=/tmp/nx

RUN pnpm install --frozen-lockfile
# @angular/build:application writes to dist/apps/web/browser — note the subdirectory.
RUN pnpm nx build web

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

# envsubst, used by entrypoint.sh to put the /api upstream into the nginx config.
RUN apk add --no-cache gettext

COPY --from=builder /app/dist/apps/web/browser /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/index.html || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
