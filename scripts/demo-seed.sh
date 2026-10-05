#!/usr/bin/env bash
#
# demo-seed — bring a rig Cloud to "setup only": every business row gone, the
# setup the migrations carry kept (chart of accounts, account map, sites,
# divisions, colours, sizes, tags, payment terms, tax, banks, HR policy …),
# plus a small sourcing catalogue (2 suppliers × 5 supplier items), HR setup
# (leave, shifts, attendance, overtime, claims), five complete employees with
# accounts (password Password01), discussions and chat between them, and the
# accounting period open, and a head office bank account to pay suppliers from.
#
#   scripts/demo-seed.sh <database> <cloud-api-base>
#   scripts/demo-seed.sh sim_rig_demo http://127.0.0.1:8180
#
# `rig.sh new demo` / `rig.sh reset demo` call this automatically. Suppliers go
# through the HTTP API (as `development`, or the bootstrap admin on a sign-in
# rig) so they carry exactly
# what the Hub would write; only the wipe is SQL.
set -euo pipefail

db="${1:?database name}"
api="${2:?cloud api base, e.g. http://127.0.0.1:8180}"
auth_mode="${3:-disabled}"   # the rig's AUTH_MODE
case "$db" in sim_rig_*) ;; *) echo "demo-seed: refusing to wipe '$db' (not a sim_rig_* database)" >&2; exit 1 ;; esac

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# On a rig that requires sign-in, every call carries the bootstrap admin's
# bearer token (password from DEMO_ADMIN_PASSWORD, which rig.sh passes on).
auth=()
if [[ "$auth_mode" == "required" ]]; then
    token=$(curl -sS -m10 -X POST "$api/api/v1/auth/login" -H 'content-type: application/json' \
        -d "{\"username\":\"admin\",\"password\":\"${DEMO_ADMIN_PASSWORD:?set DEMO_ADMIN_PASSWORD for a sign-in rig}\"}" \
        | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])') \
        || { echo "demo-seed: admin sign-in failed" >&2; exit 1; }
    auth=(-H "Authorization: Bearer $token")
fi

step "demo-seed: clearing business data in $db"
# Cascades only reach rows that hang off these (sales, purchase lines, journal
# lines, cost layers …); every setup table is outside that reach. Sync origins,
# credentials and watermarks stay, so the running edges keep their sequence.
psql -d "$db" -v ON_ERROR_STOP=1 -q <<'SQL'
TRUNCATE movement, movement_group, inventory_subject, inventory_projection,
         observation_sighting, count_entry, count_snapshot, official_count,
         sku, article, edge_inventory_snapshot, edge_inventory_pool,
         audit_log, integrity_result, integrity_run, scheduled_job_run,
         commercial_price_rule, commercial_assortment_rule,
         supplier_item, supplier_contact, supplier
  CASCADE;
SQL

post() {
    local path="$1" body="$2" out
    out=$(curl -sS -m10 -w '\n%{http_code}' -X POST "$api$path" -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" ${auth[@]+"${auth[@]}"} -d "$body")
    local code="${out##*$'\n'}"
    [[ "$code" == 2* ]] || { echo "demo-seed: POST $path → $code: ${out%$'\n'*}" >&2; exit 1; }
    printf '%s' "${out%$'\n'*}"
}
id_of() { python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("id") or d.get("supplier_id") or d["supplier"]["id"])'; }

step "demo-seed: 2 suppliers × 5 sourcing items"
# Each with standing terms and tax status: a delivery's payable falls due by
# the supplier's terms (0390), so a supplier without them is owed on the day
# the goods are accepted. 0001 (Garmen Nusantara) is PKP on Net 30, 0002 (Sepatu Sejahtera) is non-PKP on
# COD. No code is sent: the centre numbers suppliers itself, four digits.
s1=$(post /api/v1/suppliers '{"name":"Garmen Nusantara","legal_form":"PT","contact_name":"Budi Santoso","phone":"0812-1000-0001","email":"sales@garmennusantara.co.id","address":"Jl. Industri No. 12, Bandung","status":"ACTIVE","category":"MERCHANDISE","npwp":"01.234.567.8-423.000","is_pkp":true,"default_payment_terms_code":"NET_30"}' | id_of)
s2=$(post /api/v1/suppliers '{"name":"Sepatu Sejahtera","legal_form":"CV","contact_name":"Sari Wulandari","phone":"0812-2000-0002","email":"order@sepatusejahtera.co.id","address":"Jl. Raya Cibaduyut No. 45, Bandung","status":"ACTIVE","category":"MERCHANDISE","npwp":"02.345.678.9-424.000","is_pkp":false,"default_payment_terms_code":"COD"}' | id_of)

item() { post "/api/v1/suppliers/$1/items" "$2" >/dev/null; }
item "$s1" '{"supplier_item_code":"GN-KMJ-01","name":"Kemeja Oxford Lengan Panjang","unit_price_minor":85000,"currency":"IDR","status":"ACTIVE","division_code":"PRIA","tags":["KEMEJA","LENGAN_PANJANG"],"colour_codes":["WHITE","LIGHT_BLUE","NAVY"],"size_codes":["02","03","04","05"]}'
item "$s1" '{"supplier_item_code":"GN-KAO-01","name":"Kaos Basic Katun Combed","unit_price_minor":35000,"currency":"IDR","status":"ACTIVE","division_code":"PRIA","tags":["KAOS","BASIC","LENGAN_PENDEK"],"colour_codes":["BLACK","WHITE","GREY"],"size_codes":["02","03","04","05"]}'
item "$s1" '{"supplier_item_code":"GN-BLS-01","name":"Blus Rayon Motif Bunga","unit_price_minor":72000,"currency":"IDR","status":"ACTIVE","division_code":"WANITA","tags":["BLUS"],"colour_codes":["PINK","OFF_WHITE"],"size_codes":["02","03","04"]}'
item "$s1" '{"supplier_item_code":"GN-CLN-01","name":"Celana Chino Slim Fit","unit_price_minor":110000,"currency":"IDR","status":"ACTIVE","division_code":"PRIA","tags":["CELANA"],"colour_codes":["KHAKI","NAVY","BLACK"],"size_codes":["03","04","05","06"]}'
item "$s1" '{"supplier_item_code":"GN-KAO-02","name":"Kaos Anak Karakter","unit_price_minor":28000,"currency":"IDR","status":"ACTIVE","division_code":"ANAK_LAKI","tags":["KAOS","LENGAN_PENDEK"],"colour_codes":["BLUE","YELLOW","RED"],"size_codes":["01","02","03"]}'
item "$s2" '{"supplier_item_code":"SS-SNK-01","name":"Sneakers Kanvas Low","unit_price_minor":145000,"currency":"IDR","status":"ACTIVE","division_code":"SANDAL_SEPATU","tags":["SEPATU"],"colour_codes":["WHITE","BLACK"],"size_codes":["04","05","06","07"]}'
item "$s2" '{"supplier_item_code":"SS-LOF-01","name":"Loafers Kulit Sintetis","unit_price_minor":175000,"currency":"IDR","status":"ACTIVE","division_code":"SANDAL_SEPATU","tags":["SEPATU","FORMAL"],"colour_codes":["BROWN","BLACK"],"size_codes":["05","06","07","08"]}'
item "$s2" '{"supplier_item_code":"SS-SDL-01","name":"Sandal Slide Karet","unit_price_minor":45000,"currency":"IDR","status":"ACTIVE","division_code":"SANDAL_SEPATU","tags":["MUSIMAN"],"colour_codes":["BLACK","NAVY","OLIVE"],"size_codes":["04","05","06","07"]}'
item "$s2" '{"supplier_item_code":"SS-FLT-01","name":"Flat Shoes Wanita","unit_price_minor":120000,"currency":"IDR","status":"ACTIVE","division_code":"SANDAL_SEPATU","tags":["SEPATU"],"colour_codes":["BEIGE","BLACK","MAROON"],"size_codes":["03","04","05","06"]}'
item "$s2" '{"supplier_item_code":"SS-TAS-01","name":"Tas Selempang Kanvas","unit_price_minor":95000,"currency":"IDR","status":"ACTIVE","division_code":"TAS","tags":["AKSESORI"],"colour_codes":["KHAKI","BLACK"],"size_codes":["00"]}'

step "demo-seed: HR setup — leave, holidays, shifts, attendance, overtime, claims"
# What every Profile screen reads before it can show a person anything: the
# kinds of leave and the annual entitlement (balances derive from these), the
# shifts a roster names, the attendance and overtime rules, claim and
# grievance types.
today="$(date +%Y-%m-%d)"; year="$(date +%Y)"
post /api/v1/leave-types '{"code":"CUTI_TAHUNAN","name":"Cuti tahunan","backing":"BALANCE","payment":"FULL","requires_evidence":false}' >/dev/null
post /api/v1/leave-types '{"code":"SAKIT","name":"Sakit","backing":"AS_CERTIFIED","payment":"FULL","requires_evidence":true}' >/dev/null
post /api/v1/leave-types '{"code":"IZIN","name":"Izin tanpa upah","backing":"PER_OCCURRENCE","max_days":3,"payment":"UNPAID","requires_evidence":false}' >/dev/null
post /api/v1/leave-policy "{\"version\":1,\"effective_from\":\"$year-01-01\",\"annual_days\":12,\"accrual\":\"UP_FRONT\",\"carry_forward_days\":6,\"carry_forward_expires_on\":\"03-31\",\"protected_leave\":\"CONTINUES\"}" >/dev/null
post /api/v1/holiday-calendars "{\"year\":$year,\"holidays\":[{\"date\":\"$year-08-17\",\"name\":\"Hari Kemerdekaan RI\",\"kind\":\"NATIONAL\"},{\"date\":\"$year-12-25\",\"name\":\"Hari Raya Natal\",\"kind\":\"NATIONAL\"}],\"reason\":\"demo: national days\"}" >/dev/null
post /api/v1/attendance-shifts '{"id":"PAGI","name":"Pagi","starts_at":"08:00","ends_at":"17:00","crosses_midnight":false,"unpaid_break_minutes":60}' >/dev/null
post /api/v1/attendance-shifts '{"id":"SIANG","name":"Siang","starts_at":"13:00","ends_at":"22:00","crosses_midnight":false,"unpaid_break_minutes":60}' >/dev/null
post /api/v1/attendance-policy "{\"effective_from\":\"$year-01-01\",\"late_grace_minutes\":10,\"early_leave_grace_minutes\":10,\"overtime_minimum_minutes\":30,\"duplicate_punch_window_minutes\":2,\"reason\":\"demo: attendance rules\"}" >/dev/null
post /api/v1/overtime-policy '{"version":1,"max_per_day_minutes":240,"max_per_week_minutes":1080,"reason":"demo: PP 35/2021 caps"}' >/dev/null
post /api/v1/expense-claim-types '{"code":"TRANSPORT","name":"Transport dinas","expense_category":"expense_transport"}' >/dev/null
post /api/v1/expense-claim-types '{"code":"MAKAN","name":"Uang makan lembur","expense_category":"expense_misc"}' >/dev/null
post /api/v1/grievance-types '{"code":"JADWAL","name":"Jadwal & shift"}' >/dev/null
post /api/v1/grievance-types '{"code":"PERLAKUAN","name":"Perlakuan atasan atau rekan"}' >/dev/null
echo "  3 leave types, 12 days/year, 2 holidays, shifts PAGI/SIANG, attendance + overtime rules, claim + grievance types"

step "demo-seed: people — 1 at head office (the demo login), 2 at the DC, 2 at store-01"
# Each person is complete: employment, personal data, contract, posting, agreed
# pay, payroll identity (bank, NPWP, PTKP, BPJS) and a roster for the next two
# weeks. The two DC employees are the receiving pair: one counts (checking),
# one verifies. Accounts all use the demo password below.
password="Password01"
joined="$(date -v-1y +%Y-%m-%d)"
person() {  # person <code> <name> <position> <grade> <kind> <place> <nik> <base-salary> <username> <role>
    local id n="${7: -1}"
    id=$(post /api/v1/employees "{\"employee_code\":\"$1\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["employee_id"])')
    post "/api/v1/employees/$id/employment" "{\"transition\":\"HIRE\",\"effective_on\":\"$joined\",\"reason\":\"joined as $3\"}" >/dev/null
    post "/api/v1/employees/$id/personal-data" "{\"full_name\":\"$2\",\"nik\":\"$7\",\"birth_date\":\"199$n-05-1$n\",\"address\":\"Jl. Contoh No. $n, Bandung\"}" >/dev/null
    local ends=null; [[ $5 == PKWT ]] && ends="\"$(date -v+11m +%Y-%m-%d)\""
    post "/api/v1/employees/$id/contracts" "{\"kind\":\"$5\",\"starts_on\":\"$joined\",\"ends_on\":$ends,\"position\":\"$3\",\"grade\":\"$4\",\"reason\":\"first contract\"}" >/dev/null
    post "/api/v1/employees/$id/assignments" "{\"unit_id\":\"$6\",\"valid_from\":\"$joined\",\"valid_to\":null,\"reason\":\"posted to $6\"}" >/dev/null
    post "/api/v1/employees/$id/pay" "{\"effective_from\":\"$joined\",\"base_minor\":$8,\"reason\":\"agreed pay\"}" >/dev/null
    identity "$id" "$2" "$7"
    roster "$id"
    # UP_FRONT policy: the year's 12 days land on 1 January, expiring 31 March next year.
    post "/api/v1/employees/$id/leave-balances" "{\"entry_id\":\"grant-$1-$year\",\"leave_type\":\"CUTI_TAHUNAN\",\"on\":\"$year-01-01\",\"event\":\"ACCRUAL\",\"days\":12,\"expires_on\":\"$((year+1))-03-31\"}" >/dev/null
    [[ -n "${9}" ]] && post "/api/v1/employees/$id/account/provision" "{\"username\":\"$9\",\"display_name\":\"$2\",\"password\":\"$password\",\"role\":\"${10}\",\"reason\":\"demo account\"}" >/dev/null
    echo "  + $1 $2 — $3 at $6, Rp $8/bln${9:+, login $9}" >&2
    printf '%s' "$id"
}
identity() {  # identity <employee-id> <name> <nik>
    local f
    post "/api/v1/employees/$1/payroll-identity" "{\"field\":\"bank_account\",\"bank_name\":\"BCA\",\"bank_account\":\"88${3: -8}\",\"bank_holder\":\"$2\",\"effective_from\":\"$joined\",\"reason\":\"demo: payroll identity\"}" >/dev/null
    for f in "npwp:$3" "ptkp:TK/0" "bpjs_kesehatan:000${3: -10}" "bpjs_ketenagakerjaan:${3: -11}"; do
        post "/api/v1/employees/$1/payroll-identity" "{\"field\":\"${f%%:*}\",\"value\":\"${f#*:}\",\"effective_from\":\"$joined\",\"reason\":\"demo: payroll identity\"}" >/dev/null
    done
}
roster() {  # roster <employee-id> — PAGI on every weekday for 14 days
    local d day
    for d in $(seq 0 13); do
        day=$(date -v+"${d}"d +%Y-%m-%d); [[ $(date -v+"${d}"d +%u) -ge 6 ]] && continue
        post "/api/v1/employees/$1/roster" "{\"on_date\":\"$day\",\"plan\":\"SCHEDULED\",\"shift_id\":\"PAGI\",\"reason\":\"demo roster\"}" >/dev/null
    done
}
# With auth disabled the demo login is `development`, and the database allows
# one login per employee — so Rina IS `development` there, and gets her own
# `rina` account only when the rig requires sign-in.
if [[ "$auth_mode" == "required" ]]; then
    person HO-0001 "Rina Kusuma" "HR manager" G6 PKWTT ho 3273000000000001 18000000 rina ADMIN >/dev/null
else
    ho_id=$(person HO-0001 "Rina Kusuma" "HR manager" G6 PKWTT ho 3273000000000001 18000000 "" "")
    psql -d "$db" -v ON_ERROR_STOP=1 -q -c "
      INSERT INTO app_user (id, username, display_name, password_hash, role, active, created_by, employee_id)
      VALUES (gen_random_uuid(), 'development', 'Rina Kusuma', '!auth-disabled', 'ADMIN', true, 'demo-seed', '$ho_id')
      ON CONFLICT (username) DO UPDATE SET employee_id = EXCLUDED.employee_id, display_name = EXCLUDED.display_name"
    echo "  development login → HO-0001 Rina Kusuma"
fi
person HO-0006 "Nina Oktaviani" "Staf gudang toko" G1 PKWT ho 3273000000000006 5500000 nina SUPERVISOR >/dev/null  # DC checker
person HO-0007 "Yusuf Ramadhan" "Kepala gudang DC" G5 PKWTT ho 3273000000000007 12000000 yusuf SUPERVISOR >/dev/null # DC verifier
person ST-0101 "Maya Anggraini" "Kepala toko" G5 PKWTT store-01 3273000000000011 11000000 maya SUPERVISOR >/dev/null # store manager
person ST-0102 "Dian Pertiwi" "Admin toko" G2 PKWT store-01 3273000000000012 5800000 dian CASHIER >/dev/null        # store admin, runs the till

# Who signs in at which node, with the same demo password: the DC pair at the
# DC (floor app, handheld operators), the store pair at store-01 (store app,
# till). The edge learns each assignment over sync and signs them in offline.
users=$(curl -sS -m10 ${auth[@]+"${auth[@]}"} "$api/api/v1/auth/users")
# The DC pair work the Gudang: job role OPERATIONS (Ops + Inventory in the
# hub). A bare SUPERVISOR rung defaults to STORE_MANAGER, which has no Ops
# menu, so Nina could not count a delivery from the hub.
for who in nina yusuf; do
    uid=$(printf '%s' "$users" | python3 -c "import json,sys;d=json.load(sys.stdin);rows=d if isinstance(d,list) else d.get('items',d.get('users',[]));print(next(u.get('id') or u.get('user_id') for u in rows if u['username']=='$who'))")
    post "/api/v1/auth/users/$uid/role" '{"role_code":"OPERATIONS"}' >/dev/null
done
pairs="maya:store-01:SUPERVISOR dian:store-01:CASHIER yusuf:dc:SUPERVISOR nina:dc:SUPERVISOR"
# Rina runs the hub's Operations screens, which sign in at the DC with her
# Cloud session — only possible with an assignment there.
[[ "$auth_mode" == "required" ]] && pairs="$pairs rina:dc:ADMIN"
for pair in $pairs; do
    IFS=: read -r who origin role <<<"$pair"
    uid=$(python3 -c 'import json,sys;d=json.loads(sys.argv[1]);r=d.get("items",d.get("rows",d)) if isinstance(d,dict) else d;print(next(u["id"] for u in r if u["username"]==sys.argv[2]))' "$users" "$who")
    post /api/v1/auth/edge-assignments "{\"origin_id\":\"$origin\",\"user_id\":\"$uid\",\"role\":\"$role\",\"edge_password\":\"$password\",\"offline_ttl_seconds\":null}" >/dev/null
done
echo "  node sign-in: maya, dian at store-01; yusuf, nina at the DC (password $password)"

step "demo-seed: discussions and chat between the demo people"
rina_user=development; [[ "$auth_mode" == "required" ]] && rina_user=rina
python3 "$(dirname "$0")/demo-workplace.py" --db "$db" --rina "$rina_user" | sed 's/^/  /'

step "demo-seed: open the accounting period (this month)"
# Without an OPEN period every posting — a receipt's payable, a sale — is
# refused, and the demo would show a supplier with nothing owed. Only this
# month: the finance reports open on the latest open period, and an open
# empty next month makes every one of them start after today.
ym=$(date +%Y-%-m)
post /api/v1/finance/periods "{\"year\":${ym%-*},\"month\":${ym#*-}}" >/dev/null && echo "  period $ym open"

step "demo-seed: head office bank account (pays the suppliers)"
# A supplier payment leaves from a described company account; the golden
# template has none. Giro BCA on 1005 at head office (`dc`, where every supplier
# payable sits). Not in the wipe above, so a re-run finds it and moves on.
if curl -sS -m10 ${auth[@]+"${auth[@]}"} "$api/api/v1/finance/bank-accounts" | grep -q '"account_no":"8730123456"'; then
    echo "  Giro BCA 8730123456 already described"
else
    post /api/v1/finance/bank-accounts '{"ledger_account_code":"1005","unit_id":"ho","bank_code":"BCA","bank_name":"Bank Central Asia","account_no":"8730123456","account_holder":"PT Itulah Demo","branch":"KCU Bandung","kind":"GIRO","is_primary":true,"note":"Rekening demo untuk bayar supplier"}' >/dev/null
    echo "  Giro BCA 8730123456 on 1005 at ho"
fi

psql -d "$db" -Atc "SELECT 'suppliers: '||count(*) FROM supplier UNION ALL SELECT 'supplier items: '||count(*) FROM supplier_item UNION ALL SELECT 'active accounts: '||count(*) FROM ledger_account WHERE NOT is_group AND is_active UNION ALL SELECT 'open periods: '||string_agg(year||'-'||month, ', ') FROM fiscal_period WHERE status='OPEN' UNION ALL SELECT 'movements: '||count(*) FROM movement" | sed 's/^/  /'
