#!/usr/bin/env bash
#
# rig — disposable run environments for simulation and demo.
#
# One run = one Postgres database cloned from the golden template + one
# directory holding the edges' SQLite files and logs + three node processes
# recorded in a pid file. Nothing outside `runs/<id>/` and `sim_rig_*` /
# `sim_golden` databases is ever touched:
#
#   - databases are dropped only when the name matches `sim_rig_*` or is the
#     `sim_golden` template this script itself created;
#   - processes are stopped only by the PIDs this script wrote to
#     `runs/<id>/pids` — never a name-based pkill;
#   - a non-local Postgres host is refused unless `SIM_ALLOW_REMOTE=1`, and
#     hosts in `SIM_DENY_HOSTS` (default: onrender.com) are always refused.
#
# Usage:
#   scripts/rig.sh new <run-id>     # provision DBs, start cloud + dc + store
#   scripts/rig.sh up <run-id>      # relaunch on existing data (after reboot)
#   scripts/rig.sh reset <run-id>   # stop, wipe, relaunch from the template
#   scripts/rig.sh down <run-id> [--keep]   # stop and destroy (keep artifacts)
#   scripts/rig.sh ps               # list runs and whether nodes are alive
#
# Configuration (read at `new` time, then frozen into runs/<id>/env):
#   RIG_PG_ADMIN_URL     admin Postgres URL; its dbname is swapped per run
#                        (default: postgresql:///postgres)
#   RIG_SYNC_KEY         sync ingest/upload key, >= 32 chars
#   RIG_CLOCK            system | controlled | scaled  (default: scaled)
#   RIG_FACTOR           ScaledClock factor            (default: 876 = 1 yr/10 h)
#   RIG_VIRTUAL_START    virtual anchor, RFC 3339      (default: 1 Jan, 00:00 +07)
#   RIG_AUTH_MODE        disabled | required           (default: disabled)
#   RIG_ADMIN_PASSWORD   bootstrap admin password when auth is required
#   RIG_PORT_CLOUD/DC/STORE  listener ports (defaults 8180 / 8182 / 8181)
#
# The virtual clock re-anchors at every launch: a run always wakes up on its
# virtual New Year, and `reset` starts the year over.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runs_dir="$root/runs"
bin_dir="$root/backend/target/debug"

pg_admin_url="${RIG_PG_ADMIN_URL:-postgresql:///postgres}"
sync_key="${RIG_SYNC_KEY:-rig-sync-key-local-0123456789abcdef}"
auth_mode="${RIG_AUTH_MODE:-disabled}"
clock_mode="${RIG_CLOCK:-scaled}"
clock_factor="${RIG_FACTOR:-876}"
virtual_start="${RIG_VIRTUAL_START:-$(date +%Y)-01-01T00:00:00+07:00}"
port_cloud="${RIG_PORT_CLOUD:-8180}"
port_dc="${RIG_PORT_DC:-8182}"
port_store="${RIG_PORT_STORE:-8181}"
# Where the two edges listen. Loopback by default; 0.0.0.0 lets a handheld or a
# till on the LAN reach them (demo only — the rig runs with auth disabled).
edge_host="${RIG_EDGE_HOST:-127.0.0.1}"
golden_db="sim_golden"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
die()  { printf 'rig: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

validate_run_id() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || die "run id '$1' must match [a-z0-9][a-z0-9-]{0,39}"
}

# ── guardrails ────────────────────────────────────────────────────────────────

# The only database names this script will ever create or drop.
assert_owned_db() {
  case "$1" in
    sim_rig_* | sim_golden) ;;
    *) die "refusing to touch database '$1': not a rig database (sim_rig_* / sim_golden)" ;;
  esac
}

assert_local_postgres() {
  local host deny
  host=$(printf '%s' "$pg_admin_url" \
    | sed -E 's#^[a-z+]+://##; s#^[^@/]*@##; s#/.*$##; s#:[0-9]+$##')
  if [[ -n "$host" && "$host" != "localhost" && "$host" != "127.0.0.1" && "$host" != "::1" ]]; then
    [[ "${SIM_ALLOW_REMOTE:-0}" == "1" ]] || \
      die "Postgres host '$host' is not local; set SIM_ALLOW_REMOTE=1 to override"
  fi
  for deny in ${SIM_DENY_HOSTS:-onrender.com}; do
    [[ "$host" != *"$deny"* ]] || die "Postgres host '$host' matches SIM_DENY_HOSTS pattern '$deny'"
  done
}

psql_admin() { psql "$pg_admin_url" -v ON_ERROR_STOP=1 -qAt -c "$1"; }

db_exists() { [[ "$(psql_admin "SELECT 1 FROM pg_database WHERE datname='$1'")" == "1" ]]; }

drop_db() {
  assert_owned_db "$1"
  if db_exists "$1"; then psql_admin "DROP DATABASE \"$1\"" >/dev/null; fi
}

# Swap the dbname (last path segment) of the admin URL. Safe because every
# caller passes a rig-validated name (sim_rig_<id> / sim_golden).
url_for_db() {
  local db="$1"
  printf '%s' "$pg_admin_url" | sed -E "s#/[^/?]+(\\?.*)?\$#/$db#"
}

# ── process handling ──────────────────────────────────────────────────────────

stop_run() {
  local run_dir="$1" entry name pid
  [[ -f "$run_dir/pids" ]] || return 0
  while IFS='=' read -r name pid; do
    [[ -n "$pid" ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -9 "$pid" 2>/dev/null || true
    fi
  done < "$run_dir/pids"
  rm -f "$run_dir/pids"
}

wait_http() {  # wait_http <name> <url> <pid>
  local name="$1" url="$2" pid="$3" i
  # Any HTTP answer proves the node is up — auth may legitimately reply 401/403.
  for i in $(seq 1 60); do
    curl -s --max-time 2 -o /dev/null "$url" && return 0
    kill -0 "$pid" 2>/dev/null || die "$name exited before answering $url (see runs/*/logs)"
    sleep 1
  done
  die "$name did not answer $url within 60 s"
}

# ── golden template ───────────────────────────────────────────────────────────
# The template carries the migrations and the two sync origins, so every run
# boots with sync ready and zero business data. Rebuilt when missing or when
# the sync key changed.

ensure_golden() {
  local marker="$runs_dir/_golden/sync_key" api pid
  if db_exists "$golden_db" && [[ -f "$marker" ]] && [[ "$(cat "$marker")" == "$sync_key" ]]; then
    return 0
  fi
  step "golden template: building (migrations + sync origins, no business data)"
  mkdir -p "$runs_dir/_golden"
  drop_db "$golden_db"
  psql_admin "CREATE DATABASE \"$golden_db\"" >/dev/null
  DATABASE_URL="$(url_for_db "$golden_db")" BIND_ADDR="127.0.0.1:8199" \
    INVENTORY_NODE_ID=cloud-rig-golden INVENTORY_NODE_ROLE=CLOUD \
    INVENTORY_AUTH_MODE=disabled INVENTORY_ENABLE_TEST_CONTROLS=true \
    INVENTORY_ORIGIN_GENERATION=1 SYNC_INGEST_KEY="$sync_key" RUST_LOG=warn \
    "$bin_dir/cloud" >"$runs_dir/_golden/boot.log" 2>&1 &
  pid=$!
  trap 'kill "$pid" 2>/dev/null || true' EXIT
  wait_http golden "http://127.0.0.1:8199/api/v1/health" "$pid"
  api="http://127.0.0.1:8199"
  curl -sf -X POST "$api/api/v1/sync/origins" -H "x-sync-key: $sync_key" \
    -H 'content-type: application/json' \
    -d "{\"origin_id\":\"dc\",\"site_id\":\"dc\",\"label\":\"rig DC\",\"ingest_key\":\"$sync_key\",\"node_role\":\"DC\",\"inventory_enabled\":true}" >/dev/null
  curl -sf -X POST "$api/api/v1/sync/origins" -H "x-sync-key: $sync_key" \
    -H 'content-type: application/json' \
    -d "{\"origin_id\":\"store-01\",\"site_id\":\"store-01\",\"label\":\"rig store-01\",\"ingest_key\":\"$sync_key\",\"node_role\":\"STORE\",\"inventory_enabled\":true}" >/dev/null
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  trap - EXIT
  printf '%s' "$sync_key" > "$marker"
  echo "  golden ready: $golden_db"
}

# ── configuration + launch ────────────────────────────────────────────────────

write_env() {  # write_env <run_dir> <db> <run_id>
  local dir="$1" db="$2" id="$3"
  cat > "$dir/env" <<EOF
# Frozen at 'new' time. 'reset' reuses this file; change config via down+new.
RUN_ID=$id
DB_NAME=$db
CLOUD_URL=http://127.0.0.1:$port_cloud
CLOUD_PORT=$port_cloud
DC_PORT=$port_dc
STORE_PORT=$port_store
EDGE_HOST=$edge_host
SYNC_KEY=$sync_key
AUTH_MODE=$auth_mode
ADMIN_PASSWORD=${RIG_ADMIN_PASSWORD:-}
CLOCK_MODE=$clock_mode
CLOCK_FACTOR=$clock_factor
VIRTUAL_START=$virtual_start
EOF
}

clock_env() {  # exported fresh at every launch so the clock re-anchors
  export ITULAH_CLOCK="$clock_mode"
  case "$clock_mode" in
    scaled | controlled)
      export ITULAH_CLOCK_ANCHOR_REAL
      ITULAH_CLOCK_ANCHOR_REAL="$(date -u +%Y-%m-%dT%H:%M:%S+00:00)"
      export ITULAH_CLOCK_ANCHOR_VIRTUAL="$virtual_start"
      [[ "$clock_mode" == "scaled" ]] && export ITULAH_CLOCK_FACTOR="$clock_factor"
      ;;
  esac
  return 0
}

auth_env() {
  export INVENTORY_AUTH_MODE="$auth_mode"
  [[ "$auth_mode" == "required" ]] && export INVENTORY_BOOTSTRAP_ADMIN_PASSWORD="${RIG_ADMIN_PASSWORD:-}"
  return 0
}

launch_run() {  # launch_run <run_dir> <db>
  local dir="$1" db="$2" run_url pid
  run_url="$(url_for_db "$db")"
  mkdir -p "$dir/logs" "$dir/frontend"
  : > "$dir/pids"

  step "node cloud: 127.0.0.1:$port_cloud"
  auth_env
  # ONE shared anchor for all three nodes: every node agrees on
  # (anchor_real, anchor_virtual, factor) and derives the SAME virtual instant
  # without per-tick synchronisation (VIRTUAL-TIME-PLAN §1.2). Re-anchoring per
  # node would skew virtual time by launch-delay × factor.
  clock_env
  # INVENTORY_STORE_INBOUND_COMMANDS: the store edge here is the same build and
  # understands `store.inbound`, so a koli that leaves the DC is announced to
  # its shop and the handheld's Terima lists it (docs/store-inbound-receiving.md).
  env DATABASE_URL="$run_url" BIND_ADDR="127.0.0.1:$port_cloud" \
    INVENTORY_NODE_ID=cloud-rig INVENTORY_NODE_ROLE=CLOUD \
    INVENTORY_ENABLE_TEST_CONTROLS=true INVENTORY_ORIGIN_GENERATION=1 \
    INVENTORY_STORE_INBOUND_COMMANDS=1 \
    INVENTORY_SSO_SIGNING_KEY_HEX="$(printf '%s' "sso:$sync_key" | shasum -a 256 | cut -c1-64)" \
    SYNC_INGEST_KEY="$sync_key" RUST_LOG=info \
    "$bin_dir/cloud" >"$dir/logs/cloud.log" 2>&1 &
  pid=$!; echo "cloud=$pid" >> "$dir/pids"
  wait_http cloud "http://127.0.0.1:$port_cloud/api/v1/health" "$pid"

  step "node dc:    127.0.0.1:$port_dc  (origin dc → cloud ingest)"
  auth_env
  # SYNC_UPLOAD_URL is the cloud BASE: HttpTransport::new appends the
  # ingest/handshake paths itself.
  env BIND_ADDR="$edge_host:$port_dc" \
    INVENTORY_SITE_ID=dc INVENTORY_NODE_ID=dc \
    INVENTORY_DATABASE_PATH="$dir/dc-edge.sqlite3" FRONTEND_DIR="$dir/frontend" \
    INVENTORY_ENABLE_TEST_CONTROLS=true INVENTORY_ORIGIN_GENERATION=1 \
    SYNC_UPLOAD_URL="http://127.0.0.1:$port_cloud" \
    SYNC_UPLOAD_KEY="$sync_key" RUST_LOG=info \
    "$bin_dir/dc" >"$dir/logs/dc.log" 2>&1 &
  pid=$!; echo "dc=$pid" >> "$dir/pids"
  wait_http dc "http://127.0.0.1:$port_dc/api/v1/inventory/control/clock" "$pid"

  step "node store: 127.0.0.1:$port_store  (origin store-01 → cloud ingest)"
  auth_env
  env BIND_ADDR="$edge_host:$port_store" \
    INVENTORY_SITE_ID=store-01 INVENTORY_NODE_ID=store-01 \
    INVENTORY_DATABASE_PATH="$dir/store-edge.sqlite3" FRONTEND_DIR="$dir/frontend" \
    INVENTORY_ENABLE_TEST_CONTROLS=true INVENTORY_ORIGIN_GENERATION=1 \
    SYNC_UPLOAD_URL="http://127.0.0.1:$port_cloud" \
    SYNC_UPLOAD_KEY="$sync_key" RUST_LOG=info \
    "$bin_dir/store" >"$dir/logs/store.log" 2>&1 &
  pid=$!; echo "store=$pid" >> "$dir/pids"
  wait_http store "http://127.0.0.1:$port_store/api/v1/inventory/control/clock" "$pid"
}

show_clock() {
  local now
  now=$(curl -sf --max-time 3 "http://127.0.0.1:$port_cloud/api/v1/inventory/control/clock") || now="(unreadable)"
  printf '\n  clock: %s\n' "$now"
}

# ── commands ──────────────────────────────────────────────────────────────────

require_binaries() {
  local b
  for b in cloud dc store; do
    [[ -x "$bin_dir/$b" ]] || die "$bin_dir/$b missing — run: (cd backend && cargo build --bin cloud --bin dc --bin store)"
  done
}

# The golden template is built with sign-in off, and its first boot leaves a
# `bootstrap` admin behind with a password nobody knows. A cloud only mints the
# bootstrap admin (from INVENTORY_BOOTSTRAP_ADMIN_PASSWORD) into an EMPTY user
# table, so a run that requires sign-in starts from an empty one.
prepare_auth_db() {  # prepare_auth_db <db> <auth_mode>
  local db="$1" mode="$2"
  assert_owned_db "$db"
  [[ "$mode" == "required" ]] || return 0
  psql "$(url_for_db "$db")" -v ON_ERROR_STOP=1 -qAt -c "DELETE FROM app_user" >/dev/null
}

# The `demo` run is the presentation stage: setup data only, plus a small
# sourcing catalogue. Any other run keeps the template exactly as it is.
seed_demo() {
  local id="$1" db="$2"
  [[ "$id" == "demo" ]] || return 0
  # On `reset` the frozen env was sourced (AUTH_MODE, ADMIN_PASSWORD, ports);
  # on `new` the RIG_* settings are in the plain variables. Either way:
  local auth_mode="${AUTH_MODE:-$auth_mode}" port_cloud="${CLOUD_PORT:-$port_cloud}" \
        port_dc="${DC_PORT:-$port_dc}" port_store="${STORE_PORT:-$port_store}"
  local RIG_ADMIN_PASSWORD="${ADMIN_PASSWORD:-${RIG_ADMIN_PASSWORD:-}}"
  export DEMO_ADMIN_PASSWORD="${RIG_ADMIN_PASSWORD:-}"
  "$root/scripts/demo-seed.sh" "$db" "http://127.0.0.1:$port_cloud" "$auth_mode" 2>&1 | grep -v '^NOTICE'
  # The goods stage prints real labels; on a laptop they go to a sink on 9109.
  if ! lsof -iTCP:9109 -sTCP:LISTEN >/dev/null 2>&1; then
    mkdir -p "$root/runs/labels"
    nohup python3 "$root/scripts/label-sink.py" --port 9109 --save "$root/runs/labels" \
      >"$root/runs/labels/sink.log" 2>&1 &
    disown
    sleep 1
  fi
  # On a sign-in run every step is done as the person whose job it is.
  local signin=()
  [[ "$auth_mode" == "required" ]] && signin=(--password "${RIG_ADMIN_PASSWORD:-}")
  python3 "$root/scripts/demo-populate.py" --cloud "http://127.0.0.1:$port_cloud" \
    --dc "http://127.0.0.1:$port_dc" --store "http://127.0.0.1:$port_store" --printer-port 9109 \
    ${signin[@]+"${signin[@]}"}
  # The reset wiped the handhelds' device keys: enrol them again.
  DEMO_PASSWORD="$([[ "$auth_mode" == "required" ]] && echo "${RIG_ADMIN_PASSWORD:-}")" \
    "$root/scripts/demo-c5.sh" "http://127.0.0.1:$port_cloud" || true
}

cmd_new() {
  local id="$1" db dir
  validate_run_id "$id"
  require_binaries
  assert_local_postgres
  db="sim_rig_$id"
  dir="$runs_dir/$id"
  [[ -d "$dir" ]] && die "run '$id' already exists at $dir — use 'reset' or 'down' first"
  ensure_golden

  step "run $id: creating $db from template"
  drop_db "$db"
  psql_admin "CREATE DATABASE \"$db\" TEMPLATE \"$golden_db\"" >/dev/null
  prepare_auth_db "$db" "$auth_mode"
  mkdir -p "$dir"
  write_env "$dir" "$db" "$id"
  launch_run "$dir" "$db"
  seed_demo "$id" "$db"

  show_clock
  cat <<EOF

  run '$id' is up (config frozen in $dir/env):
    cloud  http://127.0.0.1:$port_cloud   (Postgres $db)
    dc     http://127.0.0.1:$port_dc      ($dir/dc-edge.sqlite3)
    store  http://127.0.0.1:$port_store   ($dir/store-edge.sqlite3)
  logs:   $dir/logs/     stop: scripts/rig.sh down $id
EOF
}

cmd_reset() {
  local id="$1" db dir
  validate_run_id "$id"
  require_binaries
  assert_local_postgres
  db="sim_rig_$id"
  dir="$runs_dir/$id"
  [[ -f "$dir/env" ]] || die "run '$id' has no env file — nothing to reset"
  # shellcheck disable=SC1091
  source "$dir/env"
  step "run $id: stopping"
  stop_run "$dir"
  step "run $id: wiping $db and SQLite files"
  drop_db "$db"
  rm -f "$dir"/*.sqlite3 "$dir"/*.sqlite3-* "$dir"/logs/*.log
  psql_admin "CREATE DATABASE \"$db\" TEMPLATE \"$golden_db\"" >/dev/null
  prepare_auth_db "$db" "$AUTH_MODE"
  # Reset always reuses the frozen env but re-anchors the clock: the run wakes
  # up on its virtual New Year again.
  clock_mode="$CLOCK_MODE" clock_factor="$CLOCK_FACTOR" virtual_start="$VIRTUAL_START"
  sync_key="$SYNC_KEY" auth_mode="$AUTH_MODE" RIG_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    port_cloud="$CLOUD_PORT" port_dc="$DC_PORT" port_store="$STORE_PORT" \
    edge_host="${EDGE_HOST:-127.0.0.1}"
  launch_run "$dir" "$db"
  seed_demo "$id" "$db"
  show_clock
  echo "  run '$id' reset complete."
}

cmd_up() {  # relaunch an existing run on its data, no wipe
  local id="$1" dir
  validate_run_id "$id"
  require_binaries
  dir="$runs_dir/$id"
  [[ -f "$dir/env" ]] || die "run '$id' has no env file — use 'new'"
  # shellcheck disable=SC1091
  source "$dir/env"
  stop_run "$dir"
  clock_mode="$CLOCK_MODE" clock_factor="$CLOCK_FACTOR" virtual_start="$VIRTUAL_START"
  sync_key="$SYNC_KEY" auth_mode="$AUTH_MODE" RIG_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    port_cloud="$CLOUD_PORT" port_dc="$DC_PORT" port_store="$STORE_PORT" \
    edge_host="${EDGE_HOST:-127.0.0.1}"
  launch_run "$dir" "$DB_NAME"
  echo "  run '$id' is up on its existing data."
}

cmd_down() {
  local id="$1" keep="${2:-}" db dir
  validate_run_id "$id"
  db="sim_rig_$id"
  dir="$runs_dir/$id"
  [[ -d "$dir" ]] || die "run '$id' does not exist"
  step "run $id: stopping nodes"
  stop_run "$dir"
  step "run $id: dropping $db"
  drop_db "$db"
  if [[ "$keep" == "--keep" ]]; then
    echo "  kept $dir (artifacts, logs, env)"
  else
    rm -rf "$dir"
    echo "  removed $dir"
  fi
}

cmd_ps() {
  local dir id entry pid alive cloud_port n=0
  printf '%-20s %-16s %-22s %s\n' "RUN" "STATE" "DB" "CLOUD"
  for dir in "$runs_dir"/*/; do
    [[ -d "$dir" ]] || continue
    id=$(basename "$dir")
    [[ "$id" == "_golden" ]] && continue
    n=$((n + 1))
    cloud_port=$(sed -n 's/^CLOUD_PORT=//p' "$dir/env" 2>/dev/null)
    alive="stopped"
    if [[ -f "$dir/pids" ]]; then
      alive="running"
      while IFS='=' read -r entry pid; do
        kill -0 "$pid" 2>/dev/null || alive="degraded($entry down)"
      done < "$dir/pids"
    fi
    if curl -sf --max-time 1 "http://127.0.0.1:${cloud_port:-8180}/api/v1/health" >/dev/null 2>&1; then
      cloud="answering"
    else
      cloud="-"
    fi
    printf '%-20s %-16s %-22s %s\n' "$id" "$alive" "sim_rig_$id" "$cloud"
  done
  [[ $n -eq 0 ]] && echo "(no runs — start one with: scripts/rig.sh new <run-id>)"
  return 0
}

main() {
  [[ $# -ge 1 ]] || usage
  local cmd="$1"; shift
  case "$cmd" in
    new)    [[ $# -eq 1 ]] || usage; cmd_new "$1" ;;
    up)     [[ $# -eq 1 ]] || usage; cmd_up "$1" ;;
    reset)  [[ $# -eq 1 ]] || usage; cmd_reset "$1" ;;
    down)   [[ $# -ge 1 ]] || usage; cmd_down "$@" ;;
    ps)     cmd_ps ;;
    -h | --help | help) usage ;;
    *) die "unknown command '$cmd' (new | reset | down | ps)" ;;
  esac
}

main "$@"
