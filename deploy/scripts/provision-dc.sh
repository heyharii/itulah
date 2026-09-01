#!/usr/bin/env bash
#
# Enrol the distribution centre into the fleet.
#
# This is the Store script's sibling, and the differences are the whole point
# of having two files rather than one with a flag:
#
#   * the origin is registered with node_role DC, not STORE. Cloud uses that
#     role to decide what a node may claim — a DC asserts despatches and
#     in-transit ownership that a shop has no business asserting.
#   * the tailnet key carries tag:dc, so the headscale policy admits it as a
#     distribution centre rather than as another till.
#   * the DC usually has to be reachable on its own LAN, because the RFID
#     portals and the label printer are separate boxes in the same building.
#     A shop box can stay on loopback; a DC generally cannot. See DC_BIND.
#
# Everything else is identical, deliberately: one origin id, one ingest key,
# shown once, never recoverable.
#
# Run on the control server, as the fleet admin. Prints the DC's .env.

set -euo pipefail

ORIGIN="${1:-}"
LABEL="${2:-$ORIGIN}"
CLOUD_ADMIN_URL="${CLOUD_ADMIN_URL:-http://127.0.0.1:8080}"
HEADSCALE="${HEADSCALE:-headscale}"
HEADSCALE_USER="${HEADSCALE_USER:-1}"

# Where the DC edge listens. The default is loopback, which is correct only
# when the readers and the printer live on the DC box itself. For the ordinary
# case — portals and a Printronix on the warehouse LAN — set this to the box's
# LAN address before running, e.g. DC_BIND=10.20.0.4:8081. Never 0.0.0.0: that
# would also publish the API on any other interface the box acquires later.
DC_BIND="${DC_BIND:-127.0.0.1:8081}"

CLOUD_AUTH_ARGS=()
if [[ -n "${CLOUD_ADMIN_TOKEN:-}" ]]; then
    CLOUD_AUTH_ARGS=(-H "Authorization: Bearer $CLOUD_ADMIN_TOKEN")
fi

if [[ -z "$ORIGIN" ]]; then
    echo "usage: $0 <origin-id> [label]" >&2
    echo "  e.g. $0 dc-01 'Gudang Pusat'" >&2
    echo "  set DC_BIND=<lan-ip>:8081 when readers are not on this box" >&2
    exit 64
fi

if [[ -z "${SYNC_MASTER_KEY:-}" ]]; then
    echo "SYNC_MASTER_KEY is not set (the cloud's SYNC_INGEST_KEY)" >&2
    exit 78
fi

if [[ "$DC_BIND" == 0.0.0.0:* ]]; then
    echo "DC_BIND must name one interface, not 0.0.0.0." >&2
    echo "A DC that binds every interface publishes its API on whatever" >&2
    echo "network the box is plugged into next." >&2
    exit 64
fi

# Fail before issuing anything if the DC is already enrolled: re-running this
# by accident would hand out a second identity for one site, and the facts
# already uploaded under the first would be orphaned.
if curl -fsS "$CLOUD_ADMIN_URL/api/v1/sync/origins" \
        "${CLOUD_AUTH_ARGS[@]}" \
        -H "x-sync-key: $SYNC_MASTER_KEY" | grep -q "\"$ORIGIN\""; then
    echo "origin '$ORIGIN' is already registered." >&2
    echo "To replace its key deliberately, re-register it and update the DC's .env." >&2
    exit 73
fi

# 256 bits as fixed-width hex. Filtering base64 punctuation can silently
# shorten a nominally 32-character value, so it is not used for a credential
# whose minimum length is security-significant.
INGEST_KEY="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
BOOTSTRAP_PASSWORD="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"

echo "==> registering '$ORIGIN' with the cloud as a DC"
curl -fsS -X POST "$CLOUD_ADMIN_URL/api/v1/sync/origins" \
    "${CLOUD_AUTH_ARGS[@]}" \
    -H "x-sync-key: $SYNC_MASTER_KEY" \
    -H 'content-type: application/json' \
    -d "$(printf '{"origin_id":"%s","ingest_key":"%s","label":"%s","site_id":"%s","node_role":"DC","active_generation":1,"inventory_enabled":true}' \
          "$ORIGIN" "$INGEST_KEY" "$LABEL" "$ORIGIN")" >/dev/null
echo "    registered."

echo "==> issuing a single-use tailnet key (tag:dc, 1h)"
AUTHKEY="$("$HEADSCALE" preauthkeys create \
    --user "$HEADSCALE_USER" --tags tag:dc --expiration 1h | tail -1)"

cat <<EOF

================== /etc/itulah/dc.env for ${ORIGIN} ==================
INVENTORY_NODE_ID=${ORIGIN}
INVENTORY_SITE_ID=${ORIGIN}
INVENTORY_ORIGIN_GENERATION=1
INVENTORY_DATABASE_PATH=/var/lib/itulah/dc-edge.sqlite3
BIND_ADDR=${DC_BIND}
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

On the DC box, once:

  tailscale up --login-server=https://hs.itulah.co.id --authkey='${AUTHKEY}' \\
               --hostname='${ORIGIN}'
  install -m600 -o itulah /dev/stdin /etc/itulah/dc.env   # paste the block above
  systemctl enable --now dc-edge

If the readers and printer are on the warehouse LAN, edit the two defines at
the top of deploy/edge/nftables-dc.conf to your reader and printer subnets
before loading it, or the portals will be dropped and the labels will not
print. The rule set is written to fail closed, so a wrong subnet looks like a
dead reader rather than an open box.

Then confirm from the cloud that the DC has arrived:

  curl -s \$CLOUD_ADMIN_URL/api/v1/sync/fleet | jq '.items[] | select(.origin_id=="${ORIGIN}")'

The tailnet and sync credentials plus the break-glass password are shown once.
The tailnet key burns on first use and expires in an hour; the two persistent
secrets exist in plaintext only in the root-readable Edge environment file.

EOF
