#!/usr/bin/env python3
"""Import the client's own asset register into the module.

The file is `MASTER ASSET.xls` as they sent it on 2026-09-13: 1,342 rows,
Rp 50.7 billion, purchases from 2016 to 2026, across all fourteen units.

# What this does NOT do

It does not invent. Their register is a schedule of COSTS, not a list of
things: rows are called "HANGER", "KOMPUTER", "INTERIOR", there is no serial
number anywhere, and the `DEPARTEMEN` column is "-" on all 1,342 rows. So
every asset lands here with no serial and no custodian, because they have
none — those start being recorded from the next purchase forward, on GA's
screen.

Neither does it change what is being charged. A row their register calls NON
DEPRECIABLE arrives as `method = NONE` and charges nothing, even where the
client's chart clearly intends a replacement reserve for it (the 201 operating
equipment rows). That is a question for the client, printed at the end, not a
decision for an import script.

# The three mappings, and where each comes from

* **Where** — the unit is the suffix on their ACCOUNT column: `HO`, `C001` …
  `C013`. HO maps to `dc`, the head office and distribution centre being one
  building; `C0nn` maps to `store-nn`.
* **What kind** — their ACCOUNT column without that suffix is the client's own
  account NAME, which is matched against the chart already loaded in this
  database. No second category list is invented: the chart is the register.
* **How it is charged** — depreciation for the ordinary families, a replacement
  reserve for `1021507*` (operating equipment), amortisation for `10217*`
  (software). That mapping is the one migration 0159 wrote down.

Run:  python3 scripts/import_client_assets.py "~/Downloads/MASTER ASSET (2).xls"
      --api http://127.0.0.1:8080            # where to post
      --dry-run                              # print, write nothing
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

import xlrd

UNIT = re.compile(r"\s+(HO|C\d{3})\s*$")


def site_of(account: str) -> str | None:
    """`FFE Komputer C003` → `store-03`; `Sepeda Motor HO` → `dc`."""
    found = UNIT.search(account.strip())
    if found is None:
        return None
    unit = found.group(1)
    if unit == "HO":
        # Head office and the distribution centre are one building — see the
        # co-location note in the project's own docs — and since migration
        # 0256 they are also one `site` row, `ho`, of kind `HO`. This used to
        # return `dc` because that was the only id the building had.
        return "ho"
    return f"store-{int(unit[1:]):02d}"


def account_name(account: str) -> str:
    return UNIT.sub("", account.strip()).strip()


def charge_kind(code: str) -> str:
    if code.startswith("1021507"):
        return "REPLACEMENT_RESERVE"
    if code.startswith("10217"):
        return "AMORTISATION"
    return "DEPRECIATION"


def normalise(text: str) -> str:
    """Their spelling against the chart's: spacing and case drift between the
    two, and `OE - Pajangan Gantungan Lain - Lain` is the chart's
    `OE - Pajangan Gantungan Lain - Lain` with different spaces."""
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def post(api: str, path: str, body: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        f"{api}{path}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as answer:
            return answer.status, json.loads(answer.read() or b"{}")
    except urllib.error.HTTPError as failure:
        raw = failure.read().decode(errors="replace")
        try:
            return failure.code, json.loads(raw)
        except json.JSONDecodeError:
            return failure.code, {"error": raw[:200]}


def get(api: str, path: str) -> dict:
    with urllib.request.urlopen(f"{api}{path}") as answer:
        return json.loads(answer.read() or b"{}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    book = xlrd.open_workbook(os.path.expanduser(args.workbook))
    sheet = book.sheet_by_index(0)
    heading = {c: str(sheet.cell_value(7, c)).strip() for c in range(sheet.ncols)}
    at = {name: c for c, name in heading.items() if name}

    rows = []
    for r in range(9, sheet.nrows):
        name = str(sheet.cell_value(r, at["NAMA ASSET"])).strip()
        if name == "":
            continue
        rows.append({key: sheet.cell_value(r, c) for key, c in at.items()})

    # The chart, as this database holds it. Matched by NAME because that is
    # what their register carries; the code is what we store.
    #
    # Asked family by family rather than in one request: the accounts endpoint
    # answers as a TREE unless it is searching, and a tree of 7,528 accounts
    # arrives as its eight roots. Searching flattens it, and the three prefixes
    # below are the only families an asset may belong to.
    #
    # Family by family rather than by the three roots, because the search caps
    # its answer: `q=10215` returns 500 of the family's 833 accounts, and the
    # ones it drops are the ten-digit categories this needs. Asking for each
    # seven-digit family keeps every answer well under the cap.
    chart = {}
    families = [f"102150{n}" for n in range(1, 8)] + ["1021701", "1021702", "1031803"]
    for prefix in families:
        for account in get(
            args.api, f"/api/v1/finance/accounts?q={prefix}&limit=1000"
        ).get("rows", []):
            code = account["account_code"]
            # The per-unit leaves (`102150700100`) are not categories: an
            # asset's category is the family, and WHERE it is, is its site.
            if len(code) == 10 and code.startswith(prefix):
                chart.setdefault(normalise(account["name"]), code)

    def category_of(name: str) -> str | None:
        """The chart code for one of their account names.

        The bulk load above misses the tail of the biggest family: operating
        equipment has 36 categories across fourteen units and the search caps
        at 500 rows, so `OE - PIN / Kawat Sensor` and `OE - Tas / Keranjang
        Belanja` — the last two — never arrive. Rather than guess a bigger cap,
        anything still unknown is asked for by name, which is one request per
        distinct miss and answers in full.
        """
        key = normalise(name)
        if key in chart:
            return chart[key]
        quoted = urllib.parse.quote(name)
        for account in get(
            args.api, f"/api/v1/finance/accounts?q={quoted}&limit=200"
        ).get("rows", []):
            code = account["account_code"]
            if len(code) == 10 and code.startswith(("10215", "10217", "1031803")):
                if normalise(account["name"]) == key:
                    chart[key] = code
                    return code
        chart[key] = None
        return None

    # What a previous run already landed. One request rather than a failed
    # write per row: a create that collides answers "database operation
    # failed", which is true and useless, and re-running should finish the job
    # rather than print six hundred of those.
    already: set[str] = set()
    cursor = ""
    while True:
        page = get(args.api, f"/api/v1/finance/assets?q=AST-M-&limit=1000{cursor}")
        already.update(row["asset_number"] for row in page.get("rows", []))
        # The endpoint caps a page at a thousand whatever is asked for, so the
        # whole set is read by following its own cursor rather than by asking
        # for a bigger number and believing the answer.
        nxt = page.get("next_cursor")
        if not nxt:
            break
        cursor = f"&cursor={urllib.parse.quote(nxt)}"

    made, skipped, existing, refused = 0, 0, 0, []
    # Two different failures, counted apart: a row whose ACCOUNT names no unit
    # (so nobody knows WHERE the thing is) and a row whose account name is not
    # in the chart (so nobody knows WHAT it is). Lumping them together hides
    # which question to ask the client.
    no_site = collections.Counter()
    unmatched = collections.Counter()
    for index, row in enumerate(rows, start=1):
        if args.limit and made >= args.limit:
            break

        account = str(row["ACCOUNT"]).strip()
        site = site_of(account)
        code = category_of(account_name(account))
        if site is None:
            no_site[account or "(kosong)"] += 1
            continue
        if code is None:
            unmatched[account_name(account) or "(kosong)"] += 1
            continue

        cost = round(float(row["NILAI ASSET"] or 0) * 100)
        if cost <= 0:
            skipped += 1
            continue

        bought = row["TGL BELI"]
        acquired = (
            "%04d-%02d-%02d" % xlrd.xldate_as_tuple(bought, book.datemode)[:3]
            if isinstance(bought, float) and bought > 1000
            else "2016-01-01"
        )

        method_said = str(row["METODE DEPRESIASI"]).strip().upper()
        percent = float(row["PERSEN"] or 0)
        cip = code.startswith("1031803")

        asset = {
            "asset_number": f"AST-M-{index:05d}",
            "name": str(row["NAMA ASSET"]).strip()[:120],
            "category_code": code,
            "site_id": site,
            "acquired_on": acquired,
            # Their register has no serial anywhere, and none may be invented.
            "serial_number": None,
            "notes": f"Dari MASTER ASSET klien, baris {index}. "
            f"Akun: {account}. Tipe: {str(row['TIPE ASSET']).strip()}.",
            "quantity": max(1, int(float(row["JUMLAH"] or 1))),
        }

        if asset["asset_number"] in already:
            existing += 1
            continue

        if args.dry_run:
            made += 1
            continue

        status, answer = post(args.api, "/api/v1/finance/assets", asset)
        if status >= 400:
            # A number this import has already minted is a row that already
            # landed, which makes re-running safe: the first pass stopped where
            # the server refused it, and the second finishes the rest rather
            # than making everything twice.
            said = str(answer.get("error", status))
            if "already" in said.lower() or "duplicate" in said.lower():
                existing += 1
                continue
            refused.append((asset["asset_number"], said))
            continue
        asset_id = answer["asset_id"]

        if cip:
            # Work being paid for on something not built yet: a cost, and
            # nothing else. Migration 0213.
            assessment = {
                "decision": "IN_PROGRESS",
                "capitalized_cost_minor": cost,
                "reason": f"Contract In Progress dari register klien, baris {index}",
            }
        else:
            depreciating = method_said == "STRAIGHT LINE" and percent > 0
            assessment = {
                "decision": "CAPITALIZE",
                "capitalized_cost_minor": cost,
                "salvage_value_minor": 0,
                "method": "STRAIGHT_LINE" if depreciating else "NONE",
                "charge_kind": charge_kind(code),
                "in_service_on": acquired,
                "reason": f"Nilai dan tarif dari register klien, baris {index}"
                f" ({method_said.title()}"
                + (f", {percent:g}%" if percent else "")
                + ")",
            }
            if depreciating:
                assessment["rate_bps"] = round(percent * 100)
            else:
                # `NONE` means no charge, and the schema wants a life of zero
                # to say so out loud rather than leaving it absent.
                assessment["useful_life_months"] = 0

        status, answer = post(
            args.api, f"/api/v1/finance/assets/{asset_id}/assess", assessment
        )
        if status >= 400:
            refused.append((asset["asset_number"], answer.get("error", status)))
            continue
        made += 1

    print(f"dibaca   : {len(rows)} baris")
    print(f"dibuat   : {made}")
    print(f"sudah ada: {existing}")
    print(f"nilai 0  : {skipped}")
    if no_site:
        print(f"tanpa unit: {sum(no_site.values())} baris — ACCOUNT tidak menyebut HO/C0nn")
        for name, many in no_site.most_common(12):
            print(f"    {many:>4}  {name!r}")
    if unmatched:
        print(f"tak cocok : {sum(unmatched.values())} baris, {len(unmatched)} nama akun")
        for name, many in unmatched.most_common(12):
            print(f"    {many:>4}  {name}")
    if refused:
        print(f"ditolak  : {len(refused)}")
        for number, why in refused[:12]:
            print(f"    {number}  {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
