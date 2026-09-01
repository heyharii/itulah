#!/usr/bin/env python3
"""Import CENTRAL FASHION STORE's chart of accounts into `ledger_account`.

    python3 scripts/import-coa.py --csv ~/Downloads/Laporan_Master_Account1.csv --dry-run
    python3 scripts/import-coa.py --csv ~/Downloads/Laporan_Master_Account1.csv | psql -d inventory_edge_dev

The audit report always goes to stderr; the SQL goes to stdout, so a dry run is
just the run with stdout thrown away. Read the report before you load anything:
it names every account this script had to make a judgement about.

Three rules earn their complexity, and each of them is a real property of the
client's file rather than defensive coding:

1. A parent is the LONGEST DECLARED STRICT PREFIX, not "the previous rung".
   Six accounts skip a rung. A strict parent rule rejects all six, and they are
   not errors — they are simply filed higher than the ladder suggests.

2. is_group is DERIVED, never read from the file. Column 3 looks like a group
   flag and is not one: it reads 'Y' on leaves too. It is the active flag, and
   104 accounts carry 'N'.

3. The two-digit suffix means a location ONLY outside the goods-in-transit
   families. `1011203` and `1011204` are source x destination matrices: the
   source is the ten-character rung, the destination is the suffix. A blind
   "suffix is the location" rule files 210 leaves under the wrong place, and the
   first transfer posted against them is wrong in a way no trial balance can
   see, because it still balances.
"""

import argparse
import csv
import sys
from collections import Counter

# Goods in transit. The suffix here is the DESTINATION, and the source is named
# by the ten-character rung. Everywhere else the suffix is simply the location.
MATRIX_FAMILIES = ("1011203", "1011204")

# `00` is head office, which is our DC; `01`..`13` are C001..C013.
#
# The client's file never joins a store name to a `C0nn` code, so this ordinal
# reading is an assumption and is recorded as one. It is the only assumption in
# this script, and it is the one to check before anybody compares a balance
# against the client's own books.
def site_for_suffix(suffix: str):
    if suffix == "00":
        return "dc"
    if suffix.isdigit() and 1 <= int(suffix) <= 13:
        return f"store-{int(suffix):02d}"
    return None


def sql_str(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(args.csv, encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))

    # An account row is one whose second column is a number. The eight banner
    # rows and two legend rows fail that test, which is the whole filter.
    accounts = {}
    order = []
    for row in rows:
        if len(row) < 5:
            continue
        code = row[1].strip()
        if not code.isdigit():
            continue
        if code in accounts:
            print(f"warning: duplicate code {code}, keeping the first", file=sys.stderr)
            continue
        accounts[code] = {
            "code": code,
            "name": " ".join(row[2].split()),
            "active": row[3].strip().upper() != "N",
        }
        order.append(code)

    codes = set(accounts)

    # Rule 2: a group is an account something else hangs under.
    children = Counter()
    by_length = sorted(codes, key=len)
    for code in codes:
        for other in codes:
            if other != code and other.startswith(code):
                children[code] += 1
                break
    groups = {c for c in codes if children[c]}

    # Rule 1: longest declared strict prefix.
    prefixes_by_len = {}
    for code in codes:
        prefixes_by_len.setdefault(len(code), set()).add(code)
    lengths = sorted(prefixes_by_len, reverse=True)

    skips = []
    orphans = []
    for code in codes:
        parent = None
        for length in lengths:
            if length >= len(code):
                continue
            candidate = code[:length]
            if candidate in prefixes_by_len[length]:
                parent = candidate
                break
        accounts[code]["parent"] = parent
        if parent is None and len(code) > 1:
            orphans.append(code)
        elif parent is not None:
            # The ladder is {1,3,5,7,10,12}. Anything that is not the rung
            # immediately below is a skip: legal, but worth naming.
            ladder = [1, 3, 5, 7, 10, 12]
            here = len(code)
            expected = max((r for r in ladder if r < here), default=None)
            if expected is not None and len(parent) != expected and here in ladder:
                skips.append((code, parent))

    # Rule 3: where an account sits, and for goods in transit, where it came from.
    mismatches = []
    unmapped = []
    for code, row in accounts.items():
        row["site"] = None
        row["counterparty"] = None
        if len(code) != 12:
            continue
        suffix = code[-2:]
        site = site_for_suffix(suffix)
        if site is None:
            unmapped.append(code)
            continue
        row["site"] = site
        family = code[:7]
        if family in MATRIX_FAMILIES:
            # `1011203001` is the first source, and 001 is head office.
            sequence = int(code[7:10])
            row["counterparty"] = "dc" if sequence == 1 else f"store-{sequence - 1:02d}"
        else:
            # The leaf names carry `HO` or `C0nn`; disagreement with the suffix
            # is worth reporting rather than silently trusting either one.
            name = row["name"].upper()
            expect = "HO" if suffix == "00" else f"C{int(suffix):03d}"
            if expect not in name.replace("  ", " ").split() and not name.endswith(expect):
                mismatches.append((code, row["name"], expect))

    # ---- the report -------------------------------------------------------
    out = sys.stderr
    lengths_seen = Counter(len(c) for c in codes)
    print(f"accounts read      {len(codes)}", file=out)
    print(f"  groups           {len(groups)}", file=out)
    print(f"  leaves           {len(codes) - len(groups)}", file=out)
    print(f"  inactive         {sum(1 for a in accounts.values() if not a['active'])}", file=out)
    print("by code length     " + "  ".join(
        f"{n}:{lengths_seen[n]}" for n in sorted(lengths_seen)), file=out)
    print(f"located leaves     {sum(1 for a in accounts.values() if a['site'])}", file=out)
    print(f"  of which transit {sum(1 for a in accounts.values() if a['counterparty'])}", file=out)
    print(f"orphans            {len(orphans)}" + (f"  {orphans}" if orphans else ""), file=out)
    off_ladder = sorted(c for c in codes if len(c) not in (1, 3, 5, 7, 10, 12))
    print(f"off-ladder codes   {len(off_ladder)}", file=out)
    for code in off_ladder:
        print(f"  {code} ({len(code)} digits) {accounts[code]['name']!r}"
              f" under {accounts[code]['parent']}", file=out)
    print(f"rung skips         {len(skips)}", file=out)
    for code, parent in sorted(skips):
        print(f"  {code} hangs under {parent}", file=out)
    print(f"unmapped suffixes  {len(unmapped)}" + (f"  {unmapped}" if unmapped else ""), file=out)
    print(f"name/suffix clash  {len(mismatches)}", file=out)
    for code, name, expect in sorted(mismatches):
        print(f"  {code} expected {expect} in {name!r}", file=out)

    if args.dry_run:
        return

    # ---- the SQL ----------------------------------------------------------
    # Parents before children, so the self-referencing foreign key holds at
    # every step rather than needing the constraint deferred.
    print("BEGIN;")
    for code in sorted(codes, key=lambda c: (len(c), c)):
        row = accounts[code]
        print(
            "INSERT INTO ledger_account "
            "(account_code,name,parent_code,is_group,is_active,site_id,counterparty_site_id) VALUES ("
            f"{sql_str(code)},{sql_str(row['name'])},{sql_str(row['parent'])},"
            f"{'true' if code in groups else 'false'},"
            f"{'true' if row['active'] else 'false'},"
            f"{sql_str(row['site'])},{sql_str(row['counterparty'])}) "
            "ON CONFLICT (account_code) DO NOTHING;"
        )
    print("COMMIT;")


if __name__ == "__main__":
    main()
