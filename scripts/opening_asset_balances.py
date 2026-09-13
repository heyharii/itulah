#!/usr/bin/env python3
"""Work out what each asset had already depreciated before this system, and
print the reconciliation the client's accountant has to tick.

# Why this is computed and not imported

Their register has a column for it — `S/D TAHUN LALU` — and it is zero on all
1,342 rows. So the figure exists in exactly one place: the balances of `10216*`
in the books being replaced. Those balances are per unit per sub-family, which
is precisely the granularity this module files assets at, so the two can be
compared account by account rather than as one number nobody can check.

What this script does is compute the other side of that comparison. Every input
it needs is already recorded: cost, salvage, life, method and the month the
asset went into service. Straight line and declining balance are the same two
functions `domain::depreciation` runs, so the figure produced here is what this
system WOULD have charged had it been running since the asset went into service
— which is the only defensible opening figure: any other one makes the schedule
from the cutover onwards disagree with its own arithmetic.

# What it refuses to do

It does not write the client's number. It prints ours beside the account it
belongs to, and `--write` records it only when somebody has decided to. A
difference against their `10216*` balance is a question for their accountant —
an asset written down on a different policy, a disposal never recorded, a
revaluation their chart cannot even hold — and answering it by adjusting our
side to match would bury the very thing worth finding.

Operating equipment is computed and reported apart: the owner's decision is
that the replacement accrual is OFF, so those figures are for reading, not for
carrying in. `--include-oe` overrides that.

Run:
    python3 scripts/opening_asset_balances.py --cutover 2026-08
    python3 scripts/opening_asset_balances.py --cutover 2026-08 --csv /tmp/opening.csv
    python3 scripts/opening_asset_balances.py --cutover 2026-08 --write --api http://127.0.0.1:8097
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import subprocess
import sys
import urllib.error
import urllib.request

SEP = "\x1f"

# What each charge kind credits, as `account_map` knows it.
CONTRA_KEY = {
    "DEPRECIATION": "accumulated_depreciation",
    "REPLACEMENT_RESERVE": "replacement_reserve",
    "AMORTISATION": "accumulated_amortisation",
}


def psql(database: str, sql: str) -> list[list[str]]:
    out = subprocess.run(["psql", "-d", database, "-tAF", SEP, "-c", sql],
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"psql failed:\n{out.stderr.strip()}")
    return [line.split(SEP) for line in out.stdout.splitlines() if line.strip()]


def months_between(start: dt.date, end: dt.date) -> int:
    """The period index `domain::depreciation` counts: 0 for the month an asset
    went into service, 1 for the next."""
    return (end.year - start.year) * 12 + (end.month - start.month)


def charged_through(cost: int, salvage: int, life: int, method: str,
                    in_service: dt.date, cutover: dt.date) -> int:
    """What this system would have charged from service to the cutover month,
    inclusive — using the same truncation and the same final sweep.

    Straight line truncates every month and the last instalment takes the
    remainder; declining balance takes a shrinking share of a shrinking book
    value and would never arrive at salvage without that same last instalment.
    Both are replayed rather than approximated, because an opening figure that
    disagrees with the engine leaves a schedule that cannot end on salvage.
    """
    depreciable = cost - salvage
    if depreciable <= 0 or life <= 0 or method == "NONE":
        return 0
    instalments = min(max(months_between(in_service, cutover) + 1, 0), life)
    if instalments >= life:
        return depreciable
    if method == "STRAIGHT_LINE":
        return (depreciable // life) * instalments
    # DECLINING: 2 x book value / (12 x life), month by month, in integers.
    accumulated = 0
    for _ in range(instalments):
        book = cost - accumulated
        charge = (2 * book) // (12 * life)
        if charge <= 0:
            break
        accumulated = min(accumulated + charge, depreciable)
    return accumulated


def money(minor: int) -> str:
    return f"{minor / 100:,.0f}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--database", default="inventory_rfid")
    ap.add_argument("--cutover", required=True, help="bulan terakhir yang dicharge buku lama, YYYY-MM")
    ap.add_argument("--csv", help="tulis rincian per aset ke file ini")
    ap.add_argument("--include-oe", action="store_true",
                    help="ikutkan operating equipment (akrual cadangan — pemilik memutuskan OFF)")
    ap.add_argument("--write", action="store_true", help="rekam penilaian baru lewat API")
    ap.add_argument("--api", default="http://127.0.0.1:8097")
    args = ap.parse_args()

    year, month = (int(part) for part in args.cutover.split("-"))
    cutover = dt.date(year, month, 1)

    rows = psql(args.database, f"""
        SELECT a.asset_id, a.asset_number, a.name, a.category_code, a.site_id,
               k.decision, k.method, coalesce(k.charge_kind,'DEPRECIATION'),
               k.capitalized_cost_minor, k.salvage_value_minor, k.useful_life_months,
               k.in_service_on, coalesce(k.opening_accumulated_minor::text,''),
               coalesce(k.opening_through::text,''), coalesce(k.rate_bps::text,''),
               coalesce((SELECT sum(d.amount_minor) FROM asset_depreciation_entry d
                          WHERE d.asset_id = a.asset_id), 0)
          FROM fixed_asset a
          JOIN LATERAL (SELECT * FROM asset_capitalization x
                         WHERE x.asset_id = a.asset_id
                         ORDER BY x.sequence DESC LIMIT 1) k ON true
         WHERE a.status <> 'DISPOSED'
         ORDER BY a.asset_number""")

    accounts = {(r[0], r[1], r[2]): r[3] for r in psql(
        args.database, "SELECT semantic_key, site_id, qualifier, account_code FROM account_map")}
    names = {r[0]: r[1] for r in psql(args.database, "SELECT account_code, name FROM ledger_account")}

    per_account: dict[str, int] = collections.defaultdict(int)
    cip_per_unit: dict[str, int] = collections.defaultdict(int)
    detail: list[dict] = []
    counts = collections.Counter()
    unmapped = collections.Counter()

    for r in rows:
        (asset_id, number, name, category, site, decision, method, kind,
         cost, salvage, life, in_service, opening_now, opening_through, _rate, posted) = r

        if decision == "IN_PROGRESS":
            # Work in progress carries a cost and charges nothing. Its opening
            # balance is the cost itself, sitting in the client's CIP account
            # per unit — the balance the reclass journal will one day move out.
            cip_per_unit[f"{category}|{site}"] += int(cost or 0)
            counts["work in progress"] += 1
            continue
        if decision != "CAPITALIZE":
            counts["expensed"] += 1
            continue
        if method == "NONE":
            counts["tidak disusutkan (tanah)"] += 1
            continue
        if kind == "REPLACEMENT_RESERVE" and not args.include_oe:
            counts["operating equipment (akrual OFF)"] += 1
            continue

        opening = charged_through(int(cost), int(salvage), int(life), method,
                                  dt.date.fromisoformat(in_service), cutover)
        if opening <= 0:
            counts["belum mencharge apa pun sebelum cutover"] += 1
            continue
        if opening_now:
            counts["saldo awal sudah tercatat"] += 1
            continue
        if int(posted) > 0:
            # This system has already charged it. Carrying a figure in now
            # would sit beside entries that assumed there was none.
            counts["sudah dicharge di sini — dilewati"] += 1
            continue

        account = accounts.get((CONTRA_KEY[kind], site, category))
        if account is None:
            unmapped[f"{CONTRA_KEY[kind]} {category} @ {site}"] += 1
        else:
            per_account[account] += opening
        counts["dihitung"] += 1
        detail.append({
            "asset_number": number, "name": name, "site": site, "category": category,
            "kind": kind, "method": method, "cost_minor": cost, "life_months": life,
            "in_service_on": in_service, "opening_minor": opening,
            "opening_through": cutover.isoformat(), "account": account or "",
            "account_name": names.get(account or "", ""),
            "asset_id": asset_id,
        })

    print(f"cutover: {cutover:%Y-%m} · aset dibaca: {len(rows)}")
    for label, n in counts.most_common():
        print(f"   {label:38} {n}")
    if unmapped:
        print("\nTIDAK TERPETA (tidak bisa direkonsiliasi ke akun):")
        for line, n in unmapped.most_common(10):
            print(f"   {line}  ×{n}")

    total = sum(per_account.values())
    print(f"\nsaldo awal yang dihitung: Rp {money(total)} atas {len(detail)} aset")
    print("\nrekonsiliasi — cocokkan tiap baris dengan saldo akun di buku lama:")
    print(f"   {'AKUN':<14} {'NAMA':<44} {'KITA (Rp)':>18}")
    for code, amount in sorted(per_account.items(), key=lambda kv: -kv[1])[:25]:
        print(f"   {code:<14} {names.get(code,'')[:44]:<44} {money(amount):>18}")
    if len(per_account) > 25:
        rest = sum(sorted(per_account.values(), reverse=True)[25:])
        print(f"   {'…':<14} {len(per_account)-25} akun lain{'':<33} {money(rest):>18}")

    if cip_per_unit:
        print(f"\ncontract in progress — biaya yang menunggu dikapitalisasi:")
        for key, amount in sorted(cip_per_unit.items(), key=lambda kv: -kv[1]):
            category, site = key.split("|")
            print(f"   {site:<10} {category:<12} {money(amount):>18}")
        print(f"   {'TOTAL':<23} {money(sum(cip_per_unit.values())):>18}")

    if args.csv:
        with open(args.csv, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(detail[0].keys()) if detail else ["asset_number"])
            writer.writeheader()
            writer.writerows(detail)
        print(f"\nrincian per aset: {args.csv}")

    if not args.write:
        print("\nlaporan saja; tambahkan --write untuk merekam penilaian saldo awal")
        return 0

    written, refused = 0, []
    for row in detail:
        body = {
            "decision": "CAPITALIZE",
            "capitalized_cost_minor": int(row["cost_minor"]),
            "salvage_value_minor": 0,
            "useful_life_months": int(row["life_months"]),
            "method": row["method"],
            "charge_kind": row["kind"],
            "in_service_on": row["in_service_on"],
            "opening_accumulated_minor": int(row["opening_minor"]),
            "opening_through": row["opening_through"],
            "reason": f"Saldo awal penyusutan s/d {args.cutover}, dihitung dari tanggal "
                      f"perolehan dan tarif register klien; direkonsiliasi ke {row['account']}.",
        }
        request = urllib.request.Request(
            f"{args.api}/api/v1/finance/assets/{row['asset_id']}/assess",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request) as answer:
                answer.read()
                written += 1
        except urllib.error.HTTPError as failure:
            refused.append(f"{row['asset_number']}: {failure.read().decode(errors='replace')[:160]}")
    print(f"\nditulis: {written} · ditolak: {len(refused)}")
    for line in refused[:10]:
        print("   ", line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
