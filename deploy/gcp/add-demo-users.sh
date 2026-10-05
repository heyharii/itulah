#!/usr/bin/env bash
#
# Adds the two default demo accounts to the CLOUD demo: candra (owner) and
# yudi (receiving, Ops menu). Both Password01. Run it yourself:
#
#     bash deploy/gcp/add-demo-users.sh https://34-128-98-21.sslip.io
#
# Same calls as scripts/demo-seed.sh, trimmed to what an account needs.
set -euo pipefail
api="${1:?cloud base url, e.g. https://34-128-98-21.sslip.io}"
admin_password="${DEMO_ADMIN_PASSWORD:-Password01}"
password="Password01"

token=$(curl -sS -m15 -X POST "$api/api/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$admin_password\"}" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])') \
  || { echo "admin sign-in failed (set DEMO_ADMIN_PASSWORD)" >&2; exit 1; }

post() {
  local path="$1" body="$2" out code
  out=$(curl -sS -m20 -w '\n%{http_code}' -X POST "$api$path" -H 'content-type: application/json' \
    -H "Idempotency-Key: $(uuidgen)" -H "Authorization: Bearer $token" -d "$body")
  code="${out##*$'\n'}"
  [[ "$code" == 2* ]] || { echo "POST $path -> $code: ${out%$'\n'*}" >&2; exit 1; }
  printf '%s' "${out%$'\n'*}"
}

joined="$(date -v-1y +%Y-%m-%d 2>/dev/null || date -d '1 year ago' +%Y-%m-%d)"

person() {  # person <code> <name> <position> <nik> <username> <base-role>
  local id
  id=$(post /api/v1/employees "{\"employee_code\":\"$1\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["employee_id"])')
  post "/api/v1/employees/$id/employment" "{\"transition\":\"HIRE\",\"effective_on\":\"$joined\",\"reason\":\"joined as $3\"}" >/dev/null
  post "/api/v1/employees/$id/personal-data" "{\"full_name\":\"$2\",\"nik\":\"$4\",\"birth_date\":\"1990-05-15\",\"address\":\"Jl. Contoh No. 1, Bandung\"}" >/dev/null
  post "/api/v1/employees/$id/account/provision" "{\"username\":\"$5\",\"display_name\":\"$2\",\"password\":\"$password\",\"role\":\"$6\",\"reason\":\"demo account\"}" >/dev/null
  echo "  + $1 $2 (login $5)" >&2
}

person HO-0010 "Candra" "Owner" 3273000000000010 candra ADMIN
person HO-0011 "Yudi" "Penerimaan barang DC" 3273000000000011 yudi SUPERVISOR

users=$(curl -sS -m15 -H "Authorization: Bearer $token" "$api/api/v1/auth/users")
uid() { python3 -c 'import json,sys;d=json.loads(sys.argv[1]);r=d.get("items",d.get("rows",d.get("users",d))) if isinstance(d,dict) else d;print(next(u.get("id") or u.get("user_id") for u in r if u["username"]==sys.argv[2]))' "$users" "$1"; }

post "/api/v1/auth/users/$(uid candra)/role" '{"role_code":"OWNER"}' >/dev/null || echo "  (candra job role OWNER not applied)"
post "/api/v1/auth/users/$(uid yudi)/role" '{"role_code":"OPERATIONS"}' >/dev/null

assign() {  # assign <user> <origin> <role>
  post /api/v1/auth/edge-assignments "{\"origin_id\":\"$2\",\"user_id\":\"$(uid "$1")\",\"role\":\"$3\",\"edge_password\":\"$password\",\"offline_ttl_seconds\":null}" >/dev/null
  echo "  node sign-in: $1 at $2" >&2
}
assign candra dc ADMIN
assign candra store-01 ADMIN
assign yudi dc SUPERVISOR
echo "done — candra and yudi, password $password"
