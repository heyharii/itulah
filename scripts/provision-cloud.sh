#!/usr/bin/env bash
#
# Take an EMPTY Postgres database to a cloud node that trades.
#
#     DATABASE_URL=postgresql://…/inventory_stj6 \
#     SYNC_INGEST_KEY='…' ITULAH_SEED_PASSWORD='…' \
#     scripts/provision-cloud.sh
#
# `seed-everything.sh` seeds a node that already exists. This gets you the node:
# the migrations, the sync origins, and the supplier catalogue that the first
# seed step silently depends on. It was written after provisioning a database
# from scratch took four rounds of trial and error, each failing on something
# no script mentioned.
#
# WHAT IT WILL DO TO AN EXISTING DATABASE
#
# Everything here is additive except the migrations, and the migrations are not:
# `0243`/`0244` collapse the chart of accounts from the client's 7,528 rows onto
# 302 and rewrite every `journal_line.account_code` through a remap table. That
# is safe — proved on a clone, per account and per site, with the trial balance
# byte-identical — but it is not reversible. Run it on a database you are
# willing to rebuild.
#
# THE FOUR THINGS THAT ARE NOT OBVIOUS
#
#   1. `seed-everything.sh` needs `seed-sourcing.py` to have run first. Nothing
#      says so; the failure is "only 0 unbought supplier items carry a
#      photograph", eight steps before anything you changed.
#   2. A goods receipt's `origin_id` is a foreign key into
#      `sync_origin_credential`, and the seed looks one up by `origin_id = site
#      id` — so the origin must be named after the SITE (`dc`), not after the
#      edge node (`dc-01`). Registering it needs the master `x-sync-key`.
#   3. The chart now comes from the migrations. Do NOT run `import-coa.py`: it
#      is refused by a check `0244` adds, which is the correct outcome.
#   4. `seed-finance.py` needs a node on the API, not just the database. Three
#      of the nine steps post through HTTP because the invariants they rely on
#      live behind the endpoints.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
db="${DATABASE_URL:?set DATABASE_URL}"
key="${SYNC_INGEST_KEY:?set SYNC_INGEST_KEY — the master key origin registration needs}"
port="${PORT:-8420}"
api="http://127.0.0.1:${port}"
sites="${SITES:-dc store-01 store-02 store-03 store-04 store-05 store-06 store-07 store-08 store-09 store-10 store-11 store-12 store-13}"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "1/5  migrations, by starting a node against the database"
# The node applies `sqlx::migrate!` on boot; there is no separate CLI. Note that
# the migrations are embedded AT COMPILE TIME, so a migration added since the
# last `cargo build` will not run until the binary is rebuilt — and `cargo
# build` does not rebuild on a new .sql file alone. Touch a source file first.
DATABASE_URL="$db" BIND_ADDR="127.0.0.1:${port}" \
  INVENTORY_NODE_ID=cloud-primary INVENTORY_NODE_ROLE=CLOUD \
  INVENTORY_AUTH_MODE="${INVENTORY_AUTH_MODE:-disabled}" \
  INVENTORY_ENABLE_TEST_CONTROLS=true INVENTORY_ORIGIN_GENERATION=1 \
  SYNC_INGEST_KEY="$key" RUST_LOG=error \
  "$root/backend/target/debug/cloud" &
node=$!
trap 'kill "$node" 2>/dev/null || true' EXIT

until curl -sf --max-time 2 "$api/api/v1/health" >/dev/null 2>&1; do
  kill -0 "$node" 2>/dev/null || { echo "the node exited before answering; migrations failed"; exit 1; }
  sleep 3
done
echo "  node up on $api"

# These are EDGE node names, not `site.id`. `dc` stays `dc` after migration
# 0256 renamed the site to `ho`: an origin registers under the id the box in
# the building runs as, a receipt is checked against it, and the centre bridges
# the two names in `inventory_dc_owner_tx`. Renaming this to `ho` would make
# that bridge a no-op and break receiving instead of fixing anything.
step "2/5  sync origins, one per site, named after the edge node"
for site in $sites; do
  role=STORE; [ "$site" = "dc" ] && role=DC
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$api/api/v1/sync/origins" \
    -H "x-sync-key: $key" -H 'content-type: application/json' \
    -d "{\"origin_id\":\"$site\",\"site_id\":\"$site\",\"label\":\"$site\",\"ingest_key\":\"$key\",\"node_role\":\"$role\"}")
  printf '  %-10s %s\n' "$site" "$code"
done

step "3/5  supplier catalogue"
ITULAH_API="$api" python3 "$here/seed-sourcing.py" | tail -2

step "4/5  the nine seed steps"
# No COA_CSV: step 5 of that script stopped importing the chart when the chart
# became the migrations' (0243/0244), and now reports what is there instead.
ITULAH_DB="$db" ITULAH_API="$api" \
  ITULAH_SEED_PASSWORD="${ITULAH_SEED_PASSWORD:?set ITULAH_SEED_PASSWORD}" \
  bash "$here/seed-everything.sh"

step "5/5  the chart holds nothing the client does not have"
# Reads the 190 retired accounts name for name against the client's export, and
# lists the forty live ones as declared exceptions — their codes are ours (0289).
# It does NOT check the forty names, because each stands for several of the
# client's accounts at once; see the note in the script.
python3 "$here/audit-chart-against-client.py" --db "$db" --loops 1 || true

echo
echo "done. the node is still running on $api; it stops when this script exits."
