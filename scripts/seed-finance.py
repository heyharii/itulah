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
import json
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
    "affiliate_receivable": [("PEMBIAYAAN", "1021401001")],
    "affiliate_payable": [("PEMBIAYAAN", "2012301001")],
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
