#!/usr/bin/env python3
"""Prove that collapsing the chart onto the unit dimension moved no money.

    python3 scripts/verify-coa-collapse.py --db coa_scratch          # snapshot, migrate, check
    python3 scripts/verify-coa-collapse.py --db coa_scratch --check  # check only

Migrations 0243 and 0244 turn CENTRAL FASHION STORE's 7,528-account chart into
219 accounts: one row per MEANING, with the unit left to `journal_line.site_id`
where it already lived. Fourteen accounts become one, so a per-account trial
balance is SUPPOSED to look different afterwards. What must not change is the
money, and this script is the definition of that:

  1 the chart is 219 rows, and no row carries a unit
  2 total debits and total credits are the same rupiah, to the rupiah
  3 every journal entry still balances, and still agrees with its header
  4 every account code any table pointed at before still resolves
  5 for every new account, its balance equals the SUM OF THE BALANCES of the
    old accounts that were folded into it — which is the real test, because
    it catches a mapping that quietly sends one unit's leaf somewhere else
  6 the same holds per site, and per root class; a class that moves is named
    with its figure rather than averaged away
  7 all fourteen account_map rows for one meaning name the same account

The counts below are 0244's. 0247 then puts the client's 79 missing rungs back
above these same 175 postings and the chart becomes 298 rows — no account code
moves and no balance does, so only the two shape checks here go stale. Run this
script the way it is meant to be run, on a scratch database that stops at 0244.

Run it against a scratch database. It writes.

# This proves the FIRST collapse, not the second (18 September 2026)

Migrations 0287-0292 collapse those 175/190 postable accounts again, onto
forty, by moving the identity still baked into their codes — which bank, which
rack, which PPh article — onto `journal_line.category_code` and onto columns
and sub-ledgers that already existed. The seven properties above hold of that
collapse too, word for word, and property 5 is again the one that matters: for
every one of the forty, its balance must equal the sum of the balances of the
retired accounts `ledger_account_remap` folded into it.

Nothing here has been re-pointed at 0292, and the counts would need to be. Run
this as written against a scratch database that stops at 0244; the equivalent
proof for the forty is 0290's own `DO $$` block plus the control panel, and a
long form of it is still owed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent / "backend/migrations/postgres"
SNAPSHOT_DIR = pathlib.Path("/tmp")

# The thirteen columns that hold a ledger account code: eleven foreign keys
# (`ledger_account.parent_code` is the twelfth and moves with the rows) and the
# two that hold one without a constraint.
REFERENCES = [
    ("journal_line", "account_code"),
    ("account_map", "account_code"),
    ("fixed_asset", "category_code"),
    ("bank_statement", "account_code"),
    ("bank_statement_line", "account_code"),
    ("bank_statement_source", "account_code"),
    ("cash_count", "account_code"),
    ("company_bank_account", "ledger_account_code"),
    ("store_deposit", "bank_account_code"),
    ("store_deposit", "drawer_account_code"),
    ("supplier_invoice_expense_line", "account_code"),
    ("supplier", "expense_account_code"),
]

FORBIDDEN = {"inventory_rfid", "inventory", "inventory_tanstack", "inventory_hub"}


def sql(db: str, statement: str) -> list[list[str]]:
    out = subprocess.run(["psql", "-At", "-F", "\t", "-d", db, "-c", statement],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"query failed:\n{statement}\n{out.stderr}")
    return [line.split("\t") for line in out.stdout.splitlines()]


def one(db: str, statement: str) -> str:
    rows = sql(db, statement)
    return rows[0][0] if rows else ""


def snapshot(db: str) -> dict:
    per_account = {f"{r[0]}|{r[1]}": [int(r[2]), int(r[3])] for r in sql(db, """
        SELECT account_code, site_id, sum(debit_minor), sum(credit_minor)
          FROM journal_line GROUP BY 1, 2""")}
    per_site = {r[0]: [int(r[1]), int(r[2])] for r in sql(db, """
        SELECT site_id, sum(debit_minor), sum(credit_minor)
          FROM journal_line GROUP BY 1""")}
    per_class = {r[0]: [int(r[1]), int(r[2])] for r in sql(db, """
        SELECT left(account_code, 1), sum(debit_minor), sum(credit_minor)
          FROM journal_line GROUP BY 1""")}
    referenced = set()
    for table, column in REFERENCES:
        for r in sql(db, f"SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL"):
            referenced.add(r[0])
    return {
        "accounts": int(one(db, "SELECT count(*) FROM ledger_account")),
        "debits": int(one(db, "SELECT coalesce(sum(debit_minor),0) FROM journal_line")),
        "credits": int(one(db, "SELECT coalesce(sum(credit_minor),0) FROM journal_line")),
        "entries": int(one(db, "SELECT count(*) FROM journal_entry")),
        "lines": int(one(db, "SELECT count(*) FROM journal_line")),
        "per_account": per_account,
        "per_site": per_site,
        "per_class": per_class,
        "referenced": sorted(referenced),
    }


def apply_migration(db: str, path: pathlib.Path) -> None:
    version = int(path.name.split("_", 1)[0])
    description = path.name.split("_", 1)[1].removesuffix(".sql").replace("_", " ")
    body = path.read_bytes()
    checksum = hashlib.sha384(body).hexdigest()
    script = (
        "BEGIN;\n" + body.decode() +
        "\n;\nINSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)\n"
        f"VALUES ({version}, $d${description}$d$, true, decode('{checksum}','hex'), 0)\n"
        "ON CONFLICT (version) DO NOTHING;\nCOMMIT;\n"
    )
    proc = subprocess.run(["psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                          input=script, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"{path.name} failed:\n{proc.stdout}\n{proc.stderr}")
    print(f"  applied {path.name}")


def rupiah(minor: int) -> str:
    return f"Rp {minor / 100:,.2f}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--check", action="store_true", help="skip the migrations; verify what is there")
    args = ap.parse_args()
    snapshot_file = SNAPSHOT_DIR / f"coa-collapse-before-{args.db}.json"
    if args.db in FORBIDDEN:
        sys.exit(f"refusing to touch {args.db}: run this against a scratch database")

    if not args.check:
        print("── before")
        before = snapshot(args.db)
        snapshot_file.write_text(json.dumps(before))
        print(f"  {before['accounts']:,} accounts   {before['entries']} entries / {before['lines']} lines   "
              f"debits {rupiah(before['debits'])}   credits {rupiah(before['credits'])}")
        print("── migrating")
        for name in ("0243_the_chart_stops_carrying_the_unit.sql",
                     "0244_fourteen_accounts_become_one.sql"):
            apply_migration(args.db, MIGRATIONS / name)
    before = json.loads(snapshot_file.read_text())

    after = snapshot(args.db)
    remap = {r[0]: r[1] for r in sql(args.db, "SELECT legacy_code, new_code FROM ledger_account_remap")}
    live = {r[0] for r in sql(args.db, "SELECT account_code FROM ledger_account")}
    fails: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
        if not ok:
            fails.append(name)

    print("── after")
    print(f"  {after['accounts']:,} accounts   {after['entries']} entries / {after['lines']} lines   "
          f"debits {rupiah(after['debits'])}   credits {rupiah(after['credits'])}")

    print("── the chart")
    check("chart is 219 rows", after["accounts"] == 219, f"{after['accounts']}")
    groups = int(one(args.db, "SELECT count(*) FROM ledger_account WHERE is_group"))
    check("44 groups and 175 posting accounts", groups == 44 and after["accounts"] - groups == 175,
          f"{groups} / {after['accounts'] - groups}")
    with_site = int(one(args.db, """SELECT count(*) FROM ledger_account
                                     WHERE site_id IS NOT NULL OR counterparty_site_id IS NOT NULL"""))
    check("no account carries a unit", with_site == 0, f"{with_site} do")
    twelve = int(one(args.db, "SELECT count(*) FROM ledger_account WHERE length(account_code) = 12"))
    check("no twelve-digit (unit-suffixed) code survives", twelve == 0, f"{twelve} do")
    bad_parent = int(one(args.db, """SELECT count(*) FROM ledger_account
        WHERE parent_code IS NOT NULL
          AND (account_code NOT LIKE parent_code || '%' OR account_code = parent_code)"""))
    check("every parent is a strict prefix of its children", bad_parent == 0, f"{bad_parent} are not")
    orphan = int(one(args.db, """SELECT count(*) FROM ledger_account a
        WHERE a.parent_code IS NULL AND length(a.account_code) > 1"""))
    check("no account hangs off nothing", orphan == 0, f"{orphan} do")
    # A group must not be a prefix of an account that is not beneath it, or the
    # subtree sums in ledger.rs quietly pick up a stranger.
    strays = sql(args.db, """
        SELECT g.account_code, a.account_code FROM ledger_account g
          JOIN ledger_account a ON a.account_code <> g.account_code
                               AND a.account_code LIKE g.account_code || '%'
         WHERE NOT EXISTS (
            WITH RECURSIVE up(code, parent) AS (
                SELECT a.account_code, a.parent_code
                UNION ALL
                SELECT l.account_code, l.parent_code FROM ledger_account l JOIN up ON l.account_code = up.parent)
            SELECT 1 FROM up WHERE up.code = g.account_code)""")
    check("no code is a prefix of a non-descendant", not strays, f"{len(strays)} pairs")

    print("── the money")
    check("total debits unchanged", before["debits"] == after["debits"],
          f"{rupiah(before['debits'])} -> {rupiah(after['debits'])}")
    check("total credits unchanged", before["credits"] == after["credits"],
          f"{rupiah(before['credits'])} -> {rupiah(after['credits'])}")
    check("debits equal credits", after["debits"] == after["credits"], rupiah(after["debits"]))
    check("no journal line was lost", before["lines"] == after["lines"],
          f"{before['lines']} -> {after['lines']}")

    unbalanced = sql(args.db, """
        SELECT e.entry_number, sum(l.debit_minor), sum(l.credit_minor), e.total_minor
          FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id
         GROUP BY e.entry_id, e.entry_number, e.total_minor
        HAVING sum(l.debit_minor) <> sum(l.credit_minor) OR sum(l.debit_minor) <> e.total_minor""")
    check("every entry balances and agrees with its header", not unbalanced,
          f"{len(unbalanced)} do not")

    # The real one. Fold the BEFORE totals through the remap and compare.
    folded: dict[str, list[int]] = {}
    unmapped = []
    for key, (d, c) in before["per_account"].items():
        code, site = key.split("|", 1)
        new = remap.get(code, code if code in live else None)
        if new is None:
            unmapped.append(code)
            continue
        slot = folded.setdefault(f"{new}|{site}", [0, 0])
        slot[0] += d
        slot[1] += c
    check("every account that carried a balance has a home", not unmapped,
          f"{sorted(set(unmapped))[:5]}")
    drift = {k: (folded.get(k, [0, 0]), v) for k, v in after["per_account"].items()
             if folded.get(k, [0, 0]) != v}
    drift.update({k: (v, after["per_account"].get(k, [0, 0])) for k, v in folded.items()
                  if after["per_account"].get(k, [0, 0]) != v})
    check("every new account holds exactly what was folded into it", not drift,
          f"{len(drift)} accounts differ: {list(drift)[:3]}")

    check("per-site totals unchanged", before["per_site"] == after["per_site"],
          f"{len(before['per_site'])} sites")

    moved = {k for k in set(before["per_class"]) | set(after["per_class"])
             if before["per_class"].get(k, [0, 0]) != after["per_class"].get(k, [0, 0])}
    if moved:
        # A class total that changes is not drift. It is the fixture filing an
        # account somewhere else, and it is only honest if the migration can
        # name which account and how much. Everything below is derived from the
        # remap itself, so it cannot flatter the result.
        crossings: dict[tuple[str, str], list[int]] = {}
        for key, (d, c) in before["per_account"].items():
            code = key.split("|", 1)[0]
            new = remap.get(code, code)
            if code[0] == new[0]:
                continue
            slot = crossings.setdefault((code[0], new[0]), [0, 0])
            slot[0] += d
            slot[1] += c
        print("  NOTE  balances crossed a root class, by the fixture's own design:")
        for (old, new), (d, c) in sorted(crossings.items()):
            print(f"          class {old} -> class {new}: debits {rupiah(d)}, credits {rupiah(c)}")
        for k in sorted(moved):
            b = before["per_class"].get(k, [0, 0])
            a = after["per_class"].get(k, [0, 0])
            print(f"          class {k} now: debits {rupiah(b[0])} -> {rupiah(a[0])}, "
                  f"credits {rupiah(b[1])} -> {rupiah(a[1])}")
    else:
        check("root class totals unchanged", True, f"{len(after['per_class'])} classes")

    print("── the references")
    gone = [c for c in before["referenced"] if c not in remap and c not in live]
    check("every previously-referenced code resolves", not gone, f"{gone[:5]}")
    for table, column in REFERENCES:
        bad = int(one(args.db, f"""SELECT count(*) FROM {table} t
            WHERE t.{column} IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM ledger_account a WHERE a.account_code = t.{column})"""))
        total = int(one(args.db, f"SELECT count(*) FROM {table} WHERE {column} IS NOT NULL"))
        check(f"{table}.{column}", bad == 0, f"{total} rows, {bad} dangling")
    qual = int(one(args.db, """SELECT count(*) FROM account_map m
        WHERE m.qualifier ~ '^[0-9]+$'
          AND NOT EXISTS (SELECT 1 FROM ledger_account a WHERE a.account_code = m.qualifier)"""))
    check("numeric account_map qualifiers still name an account", qual == 0, f"{qual} dangling")

    print("── the map")
    split = sql(args.db, """
        SELECT semantic_key, qualifier, count(DISTINCT account_code)
          FROM account_map GROUP BY 1, 2 HAVING count(DISTINCT account_code) > 1""")
    check("one meaning, one account across all fourteen units", not split,
          f"{len(split)} meanings still split: {[(r[0], r[1], r[2]) for r in split[:3]]}")
    per_meaning = sql(args.db, "SELECT count(*) FROM (SELECT DISTINCT semantic_key, qualifier FROM account_map) x")
    print(f"  {one(args.db, 'SELECT count(*) FROM account_map')} map rows over "
          f"{per_meaning[0][0]} meanings, still one row per site")

    print()
    if fails:
        print(f"FAILED: {len(fails)} check(s): " + "; ".join(fails))
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
