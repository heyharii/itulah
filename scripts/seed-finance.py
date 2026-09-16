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
    # lane-A: what posting a day of takings needs, beyond the four above it
    # already reuses (cash, card_receivable_debit, card_receivable_credit,
    # rounding). Three of these are PROPOSED codes — the client's chart has no
    # account for QRIS, for a QRIS receivable, or for vouchers outstanding, so
    # each is the next free leaf in the family it belongs to and has to be
    # confirmed with Finance before these books are compared with theirs.
    "revenue_cash": "4010110001",
    # PROPOSED. Not 4010113001, which their chart already spends on
    # "Penjualan Online Sendiri" — 401011.3 is their online rung, with .3002
    # for the marketplaces. 401011.4 is the next one nobody has taken.
    "revenue_qris": "4010114001",  # created by 0274
    "sales_return": "4010214001",
    "sales_discount": "4010213001",
    "vat_out": "2012101003",
    "voucher_liability": "2012305001",  # created by 0275
    # end lane-A
    # lane-C: the three lines every statement carries every month, and the
    # accounts the seeded bank rules (migration 0116) propose for them.
    # 6010310004 Biaya Bank HO / 8010110001 Pendapatan Bunga Bank.
    "bank_admin_fee": "6010310004",
    "interest_income": "8010110001",
    # PPh 4(2) on bank interest is FINAL — withheld at source, never recovered
    # — so it is an expense and not the prepaid it looks like. The chart has no
    # leaf named for it; 8030112001 Current Tax Inc/Exp PPH Pasal 25 is the
    # income-tax expense the client does keep, and Finance can repoint it.
    "tax_on_interest": "8030112001",
    # lane-G: the rest of the payables loop. Each of these has the same
    # fourteen location leaves the meanings above have — HO and C001..C013 —
    # so each is seeded per site exactly as `inventory` is.
    #
    # `supplier_suspend` is the one that changes a balance sheet: a delivery
    # credits it and the bill that answers the delivery clears it, so what the
    # warehouse holds and nobody has invoiced is a figure rather than a report.
    "supplier_suspend": "2012001002",
    # The same account `purchase_discount` points at. The client keeps one
    # signed account for an agreed reduction and a discovered difference, and
    # there is no variance account in their chart to point at instead.
    "purchase_price_variance": "8010110003",
    # Not `advance` (1011303001), which is a person's travelling advance, and
    # not anything owed by a store manager. A supplier advance, its own debt to
    # its own kind of counterparty, on its own account.
    "advance_purchase": "1011303002",
    # `bank_admin_fee` is the same meaning and the same account lane C seeds
    # above; one key, one line.
    "pph23_payable": "2012101002",
    # `pph_final_payable` is deliberately absent. The client's chart has no
    # PPh 4(2) leaf under 20121 — only PPh 21, PPh 23, output VAT, PBB and
    # PPh 25 — and seeding it to the PPh 23 account would put a final tax in a
    # creditable one, where somebody would claim it back a year later. It shows
    # as an unset key on the Account map screen until the client opens the
    # account, and a rent payment refuses until then and says so.
    # lane-J: where the difference between what an asset was worth and what it
    # fetched lands. Reading all 496 ten-digit template accounts in
    # `Laporan_Master_Account1.csv`, the client keeps no "Laba (Rugi) Penjualan
    # Aktiva Tetap" — classes 4 and 8 have nothing of the kind. What they do
    # keep is one signed other-income-and-expense leaf, which is why
    # `asset_disposal_result` is one key and not a gain key beside a loss key:
    #
    #   8010110007  Pendapatan (Biaya) Lain-Lain   (14 location leaves)
    #
    # It was the only one of the 29 meanings the posting rules use that this
    # script never mapped, so every disposal with a gain or a loss — which is
    # every disposal that is not exactly at book value — was refused by
    # `poster.rs` naming a key nobody had set.
    "asset_disposal_result": "8010110007",
    # lane-B — the store cash chain.
    #
    # Every code here is a real leaf, checked against
    # Laporan_Master_Account1.csv — except the first, which is the one meaning
    # this estate still has no account for. See UNANSWERED_MEANINGS below.
    "cash_in_transit": "1011005001",      # NO ACCOUNT: client question
    # 0254 deleted `8010110008 Selisih Kas` as ours and remapped it onto the
    # client's own `8010110007 Pendapatan (Biaya) Lain-Lain`. Pointing at the
    # deleted code made this meaning unmappable, and a cash count that came up
    # short had nowhere to post.
    "cash_variance": "8010110007",
    # `store_manager_receivable` — what a store manager is HOLDING for the
    # company, which is not what an employee OWES it — is seeded by lane P
    # above, at the same account. 1011102001 PIUTANG PEGAWAI is the second
    # thing and is deliberately mapped by nobody; a float posted there would be
    # indistinguishable from a staff debt on an ageing report.
    # Wages owed and not yet handed over. What a manager paying an employee out
    # of a fund debits — never a second salary expense.
    "payroll_payable": "2012201001",      # Biaya Gaji dan Upah YMHD
    # What a shop may spend petty cash or an operating fund on. Nine
    # categories, all real, and the
    # last is the catch-all — a list with no bottom means a genuine receipt
    # eventually has nowhere to go and comes out of the drawer instead.
    "expense_electricity": "6010310006",  # Biaya Pemakaian Listrik
    "expense_water": "6010310007",        # Biaya Pemakaian Air Bersih (PDAM)
    "expense_telephone": "6010310005",    # Biaya Telephone,Facsimile, Modem
    "expense_household": "6010310003",    # Biaya Rumah Tangga
    "expense_stationery": "6010310002",   # Alat Tulis Kantor & Barang Cetakan
    "expense_repairs": "6010410004",      # BIAYA PERBAIKAN DAN PERAWATAN BANGUNAN
    "expense_transport": "6010310009",    # Biaya Lokal Transport
    "expense_cleaning": "6010310001",     # Biaya Kebersihan (Cleaning)
    "expense_misc": "6010310099",         # Miscellaneous Expences
    # end lane-B
}

# lane-B — the two accounts the client's chart does not have.
#
# `import-coa.py` builds the chart from the client's own export, so anything
# not in that export does not exist. These two are PROPOSALS, and this is the
# only place in the system that invents an account code. They are written here
# rather than in a migration because the chart is the client's document: a
# migration that added rows to it would make this system a second author of it,
# and the day the client sends a new export the two would have to be
# reconciled.
#
# `1011005` is an unused rung of `10110 KAS & SETARA KAS`, sitting beside CASH
# ON HAND, CASH IN BANK GIRO, CASH IN BANK TABUNGAN and TIME DEPOSIT — where a
# treasurer would look for money that has left a shop and not yet reached a
# bank. `8010110008` is the next free leaf under the rung that already holds
# `Selisih pembulatan` and `Kehilangan Barang atau Selisih Stock Opname`, which
# is where this client already keeps differences of exactly this species.
#
# (rung code, rung name, leaf code, leaf name, per-site name)
# The two accounts this seed used to CREATE, and why it no longer does.
#
# `1011005001 Kas Dalam Perjalanan` and `8010110008 Selisih Kas` are both codes
# 0254 deleted as ours rather than the client's. Recreating them here put the
# chart back into a state a migration had deliberately taken it out of — and it
# did so in the PRE-COLLAPSE shape, one leaf per unit with `site_id` set, which
# 0244's `ledger_account_carries_no_unit` now refuses outright. So the step could
# not run at all, and the finance seed stopped there.
#
# What replaced it:
#
#   `cash_variance`    -> `8010110007 Pendapatan (Biaya) Lain-Lain`, which is
#                         where 0254's own remap sends `8010110008`. A real home,
#                         no invention.
#   `cash_in_transit`  -> still has none. Money that left the shop and has not
#                         reached the bank is a real state, but which account the
#                         client keeps it in is theirs to say. Reported as an
#                         open question rather than answered by this script.
UNANSWERED_MEANINGS = {
    "cash_in_transit": "0254 deleted 1011005001 as ours; the client has not named a replacement",
}

# The client writes head office `HO` and shop n `C00n` in every leaf name.
def unit_suffix(site: str) -> tuple[str, str]:
    """(two-digit code suffix, the name the client would write)."""
    if site == "dc":
        return "00", "HO"
    number = int(site.split("-")[1])
    return f"{number:02d}", f"C{number:03d}"

# The seven asset categories the register offers, and what each one means in
# the client's chart. The monthly run passes the category code as the
# qualifier (`assets.rs`), so the pair of keys a category charges through must
# be mapped per category or a run is refused for that asset.
#
# WHICH pair depends on the charge kind, not on the category alone. Six
# families depreciate; `1021507` does not — the client's chart calls its
# contra `Reserve Replacement` and its expense `BIAYA REPLACEMENT`, because
# racks and hangers are replaced rather than written down. See migration 0159.
#
# Tanah carries no contra and no expense, and that is not an omission. Freehold
# land is not depreciated, and the client's chart agrees: under `1021601` the
# only leaf is the one for HGB, and `70102` has no family for land at all.
# Mapping it to Bangunan's expense account — which this table used to do —
# describes a posting that must never happen.
CATEGORIES: list[tuple[str, str, str | None, str | None, str]] = [
    # qualifier, asset account, contra, expense, charge kind
    ("1021501", "1021501001", None, None, "DEPRECIATION"),  # Tanah
    ("1021502", "1021502001", "1021602001", "7010210001", "DEPRECIATION"),
    ("1021503", "1021503001", "1021603001", "7010211001", "DEPRECIATION"),
    ("1021504", "1021504001", "1021604001", "7010212001", "DEPRECIATION"),
    ("1021505", "1021505001", "1021605001", "7010213001", "DEPRECIATION"),
    ("1021506", "1021506001", "1021606001", "7010214001", "DEPRECIATION"),
    ("1021507", "1021507001", "1021607001", "7010215001", "REPLACEMENT_RESERVE"),
]

# The pair of meanings each charge kind posts through. Mirrors
# `ChargeKind::charge_keys` in `domain/depreciation.rs`; if the two disagree,
# the seed maps accounts the run never reads and the run refuses on accounts
# the seed never mapped.
CHARGE_KEYS: dict[str, tuple[str, str]] = {
    "DEPRECIATION": ("depreciation_expense", "accumulated_depreciation"),
    "REPLACEMENT_RESERVE": ("replacement_expense", "replacement_reserve"),
    "AMORTISATION": ("amortisation_expense", "accumulated_amortisation"),
}

# Meanings that need narrowing but that nothing posts automatically yet. One
# qualifier each is enough to close the gap the Account map screen counts,
# and each is a real account under the prefix the meaning documents.
QUALIFIED: dict[str, list[tuple[str, str]]] = {
    # lane-C: widened to match `giro_outstanding`. A giro credited to
    # `giro_outstanding` at MANDIRI clears to `bank_giro` at MANDIRI, so a bank
    # mapped on one side and not the other is a giro that can be written and
    # never cleared.
    "bank_giro": [
        ("BCA", "1011002001"),
        ("MANDIRI", "1011002002"),
        ("BRI", "1011002003"),
        ("BNI", "1011002004"),
        ("DANAMON", "1011002005"),
    ],
    "bank_savings": [
        ("BCA", "1011003001"),
        ("MANDIRI", "1011003002"),
        ("BRI", "1011003003"),
        ("BNI", "1011003004"),
    ],
    # lane-C: every bank the client has, not just the first. A giro is drawn
    # on one particular bank and the chart keeps one leaf each; a single BCA
    # mapping made a Mandiri giro unpostable, which is how it had stayed
    # unwritten-to since the ledger's first day.
    # 2012002001 Outstanding Giro Bank BCA .. 2012002005 Bank DANAMON.
    "giro_outstanding": [
        ("BCA", "2012002001"),
        ("MANDIRI", "2012002002"),
        ("BRI", "2012002003"),
        ("BNI", "2012002004"),
        ("DANAMON", "2012002005"),
    ],
    # lane-C: money the company has and cannot spend today. Holding money is
    # what makes a deposit a TRANSFER rather than a payment.
    # 1011004001 TIME DEPOSIT BANK BCA .. 1011004004 BANK BNI.
    "time_deposit": [
        ("BCA", "1011004001"),
        ("MANDIRI", "1011004002"),
        ("BRI", "1011004003"),
        ("BNI", "1011004004"),
    ],
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
    # lane-A: income and receivables split by who settled them, which is how
    # the client's own chart keeps them — a debit card is a named bank's debt,
    # a credit card is a network's, and they are different accounts because
    # they clear on different days for different fees.
    #
    # The qualifiers here are the ones the till will actually send. A tender
    # naming an acquirer nothing is mapped for is refused by name at posting
    # time, which is the point: it is a gap somebody can close on the Account
    # Map screen, not a figure quietly filed under "cards".
    "revenue_debit": [("BCA", "4010111001"), ("MANDIRI", "4010111002")],
    "revenue_credit": [("VISA", "4010112001"), ("MASTER", "4010112002")],
    # The two card receivables are ALSO mapped unqualified, above, and both
    # mappings are wanted. The posting rule resolves them per acquirer, because
    # what a shop is owed is owed by a named bank; the client's chart keeps one
    # account for all of them, so every qualifier points at the same leaf until
    # Finance decides to split it. Mapping the qualifier now costs nothing and
    # means that split is a change to this file rather than to a posting rule.
    "card_receivable_debit": [("BCA", "1011101002"), ("MANDIRI", "1011101002")],
    "card_receivable_credit": [("VISA", "1011101001"), ("MASTER", "1011101001")],
    # Who owes the QRIS money: the acquiring bank or the wallet, whichever the
    # till names. Proposed code, like the income account it pairs with.
    "qris_receivable": [
        ("BCA", "1011101003"),
        ("GOPAY", "1011101003"),
        ("OVO", "1011101003"),
        ("DANA", "1011101003"),
        ("SHOPEEPAY", "1011101003"),
    ],  # 1011101003 created by 0274
    # end lane-A
}

# lane-J: the client does not depreciate operating equipment. Their chart
# carries three parallel blocks of thirty-six accounts, class for class:
#
#   1021507xxx  OE - <thing>                        the asset
#   1021607xxx  RR OE- <thing>                      the replacement reserve
#   7010215xxx  Biaya Replacement OE - <thing>      the monthly charge
#
# `1021607` is named "Reserve Replacement - Operating Equipment" where the other
# six families under `10216` are named "Akum-Penyusu - …", and `70102` has no
# depreciation family for operating equipment at all — its sixth child is
# "BIAYA REPLACEMENT OPERATING EQUIPMENT". All three blocks and all fourteen
# location leaves of each were verified against `Laporan_Master_Account1.csv`.
#
# The thirty-six suffixes, in the client's own order and with their own names:
OPERATING_EQUIPMENT: list[tuple[str, str]] = [
    ("001", "Rak 1"),
    ("002", "Rak 2"),
    ("003", "Rak 3"),
    ("004", "Rak 4"),
    ("005", "Pajangan Gantungan 2"),
    ("006", "Pajangan Gantungan 4"),
    ("007", "Pajangan Gantungan 6"),
    ("008", "Pajangan Gantungan Lain-lain"),
    ("009", "Meja 1"),
    ("010", "Meja 2"),
    ("011", "Meja 3"),
    ("012", "Box OB Kayu"),
    ("013", "Box OB Besi"),
    ("014", "Holo"),
    ("015", "Breket"),
    ("016", "Belalai"),
    ("017", "Patung Full Bodi Dewasa"),
    ("018", "Patung Full Bodi Anak"),
    ("019", "Patung Setengah Badan Pria"),
    ("020", "Patung Setengah Badan Wanita 1"),
    ("021", "Patung Setengah Badan Wanita 2"),
    ("022", "Patung Setengah Badan Anak"),
    ("023", "Patung Kepala Dewasa"),
    ("024", "Patung Kepala Anak"),
    ("025", "Patung Kaki Dewasa"),
    ("026", "Patung Kaki Anak"),
    ("027", "Hanger Wanita / ABG"),
    ("028", "Hanger Pria"),
    ("029", "Hanger Jacket"),
    ("030", "Hanger Kayu Anak"),
    ("031", "Hanger Body / Stelan"),
    ("032", "Hanger Jepit Dewasa"),
    ("033", "Hanger Jepit Anak"),
    ("034", "Hanger Gamis / Ibu"),
    ("035", "PIN / Kawat Sensor"),
    ("036", "Tas / Keranjang Belanja"),
]

# The qualifier is the CLASS — `1021507001` — and not the family. Qualifying by
# `1021507` instead would put every rack, mannequin and hanger in the company
# into one reserve account, which is what the map did before and what made the
# client's own reserve report unreadable.
RESERVE_KEYS: list[tuple[str, str, str]] = [
    (f"1021507{suffix}", f"1021607{suffix}", f"7010215{suffix}")
    for suffix, _ in OPERATING_EQUIPMENT
]

# `site.id`, and these are joined to `site` by every endpoint below — the
# account map, the bills and the bank imports all carry a foreign key.
#
# Head office is `dc`, not `ho`. `poster::HEAD_OFFICE_SITE` says so and 0122
# maps the affiliate accounts against it. `ho` is an `org_place` id, which is
# a different thing: 0236 records the place `ho` as sitting at site `dc`. The
# migration that would fold both into one `ho` SITE is 0256, and 9b273f83 set
# it aside unlanded because it refuses `dc` — which every demo rig still uses.
# This file said `ho` in one place and `dc` in another until they were merged;
# the shops were never in doubt, `store-01` is still `store-01`.
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


def psql_exec(db: str, sql: str) -> None:
    subprocess.run(["psql", "-d", db, "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
                   capture_output=True, text=True, check=True)




def leaves(db: str) -> dict[tuple[str, str], str]:
    """(10-digit account, site) -> the account to map at that site.

    It used to answer with a TWELVE-digit leaf: the client's imported chart
    carried the location inside the account code, so `Kas di Tangan` existed
    fourteen times — `101100100100` for head office, `...101` for the first
    shop — and a meaning had to be bound to a different account at every site.

    The chart no longer works that way. The unit is a dimension on the ledger
    row (`journal_line.site_id`), so one account serves all fourteen and the
    posting accounts are ten digits. This function kept looking for twelve-digit
    rows, found none, and every binding silently went missing — which is why a
    freshly seeded database posted nothing and reported `no account is mapped
    for 'inventory' at store-10`.

    The answer now is the account itself, for every site that keeps books.
    """
    rows = psql(
        db,
        "select account_code from ledger_account "
        "where not is_group and length(account_code) = 10",
    )
    return {(code, site): code for (code,) in rows for site in SITES}


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
    for qualifier, asset, contra, expense, charge_kind in CATEGORIES:
        expense_key, contra_key = CHARGE_KEYS[charge_kind]
        for key, code in (
            ("fixed_asset", asset),
            (contra_key, contra),
            (expense_key, expense),
        ):
            if code is None:
                continue
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
    # lane-J: the replacement reserve, class by class.
    for qualifier, reserve, expense in RESERVE_KEYS:
        for key, code in (
            ("replacement_reserve", reserve),
            ("replacement_expense", expense),
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


def family_leaf(family: str) -> str:
    """The one posting account our chart keeps for an affiliate family.

    `1021402` -> `1021402001`. The client writes a leaf per unit pair and we
    write one per meaning; `ledger_account_remap` records the fold.
    """
    return family + "001"


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
            for key, owner, counterparty, client_code in (
                # Head office books the receivable, named for the shop, at 00.
                ("affiliate_receivable", HEAD_OFFICE, site,
                 receivable + index + ho_suffix),
                # The shop books the payable, named for head office, at its own.
                ("affiliate_payable", site, HEAD_OFFICE,
                 payable + ho_index + suffix),
            ):
                # The client's twelve-digit leaf is what gets CHECKED; the
                # ten-digit family leaf is what gets WRITTEN. Our chart keeps one
                # row per meaning (0243): the unit is `journal_line.site_id` and
                # the counterparty is in the qualifier, so all 196 of the
                # client's leaves in a family collapse onto `<family>001`.
                # Posting their code instead is what made every one of these 52
                # rows fail with "no account 102140200200 in the chart" — the
                # codes were verified against the right chart and sent to the
                # wrong one.
                code = family_leaf(receivable if key == "affiliate_receivable" else payable)
                if chart and client_code not in chart:
                    missing.append(f"{key}/{owner}/{kind}:{counterparty}/{client_code}")
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
                    # Which of the client's leaves this row stands for, so the
                    # collapse can still be read back on the map screen.
                    "note": chart.get(client_code, "inter-unit pair"),
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
        qualifier, _, _, _, charge_kind = CATEGORIES[index % len(CATEGORIES)]
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
            # Carried by a capitalised asset and by nothing else, which is why
            # it is set inside the branch below rather than here.
            "charge_kind": None,
            "in_service_on": None,
            "reason": "Seed: penilaian awal",
        }
        if body["decision"] == "CAPITALIZE":
            body.update(
                capitalized_cost_minor=rng.randrange(20_000, 400_000) * 1_000,
                salvage_value_minor=0,
                useful_life_months=0 if land else rng.choice([48, 60, 96, 120]),
                method="NONE" if land else "STRAIGHT_LINE",
                charge_kind=charge_kind,
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


def seed_reserve(api: Api, months, rng, report) -> None:
    """lane-J: what each shop puts aside against its operating equipment.

    Six of the thirty-six classes, at every location, rather than all of them:
    the point of the seed is that the reserve is visible and posts, and 504
    rates would be 504 rows nobody reads on a screen built to be read. The
    remaining thirty are mapped and unrated, which is the ordinary state of a
    class Finance has not decided about yet — and which `rated_sites = 0` on
    the classes list is there to show.
    """
    rated, runs = 0, []
    for suffix, _ in OPERATING_EQUIPMENT[:6]:
        for site in SITES:
            body = {
                "class_code": f"1021507{suffix}",
                "site_id": site,
                "effective_from": date(months[0][0], months[0][1], 1).isoformat(),
                "monthly_charge_minor": rng.randrange(150, 600) * 1_000,
                "note": "Seed: cadangan penggantian sesuai praktik klien",
            }
            if api.post("/api/v1/finance/assets/reserve/rates", body) is not None:
                rated += 1
    for year, month in months:
        run = api.post(
            f"/api/v1/finance/assets/reserve/run?period={year}-{month:02d}", {}
        )
        if run:
            runs.append(
                {
                    "month": f"{year}-{month:02d}",
                    "posted": run.get("posted_count"),
                    "total": run.get("posted_total_minor"),
                }
            )
    report["reserve_rates"] = rated
    report["reserve_runs"] = runs


def seed_bank(api: Api, leaf: dict, months, rng, report) -> None:
    """A statement of a real account of ours, at head office.

    This used to file one statement per site over `SITES[:4]`, which produced
    "Rekening koran store-01" — a bank account no shop has. Shops do not hold
    external accounts; what a shop holds is a DESTINATION for its takings
    (`store_bank_destination`, 0111). Since 0271 a statement must name a real
    company bank account, so the invention is now refused outright, which is the
    right answer arriving late.

    So: one account, described first, and the statements are of it.
    """
    imported = 0
    described = api.post(
        "/api/v1/finance/bank-accounts",
        {
            "ledger_account_code": "1011002001",
            "site_id": "dc",
            "bank_code": "BCA",
            "account_no": "1234567890",
            "account_holder": "PT Itulah Busana Nusantara",
            "kind": "GIRO",
            "is_primary": True,
        },
    )
    report["bank_accounts"] = 1 if described is not None else 0

    for index, site in enumerate(["dc"]):
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
                "source_name": f"Rekening koran BCA giro {site}",
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
        choices=[
            "all",
            "map",
            "periods",
            "bills",
            "assets",
            "reserve",
            "bank",
            "opening",
        ],
    )
    args = parser.parse_args()

    rng = random.Random(args.seed)
    api = Api(args.api, args.dry_run)
    leaf = leaves(args.db)
    months = [(2026, m) for m in (6, 7, 8, 9)]
    report: dict = {}

    want = args.stage
    if want in ("all", "map"):
        # lane-B: the two proposed accounts have to exist before anything can
        # be mapped to them, and `leaf` was read before they did.
        if not args.dry_run:
            leaf = leaves(args.db)
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
    if want in ("all", "reserve"):
        seed_reserve(api, months, rng, report)
    if want in ("all", "bank"):
        seed_bank(api, leaf, months, rng, report)

    report["api_calls"] = api.calls
    report["failures"] = api.failures[:10]
    report["failure_count"] = len(api.failures)
    print(json.dumps(report, indent=2))
    return 1 if api.failures else 0


if __name__ == "__main__":
    sys.exit(main())
