#!/usr/bin/env bash
#
# seed-pos-test-data — twenty records for trying the till's keys by hand:
# ten members (F5 look-up, Shift+F5 refuses a number that is taken) and ten
# vouchers of every kind and state (F2 check: gift card, refund, goodwill, one
# with a member, one about to expire, one voided). Everything goes through the
# hub's own API as the admin, exactly what the Hub would write — nothing is
# inserted behind the books. Safe to run twice: a member is enrolled
# idempotently and a voucher code that already exists is skipped.
#
#   DEMO_ADMIN_PASSWORD=… scripts/seed-pos-test-data.sh http://127.0.0.1:8180
#
# The till itself sells only by RFID tag; the tags to type into its scan field
# are listed at the end from the store node (STORE_DB, default the demo rig's).
set -euo pipefail
api="${1:?cloud api base, e.g. http://127.0.0.1:8180}"
pw="${DEMO_ADMIN_PASSWORD:?set DEMO_ADMIN_PASSWORD (the admin password of that cloud)}"

token=$(curl -sS -m10 -X POST "$api/api/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$pw\"}" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])') \
  || { echo "seed: admin sign-in failed" >&2; exit 1; }

post() {
  local path="$1" body="$2" out code
  out=$(curl -sS -m15 -w '\n%{http_code}' -X POST "$api$path" \
    -H 'content-type: application/json' -H "Authorization: Bearer $token" \
    -H "Idempotency-Key: $(uuidgen)" -d "$body")
  code="${out##*$'\n'}"
  echo "$code"
}
day() { python3 -c "import datetime,sys;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=int(sys.argv[1]))).strftime('%Y-%m-%dT23:59:00Z'))" "$1"; }

echo "── members (phone = member number)"
while IFS='|' read -r phone name; do
  code=$(post /api/v1/members "{\"member_id\":\"$phone\",\"display_name\":\"$name\"}")
  printf '  %s  %-16s %s\n' "$code" "$phone" "$name"
done <<'EOF'
081211110001|Siti Rahmawati
081211110002|Budi Santoso
081211110003|Wulan Sari
081211110004|Agus Pratama
081211110005|Rina Kartika
081211110006|Dewi Lestari
081211110007|Hendra Wijaya
081211110008|Yuni Astuti
081211110009|Fajar Nugroho
081211110010|Lina Marlina
EOF

echo "── vouchers"
# BATCH=T2 (etc.) issues a fresh set — GCT20001… — when the last one was spent testing.
batch="${BATCH:-TEST}"
while IFS='|' read -r vcode kind value days member; do
  vcode="${vcode/TEST/$batch}"
  m=""; [[ -n "$member" ]] && m=",\"member_id\":\"$member\""
  code=$(post /api/v1/commercial/vouchers "{\"code\":\"$vcode\",\"kind\":\"$kind\",\"value_minor\":$value,\"currency\":\"IDR\",\"expires_at\":\"$(day "$days")\",\"note\":\"POS test data\"$m}")
  printf '  %s  %-11s %-10s Rp %s  %s days%s\n' "$code" "$vcode" "$kind" "$value" "$days" "${member:+  · $member}"
done <<'EOF'
GCTEST0001|GIFT_CARD|300000|365|
GCTEST0002|GIFT_CARD|100000|365|
GCTEST0003|GIFT_CARD|500000|180|081211110001
GCTEST0004|GIFT_CARD|50000|30|
GCTEST0005|GIFT_CARD|200000|1|
GCTEST0006|GIFT_CARD|150000|365|
RFTEST0001|REFUND|129000|90|
RFTEST0002|REFUND|75000|90|
GWTEST0001|GOODWILL|50000|30|
GWTEST0002|GOODWILL|25000|7|
EOF
code=$(post "/api/v1/commercial/vouchers/GC${batch}0006/void" '{"reason":"POS test data: a voided card"}')
echo "  $code  GC${batch}0006 voided"

store_db="${STORE_DB:-$(dirname "$0")/../runs/demo/store-edge.sqlite3}"
if [[ -f "$store_db" ]]; then
  echo "── RFID tags in stock at the store (type one into the till's scan field)"
  sqlite3 -separator '  ' "$store_db" "SELECT s.epc, s.sku_code, s.unit_price_minor
     FROM inventory_projection p JOIN inventory_subject s ON s.id = p.subject_id
    WHERE s.subject_type = 'UNIT' AND p.place_id LIKE '%:on_hand'
    ORDER BY p.place_id, s.sku_code LIMIT 20;" 2>/dev/null || true
fi
