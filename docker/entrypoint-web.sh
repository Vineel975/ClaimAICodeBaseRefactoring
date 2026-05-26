#!/bin/sh
set -e

strip_quotes() {
  printf '%s' "$1" | sed "s/^['\"]//;s/['\"]$//"
}

cd /app

# Skip deploy if disabled (Swarm replicas #2..N should set CONVEX_DEPLOY_ON_START=0).
if [ "${CONVEX_DEPLOY_ON_START:-1}" != "1" ]; then
  echo "[entrypoint] CONVEX_DEPLOY_ON_START != 1; starting Next server without deploy."
  exec node server.js
fi

if [ -z "${CONVEX_SELF_HOSTED_ADMIN_KEY:-}" ] || [ -z "${CONVEX_SELF_HOSTED_URL:-}" ]; then
  echo "[entrypoint] CONVEX_SELF_HOSTED_URL / _ADMIN_KEY unset; starting without deploy."
  exec node server.js
fi

export CONVEX_SELF_HOSTED_URL="$(strip_quotes "${CONVEX_SELF_HOSTED_URL}")"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$(strip_quotes "${CONVEX_SELF_HOSTED_ADMIN_KEY}")"
# CLI refuses to run when both self-hosted and cloud deployment pointers are set.
unset CONVEX_DEPLOYMENT

echo "[entrypoint] Waiting for Convex backend at ${CONVEX_SELF_HOSTED_URL}/version ..."
node -e '
const base = (process.env.CONVEX_SELF_HOSTED_URL || "").replace(/\/$/, "");
const url = `${base}/version`;
const deadline = Date.now() + 120_000;
(async () => {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) process.exit(0);
    } catch {}
    await new Promise((res) => setTimeout(res, 2000));
  }
  console.error("Convex backend did not become ready:", url);
  process.exit(1);
})();
'

echo "[entrypoint] Deploying Convex functions (self-hosted)..."
cd /opt/convex-deploy

CONVEX_CLI="node ./node_modules/convex/bin/main.js"

# Mirror selected env vars from the web container into the Convex deployment store
# so Convex function runtime (actions, mutations) can read them via process.env.
sync_env_if_set() {
  name="$1"
  eval "val=\${$name-}"
  if [ -n "$val" ]; then
    $CONVEX_CLI env set "$name" "$(strip_quotes "$val")" || echo "[entrypoint] warning: env set $name failed"
  fi
}

echo "[entrypoint] Syncing Convex deployment env..."
# TODO(user): which of these should be mirrored into Convex on every start?
# These are the vars Convex functions in this repo actually read (grep confirms).
# Decide whether to gate any behind a flag, or add more your deployment needs.
sync_env_if_set OPENROUTER_API_KEY
sync_env_if_set MODEL_NAME
sync_env_if_set MODEL_PROVIDER
sync_env_if_set FILE_TIMEOUT_MS
sync_env_if_set BENEFIT_PLAN_USER_ID
sync_env_if_set MEMBER_DB_SERVER
sync_env_if_set MEMBER_DB_PORT
sync_env_if_set MEMBER_DB_DATABASE
sync_env_if_set MEMBER_DB_USER
sync_env_if_set MEMBER_DB_USERNAME
sync_env_if_set MEMBER_DB_PASSWORD
sync_env_if_set MEMBER_DB_DOMAIN

$CONVEX_CLI deploy --yes --typecheck disable

cd /app
exec node server.js
