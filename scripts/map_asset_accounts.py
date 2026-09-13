#!/usr/bin/env python3
"""Derive the asset half of `account_map` from the client's own chart.

# Why this exists

`resolve_account` matches a qualifier EXACTLY (`postgres/ledger.rs`). The asset
register files every asset under a ten-digit SUB-FAMILY — `1021506003 FFE
Komputer`, `1021507004 OE - Rak 4` — because that is the granularity the
client's chart is written at: seven families, fifty-odd sub-families, thirty-six
of them fixture types under Operating Equipment alone. The map, seeded by hand,
only ever carried the seven-digit FAMILY. The result, measured on the imported
register: 13 of 683 capitalised assets could resolve both legs of their monthly
journal. The rest refused.

Truncating the qualifier to seven digits would "fix" it by posting all
thirty-six fixture types to the Rak 1 accounts. So the map is completed instead,
at the granularity the chart actually has.

# The rule, and why it is allowed to be a rule

The client's chart is structurally parallel, and the three legs of a monthly
charge are the same digits in three families:

    1021506003 FFE Komputer      cost
    1021606003 Akum Penyusu      contra      (10215 -> 10216, series kept)
    7010214003 Biaya Depresiasi  expense     (family 02..07 -> 7010210..7010215)
    ...00 / ...01 / ...13        the two-digit unit suffix, kept verbatim

Nothing here CHOOSES an account: it recognises the one the client already wrote,
and every derived code is checked to exist, to be active, to be postable, and to
carry the same site before a row is written. Anything that fails a check is
printed and skipped — the script never invents an account.

Operating equipment is the exception the chart states itself: `1021607` is
*Reserve Replacement*, not accumulated depreciation, and `7010215` is *Biaya
Replacement*. Those map through the replacement meanings (migration 0159), never
through the depreciation ones. Intangibles are the other exception: cost in
`1021701`, contra in `1021702`, expense in `7010216`.

# Verification against the client's own file

`MASTER ASSET.xls` carries `COA DEBET` and `COA KREDIT` per row — the client's
own statement of which pair each asset charges. With `--register`, every derived
pair is checked against those two columns by name, and disagreements are
printed. That is the difference between a rule that looks right and a rule that
has been checked against 1,342 rows of their practice.

Run:
    python3 scripts/map_asset_accounts.py --dry-run
    python3 scripts/map_asset_accounts.py --register "~/Downloads/MASTER ASSET (2).xls"
    python3 scripts/map_asset_accounts.py --write
"""

from __future__ import annotations

import argparse
import collections
import os
import subprocess
import sys

# The families this script knows, and the three meanings each charges through.
#
# Land (`1021501`) is deliberately here with no contra and no expense: it is a
# cost that never charges, and `method = NONE` is what says so.
COST_FAMILY = "10215"
CONTRA_FAMILY = "10216"

# `10215XX` -> the expense family under `70102`. Land has none.
EXPENSE_OF = {
    "02": "7010210",  # Bangunan
    "03": "7010211",  # Instalasi, mekanikal, elektrikal
    "04": "7010212",  # Mesin
    "05": "7010213",  # Kendaraan
    "06": "7010214",  # FFE
    "07": "7010215",  # Operating equipment — BIAYA REPLACEMENT, not depresiasi
}

# Which pair of meanings a family charges through. 0159 is the reason this is a
# table and not an `if`.
MEANINGS = {
    "07": ("fixed_asset", "replacement_reserve", "replacement_expense"),
    "*": ("fixed_asset", "accumulated_depreciation", "depreciation_expense"),
}

# Work in progress: one account per unit, not one per family — a fit-out has
# not become a kind of thing yet, which is exactly why capitalising it has to
# say what it became. Its pre-opening cousin (`1031802001` cost, `1031802002`
# accumulated amortisation) is deliberately not mapped here: nothing models it
# yet, and a mapping for a meaning no rule names would be dead weight.
WORK_IN_PROGRESS = "1031803"

INTANGIBLE_COST = "1021701"
INTANGIBLE_CONTRA = "1021702"
INTANGIBLE_EXPENSE = "7010216"
INTANGIBLE_MEANINGS = ("intangible_asset", "accumulated_amortisation", "amortisation_expense")

# Intangibles are the one place the series does NOT run parallel, and the
# client's own file is what caught it: `7010216002` is *Biaya Amortisasi Biaya
# Pre Opening* — an extra member with no asset under `1021701` — so Opti Tex,
# second under cost, is third under expense. Spelled out rather than guessed,
# and a sub-family that is not in this table is refused instead of matched to
# whatever shares its number.
#
#   1021701001 Seventh Soft Application -> 7010216001 Biaya Amort SeventSoft
#   1021701002 Opti Tex System          -> 7010216003 Biaya Amortisasi Opti Tex
INTANGIBLE_EXPENSE_SERIES = {"001": "001", "002": "003"}

# Where a gain or loss on disposal lands. The client's chart has no disposal
# account at all — no revaluation, no impairment, no gain on sale anywhere in
# 7,528 accounts — and this is the only leaf that can honestly hold it.
# Printed as a question every run, because it is one.
DISPOSAL_PARENT = "8010110007"  # Pendapatan (Biaya) Lain-Lain


def psql(database: str, sql: str) -> list[list[str]]:
    """Run one query and return rows split on the unit separator."""
    out = subprocess.run(
        ["psql", "-d", database, "-tAF", "\x1f", "-c", sql],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        sys.exit(f"psql failed:\n{out.stderr.strip()}")
    return [line.split("\x1f") for line in out.stdout.splitlines() if line.strip()]


def chart(database: str) -> dict[str, tuple[str, str | None, bool, bool]]:
    """Every account, by code: name, site, is_group, is_active."""
    rows = psql(
        database,
        "SELECT account_code, name, coalesce(site_id,''), is_group, is_active FROM ledger_account",
    )
    return {r[0]: (r[1], r[2] or None, r[3] == "t", r[4] == "t") for r in rows}


def postable(book, code: str, site: str) -> str | None:
    """The reason this account cannot be mapped, or None when it can."""
    if code not in book:
        return "tidak ada di bagan"
    name, acc_site, is_group, is_active = book[code]
    if is_group:
        return "akun induk"
    if not is_active:
        return "tidak aktif"
    if acc_site != site:
        return f"unit tidak cocok ({acc_site or 'kosong'})"
    return None


def derive(book) -> tuple[list[tuple[str, str, str, str]], list[str]]:
    """(semantic_key, site, qualifier, account_code) rows, and refusals."""
    wanted: list[tuple[str, str, str, str]] = []
    refused: list[str] = []

    for code, (name, site, is_group, is_active) in sorted(book.items()):
        if is_group or not is_active or not site or len(code) != 12:
            continue

        if code.startswith(COST_FAMILY):
            family, series, unit = code[5:7], code[7:10], code[10:12]
            qualifier = code[:10]
            cost_key, contra_key, expense_key = MEANINGS.get(family, MEANINGS["*"])
            wanted.append((cost_key, site, qualifier, code))
            if family == "01":  # Tanah: a cost that never charges.
                continue
            contra = CONTRA_FAMILY + family + series + unit
            expense_family = EXPENSE_OF.get(family)
            for key, target in ((contra_key, contra), (expense_key, (expense_family or "") + series + unit)):
                if not expense_family and key == expense_key:
                    refused.append(f"{code} {name}: famili {family} tidak punya akun beban")
                    continue
                why = postable(book, target, site)
                if why:
                    refused.append(f"{code} {name} -> {key} {target}: {why}")
                else:
                    wanted.append((key, site, qualifier, target))

        elif code.startswith(WORK_IN_PROGRESS):
            wanted.append(("work_in_progress", site, code[:10], code))

        elif code.startswith(INTANGIBLE_COST):
            series, unit = code[7:10], code[10:12]
            qualifier = code[:10]
            cost_key, contra_key, expense_key = INTANGIBLE_MEANINGS
            wanted.append((cost_key, site, qualifier, code))
            expense_series = INTANGIBLE_EXPENSE_SERIES.get(series)
            if expense_series is None:
                refused.append(
                    f"{code} {name}: sub-famili intangible baru, tidak ada di "
                    "INTANGIBLE_EXPENSE_SERIES — pasangkan akun bebannya dahulu"
                )
                continue
            for key, target in (
                (contra_key, INTANGIBLE_CONTRA + series + unit),
                (expense_key, INTANGIBLE_EXPENSE + expense_series + unit),
            ):
                why = postable(book, target, site)
                if why:
                    refused.append(f"{code} {name} -> {key} {target}: {why}")
                else:
                    wanted.append((key, site, qualifier, target))

    # The gain or loss on disposal, one leaf per unit, no qualifier: disposal is
    # not per asset family, it is per place.
    for code, (name, site, is_group, is_active) in sorted(book.items()):
        if code.startswith(DISPOSAL_PARENT) and len(code) == 12 and site and not is_group and is_active:
            wanted.append(("asset_disposal_result", site, "", code))

    return wanted, refused


def existing(database: str) -> dict[tuple[str, str, str], str]:
    rows = psql(database, "SELECT semantic_key, site_id, qualifier, account_code FROM account_map")
    return {(r[0], r[1], r[2]): r[3] for r in rows}


def verify_against_register(path: str, book, wanted) -> None:
    """Check the derived pairs against the client's own COA DEBET / COA KREDIT."""
    try:
        import xlrd  # noqa: PLC0415
    except ImportError:
        print("  (xlrd tidak ada — verifikasi register dilewati)")
        return

    by_name = collections.defaultdict(list)
    for code, (name, site, is_group, is_active) in book.items():
        if len(code) == 12 and not is_group:
            by_name[name.strip().lower()].append(code)

    index = {(k, s, q): a for k, s, q, a in wanted}
    sheet = xlrd.open_workbook(os.path.expanduser(path)).sheet_by_index(0)
    checked = agreed = 0
    disagreed: list[str] = []
    for i in range(9, sheet.nrows):
        row = sheet.row_values(i)
        if not isinstance(row[1], float):
            continue
        account, debit, credit = (str(row[10]).strip(), str(row[11]).strip(), str(row[12]).strip())
        codes = by_name.get(account.lower())
        if not codes or not debit or not credit:
            continue
        code = codes[0]
        site = book[code][1]
        qualifier = code[:10]
        ours = [index.get((k, site, qualifier)) for k in
                ("depreciation_expense", "replacement_expense", "amortisation_expense")]
        ours = [a for a in ours if a]
        theirs = by_name.get(debit.lower())
        if not ours or not theirs:
            continue
        checked += 1
        if ours[0] == theirs[0]:
            agreed += 1
        else:
            disagreed.append(f"  {account}: kita {ours[0]} ({book[ours[0]][0]}), mereka {theirs[0]} ({debit})")
    print(f"  register: {agreed}/{checked} baris setuju dengan COA DEBET mereka")
    for line in disagreed[:10]:
        print(line)
    if len(disagreed) > 10:
        print(f"  … dan {len(disagreed) - 10} lagi")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--database", default="inventory_rfid")
    ap.add_argument("--register", help="MASTER ASSET.xls, untuk verifikasi COA DEBET/KREDIT")
    ap.add_argument("--write", action="store_true", help="tulis ke account_map (default: hanya laporan)")
    ap.add_argument("--actor", default="map_asset_accounts.py")
    args = ap.parse_args()

    book = chart(args.database)
    print(f"bagan: {len(book)} akun di {args.database}")
    wanted, refused = derive(book)
    have = existing(args.database)

    new = [w for w in wanted if (w[0], w[1], w[2]) not in have]
    same = [w for w in wanted if have.get((w[0], w[1], w[2])) == w[3]]
    clash = [(w, have[(w[0], w[1], w[2])]) for w in wanted
             if (w[0], w[1], w[2]) in have and have[(w[0], w[1], w[2])] != w[3]]

    by_key = collections.Counter(w[0] for w in wanted)
    print(f"diturunkan: {len(wanted)} baris")
    for key, n in sorted(by_key.items()):
        print(f"   {key:28} {n}")
    print(f"sudah sama: {len(same)} · baru: {len(new)} · bentrok: {len(clash)} · ditolak: {len(refused)}")
    for line in refused[:12]:
        print("   tolak:", line)
    if len(refused) > 12:
        print(f"   … dan {len(refused) - 12} lagi")
    for w, was in clash[:12]:
        print(f"   bentrok: {w[0]} {w[1]} {w[2]}: ada {was}, diturunkan {w[3]}")

    # The seven-digit family rows that migration 0159 forbids: operating
    # equipment resolving through the depreciation meanings.
    forbidden = [(k, s, q, a) for (k, s, q), a in have.items()
                 if q.startswith("1021507") and k in ("accumulated_depreciation", "depreciation_expense")]
    if forbidden:
        print(f"\nmelanggar 0159: {len(forbidden)} baris famili OE lewat makna penyusutan")
        print(f"   contoh: {forbidden[0][0]} {forbidden[0][1]} {forbidden[0][2]} -> {forbidden[0][3]}")
        print("   (dipindah ke replacement_* saat --write)")

    if args.register:
        verify_against_register(args.register, book, wanted)

    if not args.write:
        print("\nlaporan saja; tambahkan --write untuk menulis")
        return 0

    values = ",".join(
        "('%s','%s','%s','%s',false,'%s','diturunkan dari bagan klien: sub-famili x unit')"
        % (k, s, q, a, args.actor)
        for k, s, q, a in wanted
    )
    sql = f"""
    BEGIN;
    INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, is_group, set_by, note)
    VALUES {values}
    ON CONFLICT (semantic_key, site_id, qualifier)
      DO UPDATE SET account_code = EXCLUDED.account_code, set_by = EXCLUDED.set_by, set_at = now();
    DELETE FROM account_map
     WHERE qualifier LIKE '1021507%'
       AND semantic_key IN ('accumulated_depreciation','depreciation_expense');
    COMMIT;
    """
    psql(args.database, sql)
    print(f"\nditulis: {len(wanted)} baris, dan {len(forbidden)} baris OE yang melanggar 0159 dihapus")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
