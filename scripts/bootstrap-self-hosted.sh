#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE_FILE="$ROOT_DIR/.env.example"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

escape_env_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

get_env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 1
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$line" ] || return 1
  line="${line#*=}"
  line="${line#\"}"
  line="${line%\"}"
  printf '%s' "$line"
}

upsert_env() {
  local key="$1"
  local value="$2"
  local escaped
  local temp_file

  escaped="$(escape_env_value "$value")"
  temp_file="$(mktemp)"

  if [ -f "$ENV_FILE" ]; then
    awk -v key="$key" -v value="$escaped" '
      BEGIN { found = 0 }
      index($0, key "=") == 1 {
        print key "=\"" value "\""
        found = 1
        next
      }
      { print }
      END {
        if (!found) { print key "=\"" value "\"" }
      }
    ' "$ENV_FILE" >"$temp_file"
  else
    printf '%s="%s"\n' "$key" "$escaped" >"$temp_file"
  fi

  mv "$temp_file" "$ENV_FILE"
}

wait_for_backend() {
  local url="$1"
  local deadline=$((SECONDS + 120))
  echo "Waiting for Convex backend at ${url}/version ..."
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS "${url}/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Convex backend did not become ready in time." >&2
  exit 1
}

extract_admin_key() {
  docker compose exec -T backend sh -lc './generate_admin_key.sh' \
    | awk '/^convex-self-hosted\|/ { print; exit }'
}

require_command docker
require_command curl
require_command awk

# ── Parse flags ─────────────────────────────────────────────────────
USE_PROXY=false
for arg in "$@"; do
  case "$arg" in
    --proxy) USE_PROXY=true ;;
  esac
done

cd "$ROOT_DIR"

if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE_FILE" ]; then
  cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  echo "Created .env from .env.example"
fi

# ── Baseline defaults ───────────────────────────────────────────────
upsert_env CONVEX_DEPLOY_ON_START "$(get_env_value CONVEX_DEPLOY_ON_START || printf '%s' '1')"
upsert_env NEXT_IMAGE "$(get_env_value NEXT_IMAGE || printf '%s' 'claim-processing-local')"
upsert_env WEB_REPLICAS "$(get_env_value WEB_REPLICAS || printf '%s' '1')"

# Host-port scheme — offset so this stack coexists with ai-analytics on the same VM.
upsert_env WEB_PORT "$(get_env_value WEB_PORT || printf '%s' '3100')"
upsert_env CONVEX_BACKEND_PORT "$(get_env_value CONVEX_BACKEND_PORT || printf '%s' '3310')"
upsert_env CONVEX_SITE_PORT "$(get_env_value CONVEX_SITE_PORT || printf '%s' '3311')"
upsert_env DASHBOARD_PORT "$(get_env_value DASHBOARD_PORT || printf '%s' '6792')"
upsert_env CONVEX_POSTGRES_PORT "$(get_env_value CONVEX_POSTGRES_PORT || printf '%s' '6544')"

# CONVEX_DEPLOYMENT (cloud dev pointer) must be absent in self-hosted mode;
# the entrypoint unsets it at runtime, but we also strip it from .env for clarity.
if [ -n "$(get_env_value CONVEX_DEPLOYMENT || true)" ]; then
  sed -i.bak '/^CONVEX_DEPLOYMENT=/d' "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  echo "Removed CONVEX_DEPLOYMENT from .env (conflicts with self-hosted mode)"
fi

if [ "$USE_PROXY" = true ]; then
  # ── Proxy / HTTPS mode ────────────────────────────────────────────
  APP_DOMAIN="$(get_env_value APP_DOMAIN || printf '%s' 'claims.example.com')"
  CONVEX_DOMAIN="$(get_env_value CONVEX_DOMAIN || printf '%s' 'convex.claims.example.com')"
  CONVEX_SITE_DOMAIN="$(get_env_value CONVEX_SITE_DOMAIN || printf '%s' 'site.claims.example.com')"

  upsert_env APP_DOMAIN "$APP_DOMAIN"
  upsert_env CONVEX_DOMAIN "$CONVEX_DOMAIN"
  upsert_env CONVEX_SITE_DOMAIN "$CONVEX_SITE_DOMAIN"

  # Public HTTPS URLs baked into the browser bundle at build time.
  upsert_env NEXT_PUBLIC_CONVEX_URL "$(get_env_value NEXT_PUBLIC_CONVEX_URL || printf '%s' "https://${CONVEX_DOMAIN}")"
  upsert_env NEXT_PUBLIC_CONVEX_SITE_URL "$(get_env_value NEXT_PUBLIC_CONVEX_SITE_URL || printf '%s' "https://${CONVEX_SITE_DOMAIN}")"

  # Backend must advertise its public HTTPS origin or WebSockets break.
  upsert_env CONVEX_CLOUD_ORIGIN "$(get_env_value CONVEX_CLOUD_ORIGIN || printf '%s' "https://${CONVEX_DOMAIN}")"
  upsert_env CONVEX_SITE_ORIGIN "$(get_env_value CONVEX_SITE_ORIGIN || printf '%s' "https://${CONVEX_SITE_DOMAIN}")"

  # Bootstrap script still runs on host, so admin-key extraction uses localhost.
  upsert_env CONVEX_SELF_HOSTED_URL "$(get_env_value CONVEX_SELF_HOSTED_URL || printf '%s' 'http://backend:3210')"

  echo "Proxy mode enabled — HTTPS domains:"
  echo "  App:    https://${APP_DOMAIN}"
  echo "  Convex: https://${CONVEX_DOMAIN}"
  echo "  Site:   https://${CONVEX_SITE_DOMAIN}"
else
  # ── Local / no-proxy mode ─────────────────────────────────────────
  upsert_env NEXT_PUBLIC_CONVEX_URL "$(get_env_value NEXT_PUBLIC_CONVEX_URL || printf '%s' 'http://127.0.0.1:3310')"
  upsert_env NEXT_PUBLIC_CONVEX_SITE_URL "$(get_env_value NEXT_PUBLIC_CONVEX_SITE_URL || printf '%s' 'http://127.0.0.1:3311')"
  upsert_env CONVEX_CLOUD_ORIGIN "$(get_env_value CONVEX_CLOUD_ORIGIN || printf '%s' 'http://127.0.0.1:3310')"
  upsert_env CONVEX_SITE_ORIGIN "$(get_env_value CONVEX_SITE_ORIGIN || printf '%s' 'http://127.0.0.1:3311')"
  upsert_env CONVEX_SELF_HOSTED_URL "$(get_env_value CONVEX_SELF_HOSTED_URL || printf '%s' 'http://backend:3210')"
fi

# ── Pre-flight: shared proxy network must exist before app services up ─
if [ "$USE_PROXY" = true ] && ! docker network inspect edge >/dev/null 2>&1; then
  echo "ERROR: docker network 'edge' not found." >&2
  echo "  Start the shared proxy first:" >&2
  echo "    (cd ../ai-ana-proxy && docker compose up -d)" >&2
  exit 1
fi

# ── Bring up infra + backend, extract admin key ─────────────────────
docker compose up -d postgres backend dashboard
BACKEND_PORT="$(get_env_value CONVEX_BACKEND_PORT)"
wait_for_backend "http://127.0.0.1:${BACKEND_PORT}"

if [ -z "$(get_env_value CONVEX_SELF_HOSTED_ADMIN_KEY || true)" ]; then
  admin_key="$(extract_admin_key)"
  if [ -z "$admin_key" ]; then
    echo "Failed to generate Convex self-hosted admin key." >&2
    exit 1
  fi
  upsert_env CONVEX_SELF_HOSTED_ADMIN_KEY "$admin_key"
  echo "Stored CONVEX_SELF_HOSTED_ADMIN_KEY in .env"
fi

# ── Build / pull web image, start it ────────────────────────────────
NEXT_IMAGE="$(get_env_value NEXT_IMAGE)"
if [ "$NEXT_IMAGE" = "claim-processing-local" ]; then
  docker compose up -d --build web
else
  docker compose pull web
  docker compose up -d web
fi

echo
if [ "$USE_PROXY" = true ]; then
  echo "Self-hosted stack is up (proxy mode — TLS terminates at ai-ana-proxy)."
  echo "App:       https://$(get_env_value APP_DOMAIN)"
  echo "Convex:    https://$(get_env_value CONVEX_DOMAIN)"
  echo "Site:      https://$(get_env_value CONVEX_SITE_DOMAIN)"
  echo "Dashboard: http://127.0.0.1:$(get_env_value DASHBOARD_PORT)"
else
  echo "Self-hosted stack is up."
  echo "App:       http://127.0.0.1:$(get_env_value WEB_PORT)"
  echo "Convex:    http://127.0.0.1:$(get_env_value CONVEX_BACKEND_PORT)"
  echo "Dashboard: http://127.0.0.1:$(get_env_value DASHBOARD_PORT)"
fi
echo
echo "Make sure .env also has: OPENROUTER_API_KEY and MEMBER_DB_* for patient validation."
