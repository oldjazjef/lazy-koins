#!/bin/sh
# Runtime configuration, written at container start, so ONE image serves every environment:
#   1. /env.js from the LK_* variables (incl. the optional Umami statistics) (read by core/config/runtime-env.ts before the app boots);
#   2. nginx's /api upstream from LK_API_UPSTREAM.
# `set -e`: a container with a half-written config must refuse to start rather than serve it.
set -e

ENV_JS=/usr/share/nginx/html/env.js

: "${LK_API_UPSTREAM:?LK_API_UPSTREAM is required (e.g. http://lazykoins-api:3333)}"
LK_AUTH_MODE="${LK_AUTH_MODE:-firebase}"

# Values end up inside JS string literals; strip the two characters that could break out of one.
clean() { printf '%s' "$1" | tr -d '"\\'; }

cat > "$ENV_JS" <<JS
// Generated at container start by entrypoint.sh. Do not edit — overwritten on every boot.
window.__LK_ENV__ = {
  apiBaseUrl: "$(clean "${LK_API_BASE_URL:-}")",
  authMode: "$(clean "$LK_AUTH_MODE")",
  firebase: {
    apiKey: "$(clean "${LK_FIREBASE_API_KEY:-}")",
    authDomain: "$(clean "${LK_FIREBASE_AUTH_DOMAIN:-}")",
    projectId: "$(clean "${LK_FIREBASE_PROJECT_ID:-}")",
    appId: "$(clean "${LK_FIREBASE_APP_ID:-}")",
  },
  umamiUrl: "$(clean "${LK_UMAMI_URL:-}")",
  umamiWebsiteId: "$(clean "${LK_UMAMI_WEBSITE_ID:-}")",
};
JS

# Explicit variable list: nginx configs are full of $host, $uri, … which must survive.
export API_UPSTREAM="$LK_API_UPSTREAM"
envsubst '${API_UPSTREAM}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

echo "entrypoint: authMode=${LK_AUTH_MODE}, /api -> ${LK_API_UPSTREAM}"
exec "$@"
