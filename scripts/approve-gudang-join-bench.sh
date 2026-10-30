#!/usr/bin/env bash
# Bench only: approve the waiting Central Gudang at the riza c014 bench node
# (http://100.73.80.69:8092) as an Admin signed in at that node. The password is
# asked here and sent to that node only; nothing is stored.
set -euo pipefail
NODE=${NODE:-http://100.73.80.69:8092}
read -r -p "Admin username at the node [admin]: " USER_NAME
USER_NAME=${USER_NAME:-admin}
read -r -s -p "Password: " PASS; echo
TOKEN=$(USER_NAME="$USER_NAME" PASS="$PASS" python3 -c 'import json,os;print(json.dumps({"username":os.environ["USER_NAME"],"password":os.environ["PASS"]}))' \
  | curl -fsS -H 'content-type: application/json' --data @- "$NODE/api/v1/auth/login" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
unset PASS
JOINS=$(curl -fsS -H "Authorization: Bearer $TOKEN" "$NODE/api/v1/devices/joins")
JOIN=$(printf '%s' "$JOINS" | python3 -c 'import json,sys
items=[j for j in json.load(sys.stdin)["items"] if j["kind"]=="WAREHOUSE"]
print(items[-1]["join_id"] if items else "")')
[ -n "$JOIN" ] || { echo "No Gudang is waiting at $NODE."; exit 1; }
printf '%s' "$JOINS" | python3 -c 'import json,sys
for j in json.load(sys.stdin)["items"]: print(j["kind"], j["code"], j["verification"])'
curl -fsS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  --data '{"label":"Gudang 1"}' "$NODE/api/v1/devices/joins/$JOIN/approve" >/dev/null
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$NODE/api/v1/auth/logout" >/dev/null || true
echo "Approved: Gudang 1 at $NODE"
