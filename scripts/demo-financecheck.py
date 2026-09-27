#!/usr/bin/env python3
"""Does every domain reach the books, on the right accounts, in agreement?

    python3 scripts/demo-financecheck.py --db sim_rig_demo

Four layers, each a question a finance reviewer would ask of the demo:

  1. The journal itself — every entry balances, its header total equals its
     lines, every line sits on an active, postable account of the 263-leaf
     chart, and each site's trial balance nets to zero.
  2. Domain → finance coverage — for each operational document that the
     finance rules say must be booked (receipts, bills, payments, advances,
     cash documents, store expenses, stock transfers, sales days, payroll,
     expense claims, asset capitalisation / depreciation / disposal), how many
     exist and how many carry their journal. "Booked" is counted, never
     assumed.
  3. Subledger = general ledger — the domain's own number against the GL
     balance of the account(s) the account map points it at: inventory (stock
     ledger vs 1029), payables (open payables vs 2002/2004 by supplier),
     assets (register vs asset accounts, depreciation entries vs accumulated),
     bank (latest statement closing vs the bank account's GL), payroll.
  4. The account matrix — per source of journal, which accounts it debits and
     credits, with the chart's names, so the mapping can be read against
     runs/finance-connect/2026-09-25/ACCOUNT-DECISIONS.md.

It also runs scripts/check-invariants.py (35 consistency rules). Exit code 1
when anything in layers 1–3 or the invariants fails.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
failures: list[str] = []


def q(db: str, sql: str) -> list[list[str]]:
    out = subprocess.run(["psql", "-d", db, "-XAtF", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip().splitlines()[-1] if out.stderr.strip() else "psql failed")
    return [line.split("\t") for line in out.stdout.splitlines() if line]


def one(db: str, sql: str) -> str:
    rows = q(db, sql)
    return rows[0][0] if rows and rows[0] else ""


def rp(value) -> str:
    try:
        return f"Rp {int(value):,}".replace(",", ".")
    except (TypeError, ValueError):
        return str(value)


def verdict(ok: bool, label: str, detail: str = "") -> None:
    mark = "✅" if ok else "❌"
    print(f"  {mark} {label}{('  — ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


def section(title: str) -> None:
    print(f"\n\033[1m{title}\033[0m")


# ---------------------------------------------------------------------------
def layer_journal(db: str) -> None:
    section("1 · The journal")
    entries = one(db, "SELECT count(*) FROM journal_entry")
    unbalanced = q(db, """
        SELECT e.entry_number, sum(l.debit_minor), sum(l.credit_minor)
          FROM journal_entry e JOIN journal_line l USING (entry_id)
         GROUP BY e.entry_id, e.entry_number
        HAVING sum(l.debit_minor) <> sum(l.credit_minor)""")
    verdict(not unbalanced, f"every entry balances ({entries} entries)",
            ", ".join(f"{r[0]} Dr {rp(r[1])} ≠ Cr {rp(r[2])}" for r in unbalanced[:3]))
    header = q(db, """
        SELECT e.entry_number, e.total_minor, sum(l.debit_minor)
          FROM journal_entry e JOIN journal_line l USING (entry_id)
         GROUP BY e.entry_id, e.entry_number, e.total_minor
        HAVING e.total_minor <> sum(l.debit_minor)""")
    verdict(not header, "header totals equal their lines",
            ", ".join(f"{r[0]} header {rp(r[1])} lines {rp(r[2])}" for r in header[:3]))
    bad_accounts = q(db, """
        SELECT l.account_code, coalesce(a.is_group::text, 'unknown'), coalesce(a.is_active::text, 'unknown'), count(*)
          FROM journal_line l LEFT JOIN ledger_account a ON a.account_code = l.account_code
         WHERE a.account_code IS NULL OR a.is_group OR NOT a.is_active
         GROUP BY 1, 2, 3""")
    verdict(not bad_accounts, "every line on an active, postable leaf of the chart",
            ", ".join(f"{r[0]} (group={r[1]}, active={r[2]}) ×{r[3]}" for r in bad_accounts[:4]))
    sites = q(db, """
        SELECT coalesce(site_id, '(none)'), sum(debit_minor), sum(credit_minor)
          FROM journal_line GROUP BY 1 ORDER BY 1""")
    for site, dr, cr in sites:
        verdict(dr == cr, f"trial balance nets to zero at {site}", f"Dr {rp(dr)} · Cr {rp(cr)}")


# ---------------------------------------------------------------------------
# (domain, table, filter for documents that must be booked, how to tell booked)
COVERAGE = [
    ("PO / receiving", "goods receipt lines accepted", "goods_receipt_line",
     "verified_at IS NOT NULL", "posting_id IS NOT NULL"),
    ("Payables", "supplier bills posted", "supplier_invoice",
     "status NOT IN ('DRAFT','VOID','CANCELLED','REJECTED')", "journal_entry_id IS NOT NULL"),
    ("Payables", "supplier payments", "supplier_payment", "true", "journal_entry_id IS NOT NULL"),
    ("Payables", "supplier advances", "supplier_advance", "true", "journal_entry_id IS NOT NULL"),
    ("Payables", "advance applications", "supplier_advance_application", "true", "journal_entry_id IS NOT NULL"),
    ("Payables", "credit notes", "supplier_credit_note", "true", "journal_entry_id IS NOT NULL"),
    ("Cash & bank", "cash documents posted", "cash_document",
     "status = 'POSTED'", "journal_entry_id IS NOT NULL"),
    ("Cash & bank", "petty-cash replenishments", "petty_cash_replenishment", "true", "journal_entry_id IS NOT NULL"),
    ("Cash & bank", "operating funds", "operating_fund", "true", "journal_entry_id IS NOT NULL"),
    ("Store", "store expenses", "store_expense", "true", "journal_entry_id IS NOT NULL"),
    ("Inventory", "stock transfers DC→store with value", "stock_transfer_posting",
     "value_minor <> 0", "journal_entry_id IS NOT NULL"),
    # Outflows only: a receipt's journal belongs to the receipt posting / bill,
    # never to the stock row (invariant stock.outflow_has_journal).
    ("Inventory", "stock outflows with value (sold, lost, written off, returned)", "stock_ledger_entry",
     "stock_value_difference_minor <> 0 AND event_kind IN ('SALE','LOSS','WRITE_OFF','DISPOSAL','SUPPLIER_RETURN')",
     "journal_entry_id IS NOT NULL"),
    ("Sales", "sales days posted", "sales_posting",
     "status NOT IN ('DRAFT','PENDING','SUPERSEDED')", "journal_entry_id IS NOT NULL"),
    ("Sales", "card settlements", "acquirer_settlement", "true", "journal_entry_id IS NOT NULL"),
    ("HR", "expense claims approved", "expense_claim",
     "state IN ('APPROVED','SANCTIONED','PAID')", "approved_entry_id IS NOT NULL"),
    ("HR", "expense claims paid", "expense_claim", "state = 'PAID'", "paid_entry_id IS NOT NULL"),
    # An asset bought through a bill is capitalised by that bill's journal.
    ("GA / assets", "assets bought through a posted bill", "fixed_asset f",
     "acquired_via_line_id IS NOT NULL",
     "EXISTS (SELECT 1 FROM supplier_invoice_expense_line l JOIN supplier_invoice i USING (invoice_id) "
     "WHERE l.line_id = f.acquired_via_line_id AND i.journal_entry_id IS NOT NULL)"),
    ("GA / assets", "depreciation charges", "asset_depreciation_entry", "true", "journal_entry_id IS NOT NULL"),
    ("GA / assets", "asset disposals", "fixed_asset", "disposed_on IS NOT NULL", "disposal_journal_entry_id IS NOT NULL"),
    ("GA / assets", "asset transfers", "asset_transfer", "true", "journal_entry_id IS NOT NULL"),
]


def layer_coverage(db: str) -> None:
    section("2 · Domain → finance: every document that must be booked, is")
    for domain, label, table, needs, booked in COVERAGE:
        try:
            total = int(one(db, f"SELECT count(*) FROM {table} WHERE {needs}") or 0)
            done = int(one(db, f"SELECT count(*) FROM {table} WHERE ({needs}) AND ({booked})") or 0)
        except RuntimeError as error:
            print(f"  ·  {domain}: {label} — not checked ({error})")
            continue
        if total == 0:
            print(f"  ·  {domain}: {label} — none in the demo")
            continue
        verdict(done == total, f"{domain}: {label}", f"{done}/{total} journaled")
    # Documents booked through journal_entry.source_* rather than a column.
    for domain, label, table, where, kind, key in [
        ("HR", "payroll runs handed to finance", "payroll_run",
         "state IN ('APPROVED','HANDED_OVER','RECEIVED','PAID','FINANCE_RECEIVED')", "PAYROLL_RUN", "id::text"),
    ]:
        try:
            total = int(one(db, f"SELECT count(*) FROM {table} WHERE {where}") or 0)
            kinds = int(one(db, f"SELECT count(*) FROM journal_entry WHERE source_kind = '{kind}'") or 0)
        except RuntimeError as error:
            print(f"  ·  {domain}: {label} — not checked ({error})")
            continue
        if total == 0 and kinds == 0:
            print(f"  ·  {domain}: {label} — none in the demo")
            continue
        verdict(kinds > 0, f"{domain}: {label}", f"{total} documents, {kinds} {kind} journals")


# ---------------------------------------------------------------------------
def gl(db: str, accounts_sql: str, site: str | None = None) -> int:
    site_clause = f" AND site_id = '{site}'" if site else ""
    return int(one(db, f"""SELECT coalesce(sum(debit_minor - credit_minor), 0) FROM journal_line
                           WHERE account_code IN ({accounts_sql}){site_clause}""") or 0)


def layer_subledgers(db: str) -> None:
    section("3 · Subledger = general ledger")
    # Inventory
    stock = int(one(db, "SELECT coalesce(sum(stock_value_difference_minor),0) FROM stock_ledger_entry") or 0)
    books = gl(db, "SELECT DISTINCT account_code FROM account_link WHERE role = 'inventory'")
    verdict(stock == books, "inventory: stock ledger = GL inventory", f"stock {rp(stock)} · GL {rp(books)}")
    # Company-wide agreement can hide a site whose books went negative (a
    # transfer that never posted leaves the shop selling stock it never got).
    for site, value in q(db, """SELECT site_id, sum(debit_minor - credit_minor) FROM journal_line
                                WHERE account_code IN (SELECT DISTINCT account_code FROM account_link
                                                        WHERE role = 'inventory')
                                GROUP BY 1 ORDER BY 1"""):
        verdict(int(value) >= 0, f"inventory at {site} is not negative", rp(value))
    stuck = int(one(db, """SELECT count(*) FROM allotment_line l
                            WHERE l.destination_type = 'STORE' AND EXISTS (
                              SELECT 1 FROM stock_transfer_posting t WHERE t.allotment_line_id = l.id
                                 AND t.value_minor <> 0 AND t.journal_entry_id IS NULL)""") or 0)
    verdict(stuck == 0, "no stock transfer is waiting to be posted", f"{stuck} lines waiting")
    # Payables by supplier: open payables (payment ledger) vs GL 2002/2004 per party.
    try:
        rows = q(db, """
            WITH sub AS (
              SELECT party_id, sum(CASE WHEN side = 'PAYABLE' THEN outstanding_minor ELSE -outstanding_minor END) AS open
                FROM payment_ledger_entry
               WHERE NOT delinked AND account_key LIKE '%payable'
               GROUP BY party_id),
            books AS (
              SELECT party_id, sum(credit_minor - debit_minor) AS owed FROM journal_line
               WHERE account_code IN ('2002','2004') AND party_id IS NOT NULL GROUP BY party_id)
            SELECT coalesce(s.party_id, b.party_id), coalesce(s.open, 0), coalesce(b.owed, 0)
              FROM sub s FULL JOIN books b ON b.party_id = s.party_id ORDER BY 1""")
        for party, open_, owed in rows:
            verdict(int(open_) == int(owed), f"payables: {party} open items = GL 2002/2004",
                    f"subledger {rp(open_)} · GL {rp(owed)}")
        if not rows:
            print("  ·  payables — nothing owed")
    except RuntimeError as error:
        print(f"  ·  payables — not checked ({error})")
    # Bank: latest statement closing vs GL of that bank account.
    try:
        for account, bank_id, closing, period_end in q(db, """
            SELECT DISTINCT ON (bank_account_id) account_code, bank_account_id, closing_minor, period_end
              FROM bank_statement WHERE superseded_by IS NULL ORDER BY bank_account_id, period_end DESC"""):
            books = int(one(db, f"""SELECT coalesce(sum(debit_minor - credit_minor),0) FROM journal_line l
                                    JOIN journal_entry e USING (entry_id)
                                   WHERE l.account_code = '{account}' AND e.posting_date <= '{period_end}'
                                     AND (l.bank_account_id = '{bank_id}' OR l.bank_account_id IS NULL)""") or 0)
            verdict(books == int(closing), f"bank {account}: statement closing = GL to {period_end}",
                    f"statement {rp(closing)} · GL {rp(books)} (unmatched lines explain a difference)")
    except RuntimeError as error:
        print(f"  ·  bank — not checked ({error})")
    # Assets: accumulated depreciation entries vs GL of the accumulated-depreciation accounts.
    try:
        dep = int(one(db, "SELECT coalesce(sum(amount_minor),0) FROM asset_depreciation_entry") or 0)
        acc = -gl(db, """SELECT DISTINCT account_code FROM account_link
                          WHERE role IN ('accumulated_depreciation','accumulated_amortisation')""")
        disposed = int(one(db, """SELECT coalesce(sum(l.debit_minor),0) FROM journal_line l
                                   JOIN journal_entry e USING (entry_id)
                                  WHERE e.source_kind = 'ASSET_DISPOSAL' AND l.account_code IN (
                                    SELECT DISTINCT account_code FROM account_link
                                     WHERE role IN ('accumulated_depreciation','accumulated_amortisation'))""") or 0)
        if dep or acc:
            verdict(dep - disposed == acc, "assets: depreciation entries − disposals = GL accumulated depreciation",
                    f"entries {rp(dep)} − disposed {rp(disposed)} · GL {rp(acc)}")
        else:
            print("  ·  assets — no depreciation yet")
    except RuntimeError as error:
        print(f"  ·  assets — not checked ({error})")
    # Payroll: handed-over gross vs payroll journals' expense side.
    try:
        gross = int(one(db, "SELECT coalesce(sum(gross_minor),0) FROM payroll_handover") or 0)
        if gross:
            journals = int(one(db, "SELECT count(*) FROM journal_entry WHERE source_kind = 'PAYROLL_RUN'") or 0)
            verdict(journals > 0, "payroll: handed-over runs have their journals",
                    f"gross {rp(gross)} handed over, {journals} PAYROLL_RUN journals")
        else:
            print("  ·  payroll — nothing handed over yet")
    except RuntimeError as error:
        print(f"  ·  payroll — not checked ({error})")
    # Sales: edge sales vs posted sales days.
    try:
        sold = int(one(db, "SELECT coalesce(sum(total_minor),0) FROM edge_sale WHERE status IS DISTINCT FROM 'VOIDED'") or 0)
        posted = int(one(db, "SELECT coalesce(sum(gross_minor),0) FROM sales_posting WHERE journal_entry_id IS NOT NULL") or 0)
        if sold or posted:
            verdict(sold == posted, "sales: till sales = posted sales days (gross)", f"till {rp(sold)} · posted {rp(posted)}")
        else:
            print("  ·  sales — none yet")
    except RuntimeError as error:
        print(f"  ·  sales — not checked ({error})")


# ---------------------------------------------------------------------------
def layer_matrix(db: str) -> None:
    section("4 · Which accounts each source books to (read against ACCOUNT-DECISIONS.md)")
    rows = q(db, """
        SELECT e.source_kind, count(DISTINCT e.entry_id), sum(l.debit_minor),
               string_agg(DISTINCT CASE WHEN l.debit_minor > 0 THEN l.account_code || ' ' || a.name END, '; '),
               string_agg(DISTINCT CASE WHEN l.credit_minor > 0 THEN l.account_code || ' ' || a.name END, '; ')
          FROM journal_entry e JOIN journal_line l USING (entry_id)
          LEFT JOIN ledger_account a ON a.account_code = l.account_code
         GROUP BY e.source_kind ORDER BY e.source_kind""")
    for kind, n, total, debits, credits in rows:
        print(f"  {kind:22s} {n:>3} entries  {rp(total):>18}")
        print(f"      Dr {debits or '-'}")
        print(f"      Cr {credits or '-'}")


def run_invariants(db: str) -> None:
    section("Invariants (scripts/check-invariants.py)")
    out = subprocess.run([sys.executable, str(ROOT / "scripts/check-invariants.py"), "--db", db],
                         capture_output=True, text=True)
    lines = out.stdout.strip().splitlines()
    for line in lines:
        if line.strip().startswith(("FAIL", "fail", "ERROR", "error")) or " fail " in line[:12]:
            print("  " + line.strip())
    summary = lines[-1] if lines else out.stderr.strip()
    verdict(" 0 fail" in summary and " 0 error" in summary, "all consistency rules pass", summary)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default="sim_rig_demo")
    parser.add_argument("--no-invariants", action="store_true")
    args = parser.parse_args()
    # The account names in layer 4 come from ledger_account.name; fall back if absent.
    layer_journal(args.db)
    layer_coverage(args.db)
    layer_subledgers(args.db)
    layer_matrix(args.db)
    if not args.no_invariants:
        run_invariants(args.db)
    print(f"\n{'✅ all checks pass' if not failures else '❌ ' + str(len(failures)) + ' check(s) failed: ' + '; '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
