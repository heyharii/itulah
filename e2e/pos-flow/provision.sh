#!/usr/bin/env bash
#
# provision — a fresh cloud + DC + store (rig run `pos-e2e`) with a trading
# day behind it, for the POS integration test (run.sh).
#
#   e2e/pos-flow/provision.sh          # create, or wipe and reseed
#
# Ports: cloud 8480, DC 8481, store 8482 (never the demo's 818x). Sign-in is
# required, password Password01 for every demo person (maya, dian at store-01).
# The day comes from scripts/demo-seed.sh + scripts/demo-populate.py: goods
# received at the DC, sent to store-01, priced and promoted at head office,
# nine sales at the till, the day posted to the books, and a shift left OPEN
# on POS-01 for the counter test to ring into. Only the stages the till
# depends on run by default (POPULATE_ONLY); people/ga/finance are HO work.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export RIG_PORT_CLOUD=8480 RIG_PORT_DC=8481 RIG_PORT_STORE=8482
export RIG_AUTH_MODE=required RIG_ADMIN_PASSWORD=Password01 RIG_CLOCK=system
logs="$root/runs/pos-e2e/logs"

if [[ -f "$root/runs/pos-e2e/env" ]]; then
  "$root/scripts/rig.sh" reset pos-e2e
else
  "$root/scripts/rig.sh" new pos-e2e
fi

# The goods stage prints real labels; on a laptop they go to a sink on 9109.
if ! lsof -iTCP:9109 -sTCP:LISTEN >/dev/null 2>&1; then
  mkdir -p "$root/runs/labels"
  nohup python3 "$root/scripts/label-sink.py" --port 9109 --save "$root/runs/labels" \
    >"$root/runs/labels/sink.log" 2>&1 &
  disown
  sleep 1
fi

DEMO_ADMIN_PASSWORD=Password01 "$root/scripts/demo-seed.sh" sim_rig_pos-e2e \
  http://127.0.0.1:8480 required 2>&1 | grep -v '^NOTICE' | tee "$logs/seed.log"
python3 "$root/scripts/demo-populate.py" --cloud http://127.0.0.1:8480 \
  --dc http://127.0.0.1:8481 --store http://127.0.0.1:8482 --printer-port 9109 \
  --password Password01 --only "${POPULATE_ONLY:-goods,outbound,commercial,sales}" \
  2>&1 | tee "$logs/populate.log"
exit "${PIPESTATUS[0]}"
