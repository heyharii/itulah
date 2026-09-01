#!/usr/bin/env bash
#
# Enrol one shop into the fleet.
#
# A shop needs two separate credentials, and conflating them is the mistake
# this script exists to prevent:
#
#   1. a tailnet pre-auth key — proves WHICH MACHINE is calling. Single-use,
#      expires within the hour, carries tag:store from the server so the box
#      cannot promote itself.
#   2. a sync ingest key — proves WHICH SHOP that machine may speak for. The
#      cloud stores only its SHA-256 digest, never the key itself.
#
# The tailnet alone is not enough: without (2), a compromised shop box could
# upload facts claiming to be another shop, still perfectly "inside the VPN".
#
# Run on the control server, as the fleet admin. Prints the shop's .env.

set -euo pipefail

ORIGIN="${1:-}"
LABEL="${2:-$ORIGIN}"
CLOUD_ADMIN_URL="${CLOUD_ADMIN_URL:-http://127.0.0.1:8080}"
HEADSCALE="${HEADSCALE:-headscale}"
HEADSCALE_USER="${HEADSCALE_USER:-1}"
CLOUD_AUTH_ARGS=()
if [[ -n "${CLOUD_ADMIN_TOKEN:-}" ]]; then
    CLOUD_AUTH_ARGS=(-H "Authorization: Bearer $CLOUD_ADMIN_TOKEN")
fi

if [[ -z "$ORIGIN" ]]; then
    echo "usage: $0 <origin-id> [label]" >&2
    echo "  e.g. $0 store-07 'Toko Cabang 07'" >&2
    exit 64
fi

if [[ -z "${SYNC_MASTER_KEY:-}" ]]; then
    echo "SYNC_MASTER_KEY is not set (the cloud's SYNC_INGEST_KEY)" >&2
    exit 78
fi

# Fail before issuing anything if the shop is already enrolled: re-running
# this by accident would hand out a second identity for one shop.
if curl -fsS "$CLOUD_ADMIN_URL/api/v1/sync/origins" \
        "${CLOUD_AUTH_ARGS[@]}" \
        -H "x-sync-key: $SYNC_MASTER_KEY" | grep -q "\"$ORIGIN\""; then
    echo "origin '$ORIGIN' is already registered." >&2
    echo "To replace its key deliberately, re-register it and update the shop's .env." >&2
    exit 73
fi

# Generated here and shown once. It is never stored in plaintext anywhere on
# the cloud side, so if it is lost the shop is re-registered rather than
# recovered.
# 256 bits encoded as fixed-width hex. Filtering base64 punctuation can make
# a nominally 32-character value shorter, so do not use a filtered base64
# pipeline for credentials whose minimum length is security-significant.
INGEST_KEY="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
BOOTSTRAP_PASSWORD="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"

echo "==> registering '$ORIGIN' with the cloud"
curl -fsS -X POST "$CLOUD_ADMIN_URL/api/v1/sync/origins" \
    "${CLOUD_AUTH_ARGS[@]}" \
    -H "x-sync-key: $SYNC_MASTER_KEY" \
    -H 'content-type: application/json' \
    -d "$(printf '{"origin_id":"%s","ingest_key":"%s","label":"%s","site_id":"%s","node_role":"STORE","active_generation":1,"inventory_enabled":true}' \
          "$ORIGIN" "$INGEST_KEY" "$LABEL" "$ORIGIN")" >/dev/null
echo "    registered."

echo "==> issuing a single-use tailnet key (tag:store, 1h)"
AUTHKEY="$("$HEADSCALE" preauthkeys create \
    --user "$HEADSCALE_USER" --tags tag:store --expiration 1h | tail -1)"

cat <<EOF

================= /etc/itulah/store.env for ${ORIGIN} =================
INVENTORY_NODE_ID=${ORIGIN}
INVENTORY_SITE_ID=${ORIGIN}
INVENTORY_ORIGIN_GENERATION=1
INVENTORY_DATABASE_PATH=/var/lib/itulah/store-edge.sqlite3
BIND_ADDR=127.0.0.1:8082
INVENTORY_AUTH_MODE=required
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=${BOOTSTRAP_PASSWORD}
INVENTORY_AUTH_TOKEN_TTL_MINUTES=720
INVENTORY_AUTH_SESSION_IDLE_MINUTES=30
INVENTORY_AUTH_COOKIE_SECURE=false
SYNC_UPLOAD_URL=http://cloud.itulah.internal:8080
SYNC_UPLOAD_KEY=${INGEST_KEY}
SYNC_INTERVAL_SECONDS=5
SYNC_BATCH_LIMIT=100
SYNC_RETENTION_DAYS=14
RUST_LOG=inventory_backend=info
=======================================================================

On the shop box, once:

  tailscale up --login-server=https://hs.itulah.co.id --authkey='${AUTHKEY}' \\
               --hostname='${ORIGIN}'
  install -m600 -o itulah /dev/stdin /etc/itulah/store.env   # paste the block above
  systemctl enable --now store-edge

Then confirm from the cloud that the shop has arrived:

  curl -s \$CLOUD_ADMIN_URL/api/v1/sync/fleet | jq '.items[] | select(.origin_id=="${ORIGIN}")'

The tailnet and sync credentials plus the break-glass password are shown once.
The tailnet key burns on first use and expires in an hour; the two persistent
secrets exist in plaintext only in the root-readable Edge environment file.

EOF
