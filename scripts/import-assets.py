#!/usr/bin/env python3
"""Import CENTRAL FASHION STORE's fixed-asset register from their own export.

# SUPERSEDED — 18 September 2026

`scripts/import_client_assets.py` is the importer that is run and the one the
migrations and `docs/erpnext-assets.md` name. This one reads the same register
and writes ten-digit account codes into `fixed_asset.category_code`, which
since 0287 references `asset_class(class_code)` and not `ledger_account` — so
every row it writes is refused by a foreign key. The account_map triples it
derives (cost, contra, expense per sub-family) are the job
`scripts/map_asset_accounts.py` did, and that is retired for the same reason.

Kept for its audit report, which is the part of it nothing else reproduces: it
names every row skipped, every figure interpreted, and every place the client's
own register disagrees with the client's own chart. Run it with `--dry-run`,
read the report, and load through `import_client_assets.py`.

    python3 scripts/import-assets.py \
        --master ~/Downloads/"MASTER ASSET.xls" \
        --coa ~/Downloads/Laporan_Master_Account1.csv \
        --policy ~/Downloads/"Daftar asset.xls" \
        --dry-run

The audit report always goes to stderr and the report is the point: read it
before loading anything. It names every row this script skipped, every figure
it had to interpret, and every place the client's own file disagrees with the
client's own chart.

Two files, because the register alone is not enough:

  * `MASTER ASSET.xls` — 1,342 rows, the live register. Carries the cost, the
    rate, the life, the purchase date, and — crucially — the NAME of the three
    accounts each row posts through.
  * `Laporan_Master_Account1.csv` — the chart. Turns those names into codes.
    All 261 asset accounts, 255 expense accounts and 255 contra accounts named
    in the register resolve to exactly one 12-digit leaf each, with no
    ambiguity, which is why this script maps accounts from the client's own
    words rather than deriving them.

`--policy` is optional and reads the class-level rate table out of
`Daftar asset.xls`. It changes nothing; it only lets the report say which rows
are charged at a rate their own class does not carry.

# What this script does NOT do, and why

**It does not invent accumulated depreciation.** The register's
`S/D TAHUN LALU` column is zero on all 1,342 rows, because their report
recomputes accumulated from the rate every time it is opened — the cell
comments in `Daftar asset.xls` say so in as many words. So every asset here
arrives with a cost and no history, which means a book value equal to its
cost. That is WRONG for an asset bought in 2018 and it is deliberately wrong:
the opening figure has to come from their general ledger, per account, and
loading a computed guess would produce a balance sheet that disagrees with
theirs by an amount nobody could explain. Registering the assets is step one;
the opening entry is step two and waits for the ledger.

**It does not import Contract In Progress.** 668 rows, Rp 5.65 billion, all
dated 2016–2018, all with an empty expense and contra account. They live under
`1031803` in the chart, which is not an asset family, and it is not yet known
whether that balance is still on the books or whether these rows are the
residue of work capitalised years ago. Importing them under either reading
risks counting the same money twice.

**It does not import the four rows the register has switched off.** Two cars,
a building and a plot of land, Rp 11.01 billion. Whether they were sold —
and on what date, which 0070 requires — or merely stopped being charged is a
question for the client, and `--include-inactive` is here for when it is
answered.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import xls  # noqa: E402  (a sibling script, not a package)

# The families an asset's cost can sit under, and the one that is not an asset
# at all. Mirrors `ASSET_FAMILIES` in `postgres/assets.rs`.
ASSET_FAMILIES = ("10215", "10217")
CIP_FAMILY = "1031803"

# The month the client's asset module went live. 92 rows carry it as their
# `PERIODE` while their purchase dates run back to 2016, which is what a
# conversion batch looks like: everything already owned was loaded at once and
# began charging from then. No schedule of ours may start earlier.
GO_LIVE_MONTH = "2017-02"

# Mirrors `ChargeKind` in `domain/depreciation.rs`. The client's seventh asset
# family is accrued for replacement rather than depreciated, and their
# intangibles are amortised; see migration 0159.
CHARGE_KEYS = {
    "DEPRECIATION": ("fixed_asset", "depreciation_expense", "accumulated_depreciation"),
    "REPLACEMENT_RESERVE": ("fixed_asset", "replacement_expense", "replacement_reserve"),
    "AMORTISATION": (
        "intangible_asset",
        "amortisation_expense",
        "accumulated_amortisation",
    ),
}

# What each meaning is called in the client's own vocabulary. Only used in the
# correction list: a message that says `accumulated_depreciation` to an
# accountant is a message written for us and not for them.
MEANING_IN_INDONESIAN = {
    "fixed_asset": "Akun harta",
    "intangible_asset": "Akun harta tak berwujud",
    "depreciation_expense": "Biaya depresiasi",
    "accumulated_depreciation": "Akumulasi penyusutan",
    "replacement_expense": "Biaya replacement",
    "replacement_reserve": "Cadangan penggantian (RR)",
    "amortisation_expense": "Biaya amortisasi",
    "accumulated_amortisation": "Akumulasi amortisasi",
}


def unit_name(site_id: str) -> str:
    """Back to the client's own code. They have never seen `store-04`."""
    if site_id == "ho":
        return "HO"
    return f"C{int(site_id.rsplit('-', 1)[1]):03d}"


# Columns of the register, by position. Named here so a shifted column is one
# edit and not a hunt through the file.
COL_NO = 1
COL_NAME = 2
COL_VALUE = 3
COL_PERCENT = 4
COL_YEARS = 5
COL_PRIOR = 6
COL_QUANTITY = 7
COL_PURCHASED = 8
COL_PERIOD = 9
COL_ASSET_ACCOUNT = 10
COL_EXPENSE_ACCOUNT = 11
COL_CONTRA_ACCOUNT = 12
COL_TYPE = 15
COL_STATUS = 17
FIRST_DATA_ROW = 8


# `00` is head office, which is `site.ho` since 0256; `01`..`13` are
# C001..C013, whose ids did not move. The same ordinal assumption
# `import-coa.py` records, and the same one to check before anybody compares a
# balance to the client's books: their files never join a store NAME to a
# `C0nn` code.
def site_for_suffix(suffix: str):
    if suffix == "00":
        return "ho"
    if suffix.isdigit() and 1 <= int(suffix) <= 13:
        return f"store-{int(suffix):02d}"
    return None


def normalise(name: str) -> str:
    """One spelling for one account.

    The register and the chart are written by the same system and still do not
    agree character for character: `Akum Penyusu - FFE Komputer C003` against
    `Akum Penyusu- FFE Komputer C003`, double spaces, and `-` where the other
    has `/`. Folding those three differences resolves all 771 distinct names
    to exactly one account each; folding fewer leaves a handful unmatched, and
    an unmatched contra account is an asset that cannot be charged.
    """
    text = name.strip().lower()
    text = text.replace("penyusu -", "penyusu").replace("penyusu-", "penyusu")
    text = text.replace("penyu ", "penyusu ")
    text = re.sub(r"[-/]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def read_chart(path: str) -> tuple[dict[str, list[str]], dict[str, str]]:
    """(account name -> its 12-digit leaves, account code -> its name).

    The second is only for the correction list, which has to name a class the
    way the client wrote it: `FFE Komputer`, not `1021506003`.
    """
    by_name: dict[str, list[str]] = defaultdict(list)
    names: dict[str, str] = {}
    with open(path, encoding="latin-1") as handle:
        for row in csv.reader(handle):
            if len(row) < 4:
                continue
            code, name = row[1].strip(), row[2].strip()
            if re.fullmatch(r"\d{1,12}", code):
                names[code] = name
            if re.fullmatch(r"\d{12}", code):
                by_name[normalise(name)].append(code)
    return by_name, names


def read_policy(path: str) -> dict[str, float]:
    """Class name -> the rate that class is supposed to carry.

    Their own class register, and it is a quarter filled: 14 of 57 classes
    name a rate. Which is why this is a report and not a rule.
    """
    sheet = next(iter(xls.parse(path).values()))
    rates: dict[str, float] = {}
    for row in range(6, 82):
        code = sheet.get((row, 0))
        name = str(sheet.get((row, 1), "")).strip()
        try:
            code = int(float(code))
        except (TypeError, ValueError):
            continue
        if code < 100 or not name:
            continue
        try:
            rates[normalise(name)] = float(sheet.get((row, 4)))
        except (TypeError, ValueError):
            pass
    return rates


def text(row: dict, col: int) -> str:
    return str(row.get(col, "")).strip()


def number(row: dict, col: int):
    try:
        return float(str(row.get(col, "")).strip())
    except (TypeError, ValueError):
        return None


class Api:
    def __init__(self, base: str, dry: bool) -> None:
        self.base = base.rstrip("/")
        self.dry = dry
        self.calls = 0
        self.failures: list[str] = []

    def post(self, path: str, body: dict):
        if self.dry:
            self.calls += 1
            return {}
        request = urllib.request.Request(
            f"{self.base}{path}",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                self.calls += 1
                raw = response.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            self.failures.append(f"{path} -> {exc.code} {exc.read().decode()[:200]}")
            return None
        except Exception as exc:  # noqa: BLE001
            self.failures.append(f"{path} -> {exc}")
            return None


def emit_defects(
    wrong_column, conflicts, evidence, rate_deviation, never_charges, chart_names
) -> None:
    """The correction list, as a message somebody can paste into WhatsApp.

    Written to stdout while the audit goes to stderr, so `--defects > pesan.txt`
    gives the message on its own.

    Every item names the spreadsheet row, because a defect report the client
    cannot open at the right line is a report they will not act on. And every
    item says what is wrong rather than what we would prefer: these are their
    books, and the corrections are theirs to make before the final export.
    """
    say = print
    say("Pak, dari file MASTER ASSET.xls kami menemukan beberapa baris yang")
    say("sepertinya perlu dikoreksi lebih dulu. Nomor barisnya kami sebutkan")
    say("supaya bisa langsung dibuka di Excel.")
    say("")

    if wrong_column:
        say("A. KOLOM ACCOUNT BERISI JENIS AKUN YANG SALAH")
        say("")
        say("   Kolom ACCOUNT semestinya berisi akun harta (10215/10217),")
        say("   tetapi baris berikut mengisinya dengan akun cadangan (RR OE - ...)")
        say("   atau akun beban (Biaya Replacement OE - ...). Karena itu baris")
        say("   ini belum bisa kami pindahkan ke sistem baru.")
        say("")
        for line, name, code, account_name in wrong_column:
            say(f"   - Baris {line} ({name})")
            say(f"       tertulis : {code} {account_name}")
        say("")

    if conflicts:
        say("B. SATU JENIS ASET DI SATU TOKO MEMAKAI DUA AKUN BERBEDA")
        say("")
        say("   Untuk kelompok aset yang sama di toko yang sama, ada baris yang")
        say("   menunjuk akun berbeda. Kami tidak bisa menebak mana yang benar,")
        say("   jadi aset di kelompok ini belum bisa dihitung depresiasinya.")
        say("")
        for (key, site, category), codes in sorted(conflicts.items()):
            meaning = MEANING_IN_INDONESIAN.get(key, key)
            klass = chart_names.get(category, category)
            say(f"   {meaning} untuk {klass} di {unit_name(site)}:")
            for code in sorted(codes):
                rows = evidence.get((key, site, category, code), [])
                shown = ", ".join(f"baris {line}" for line, _n, _a in rows[:4])
                more = f" (+{len(rows) - 4})" if len(rows) > 4 else ""
                name = rows[0][2] if rows else ""
                say(f"      {code} {name} <- {shown}{more}")
        say("")

    if rate_deviation:
        say("C. TARIF BERBEDA DARI TARIF KELASNYA SENDIRI")
        say("")
        say("   Dibandingkan dengan kolom % di file 'Daftar asset', baris berikut")
        say("   memakai tarif yang lain. Kami SALIN APA ADANYA supaya angka kami")
        say("   sama dengan buku Bapak — mohon dikonfirmasi mana yang benar.")
        say("")
        grouped: dict[tuple, list] = defaultdict(list)
        for line, name, kind, expected, used in rate_deviation:
            grouped[(kind, expected, used)].append(line)
        for (kind, expected, used), rows in sorted(
            grouped.items(), key=lambda item: -len(item[1])
        ):
            listed = ", ".join(str(line) for line in rows[:8])
            more = f", dan {len(rows) - 8} baris lain" if len(rows) > 8 else ""
            say(f"   {kind}: kelas {expected:g}% tetapi dipakai {used:g}%")
            say(f"      {len(rows)} baris — baris {listed}{more}")
        say("")

    if never_charges:
        say("D. BARIS TANPA TARIF, JADI BELUM PERNAH MENAGIH APA PUN")
        say("")
        for line, name, account in never_charges:
            say(f"   - baris {line}: {name} ({account})")
        say("")

    say("E. YANG SUDAH BAPAK SEBUTKAN SENDIRI")
    say("")
    say("   Baris 10 (AC, Rp 26.390.000): akunnya tercatat FFE Toko dan Gudang HO,")
    say("   seharusnya C004. Dan nilainya belum termasuk pembayaran Rp 7.000.000")
    say("   di awal Juni, sehingga totalnya Rp 33.390.000.")
    say("")
    say("Mohon dikoreksi lebih dulu, lalu file MASTER ASSET-nya diekspor ulang.")
    say("Terima kasih banyak, Pak.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master", required=True, help="MASTER ASSET.xls")
    parser.add_argument("--coa", required=True, help="the chart, as CSV")
    parser.add_argument("--policy", help="Daftar asset.xls, for the rate report")
    parser.add_argument("--base", default="http://127.0.0.1:8080")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--cost",
        choices=("unit-price", "as-is"),
        default="unit-price",
        help=(
            "how to read NILAI ASSET on a row with a quantity above one. "
            "unit-price (the default) multiplies by JUMLAH, because one row "
            "reads `60,000 sensor pins at 1,000`, and 60,000 pins do not cost "
            "a thousand rupiah between them. The report prints what the other "
            "reading would have totalled."
        ),
    )
    parser.add_argument(
        "--defects",
        action="store_true",
        help=(
            "print a correction list for the client to stdout, in Indonesian, "
            "naming every row by its spreadsheet line. Generated from the data "
            "rather than written by hand, so it cannot go stale."
        ),
    )
    parser.add_argument(
        "--include-inactive",
        action="store_true",
        help="import the four rows the register has switched off (STATUS = N)",
    )
    args = parser.parse_args()

    report = sys.stderr

    chart, chart_names = read_chart(args.coa)
    policy = read_policy(args.policy) if args.policy else {}
    sheet = next(iter(xls.parse(args.master).values()))
    last = max(r for r, _ in sheet)

    rows = []
    for index in range(FIRST_DATA_ROW, last + 1):
        cells = {col: sheet[(index, col)] for col in range(19) if (index, col) in sheet}
        if text(cells, COL_NAME):
            rows.append((index + 1, cells))  # spreadsheet row numbers, 1-based

    print(f"{len(rows)} rows with a name, from spreadsheet row {FIRST_DATA_ROW + 1}", file=report)

    # -- resolve, classify, derive ------------------------------------------
    planned = []
    skipped: Counter = Counter()
    skipped_money: Counter = Counter()
    refused: list[str] = []
    mapping: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    # Which rows chose which account for a meaning. Only read when two rows
    # disagree, and then it is the whole point: a conflict nobody can trace to
    # a line is a conflict nobody can correct.
    evidence: dict[tuple[str, str, str, str], list[tuple[int, str, str]]] = defaultdict(list)
    kind_disagreement: list[str] = []
    site_disagreement: list[str] = []
    rate_deviation: list[tuple] = []
    never_charges: list[tuple] = []
    keyed_late: list[tuple] = []
    wrong_column: list[tuple] = []
    alternative_total = 0

    for line, cells in rows:
        name = text(cells, COL_NAME)
        asset_name = text(cells, COL_ASSET_ACCOUNT)
        kind_text = text(cells, COL_TYPE)
        codes = chart.get(normalise(asset_name), [])

        # Four CIP rows name no account at all. They are still CIP rows, and
        # counting them as unreadable would bury them among the defects below.
        is_cip = kind_text == "Contract In Progress" or (
            len(codes) == 1 and codes[0].startswith(CIP_FAMILY)
        )
        if is_cip:
            skipped["contract in progress"] += 1
            skipped_money["contract in progress"] += (number(cells, COL_VALUE) or 0)
            continue

        if len(codes) != 1:
            refused.append(
                f"row {line} {name!r}: account {asset_name!r} matches "
                f"{len(codes)} accounts in the chart"
            )
            continue
        code = codes[0]

        if not code.startswith(ASSET_FAMILIES):
            # The column holds the wrong KIND of account: a reserve or an
            # expense where the cost account belongs. Nine rows do this, and
            # every one of them is operating equipment. Refused rather than
            # repaired: the cost account it should name is guessable, and a
            # guess is how an asset ends up registered against the account
            # that was supposed to hold its accumulated charge.
            refused.append(
                f"row {line} {name!r}: the asset-account column holds "
                f"{code} {asset_name!r}, which is not a cost account"
            )
            wrong_column.append((line, name, code, asset_name))
            continue

        status = text(cells, COL_STATUS)
        if status != "Y" and not args.include_inactive:
            skipped["switched off in the register (STATUS = N)"] += 1
            skipped_money["switched off in the register (STATUS = N)"] += (
                number(cells, COL_VALUE) or 0
            )
            continue

        category, suffix = code[:10], code[10:12]
        site = site_for_suffix(suffix)
        if site is None:
            refused.append(f"row {line} {name!r}: {code} has no location suffix we know")
            continue

        # The charge kind, derived from the family — and then CHECKED against
        # the client's own expense account name, which is an independent
        # witness in the same file. A row filed under operating equipment whose
        # expense account says "Biaya Depresiasi" is a contradiction worth
        # seeing, not resolving silently.
        if category.startswith("1021507"):
            kind = "REPLACEMENT_RESERVE"
        elif category.startswith("10217"):
            kind = "AMORTISATION"
        else:
            kind = "DEPRECIATION"
        expense_name = text(cells, COL_EXPENSE_ACCOUNT)
        implied = None
        if expense_name.lower().startswith("biaya replacement"):
            implied = "REPLACEMENT_RESERVE"
        elif expense_name.lower().startswith("biaya amort"):
            implied = "AMORTISATION"
        elif expense_name.lower().startswith("biaya depresiasi"):
            implied = "DEPRECIATION"
        if implied is not None and implied != kind:
            kind_disagreement.append(
                f"row {line} {name!r}: {category} implies {kind} but the expense "
                f"account is {expense_name!r} ({implied})"
            )

        cost_key, expense_key, contra_key = CHARGE_KEYS[kind]
        row_mapping: list[tuple[tuple[str, str, str], str]] = []
        for key, account_name in (
            (cost_key, asset_name),
            (expense_key, expense_name),
            (contra_key, text(cells, COL_CONTRA_ACCOUNT)),
        ):
            if not account_name:
                continue
            resolved = chart.get(normalise(account_name), [])
            if len(resolved) != 1:
                refused.append(
                    f"row {line} {name!r}: {key} account {account_name!r} matches "
                    f"{len(resolved)} accounts"
                )
                continue
            if resolved[0][10:12] != suffix:
                site_disagreement.append(
                    f"row {line} {name!r}: the asset is at {suffix} but {key} "
                    f"is {resolved[0]} {account_name!r}"
                )
            row_mapping.append(((key, site, category), resolved[0]))
            evidence[(key, site, category, resolved[0])].append((line, name, account_name))

        # The rate is copied, never corrected. A rate that disagrees with the
        # class it is filed under is reported for the client to settle: their
        # books were kept at the rate in the file, and quietly restating 18 air
        # conditioners from 20% to their class's 10% would make every balance
        # we load disagree with theirs.
        percent = number(cells, COL_PERCENT)
        years = number(cells, COL_YEARS)
        expected = policy.get(normalise(kind_text))
        if expected is not None and percent is not None and abs(percent - expected) > 0.01:
            rate_deviation.append((line, name, kind_text, expected, percent))

        if not percent:
            # Zero per cent, or blank. Copied as "not depreciated", which is
            # what the register has been doing: these rows have never charged
            # anything. Reported because that is almost certainly not intended
            # for a rack.
            method, life_months = "NONE", 0
            never_charges.append((line, name, text(cells, COL_ASSET_ACCOUNT)))
        else:
            method = "STRAIGHT_LINE"
            life_years = years if years else round(100 / percent)
            life_months = int(round(life_years * 12))

        quantity = int(number(cells, COL_QUANTITY) or 1) or 1
        unit = number(cells, COL_VALUE) or 0
        cost = round(unit * quantity) if args.cost == "unit-price" else round(unit)
        if cost <= 0:
            refused.append(f"row {line} {name!r}: cost works out to {cost}")
            continue
        alternative_total += round(unit) if args.cost == "unit-price" else round(unit * quantity)

        # What the register said, kept where a person will see it. The rate
        # and life are on the assessment; this is the row it came from, which
        # is what somebody reconciling against their file will want.
        note = f"Impor register lama baris {line}; {kind_text}"
        if percent:
            note += f"; {percent:g}%"
            if years:
                note += f"/{years:g} th"

        purchased = text(cells, COL_PURCHASED)
        if not re.match(r"\d{4}-\d{2}-\d{2}", purchased):
            refused.append(f"row {line} {name!r}: purchase date {purchased!r} is not a date")
            continue

        # In service from the FIRST DAY OF THE MONTH OF PURCHASE, floored at
        # the month their asset module went live.
        #
        # Not from `PERIODE`, which was the first reading and was wrong.
        # `PERIODE` has no stable relationship to the purchase date at all:
        # across 674 rows the gap is 0 months (138), +1 (220), +2 (138) and a
        # tail out to +18, with two rows NEGATIVE — and the gap does not depend
        # on the day of the month, so it is not a rounding rule. It is the
        # period the row was KEYED in. Row 377 is a rack bought September 2017
        # and entered in March 2019; dating its schedule from `PERIODE` would
        # start depreciation eighteen months late.
        #
        # The month of purchase is what the client says the rule is:
        # depreciation is computed from the year and month of acquisition, not
        # the day, which is why they date recognition to the 1st. A BKK dated
        # 25 June becomes an asset recognised 1 June.
        #
        # The floor is not a nicety. 92 rows carry `PERIODE` 2017-02, which is
        # when the module went live, and their purchase dates run back to 2016.
        # Their books cannot contain a charge from before the system that wrote
        # them existed, so neither may ours.
        month = purchased[:7]
        in_service = f"{max(month, GO_LIVE_MONTH)}-01"
        keyed = re.match(r"^(\d{4})(\d{2})", text(cells, COL_PERIOD).replace(".0", ""))
        if keyed:
            gap = (int(keyed.group(1)) - int(purchased[:4])) * 12 + (
                int(keyed.group(2)) - int(purchased[5:7])
            )
            if abs(gap) > 1:
                keyed_late.append((line, name, purchased, keyed.group(0), gap, cost))

        for key, account in row_mapping:
            mapping[key].add(account)

        planned.append(
            {
                "row": line,
                "asset_number": f"AST-{int(number(cells, COL_NO) or line):06d}",
                "name": name,
                "category_code": category,
                "site_id": site,
                "acquired_on": purchased,
                "quantity": quantity,
                "serial_number": None,
                "notes": note,
                "cost_minor": cost,
                "useful_life_months": life_months,
                "method": method,
                "charge_kind": kind,
                "in_service_on": in_service,
            }
        )

    # -- the report ---------------------------------------------------------
    def rupiah(value) -> str:
        return f"Rp {round(value):,}".replace(",", ".")

    print(f"\n{len(planned)} assets to register, {rupiah(sum(p['cost_minor'] for p in planned))}", file=report)
    by_kind = Counter(p["charge_kind"] for p in planned)
    for kind, count in sorted(by_kind.items()):
        total = sum(p["cost_minor"] for p in planned if p["charge_kind"] == kind)
        print(f"   {kind:<20} {count:>5} {rupiah(total):>22}", file=report)
    lots = [p for p in planned if p["quantity"] > 1]
    print(f"   of which lots (quantity > 1): {len(lots)}", file=report)
    print(
        f"   NILAI read as {args.cost}; the other reading totals "
        f"{rupiah(alternative_total)}",
        file=report,
    )

    if skipped:
        print("\nskipped, on purpose:", file=report)
        for reason, count in skipped.most_common():
            print(f"   {count:>5}  {reason}  {rupiah(skipped_money[reason])}", file=report)

    print(f"\naccount mappings implied by the register: {len(mapping)}", file=report)
    conflicts = {key: codes for key, codes in mapping.items() if len(codes) > 1}
    if conflicts:
        stranded = {
            (site, category) for (_key, site, category) in conflicts
        }
        affected = [
            p for p in planned if (p["site_id"], p["category_code"]) in stranded
        ]
        print(
            f"   CONFLICTS — one meaning, two accounts: {len(conflicts)}. "
            f"No mapping is written for these, so the {len(affected)} assets in "
            f"the categories they cover CANNOT BE CHARGED until the client says "
            f"which account is right.",
            file=report,
        )
        for (key, site, category), codes in sorted(conflicts.items()):
            print(f"      {key} / {site} / {category} -> {sorted(codes)}", file=report)
        for plan in affected:
            print(
                f"         affects row {plan['row']} {plan['name']!r} "
                f"({plan['asset_number']})",
                file=report,
            )

    for label, items in (
        ("charge kind disagrees with the expense account", kind_disagreement),
        ("the asset and its accounts are at different locations", site_disagreement),
    ):
        if items:
            print(f"\n{label}: {len(items)}", file=report)
            for line in items[:10]:
                print(f"   {line}", file=report)

    if rate_deviation:
        total = 0.0
        print(f"\nrows charged at a rate their class does not carry: {len(rate_deviation)}", file=report)
        grouped: dict[tuple, list] = defaultdict(list)
        for line, name, kind, expected, used in rate_deviation:
            grouped[(kind, expected, used)].append(line)
        for (kind, expected, used), lines in sorted(grouped.items(), key=lambda x: -len(x[1])):
            print(
                f"   {len(lines):>4}x {kind:<34} class {expected:g}% -> used {used:g}%",
                file=report,
            )
        print("   copied as they are; the rate in the file is the rate their books used", file=report)

    if keyed_late:
        at_stake = sum(
            round(cost * abs(gap) / max(1, 12)) for *_r, gap, cost in keyed_late
        )
        print(
            f"\nrows keyed more than a month after they were bought: {len(keyed_late)}",
            file=report,
        )
        print(
            "   Their schedule starts from the month of PURCHASE here, which is "
            "the rule the client states. If their own books instead charged from "
            "the month the row was KEYED, our accumulated will differ by that "
            "many months per asset — and only their general ledger can say "
            "which. The widest gaps:",
            file=report,
        )
        for line, name, buy, keyed_period, gap, cost in sorted(
            keyed_late, key=lambda row: -abs(row[4])
        )[:10]:
            print(
                f"   row {line:<5} {name[:22]:<22} bought {buy} keyed {keyed_period} "
                f"({gap:+d} months) {rupiah(cost)}",
                file=report,
            )

    if never_charges:
        print(f"\nrows with no rate at all, so they have never charged anything: {len(never_charges)}", file=report)
        for line, name, account in never_charges[:12]:
            print(f"   row {line:<5} {name:<20} {account}", file=report)

    if refused:
        print(f"\nREFUSED — read these, they are not skips: {len(refused)}", file=report)
        for line in refused[:20]:
            print(f"   {line}", file=report)

    if args.defects:
        emit_defects(
            wrong_column, conflicts, evidence, rate_deviation, never_charges, chart_names
        )

    print(
        "\nNOTE: every asset below is registered with a cost and NO accumulated "
        "depreciation, so its book value equals its cost. The opening figure "
        "comes from the client's general ledger, per account, and is a separate "
        "step.",
        file=report,
    )

    # -- load ---------------------------------------------------------------
    api = Api(args.base, args.dry_run)

    for (key, site, category), codes in sorted(mapping.items()):
        if len(codes) != 1:
            continue
        api.post(
            "/api/v1/finance/account-map",
            {
                "semantic_key": key,
                "site_id": site,
                "qualifier": category,
                "account_code": next(iter(codes)),
                "note": "impor register aset lama",
            },
        )

    registered = assessed = 0
    for plan in planned:
        created = api.post(
            "/api/v1/finance/assets",
            {
                "asset_number": plan["asset_number"],
                "name": plan["name"],
                "category_code": plan["category_code"],
                "site_id": plan["site_id"],
                "acquired_on": plan["acquired_on"],
                "quantity": plan["quantity"],
                "serial_number": None,
                "notes": plan["notes"],
            },
        )
        if created is None:
            continue
        registered += 1
        asset_id = created.get("asset_id")
        if not asset_id and not args.dry_run:
            continue
        body = {
            "decision": "CAPITALIZE",
            "capitalized_cost_minor": plan["cost_minor"],
            "salvage_value_minor": 0,
            "useful_life_months": plan["useful_life_months"],
            "method": plan["method"],
            "charge_kind": plan["charge_kind"],
            "in_service_on": plan["in_service_on"],
            "reason": f"Impor register aset lama, baris {plan['row']}",
        }
        if args.dry_run or api.post(f"/api/v1/finance/assets/{asset_id}/assess", body) is not None:
            assessed += 1

    print(
        f"\n{'would call' if args.dry_run else 'called'} the API {api.calls} times: "
        f"{registered} registered, {assessed} assessed",
        file=report,
    )
    if api.failures:
        print(f"{len(api.failures)} failures:", file=report)
        for failure in api.failures[:20]:
            print(f"   {failure}", file=report)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
