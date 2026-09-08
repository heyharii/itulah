#!/usr/bin/env bash
#
# Seed a cloud node from empty to trading, in the only order that works.
#
#     ITULAH_DB="postgresql://…" ITULAH_API=http://127.0.0.1:8410 \
#     ITULAH_SEED_PASSWORD='…' scripts/seed-everything.sh
#
# ITULAH_DB    a psql connection string (or a local database name)
# ITULAH_API   a cloud node running against THAT SAME database — three of the
#              steps below go through the HTTP API rather than SQL, because the
#              invariants they depend on live behind the endpoints
# ITULAH_SEED_PASSWORD  the password given to the nine workplace accounts.
#              Set SKIP_ACCOUNTS=1 to leave app_user alone instead.
#
# THE ORDER IS NOT A PREFERENCE. Each step needs what the one above it wrote:
#
#   goods      articles and SKUs only exist because a purchase order brought
#              them in, so nothing can be priced before this runs
#   variants   what the SUPPLIER offers, which is independent of what we bought
#   commercial prices need SKUs; promotions must go into the book while it is
#              still a draft; sales need a published book AND stock on a floor
#   floor      counts and sightings need units standing somewhere; edge sale
#              facts need the promotions to name
#   coa        the client's chart, which every posting rule maps a meaning onto
#   finance    needs the chart, and posts through the API because `poster.rs`
#              is the only thing allowed to write a journal
#   people     employees, through the API for the same reason
#   workplace  binds logins to the people that step created
#   reach      counts promotion usage from the edge facts and rolls the book
#              out to the shops, so it has to see all of the above
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
db="${ITULAH_DB:?set ITULAH_DB to a psql connection string}"
api="${ITULAH_API:-http://127.0.0.1:8410}"
articles="${ARTICLES:-500}"
coa_csv="${COA_CSV:-$HOME/Downloads/Laporan_Master_Account1.csv}"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "1/9  goods: supplier → purchase order → receipt → article → SKU → stock"
python3 "$here/seed-full-chain.py" --db "$db" --repair --purge-orphans --articles "$articles"

step "2/9  supplier catalogue variants"
psql -d "$db" -v ON_ERROR_STOP=1 -q -f "$here/seed_supplier_variants.sql"

step "3/9  prices, promotions, members, sales, vouchers, segments"
python3 "$here/seed-commercial-and-trade.py" --db "$db"

step "4/9  counts, handheld sightings, edge sale facts"
python3 "$here/seed-floor-activity.py" --db "$db"

step "5/9  chart of accounts"
if [ -f "$coa_csv" ]; then
  python3 "$here/import-coa.py" --csv "$coa_csv" 2>/dev/null | psql -d "$db" -v ON_ERROR_STOP=1 -q
  psql -d "$db" -tAc "SELECT count(*)||' accounts' FROM ledger_account"
else
  echo "  no chart at $coa_csv — skipping (set COA_CSV); finance below will have nothing to map"
fi

step "6/9  finance: account map, periods, bills, assets, bank"
# `seed-finance.py` exits 1 if ANY call was refused, and one refusal is
# expected every time: the client's chart carries a retired bank account, and
# the account-map endpoint declines to map a meaning onto an account they have
# retired. That is the invariant working. Report the exit code and carry on
# rather than letting `pipefail` end the run eight steps in.
python3 "$here/seed-finance.py" --db "$db" --api "$api" | tail -5 || true
finance_status="${PIPESTATUS[0]:-0}"
[ "$finance_status" = "0" ] || echo "  (seed-finance exited $finance_status — see the failures above)"

step "7/9  people"
python3 "$here/seed-people.py" | tail -6

step "8/9  workplace: documents, discussions, chat, reports"
if [ "${SKIP_ACCOUNTS:-0}" = "1" ]; then
  python3 "$here/seed-workplace.py" --db "$db" --api "$api" --skip-accounts | tail -8
else
  python3 "$here/seed-workplace.py" --db "$db" --api "$api" | tail -8
fi

step "9/9  promotion usage and which shop is carrying which book"
ITULAH_DB="$db" python3 "$here/seed-commercial-reach.py"

step "audit"
python3 "$here/seed-full-chain.py" --db "$db" --audit
python3 "$here/seed-commercial-and-trade.py" --db "$db" --audit
python3 "$here/seed-floor-activity.py" --db "$db" --audit
