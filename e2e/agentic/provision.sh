#!/usr/bin/env bash
#
# provision — the `agentic` rig the e2e suites run against: cloud 8580 (the
# Gudang runs inside it; RIG_DC_HOSTING=edge brings back the separate DC node on
# 8581), store-01 8582, sign-in required (password Password01), 16 open stores.
#
#   e2e/agentic/provision.sh        # create, or wipe and reseed
#
# Never the pos-e2e rig (848x) Hari uses by hand. Data comes from
# scripts/demo-seed.sh + scripts/demo-populate.py (goods at the DC, an
# outbound to store-01); three more stores are opened on top of the 13 the
# template carries.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export RIG_PORT_CLOUD=8580 RIG_PORT_DC=8581 RIG_PORT_STORE=8582
# The owner's choice for this rig (10 Oct 2026): the Gudang is the cloud's.
export RIG_DC_HOSTING="${RIG_DC_HOSTING:-cloud}"
export RIG_AUTH_MODE=required RIG_ADMIN_PASSWORD=Password01 RIG_CLOCK=system
cloud=http://127.0.0.1:8580
dc="http://127.0.0.1:8581"
[[ "$RIG_DC_HOSTING" == "cloud" ]] && dc="$cloud"

if [[ -f "$root/runs/agentic/env" ]]; then
  "$root/scripts/rig.sh" reset agentic
else
  "$root/scripts/rig.sh" new agentic
fi
logs="$root/runs/agentic/logs"

if ! lsof -iTCP:9109 -sTCP:LISTEN >/dev/null 2>&1; then
  mkdir -p "$root/runs/labels"
  nohup python3 "$root/scripts/label-sink.py" --port 9109 --save "$root/runs/labels" \
    >"$root/runs/labels/sink.log" 2>&1 &
  disown
  sleep 1
fi

DEMO_ADMIN_PASSWORD=Password01 "$root/scripts/demo-seed.sh" sim_rig_agentic "$cloud" required \
  2>&1 | grep -v '^NOTICE' | tee "$logs/seed.log"
# The edges learn the demo people over sync, and a session opened before that
# lands is revoked when it does: wait until yusuf's DC session holds twice.
for i in $(seq 1 40); do
  [[ "$RIG_DC_HOSTING" == "cloud" ]] && break   # no DC node, no sync to wait for
  tok=$(curl -sS -m10 -X POST http://127.0.0.1:8581/api/v1/auth/login -H 'content-type: application/json' \
    -d '{"username":"yusuf","password":"Password01"}' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)
  sleep 5
  if [[ -n "$tok" ]] && curl -sf -m10 -H "Authorization: Bearer $tok" http://127.0.0.1:8581/api/v1/dc/purchase-orders?limit=1 >/dev/null; then
    sleep 5
    curl -sf -m10 -H "Authorization: Bearer $tok" http://127.0.0.1:8581/api/v1/dc/purchase-orders?limit=1 >/dev/null && break
  fi
done
python3 "$root/scripts/demo-populate.py" --cloud "$cloud" --dc "$dc" \
  --store http://127.0.0.1:8582 --printer-port 9109 --password Password01 \
  --only "${POPULATE_ONLY:-goods,outbound,commercial,sales}" 2>&1 | tee "$logs/populate.log" \
  || echo "  populate: some stages failed (the EDC settlement step always does now) — see $logs/populate.log"

# Three more stores (16 in all). Opening needs a store server and a till; this
# rig has neither for them, so the opening is written straight to its database.
token=$(curl -sS -m10 -X POST "$cloud/api/v1/auth/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"Password01"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
curl -sS -m20 -X POST "$cloud/api/v1/setup/stores" -H "Authorization: Bearer $token" \
  -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"stores":[{"name":"Tasikmalaya","city":"Tasikmalaya","manager":{"name":"Agus Setiawan"}},
                 {"name":"Garut","city":"Garut","manager":{"name":"Lina Marlina"}},
                 {"name":"Cirebon","city":"Cirebon","manager":{"name":"Dedi Kurniawan"}}]}' >/dev/null
psql -d sim_rig_agentic -q -c "UPDATE unit SET opened_at = now(), opened_by = 'e2e-agentic',
  opened_note = 'rig: 16 stores for e2e' WHERE kind = 'STORE' AND opened_at IS NULL"
curl -sS -m10 -H "Authorization: Bearer $token" "$cloud/api/v1/stores" | python3 -c '
import json, sys
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else d.get("items", d.get("rows", []))
print("  stores:", len(rows), "open:", sum(s.get("status") == "OPEN" for s in rows))'
