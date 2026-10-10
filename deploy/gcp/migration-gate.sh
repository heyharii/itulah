#!/usr/bin/env bash
#
# Before a build reaches the demo: its migrations, run against a fresh copy of
# the DEMO's own database, here on this laptop (owner, 10 Oct 2026 — the rig's
# data is not the demo's). Read-only on the VM: pg_dump, nothing else.
#
#     deploy/gcp/migration-gate.sh            # builds nothing: uses backend/target/debug/cloud
#     IMAGE=<image> deploy/gcp/migration-gate.sh   # the image itself (CI; linux/amd64)
#
# Passes when the cloud binary of this tree starts on the copy, every
# migration it carries is recorded as applied, and /api/v1/health answers 200.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT="${PROJECT:-project-21f41328-b088-4894-b3f}"
ZONE="${ZONE:-asia-southeast2-a}"
VM="${VM:-itulah-demo}"
BIN="${BIN:-$root/backend/target/debug/cloud}"
db="gate_demo_$(date +%Y%m%d%H%M%S)"
dump="$(mktemp -t demo-dump).pgc"
port=8396

IMAGE="${IMAGE:-}"
PGURL="${PGURL:-postgresql:///}"   # where the copy is made; CI passes its service
if [ -z "$IMAGE" ]; then
  [ -x "$BIN" ] || { echo "no cloud binary at $BIN (cargo build --bin cloud)" >&2; exit 1; }
  newer=$(find "$root/backend/src" "$root/backend/migrations" -newer "$BIN" -type f | head -1)
  [ -z "$newer" ] || { echo "the binary is older than $newer: rebuild it first" >&2; exit 1; }
fi

echo "dumping the $VM database (read-only)…"
gcloud --project "$PROJECT" compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap \
  --command "sudo docker exec pg pg_dump -U itulah -Fc itulah_cloud" > "$dump" 2>/dev/null
[ -s "$dump" ] || { echo "empty dump" >&2; exit 1; }
echo "dump: $(du -h "$dump" | cut -f1)"

createdb "$db"   # PGHOST/PGUSER/PGPASSWORD say where, in CI
trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null; dropdb --if-exists "$db"; rm -f "$dump"' EXIT
pg_restore --no-owner --no-acl -d "$db" "$dump" 2>/dev/null || true
before=$(psql -d "$db" -Atc "select coalesce(max(version),0) from _sqlx_migrations")
want=$(ls "$root/backend/migrations/postgres" | sed -n 's/^\([0-9]*\)_.*/\1/p' | sort -n | tail -1 | sed 's/^0*//')
echo "demo is at migration $before; this build carries up to $want"

log="$(mktemp -t gate-cloud).log"
dburl="${PGURL%/}/$db"; [ "$PGURL" = "postgresql:///" ] && dburl="postgresql:///$db"
gate_env=(DATABASE_URL="$dburl" BIND_ADDR="127.0.0.1:$port" INVENTORY_NODE_ID=cloud-rig
  INVENTORY_NODE_ROLE=CLOUD INVENTORY_AUTH_MODE=required INVENTORY_BOOTSTRAP_ADMIN_PASSWORD=gate-only
  INVENTORY_ORIGIN_GENERATION=1 SYNC_INGEST_KEY=gate-sync-key-0123456789abcdef0123456789 RUST_LOG=warn)
if [ -n "$IMAGE" ]; then
  envs=(); for e in "${gate_env[@]}"; do envs+=(-e "$e"); done
  docker run --rm --network host -e APP_BIN=cloud "${envs[@]}" "$IMAGE" >"$log" 2>&1 &
else
  env "${gate_env[@]}" "$BIN" >"$log" 2>&1 &
fi
pid=$!
t0=$SECONDS
for _ in $(seq 1 300); do
  curl -sf "http://127.0.0.1:$port/api/v1/health" >/dev/null && break
  kill -0 $pid 2>/dev/null || { echo "GATE FAILED: the cloud exited on the demo copy" >&2; tail -30 "$log" >&2; exit 1; }
  sleep 1
done
curl -sf "http://127.0.0.1:$port/api/v1/health" >/dev/null || { echo "GATE FAILED: no health after 300 s" >&2; tail -30 "$log" >&2; exit 1; }
after=$(psql -d "$db" -Atc "select max(version) from _sqlx_migrations")
ok=$(psql -d "$db" -Atc "select bool_and(success) from _sqlx_migrations")
echo "migrated $before -> $after in $((SECONDS - t0)) s, all succeeded: $ok"
[ "$after" = "$want" ] && [ "$ok" = t ] || { echo "GATE FAILED: expected $want and all succeeded" >&2; exit 1; }
echo "GATE PASSED"
