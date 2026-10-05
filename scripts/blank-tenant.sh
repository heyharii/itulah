#!/usr/bin/env bash
#
# blank-tenant — turn a freshly migrated Cloud database into a company that
# has nothing yet, so the hub's setup wizard is the first thing its owner sees.
#
#   scripts/blank-tenant.sh <database> <database>
#   scripts/blank-tenant.sh retail_baru retail_baru
#
# The name twice, on purpose: this deletes. Run it once, after
# `sqlx migrate run` and before the cloud is started for the new company.
#
# # Why a script and not the migrations
#
# The migrations carry the first client: 0002 opens its thirteen stores and
# its warehouse, 0348 lays down its chart with the 7Soft crosswalk, and a
# handful more seed demo stock. Every database migrated from nothing gets all
# of it. Taking that out of the migrations is the unit/site refactor's job;
# until then this undoes it for a database that is to belong to somebody else.
#
# # What goes, and what stays
#
# Goes — the client and its demo data:
#   * demo stock: movements, projections, RFID sightings, counts, articles,
#     SKUs, price and assortment rules;
#   * every site (head office's and the shops), their pools and places, and
#     the payment methods each shop showed;
#   * the client's store units (C001…), whose codes a new company's first
#     store would otherwise have to follow;
#   * the 7Soft crosswalk (`ledger_account_source_code`, `ledger_account_remap`,
#     `legacy_code_span`) and the client's bank-statement rules;
#   * the letterhead, the company profile and how its books started (0520).
#
# Stays — what any retailer starts from:
#   * the chart of accounts and every account link, posting role and finance
#     setting (a store inherits them by the kind of its unit);
#   * head office's unit (`unit` of kind HO), which the wizard gives its site
#     again and head office's own account links name;
#   * payment methods, banks, taxes, units of measure, divisions, colours,
#     sizes, tags, payment terms, asset classes, HR policy and templates;
#   * the pool template (0610), which furnishes head office's site and every
#     shop the wizard opens.
#
# # What it refuses
#
# A database somebody has used. A sale, a journal, an employee, a supplier, or
# a company described through the hub means it is not fresh, and nothing is
# deleted.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

db="${1:?database name}"
again="${2:?type the database name twice}"
[[ "$db" == "$again" ]] || { echo "blank-tenant: the two names differ ('$db', '$again')" >&2; exit 1; }

in_use=$(psql -d "$db" -v ON_ERROR_STOP=1 -Atc "
  SELECT concat_ws(', ',
    CASE WHEN EXISTS (SELECT 1 FROM sale)         THEN 'sales' END,
    CASE WHEN EXISTS (SELECT 1 FROM journal_line) THEN 'journals' END,
    CASE WHEN EXISTS (SELECT 1 FROM employee)     THEN 'employees' END,
    CASE WHEN EXISTS (SELECT 1 FROM supplier)     THEN 'suppliers' END,
    CASE WHEN EXISTS (SELECT 1 FROM company_profile WHERE set_by NOT LIKE 'migration:%')
         THEN 'a company described in the hub' END)")
if [[ -n "$in_use" ]]; then
    echo "blank-tenant: refusing — '$db' is in use ($in_use)" >&2
    exit 1
fi

unfurnished=$(psql -d "$db" -v ON_ERROR_STOP=1 -Atc "
  SELECT string_agg(kind, ', ' ORDER BY kind)
    FROM (VALUES ('HO'), ('STORE')) AS wanted (kind)
   WHERE NOT EXISTS (SELECT 1 FROM pool_template t WHERE t.site_kind = wanted.kind)")
if [[ -n "$unfurnished" ]]; then
    echo "blank-tenant: refusing — the pool template (0610) furnishes no site of kind $unfurnished; the wizard could not open one afterwards" >&2
    exit 1
fi

psql -d "$db" -v ON_ERROR_STOP=1 -q -f "$here/../backend/src/cloud/tenancy/blank.sql"

psql -d "$db" -Atc "
  SELECT 'sites: '            || (SELECT count(*) FROM site)
  UNION ALL SELECT 'units: '  || (SELECT count(*) FROM unit)
  UNION ALL SELECT 'pools: '  || (SELECT count(*) FROM operational_pool)
  UNION ALL SELECT 'active accounts: ' || (SELECT count(*) FROM ledger_account WHERE is_active AND NOT is_group)
  UNION ALL SELECT 'account links: '   || (SELECT count(*) FROM account_link)
  UNION ALL SELECT 'pool template rows: ' || (SELECT count(*) FROM pool_template)" | sed 's/^/  /'
echo "blank-tenant: '$db' is blank — start the cloud and sign in; the setup wizard is next."
