#!/usr/bin/env bash
#
# seed-pos-door — the people the till's door needs at store-01 (owner, 23 Oct
# 2026): one Kepala toko who may open the till for a cashier ("Buka kasir atas
# nama"), and three cashiers to open it for. Then the twenty members and
# vouchers of seed-pos-test-data.sh. All through the hub's own API as the
# admin; a person whose login already exists is left as it is.
#
#   scripts/seed-pos-door.sh https://osretail.site      (asks for the admin password)
#
# Every account signs in with Password01. The store node learns the four over
# sync within a minute; until then the door's list is empty.
set -euo pipefail
api="${1:?cloud api base, e.g. https://osretail.site}"
pw="${DEMO_ADMIN_PASSWORD:-}"
if [[ -z "$pw" ]]; then read -rsp "admin password for $api: " pw; echo; fi
export DEMO_ADMIN_PASSWORD="$pw"
password="Password01"
here="$(cd "$(dirname "$0")" && pwd)"

token=$(curl -sS -m15 -X POST "$api/api/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$pw\"}" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])') \
  || { echo "seed: admin sign-in failed" >&2; exit 1; }

call() {  # call <method> <path> [body] → body, then the status on its own line
  curl -sS -m20 -w '\n%{http_code}' -X "$1" "$api$2" -H 'content-type: application/json' \
    -H "Authorization: Bearer $token" -H "Idempotency-Key: $(uuidgen)" ${3:+-d "$3"}
}
must() {  # must <method> <path> <body> → body; stops on anything but 2xx
  local out code
  out=$(call "$@"); code="${out##*$'\n'}"
  [[ "$code" == 2* ]] || { echo "  $1 $2 -> $code: ${out%$'\n'*}" >&2; exit 1; }
  printf '%s' "${out%$'\n'*}"
}
user_id() {  # user_id <username> → the cloud user id, or nothing
  call GET /api/v1/auth/users | sed '$d' | python3 -c '
import json,sys
d=json.load(sys.stdin); rows=d if isinstance(d,list) else d.get("items",d.get("rows",d.get("users",[])))
print(next((u.get("id") or u.get("user_id") for u in rows if u["username"]==sys.argv[1]),""))' "$1"
}

joined="$(date -v-1y +%Y-%m-%d 2>/dev/null || date -d '1 year ago' +%Y-%m-%d)"
echo "── people at store-01 (password $password)"
while IFS='|' read -r code name position nik username rung; do
  uid=$(user_id "$username")
  if [[ -z "$uid" ]]; then
    id=$(must POST /api/v1/employees "{\"employee_code\":\"$code\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["employee_id"])')
    must POST "/api/v1/employees/$id/employment" "{\"transition\":\"HIRE\",\"effective_on\":\"$joined\",\"reason\":\"joined as $position\"}" >/dev/null
    must POST "/api/v1/employees/$id/personal-data" "{\"full_name\":\"$name\",\"nik\":\"$nik\",\"birth_date\":\"1995-05-15\",\"address\":\"Jl. Contoh No. 1, Bandung\"}" >/dev/null
    must POST "/api/v1/employees/$id/account/provision" "{\"username\":\"$username\",\"display_name\":\"$name\",\"password\":\"$password\",\"role\":\"$rung\",\"reason\":\"POS door test account\"}" >/dev/null
    uid=$(user_id "$username")
    made="new"
  else
    made="exists"
  fi
  out=$(call POST /api/v1/auth/edge-assignments "{\"origin_id\":\"store-01\",\"user_id\":\"$uid\",\"role\":\"$rung\",\"edge_password\":\"$password\",\"offline_ttl_seconds\":null}")
  printf '  %-6s %-9s %-16s %-11s store-01 %s\n' "$made" "$username" "$name" "$rung" "${out##*$'\n'}"
done <<'EOF'
ST-0201|Bima Prasetyo|Kepala toko|3273000000000201|bima|SUPERVISOR
ST-0202|Andi Saputra|Kasir|3273000000000202|andi|CASHIER
ST-0203|Rizky Pratama|Kasir|3273000000000203|rizky|CASHIER
ST-0204|Dimas Wijaya|Kasir|3273000000000204|dimas|CASHIER
EOF

echo
"$here/seed-pos-test-data.sh" "$api"
echo
echo "Try it: https://pos.osretail.site → click the sensor (Andi), or K → bima / $password → Buka kasir atas nama → Andi."
