#!/usr/bin/env python3
"""Fill a dev cloud node's finance module with a believable set of books.

Reads go straight to Postgres (the chart is 7,528 rows and searching it over
HTTP one code at a time is slow); every WRITE goes through the API, because
`poster.rs` is the only thing allowed to write a journal and the invariants
that make these books trustworthy — balanced entries, no posting into a closed
month, no posting to a heading — live behind those endpoints.

The order below is the only order that works. `account_map` first: a posting
rule names a meaning, never a client account code, so until the map is filled
every post is refused by design. Then the periods, because nothing posts into
a month that was never opened. Only then the documents.

    python3 scripts/seed-finance.py --db inventory_tanstack
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta

# --------------------------------------------------------------------------
# the client's chart, by meaning
# --------------------------------------------------------------------------

# A meaning that needs no narrowing: one 10-digit account, the same everywhere,
# and the location leaf is chosen per site.
PLAIN: dict[str, str] = {
    "inventory": "1011201001",
    "trade_payable": "2012001001",
    "vat_in": "1011302004",
    "purchase_discount": "8010110003",
    "non_merchandise_payable": "2012001003",
    "cash": "1011001001",
    "petty_cash": "1011001002",
    "cashier_float": "1011001003",
    "rounding": "8010110002",
    "card_receivable_credit": "1011101001",
    "card_receivable_debit": "1011101002",
    # lane-P: what a store manager is holding of head office's money. Distinct
    # from 1011102001 PIUTANG PEGAWAI, which is what an employee personally
    # owes — the two read almost the same and are not the same debt. The leaf
    # per shop (101110200200 .. 101110200213) is picked by `leaves()` below.
    "store_manager_receivable": "1011102002",
    "card_fee": "6010110002",
    "cogs": "5010110001",
    "stock_loss": "8010110006",
    "interest_expense": "8020111001",
}

# The seven asset categories the register offers, and what each one means in
# the client's chart. The depreciation run passes the category code as the
# qualifier (`assets.rs:397`), so these three keys must be mapped per category
# or a run is refused for that asset.
CATEGORIES: list[tuple[str, str, str, str]] = [
    # qualifier, asset account, accumulated, expense
    ("1021501", "1021501001", "1021601002", "7010210001"),  # Tanah
    ("1021502", "1021502001", "1021602001", "7010210001"),  # Bangunan
    ("1021503", "1021503001", "1021603001", "7010211001"),  # Instalasi
    ("1021504", "1021504001", "1021604001", "7010212001"),  # Machineries
    ("1021505", "1021505001", "1021605001", "7010213001"),  # Kendaraan
    ("1021506", "1021506001", "1021606001", "7010214001"),  # FFE
    ("1021507", "1021507001", "1021607001", "7010215001"),  # Operating equip.
]

# Meanings that need narrowing but that nothing posts automatically yet. One
# qualifier each is enough to close the gap the Account map screen counts,
# and each is a real account under the prefix the meaning documents.
QUALIFIED: dict[str, list[tuple[str, str]]] = {
    "bank_giro": [("BCA", "1011002001"), ("MANDIRI", "1011002002")],
    "bank_savings": [("BCA", "1011003001"), ("MANDIRI", "1011003002")],
    "giro_outstanding": [("BCA", "2012002001")],
    "accrued_expense": [("UMUM", "2012201001")],
    # affiliate_receivable and affiliate_payable are NOT here. They used to be,
    # with the qualifier PEMBIAYAAN and the leaf under `1021401001` at all
    # fourteen locations — which is head office's account with ITSELF, shared by
    # thirteen shops. Nothing posted to it, so nothing was wrong yet. The
    # `# lane-D` block below maps them properly: one leaf per pair per column,
    # keyed `<KIND>:<counterparty>`. See migration 0122.
    "goods_in_transit": [("DC", "1011203001")],
    "prepaid_expense": [("ASURANSI", "1011301001")],
    "advance": [("PERJALANAN", "1011303001")],
    "loan_principal": [("BANK", "2022401001")],
}

SITES = ["dc"] + [f"store-{n:02d}" for n in range(1, 14)]


# --------------------------------------------------------------------------
# plumbing
# --------------------------------------------------------------------------


class Api:
    def __init__(self, base: str, dry: bool) -> None:
        self.base = base.rstrip("/")
        self.dry = dry
        self.calls = 0
        self.failures: list[str] = []

    def post(self, path: str, body: dict, idempotency: bool = False):
        if self.dry:
            self.calls += 1
            return {}
        url = f"{self.base}{path}"
        data = json.dumps(body).encode()
        headers = {"content-type": "application/json"}
        if idempotency:
            headers["Idempotency-Key"] = str(uuid.uuid4())
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                self.calls += 1
                raw = resp.read().decode()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()[:200]
            self.failures.append(f"{path} -> {exc.code} {detail}")
            return None
        except Exception as exc:  # noqa: BLE001
            self.failures.append(f"{path} -> {exc}")
            return None


def psql(db: str, sql: str) -> list[list[str]]:
    out = subprocess.run(
        ["psql", "-d", db, "-At", "-F", "\x1f", "-c", sql],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [line.split("\x1f") for line in out.splitlines() if line]


def leaves(db: str) -> dict[tuple[str, str], str]:
    """(10-digit account, site) -> the 12-digit location leaf."""
    rows = psql(
        db,
        "select account_code, site_id from ledger_account "
        "where length(account_code) = 12 and site_id is not null",
    )
    return {(code[:10], site): code for code, site in rows}


def month_days(year: int, month: int) -> tuple[date, date]:
    first = date(year, month, 1)
    nxt = date(year + (month == 12), (month % 12) + 1, 1)
    return first, nxt - timedelta(days=1)


# --------------------------------------------------------------------------
# the seed, in the only order that posts
# --------------------------------------------------------------------------


def seed_account_map(api: Api, leaf: dict, report: dict) -> None:
    written = 0
    missing: list[str] = []
    for key, code in PLAIN.items():
        for site in SITES:
            account = leaf.get((code, site))
            if account is None:
                missing.append(f"{key}/{site}/{code}")
                continue
            ok = api.post(
                "/api/v1/finance/account-map",
                {
                    "semantic_key": key,
                    "site_id": site,
                    "qualifier": "",
                    "account_code": account,
                    "note": "seed",
                },
            )
            written += ok is not None
    for qualifier, asset, accum, expense in CATEGORIES:
        for key, code in (
            ("fixed_asset", asset),
            ("accumulated_depreciation", accum),
            ("depreciation_expense", expense),
        ):
            for site in SITES:
                account = leaf.get((code, site))
                if account is None:
                    missing.append(f"{key}/{site}/{code}")
                    continue
                ok = api.post(
                    "/api/v1/finance/account-map",
                    {
                        "semantic_key": key,
                        "site_id": site,
                        "qualifier": qualifier,
                        "account_code": account,
                        "note": "seed",
                    },
                )
                written += ok is not None
    for key, choices in QUALIFIED.items():
        for qualifier, code in choices:
            for site in SITES:
                account = leaf.get((code, site))
                if account is None:
                    missing.append(f"{key}/{site}/{code}")
                    continue
                ok = api.post(
                    "/api/v1/finance/account-map",
                    {
                        "semantic_key": key,
                        "site_id": site,
                        "qualifier": qualifier,
                        "account_code": account,
                        "note": "seed",
                    },
                )
                written += ok is not None
    report["mappings"] = written
    report["mapping_gaps"] = missing


# lane-D
# --------------------------------------------------------------------------
# the affiliate map: one leaf per pair, per column
# --------------------------------------------------------------------------
#
# The client's chart carries all 784 combinations of fourteen units against
# fourteen, in four families. Fifty-two of them are the ones head office and its
# thirteen shops actually use, and this maps those.
#
# Read one of their codes out loud and the shape is unambiguous:
#
#   102140200200   Piutang Affiliasi Atas Barang CIKUPA - HO
#   |______|                                              ^^  owner: 00 = HO
#          ^^^                                                counterparty: 002
#
#   201230200101   Hutang Affiliasi Atas Barang HEAD OFFICE - C001
#                  owner: suffix 01 = C001; counterparty: 001 = HEAD OFFICE
#
# Those two are one balance written from both sides. The OWNER is the two-digit
# suffix — which is what `import-coa.py` files `ledger_account.site_id` by, so
# agreeing with it is not optional — and the counterparty is the three-digit
# rung, indexed from 001 = head office.
#
# The codes are not invented here. They are computed and then CHECKED against
# the client's own export, by name, and a code the export does not carry is
# skipped and reported rather than written. `csv.reader` and not `line.split(",")`:
# the account names contain commas.

AFFILIATE_CSV = os.path.expanduser("~/Downloads/Laporan_Master_Account1.csv")

# kind -> (receivable family, payable family, the client's own headings)
AFFILIATE_FAMILIES: dict[str, tuple[str, str, str, str]] = {
    # What a shop owes for stock, settled by its deposits.
    "BARANG": ("1021402", "2012302",
               "PIUTANG AFFILIASI ATAS BARANG", "HUTANG AFFILIASI ATAS BARANG"),
    # Head office funding a shop: paying its costs, topping up its float.
    "PEMBIAYAAN": ("1021401", "2012301",
                   "PIUTANG AFFILIASI PEMBIAYAAN", "HUTANG AFFILIASI PEMBIAYAAN"),
}

HEAD_OFFICE = "dc"


def client_chart(path: str) -> dict[str, str]:
    """code -> name, from the client's own export. Empty if it is not here."""
    if not os.path.exists(path):
        return {}
    chart: dict[str, str] = {}
    with open(path, encoding="utf-8-sig", newline="") as handle:
        for row in csv.reader(handle):
            # Same filter `import-coa.py` uses: an account row is one whose
            # second column is a number. The banner and legend rows fail it.
            if len(row) < 5:
                continue
            code = row[1].strip()
            if code.isdigit():
                chart.setdefault(code, " ".join(row[2].split()))
    return chart


def affiliate_rows(chart: dict[str, str]) -> tuple[list[dict], list[str]]:
    """The 52 mappings, and the codes the client's chart does not carry."""
    # suffix and rung index for each unit. `001` is head office, so a shop's
    # rung index is its number plus one — the same ordering `import-coa.py`
    # assumed when it filed the leaves.
    units = [(HEAD_OFFICE, "00", "001")] + [
        (f"store-{n:02d}", f"{n:02d}", f"{n + 1:03d}") for n in range(1, 14)
    ]
    ho_suffix, ho_index = "00", "001"

    rows: list[dict] = []
    missing: list[str] = []
    for kind, (receivable, payable, recv_name, pay_name) in AFFILIATE_FAMILIES.items():
        # The families themselves, checked by name. If these four have moved,
        # every code below is wrong and silence would be the worst outcome.
        for family, expected in ((receivable, recv_name), (payable, pay_name)):
            if chart and chart.get(family, "").upper() != expected:
                missing.append(f"family {family} is {chart.get(family)!r}, expected {expected!r}")
        for site, suffix, index in units:
            if site == HEAD_OFFICE:
                continue
            for key, owner, counterparty, code in (
                # Head office books the receivable, named for the shop, at 00.
                ("affiliate_receivable", HEAD_OFFICE, site,
                 receivable + index + ho_suffix),
                # The shop books the payable, named for head office, at its own.
                ("affiliate_payable", site, HEAD_OFFICE,
                 payable + ho_index + suffix),
            ):
                if chart and code not in chart:
                    missing.append(f"{key}/{owner}/{kind}:{counterparty}/{code}")
                    continue
                rows.append({
                    "semantic_key": key,
                    "site_id": owner,
                    # Both facts the client's code carries in its rung and its
                    # suffix, in the order somebody reads them. `domain::interunit`
                    # builds exactly this string, so a leg the poster adds
                    # resolves without the poster ever naming a code.
                    "qualifier": f"{kind}:{counterparty}",
                    "account_code": code,
                    "note": chart.get(code, "inter-unit pair"),
                })
    return rows, missing


def seed_affiliate_map(api: Api, report: dict, csv_path: str) -> None:
    chart = client_chart(csv_path)
    rows, missing = affiliate_rows(chart)
    written = 0
    for row in rows:
        written += api.post("/api/v1/finance/account-map", row) is not None
    report["affiliate_mappings"] = written
    report["affiliate_gaps"] = missing
    # Said out loud, because a run without the client's export writes the same
    # 52 rows without having checked a single one of them.
    report["affiliate_verified_against"] = csv_path if chart else None


def seed_periods(api: Api, months: list[tuple[int, int]], report: dict) -> None:
    opened = 0
    for year, month in months:
        if api.post("/api/v1/finance/periods", {"year": year, "month": month}) is not None:
            opened += 1
    report["periods"] = opened


def seed_bills(api: Api, suppliers: list[tuple[str, str]], months, rng, report) -> None:
    recorded, posted = 0, 0
    for index in range(28):
        supplier_id, supplier_name = suppliers[index % len(suppliers)]
        site = SITES[index % len(SITES)]
        year, month = months[index % len(months)]
        first, last = month_days(year, month)
        invoice_date = first + timedelta(days=rng.randrange((last - first).days + 1))
        subtotal = rng.randrange(4_000, 60_000) * 1_000
        tax = round(subtotal * 0.11)
        discount = subtotal // 20 if index % 4 == 0 else 0
        bill = api.post(
            "/api/v1/finance/bills",
            {
                "invoice_number": f"INV-{year}{month:02d}-{index + 1:04d}",
                "supplier_id": supplier_id,
                "supplier_name": supplier_name,
                "site_id": site,
                "invoice_date": invoice_date.isoformat(),
                "due_date": (invoice_date + timedelta(days=30)).isoformat(),
                "subtotal_minor": subtotal,
                "tax_minor": tax,
                "discount_minor": discount,
                "note": None,
            },
        )
        if bill is None:
            continue
        recorded += 1
        # Four in five are posted. The rest are the worklist the Overview and
        # the period checklist are meant to show.
        if index % 5 != 4:
            invoice_id = bill.get("invoice_id")
            if invoice_id and api.post(
                f"/api/v1/finance/bills/{invoice_id}/post", {}
            ) is not None:
                posted += 1
    report["bills_recorded"] = recorded
    report["bills_posted"] = posted


def seed_assets(api: Api, months, rng, report) -> None:
    registered, assessed = 0, 0
    names = {
        "1021501": "Tanah",
        "1021502": "Bangunan",
        "1021503": "Instalasi listrik",
        "1021504": "Air conditioner",
        "1021505": "Kendaraan operasional",
        "1021506": "Rak dan interior toko",
        "1021507": "Operating equipment",
    }
    for index in range(21):
        qualifier, *_ = CATEGORIES[index % len(CATEGORIES)]
        site = SITES[index % len(SITES)]
        year, month = months[0]
        acquired = date(year, month, 1) + timedelta(days=rng.randrange(28))
        asset = api.post(
            "/api/v1/finance/assets",
            {
                "asset_number": f"FA-{index + 1:04d}",
                "name": f"{names[qualifier]} {site}",
                "category_code": qualifier,
                "site_id": site,
                "acquired_on": acquired.isoformat(),
                "serial_number": None,
                "notes": None,
            },
        )
        if asset is None:
            continue
        registered += 1
        # Three in four are assessed, so the register keeps a visible backlog.
        if index % 4 == 3:
            continue
        asset_id = asset.get("asset_id")
        if not asset_id:
            continue
        land = qualifier == "1021501"
        body = {
            "decision": "EXPENSE" if index % 7 == 6 else "CAPITALIZE",
            "capitalized_cost_minor": None,
            "salvage_value_minor": None,
            "useful_life_months": None,
            "method": None,
            "in_service_on": None,
            "reason": "Seed: penilaian awal",
        }
        if body["decision"] == "CAPITALIZE":
            body.update(
                capitalized_cost_minor=rng.randrange(20_000, 400_000) * 1_000,
                salvage_value_minor=0,
                useful_life_months=0 if land else rng.choice([48, 60, 96, 120]),
                method="NONE" if land else "STRAIGHT_LINE",
                in_service_on=acquired.isoformat(),
            )
        if api.post(f"/api/v1/finance/assets/{asset_id}/assess", body) is not None:
            assessed += 1
    report["assets_registered"] = registered
    report["assets_assessed"] = assessed


def seed_depreciation(api: Api, months, report) -> None:
    runs = []
    for year, month in months:
        run = api.post(
            "/api/v1/finance/depreciation/run", {"year": year, "month": month}
        )
        if run:
            runs.append(
                {
                    "month": f"{year}-{month:02d}",
                    "posted": run.get("posted_count"),
                    "skipped": run.get("skipped_count"),
                    "total": run.get("posted_total_minor"),
                }
            )
    report["depreciation"] = runs


def seed_bank(api: Api, leaf: dict, months, rng, report) -> None:
    imported = 0
    for index, site in enumerate(SITES[:4]):
        year, month = months[-1]
        first, last = month_days(year, month)
        account = leaf.get(("1011002001", site))
        if account is None:
            continue
        lines = []
        balance = rng.randrange(200_000, 900_000) * 1_000
        opening = balance
        for day in range(1, 19):
            value_date = first + timedelta(days=day)
            if value_date > last:
                break
            debit = rng.randrange(5_000, 40_000) * 1_000 if day % 3 else 0
            credit = rng.randrange(5_000, 30_000) * 1_000 if not day % 3 else 0
            balance += credit - debit
            lines.append(
                {
                    "value_date": value_date.isoformat(),
                    "description": "Transfer supplier" if debit else "Setoran toko",
                    "reference": f"TRX{index}{day:02d}",
                    "debit_minor": debit,
                    "credit_minor": credit,
                }
            )
        ok = api.post(
            "/api/v1/finance/bank-statements",
            {
                "account_code": account,
                "site_id": site,
                "period_start": first.isoformat(),
                "period_end": last.isoformat(),
                "opening_minor": opening,
                "closing_minor": balance,
                "source_name": f"Rekening koran {site}",
                "lines": lines,
            },
        )
        imported += ok is not None
    report["bank_statements"] = imported


def seed_opening_balances(api: Api, leaf: dict, months, rng, report) -> None:
    """Cash and capital, so the balance sheet is not an empty frame.

    Nothing else in the system puts an opening balance into the books: the
    poster only ever answers a document. These are ordinary manual entries and
    say so in their memo.
    """
    year, month = months[0]
    posting_date = date(year, month, 1)
    posted = 0
    for site in SITES:
        cash = leaf.get(("1011001001", site))
        capital = leaf.get(("3013001001", site))  # Modal Setor
        if cash is None or capital is None:
            continue
        amount = rng.randrange(50_000, 250_000) * 1_000
        entry = api.post(
            "/api/v1/finance/journal",
            {
                "posting_date": posting_date.isoformat(),
                "currency": "IDR",
                "memo": f"Saldo awal kas {site} (seed)",
                "lines": [
                    {
                        "account": {"kind": "account", "account_code": cash},
                        "site_id": site,
                        "debit_minor": amount,
                        "credit_minor": 0,
                        "supplier_id": None,
                        "memo": None,
                    },
                    {
                        "account": {"kind": "account", "account_code": capital},
                        "site_id": site,
                        "debit_minor": 0,
                        "credit_minor": amount,
                        "supplier_id": None,
                        "memo": None,
                    },
                ],
            },
            idempotency=True,
        )
        posted += entry is not None
    report["opening_entries"] = posted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="inventory_tanstack")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--seed", type=int, default=20260902)
    # lane-D: the client's own chart export, used to check the affiliate codes.
    parser.add_argument("--coa", default=AFFILIATE_CSV)
    parser.add_argument(
        "--stage",
        default="all",
        choices=["all", "map", "periods", "bills", "assets", "bank", "opening"],
    )
    args = parser.parse_args()

    rng = random.Random(args.seed)
    api = Api(args.api, args.dry_run)
    leaf = leaves(args.db)
    months = [(2026, m) for m in (6, 7, 8, 9)]
    report: dict = {}

    want = args.stage
    if want in ("all", "map"):
        seed_account_map(api, leaf, report)
        # lane-D. After the rest of the map, so a failure here is legible on
        # its own line of the report rather than hidden in the same counter.
        seed_affiliate_map(api, report, args.coa)
    if want in ("all", "periods"):
        seed_periods(api, months, report)
    if want in ("all", "opening"):
        seed_opening_balances(api, leaf, months, rng, report)
    if want in ("all", "bills"):
        suppliers = [tuple(r) for r in psql(args.db, "select supplier_id, name from supplier order by name limit 12")]
        seed_bills(api, suppliers, months, rng, report)
    if want in ("all", "assets"):
        seed_assets(api, months, rng, report)
        seed_depreciation(api, months, report)
    if want in ("all", "bank"):
        seed_bank(api, leaf, months, rng, report)

    report["api_calls"] = api.calls
    report["failures"] = api.failures[:10]
    report["failure_count"] = len(api.failures)
    print(json.dumps(report, indent=2))
    return 1 if api.failures else 0


if __name__ == "__main__":
    sys.exit(main())
