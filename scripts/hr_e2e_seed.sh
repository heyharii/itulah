#!/usr/bin/env bash
# Seed a head-office-to-store HR world through the API, for end-to-end runs
# and local demos.
#
# Everything here goes through the routes a browser goes through, so the
# seed is only ever as valid as the domain allows: approvals are decided by a
# different actor than the filer, postings precede rosters, and a hire lands
# as a candidate until its first day is recorded.
#
#   CLOUD=http://127.0.0.1:8099 ADMIN_USER=admin ADMIN_PASS=... \
#     scripts/hr_e2e_seed.sh
#
# Idempotent-ish: reference rows use the same codes each run and are skipped
# on conflict-by-409; people are minted with run-scoped ids, so re-running
# adds another cohort rather than mutating one.

set -euo pipefail

CLOUD="${CLOUD:-http://127.0.0.1:8099}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-change-this-before-first-start}"
JAR="$(mktemp)"
CSRF=""
TODAY="$(date +%F)"
NEXT_WEEK="$(date -v+7d +%F 2>/dev/null || date -d '+7 days' +%F)"
MONTH="$(date +%Y-%m)"

say() { printf '\n== %s\n' "$*"; }

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "$CLOUD$path" -b "$JAR" -c "$JAR" \
      -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -d "$body"
  else
    curl -sS -X "$method" "$CLOUD$path" -b "$JAR" -c "$JAR"
  fi
}

# api_or STRUCT_FALLBACK — some setup routes answer 409 on a re-run; the seed
# treats that as "already there" and moves on.
api_quiet() {
  local method="$1" path="$2" body="${3:-}"
  api "$method" "$path" "$body" >/dev/null 2>&1 || true
}

field() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

say "Sign in as $ADMIN_USER"
LOGIN="$(api POST /api/v1/auth/login "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")"
echo "$LOGIN" | grep -q token || { echo "login failed: $LOGIN"; exit 1; }
# Writes ride the double-submit CSRF: the cookie the login set must echo back
# as a header, exactly as the browser client does.
CSRF="$(grep inventory_csrf "$JAR" | awk '{print $NF}')"

login_as() {
  local user="$1"
  rm -f "$JAR"
  api POST /api/v1/auth/login '{"username":"'"$user"'","password":"seed-password-1"}' >/dev/null
  CSRF="$(grep inventory_csrf "$JAR" | awk '{print $NF}' || true)"
}

say "Reference data: leave kinds, policy, holidays, shifts, claim kinds, grievance kinds"
api_quiet POST /api/v1/leave-types '{"code":"CUTI_TAHUNAN","name":"Cuti tahunan","backing":"BALANCE","payment":"FULL","requires_evidence":false}'
api_quiet POST /api/v1/leave-types '{"code":"SAKIT","name":"Sakit","backing":"AS_CERTIFIED","payment":"FULL","requires_evidence":true}'
api_quiet POST /api/v1/leave-types '{"code":"IZIN","name":"Izin tanpa upah","backing":"PER_OCCURRENCE","max_days":3,"payment":"UNPAID","requires_evidence":false}'
api_quiet POST /api/v1/leave-policy "{\"version\":1,\"effective_from\":\"$TODAY\",\"annual_days\":12,\"accrual\":\"UP_FRONT\",\"carry_forward_days\":6,\"carry_forward_expires_on\":\"03-31\",\"protected_leave\":\"CONTINUES\"}"
api_quiet POST /api/v1/holiday-calendars "{\"year\":$(date +%Y),\"holidays\":[{\"date\":\"$(date +%Y)-12-25\",\"name\":\"Hari Raya Natal\",\"kind\":\"NATIONAL\"}],\"reason\":\"seed: one national day\"}"
api_quiet POST /api/v1/attendance-shifts '{"id":"PAGI","name":"Pagi","starts_at":"09:00","ends_at":"17:00","crosses_midnight":false,"unpaid_break_minutes":60}'
api_quiet POST /api/v1/attendance-shifts '{"id":"SIANG","name":"Siang","starts_at":"13:00","ends_at":"21:00","crosses_midnight":false,"unpaid_break_minutes":60}'
api_quiet POST /api/v1/expense-claim-types '{"code":"TAKSI","name":"Taksi / transport dinas"}'
api_quiet POST /api/v1/expense-claim-types '{"code":"LOKAL","name":"Transport lokal"}'
api_quiet POST /api/v1/grievance-types '{"code":"JADWAL","name":"Jadwal & shift"}'
api_quiet POST /api/v1/grievance-types '{"code":"PERLAKUAN","name":"Perlakuan atasan atau rekan"}'
api_quiet POST /api/v1/overtime-policy '{"version":1,"max_per_day_minutes":240,"max_per_week_minutes":1440,"reason":"seed: PP 35 caps"}'
api_quiet POST /api/v1/overtime-policy '{"version":2,"max_per_day_minutes":240,"max_per_week_minutes":1440,"reason":"seed: ratify again if v1 raced"}'

# A person, end to end: record, posting, hire day, contract, pay, personal
# data, and a login bound to all of it.
person() {
  local key="$1" code="$2" place="$3" rung="$4" name="$5" position="$6" grade="$7" base="$8" kind="$9"
  local id
  # Reuse a previous run's person if the badge code is already on file.
  id="$(api GET "/api/v1/employees?q=$code" | field '["rows"][0]["employee_id"]' 2>/dev/null || true)"
  if [ -n "$id" ]; then
    echo "$key=$id" >> /tmp/hr_seed_people
    echo "  $key: reused $id"
    return 0
  fi
  id="$(api POST /api/v1/employees "{\"employee_code\":\"$code\"}" | field '["employee_id"]' 2>/dev/null || true)"
  if [ -z "$id" ]; then
    echo "  $key: register failed"; return 1
  fi
  api POST "/api/v1/employees/$id/assignments" "{\"place_id\":\"$place\",\"valid_from\":\"2025-01-01\",\"reason\":\"seed: posting\"}" >/dev/null
  api POST "/api/v1/employees/$id/employment" "{\"transition\":\"HIRE\",\"effective_on\":\"2025-01-02\",\"reason\":\"seed: first day\"}" >/dev/null
  if [ "$kind" = "PKWT" ]; then
    api POST "/api/v1/employees/$id/contracts" "{\"kind\":\"PKWT\",\"starts_on\":\"2025-01-02\",\"ends_on\":\"2026-12-31\",\"position\":\"$position\",\"grade\":\"$grade\",\"reason\":\"seed: contract\"}" >/dev/null
  else
    api POST "/api/v1/employees/$id/contracts" "{\"kind\":\"PKWTT\",\"starts_on\":\"2025-01-02\",\"position\":\"$position\",\"grade\":\"$grade\",\"reason\":\"seed: contract\"}" >/dev/null
  fi
  api POST "/api/v1/employees/$id/pay" "{\"effective_from\":\"2025-01-02\",\"base_minor\":$base,\"reason\":\"seed: agreed pay\"}" >/dev/null
  api POST "/api/v1/employees/$id/personal-data" "{\"full_name\":\"$name\",\"nik\":\"3201010101010001\",\"birth_date\":\"1995-01-01\",\"address\":\"Jl. Seed No. 1\"}" >/dev/null
  api POST "/api/v1/employees/$id/account/provision" "{\"username\":\"$key\",\"display_name\":\"$name\",\"password\":\"seed-password-1\",\"role\":\"$rung\",\"reason\":\"seed: provision\"}" >/dev/null
  echo "$key=$id" >> /tmp/hr_seed_people
  echo "  $key: $id at $place ($rung)"
}

say "People: one head office, one store head, two cashiers"
rm -f /tmp/hr_seed_people
person ratna emp_seed_ho_1 ho ADMIN "Ratna Sari" "HR manager" "G6" 18000000 PKWTT
person budi emp_seed_s7_1 store-07 SUPERVISOR "Budi Hartono" "Kepala toko" "G5" 11000000 PKWTT
person andi emp_seed_s7_2 store-07 CASHIER "Andi Saputra" "Sales associate" "G1" 5400000 PKWT
person sinta emp_seed_s7_3 store-07 CASHIER "Sinta Maharani" "Kasir" "G2" 5800000 PKWT
# The store head's own record: supervisor-rung reads bound themselves to it.
person ratna7 emp_seed_s7_9 store-07 SUPERVISOR "Ratna Sari" "Area manager" "G6" 18000000 PKWTT

andi_id="$(grep '^andi=' /tmp/hr_seed_people | cut -d= -f2)"
sinta_id="$(grep '^sinta=' /tmp/hr_seed_people | cut -d= -f2)"
budi_id="$(grep '^budi=' /tmp/hr_seed_people | cut -d= -f2)"

say "Roster: this week at store-07"
for day in 1 2 3 4 5; do
  date="$(date -v+"${day}"d +%F 2>/dev/null || date -d "+$day days" +%F)"
  for id in "$andi_id" "$sinta_id"; do
    api_quiet POST "/api/v1/employees/$id/roster" "{\"on_date\":\"$date\",\"plan\":\"SCHEDULED\",\"shift_id\":\"PAGI\",\"reason\":\"seed: weekly roster\"}"
  done
done

say "Overtime: the store head orders two hours"
api POST "/api/v1/employees/$andi_id/overtime-orders" "{\"order_id\":\"ot_seed_$(date +%s)\",\"on_date\":\"$TODAY\",\"day_kind\":\"WORKING\",\"planned_minutes\":120,\"reason\":\"seed: stock opname\"}" | head -c 200; echo

say "Leave: Andi asks for one day next week"
api POST "/api/v1/employees/$andi_id/leave-requests" "{\"request_id\":\"lr_seed_$(date +%s)\",\"leave_type\":\"CUTI_TAHUNAN\",\"from_date\":\"$NEXT_WEEK\",\"to_date\":\"$NEXT_WEEK\",\"reason\":\"seed: family matter\"}" | head -c 200; echo

say "Claim: Andi files a taxi claim and sends it"
login_as andi
CLAIM="$(api POST /api/v1/expense-claims "{\"lines\":[{\"type_code\":\"TAKSI\",\"description\":\"seed: antar sampel\",\"spent_on\":\"$TODAY\",\"claimed_minor\":120000}],\"reason\":\"seed: perjalanan dinas\"}")"
CLAIM_ID="$(echo "$CLAIM" | field '["claim_id"]' 2>/dev/null || true)"
if [ -n "$CLAIM_ID" ]; then
  api POST "/api/v1/expense-claims/$CLAIM_ID/submission" '{"reason":"seed: selesai dinas"}' >/dev/null
  echo "  claim $CLAIM_ID submitted"
else
  echo "  claim filing failed: $CLAIM"
fi

say "Grievance: Andi speaks, confidentially"
login_as andi
api POST /api/v1/grievances "{\"type_code\":\"JADWAL\",\"subject\":\"seed: pembagian shift akhir pekan\",\"description\":\"seed: minta rotasi lebih adil\"}" | head -c 160; echo

say "Punch: Andi clocks in from the app"
login_as andi
api POST /api/v1/employees/me/punches '{"direction":"IN"}' | head -c 160; echo

say "Change proposal: the store head asks a promotion for Sinta"
login_as budi
api POST "/api/v1/employees/$sinta_id/change-proposals" "{\"kind\":\"PROMOTION\",\"props\":[{\"field\":\"grade\",\"to_text\":\"G3\"}],\"effective_on\":\"$NEXT_WEEK\",\"reason\":\"seed: kasir senior 3 tahun\"}" | head -c 200; echo

say "Swap: Andi asks Sinta to swap the day after tomorrow"
login_as andi
day_after="$(date -v+2d +%F 2>/dev/null || date -d '+2 days' +%F)"
api POST /api/v1/roster-swaps "{\"with_employee_id\":\"$sinta_id\",\"on_date\":\"$day_after\",\"reason\":\"seed: kuliah pagi\"}" | head -c 200; echo

say "Recruitment: requisition by the head, decided by head office"
login_as budi
JR="$(api POST /api/v1/hire-proposals "{\"place_id\":\"store-07\",\"position\":\"Sales associate\",\"headcount\":1,\"need\":\"ADDITION\",\"candidate_name\":\"Putri Ayu\",\"start_on\":\"$NEXT_WEEK\",\"contract_kind\":\"PKWT\",\"contract_ends_on\":\"2027-12-31\",\"base_pay_minor\":5400000,\"reason\":\"seed: jam buka bertambah\"}")"
JR_ID="$(echo "$JR" | field '["id"]' 2>/dev/null || true)"
if [ -n "$JR_ID" ]; then
  login_as ratna
  api POST "/api/v1/hire-proposals/$JR_ID/decision" '{"decision":"APPROVE","reason":"seed: sesuai rencana"}' >/dev/null
  APP="$(api POST "/api/v1/recruitment/proposals/$JR_ID/applicants" '{"name":"Putri Ayu","source":"WALK_IN"}')"
  APP_ID="$(echo "$APP" | field '["id"]' 2>/dev/null || true)"
  echo "  requisition $JR_ID approved; applicant $APP_ID"
else
  echo "  requisition filing failed: $JR"
fi

say "Performance: the head records Andi's month"
login_as budi
api PUT "/api/v1/employees/$andi_id/performance/${MONTH}-01" '{"kpi_pct":105,"manager_score":4,"reason":"seed: penilaian bulanan"}' | head -c 200; echo

say "Training: head office defines, the head nominates"
login_as ratna
TRN="$(api POST /api/v1/training-programs "{\"title\":\"seed: Service excellence\",\"on_date\":\"$NEXT_WEEK\",\"place\":\"HO\",\"cost_minor\":750000,\"reason\":\"seed: program\"}")"
TRN_ID="$(echo "$TRN" | field '[0]["id"]' 2>/dev/null || true)"
if [ -n "$TRN_ID" ]; then
  api POST "/api/v1/training-programs/$TRN_ID/participants" "{\"employee_id\":\"$andi_id\",\"reason\":\"seed: nominasi\"}" >/dev/null
  echo "  program $TRN_ID; Andi nominated"
else
  echo "  program define failed: $TRN"
fi

say "Lifecycle: head office opens an onboarding checklist for Andi"
login_as ratna
api POST "/api/v1/employees/$andi_id/lifecycle-tasks" '{"kind":"ONBOARDING"}' | head -c 200; echo

say "Done. Logins: ratna/budi/andi/sinta · password seed-password-1"
rm -f "$JAR"
