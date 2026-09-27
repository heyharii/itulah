#!/usr/bin/env bash
#
# pilot-laptop-edges — run a DC edge and a Store edge on this Mac, always
# syncing to the pilot Cloud over the Headscale tailnet.
#
#   scripts/pilot-laptop-edges.sh            # register origins (once) + install services
#   scripts/pilot-laptop-edges.sh status     # tailnet + edges + sync status
#   scripts/pilot-laptop-edges.sh restart    # restart both edges
#   scripts/pilot-laptop-edges.sh uninstall  # stop and remove the launchd services
#
# Both edges run as launchd agents (RunAtLoad + KeepAlive): they come back after
# a crash, a logout or a reboot, and after sleep they simply resume — the sender
# retries every SYNC_INTERVAL_SECONDS, so the outbox drains on its own once the
# tailnet is back. Facts written while offline wait in the local SQLite.
#
# First install needs, from the operator (never stored by this script):
#   - a Cloud ADMIN username + password (prompted), and
#   - the Cloud master key SYNC_INGEST_KEY (prompted, or SYNC_MASTER_KEY env).
# Each edge gets its own random per-origin key; the master key never lands here.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLOUD_URL="${CLOUD_URL:-http://100.64.0.1:8080}"
DC_ORIGIN="${DC_ORIGIN:-dc-01}"
STORE_ORIGIN="${STORE_ORIGIN:-store-07}"
DC_PORT="${DC_PORT:-8081}"
STORE_PORT="${STORE_PORT:-8082}"
home_dir="$HOME/.itulah/pilot"
agents="$HOME/Library/LaunchAgents"
ts=/Applications/Tailscale.app/Contents/MacOS/Tailscale

die() { printf 'pilot: %s\n' "$*" >&2; exit 1; }
label() { echo "id.itulah.pilot.$1"; }

status() {
    echo "── tailnet"; "$ts" status 2>&1 | head -4
    printf '   cloud health: '; curl -s -m5 "$CLOUD_URL/api/v1/health" | grep -o '"status":"[a-z]*"' || echo unreachable
    for role in dc store; do
        port=$DC_PORT; [[ $role == store ]] && port=$STORE_PORT
        echo "── $role edge (127.0.0.1:$port)"
        launchctl print "gui/$(id -u)/$(label $role)" 2>/dev/null | grep -E '^\s+(state|pid) =' || echo "   not loaded"
        curl -s -m5 "http://127.0.0.1:$port/api/v1/sync/status" | head -c 400; echo
    done
}

case "${1:-install}" in
    status) status; exit 0 ;;
    restart)
        for role in dc store; do launchctl kickstart -k "gui/$(id -u)/$(label $role)"; done
        sleep 3; status; exit 0 ;;
    uninstall)
        for role in dc store; do
            launchctl bootout "gui/$(id -u)/$(label $role)" 2>/dev/null || true
            rm -f "$agents/$(label $role).plist"
        done
        echo "services removed; data kept in $home_dir"; exit 0 ;;
    install) ;;
    *) die "unknown command '$1'" ;;
esac

# ── 1. tailnet ────────────────────────────────────────────────────────────────
"$ts" status >/dev/null 2>&1 || die "Tailscale is not connected to Headscale — open Tailscale.app first"
curl -fsS -m8 "$CLOUD_URL/api/v1/health" >/dev/null || die "Cloud $CLOUD_URL is not reachable over the tailnet"
# Tailscale.app starts itself at login and reconnects after wake.
defaults write io.tailscale.ipn.macsys TailscaleStartOnLogin -bool true 2>/dev/null || true

# ── 2. binaries (copied, so a rebuild in the repo never swaps them mid-demo) ──
mkdir -p "$home_dir/bin" "$home_dir/logs" "$agents"
chmod 700 "$home_dir"
for bin in dc store; do
    src="$root/backend/target/release/$bin"
    [[ -x "$src" ]] || src="$root/backend/target/debug/$bin"
    [[ -x "$src" ]] || die "no $bin binary — run: cd backend && cargo build --release --bin dc --bin store"
    cp "$src" "$home_dir/bin/$bin"
done

# ── 3. register origins (only those without an env file yet) ─────────────────
need_register=()
for role in dc store; do [[ -f "$home_dir/$role.env" ]] || need_register+=("$role"); done

if (( ${#need_register[@]} )); then
    read -r -p "Cloud ADMIN username: " admin_user
    read -r -s -p "Cloud ADMIN password: " admin_pass; echo
    if [[ -z "${SYNC_MASTER_KEY:-}" ]]; then read -r -s -p "Cloud SYNC_INGEST_KEY (master): " SYNC_MASTER_KEY; echo; fi
    body=$(ADMIN_USER="$admin_user" ADMIN_PASS="$admin_pass" python3 -c \
        'import json,os;print(json.dumps({"username":os.environ["ADMIN_USER"],"password":os.environ["ADMIN_PASS"]}))')
    token=$(curl -fsS -m10 -X POST "$CLOUD_URL/api/v1/auth/login" -H 'content-type: application/json' -d "$body" \
        | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])') || die "login failed"
    unset admin_pass body
    auth=(-H "Authorization: Bearer $token" -H "x-sync-key: $SYNC_MASTER_KEY")
    existing=$(curl -fsS -m10 "$CLOUD_URL/api/v1/sync/origins" "${auth[@]}") || die "cannot list origins"

    for role in "${need_register[@]}"; do
        origin=$DC_ORIGIN; node_role=DC; port=$DC_PORT
        [[ $role == store ]] && { origin=$STORE_ORIGIN; node_role=STORE; port=$STORE_PORT; }
        if grep -q "\"$origin\"" <<<"$existing" && [[ "${FORCE:-0}" != 1 ]]; then
            die "origin '$origin' already exists in Cloud. Re-running replaces its key (the old machine stops syncing). Use FORCE=1 to do that, or pick another id: $(echo $role | tr a-z A-Z)_ORIGIN=<id>"
        fi
        key="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
        bootstrap="$(od -An -N12 -tx1 /dev/urandom | tr -d '[:space:]')"
        curl -fsS -m10 -X POST "$CLOUD_URL/api/v1/sync/origins" "${auth[@]}" -H 'content-type: application/json' \
            -d "{\"origin_id\":\"$origin\",\"ingest_key\":\"$key\",\"label\":\"$origin (laptop)\",\"site_id\":\"$origin\",\"node_role\":\"$node_role\",\"active_generation\":1,\"inventory_enabled\":true}" \
            >/dev/null || die "registering $origin failed"
        umask 077
        cat >"$home_dir/$role.env" <<EOF
INVENTORY_NODE_ID=$origin
INVENTORY_SITE_ID=$origin
INVENTORY_ORIGIN_GENERATION=1
INVENTORY_DATABASE_PATH=$home_dir/$role-edge.sqlite3
BIND_ADDR=127.0.0.1:$port
INVENTORY_AUTH_MODE=required
INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=$bootstrap
INVENTORY_AUTH_TOKEN_TTL_MINUTES=720
INVENTORY_AUTH_SESSION_IDLE_MINUTES=30
INVENTORY_AUTH_COOKIE_SECURE=false
SYNC_UPLOAD_URL=$CLOUD_URL
SYNC_UPLOAD_KEY=$key
SYNC_INTERVAL_SECONDS=5
SYNC_BATCH_LIMIT=100
SYNC_RETENTION_DAYS=14
RUST_LOG=inventory_backend=info
EOF
        echo "registered $origin ($node_role); local break-glass admin password in $home_dir/$role.env"
    done
    unset SYNC_MASTER_KEY token
fi

# ── 4. launchd agents ─────────────────────────────────────────────────────────
for role in dc store; do
    lbl=$(label "$role")
    plist="$agents/$lbl.plist"
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$lbl</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>-c</string>
    <string>set -a; . "$home_dir/$role.env"; set +a; exec "$home_dir/bin/$role"</string>
  </array>
  <key>WorkingDirectory</key><string>$home_dir</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$home_dir/logs/$role.log</string>
  <key>StandardErrorPath</key><string>$home_dir/logs/$role.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$lbl" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
done

sleep 4
status
