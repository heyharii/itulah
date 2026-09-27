#!/usr/bin/env bash
#
# seed-ga-demo — a GA demo dataset for a node that is already migrated.
#
# This is a SCRIPT and not a migration, on purpose: a migration runs once, on
# every database, and is then frozen; a demo seed is run by hand, on one
# database, and thrown away. Putting prototype data in a migration would put it
# into production.
#
# It seeds what the GA screens read, through the SAME writers the screens use —
# the register, the contract register, the repair book, the supplies ladder, and
# a place's own detail — so the data is validated exactly as a person's typing
# is. Suppliers are the one table written straight to SQL: GA has no "create a
# supplier" route of its own (the master belongs to the vendors screen), and a
# demo needs a party to point at.
#
# Usage:
#   DATABASE_URL=postgresql:///ga_e2e \
#   GA_API=http://127.0.0.1:8180 \
#     scripts/seed-ga-demo.sh
#
# Re-running it is safe: suppliers upsert, and an asset or contract whose number
# already exists is left alone.
set -euo pipefail

DB="${DATABASE_URL:-postgresql:///ga_e2e}"
API="${GA_API:-http://127.0.0.1:8180}"
ACTOR="${GA_ACTOR:-seed-ga-demo}"

say() { printf '  %s\n' "$*"; }
api() { curl -sf -H 'content-type: application/json' "$@"; }

# ── the parties ─────────────────────────────────────────────────────────────
#
# Three of the seven flows meet a vendor: a repair, a subscription and a lease.
# The fixed ids make the script re-runnable and let the later calls point at
# them without a lookup.
supplier() { # supplier <uuid> <code> <name>
  psql "$DB" -q -v ON_ERROR_STOP=1 -c \
    "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                           status, created_by, updated_by)
     VALUES ('$1', '$2', lower('$2'), '$3', 'ACTIVE', '$ACTOR', '$ACTOR')
     ON CONFLICT (supplier_id) DO UPDATE SET name = EXCLUDED.name;"
}
say "parties"
supplier 11111111-1111-4111-8111-111111111111 PLN-GA       "PLN (persero)"
supplier 22222222-2222-4222-8222-222222222222 PDAM-GA      "PDAM Tirta"
supplier 33333333-3333-4333-8333-333333333333 CLEANING-GA  "Jasa Bersih Nusantara"
supplier 44444444-4444-4444-8444-444444444444 BENGKEL-GA   "Bengkel Sejahtera"
supplier 55555555-5555-4555-8555-555555555555 PEMILIK-GA   "Pemilik Ruko Merdeka"

# ── the register ────────────────────────────────────────────────────────────
#
# One of each shape that has a form: a vehicle with its build fields, a machine
# with a warranty, a laptop, a shelf and a licence. The asset numbers are the
# guard against seeding twice.
asset() { # asset <number> <name> <class> <site> <specs-json>
  if [ "$(psql "$DB" -tAc "SELECT count(*) FROM fixed_asset WHERE asset_number='$1'")" != "0" ]; then
    say "$1 already registered"
    return 0
  fi
  api -X POST "$API/api/v1/ga/assets" \
    -d "{\"asset_number\":\"$1\",\"name\":\"$2\",\"class_code\":\"$3\",\"site_id\":\"$4\",
         \"condition\":\"BAIK\",\"acquired_on\":\"2026-01-10\",\"specs\":$5,\"quantity\":null}" \
    >/dev/null
  say "$1 registered"
}
say "register"
asset AST-GA-DEMO-01 "Gran Max operasional" MOBIL store-01 \
  '{"make":"Daihatsu Gran Max","plate":"B 9001 DEMO","year":"2022","chassis":"MHF-DEMO-01","engine":"EN-DEMO-01","odo":"45000"}'
asset AST-GA-DEMO-02 "AC toko depan" AIR_CONDITIONER store-01 \
  '{"make":"Daikin FTKC50","capacity":"2 PK","install":"2025-06-01","warranty":"2027-06-01"}'
asset AST-GA-DEMO-03 "Laptop kasir" FFE_KOMPUTER store-02 \
  '{"device":"Laptop","make":"Lenovo ThinkPad","spec":"i5/16GB","host":"KASIR-02","warranty":"2027-01-01"}'
asset AST-GA-DEMO-04 "Rak gondola" OE_RAK_1 store-03 \
  '{"material":"Besi","dim":"120x180","area":"Depan","repl":"ya"}'
asset AST-GA-DEMO-05 "Lisensi POS" SEVENTH_SOFT_APPLICATION store-01 '{}'

# ── the deals ───────────────────────────────────────────────────────────────
contract() { # contract <number> <json>
  if [ "$(psql "$DB" -tAc "SELECT count(*) FROM ga_contract WHERE contract_number='$1'")" != "0" ]; then
    say "$1 already recorded"
    return 0
  fi
  api -X POST "$API/api/v1/ga/contracts" -d "$2" >/dev/null
  say "$1 recorded"
}
say "contracts"
contract LK/2026/DEMO-01 '{"contract_number":"LK/2026/DEMO-01","contract_type":"SEWA_TOKO","counterparty_name":"Pemilik Ruko Merdeka","site_id":"store-01","starts_on":"2026-01-01","ends_on":"2027-12-31","contract_value_minor":1200000000,"is_signed":true,"signed_by":"Bpk Har","reminder_days":60}'
contract PLN/2026/DEMO-01 '{"contract_number":"PLN/2026/DEMO-01","contract_type":"LANGGANAN_LISTRIK","supplier_id":"11111111-1111-4111-8111-111111111111","site_id":"store-01","starts_on":"2026-01-01","customer_number":"512345678901","is_signed":true,"reminder_days":30}'
contract CL/2026/DEMO-01 '{"contract_number":"CL/2026/DEMO-01","contract_type":"JASA_CLEANING","supplier_id":"33333333-3333-4333-8333-333333333333","site_scope":"ALL_STORES","starts_on":"2026-02-01","ends_on":"2027-01-31","is_signed":true,"reminder_days":45}'

# ── the place's own detail ──────────────────────────────────────────────────
say "location detail"
api -X PATCH "$API/api/v1/ga/locations/store-01" \
  -d '{"address":"Jl. Merdeka 1, Bandung","kind":"Toko","floor_area_sqm":240,"contact_name":"Pak Andi","contact_phone":"0812-3456-7890","notes":"pintu belakang untuk bongkar"}' \
  >/dev/null

# ── the supplies ────────────────────────────────────────────────────────────
if [ "$(psql "$DB" -tAc "SELECT count(*) FROM ga_supply_request")" = "0" ]; then
  say "supplies"
  api -X POST "$API/api/v1/ga/supplies" \
    -d '{"site_id":"store-01","requested_by":"Rina","category_code":"ATK","item":"Kertas A4 80gsm","quantity":"10 rim","needed_by":"2026-10-01","estimated_cost_minor":750000}' >/dev/null
  api -X POST "$API/api/v1/ga/supplies" \
    -d '{"site_id":"store-02","requested_by":"Dedi","category_code":"TOOLS","item":"Obeng set","quantity":"2 set","needed_by":"2026-10-05","estimated_cost_minor":350000}' >/dev/null
else
  say "supplies already asked for"
fi

say "done — the GA screens now have a register, three deals, a place and two asks"
