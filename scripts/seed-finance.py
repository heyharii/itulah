#!/usr/bin/env python3
"""Fill a dev cloud node's finance module with a believable set of books.

Reads go straight to Postgres (the chart, the categories and the asset classes
are what the migrations put there, and this script must agree with them rather
than with a copy of them); every WRITE goes through the API, because
`poster.rs` is the only thing allowed to write a journal and the invariants
that make these books trustworthy — balanced entries, no posting into a closed
month, no posting to a heading — live behind those endpoints.

The order below is the only order that works. `account_map` first: a posting
rule names a meaning, never an account code, so until the map is filled every
post is refused by design. Then the periods, because nothing posts into a month
that was never opened. Only then the documents.

    python3 scripts/seed-finance.py --db inventory_tanstack

# What changed with the forty-account chart (0287-0292)

A meaning used to resolve to a ten-digit account out of the client's own chart,
and the account carried the identity: which bank, which rack, which PPh
article, electricity or water. The chart is forty accounts now, and that
identity moved to where it always belonged:

  * a **category** on the journal line (`journal_line.category_code`), for the
    distinctions that were only ever names — expense kinds, pay components,
    cash pots, tenders, accrual kinds;
  * a **column or sub-ledger** that already existed, for the rest —
    `bank_account_id`, `supplier_id`, `asset_id`, `tax_type`,
    `financing_facility`, `principal`.

So `account_map` maps a meaning to a PAIR: `(account_code, category_code)`,
where the category is NULL exactly when the account declares no
`category_family`. Every pair below was derived mechanically from
`outputs/coa_thirty/remap-190-to-40.csv` — the ten-digit code each meaning used
to point at is kept in a comment so the derivation can be re-read — and checked
against `line_category` as the migrations seeded it.

`docs/coa-40-contract.md` is the frozen shape; `docs/coa-thirty.md` is why.
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
# the chart, by meaning: (account, category)
# --------------------------------------------------------------------------

# A meaning that needs no narrowing: one account, one category, the same
# everywhere. `None` for the category means the account declares no family —
# the identity of the line is a column (`supplier_id`, `bank_account_id`,
# `asset_id`) or a sub-ledger row (`tax_type`, `financing_facility`,
# `principal`), and a category on such a line is REFUSED, not ignored.
#
# The trailing comment on each row is the ten-digit account this meaning used
# to resolve to. It is not used for anything; it is there so that a person
# holding the client's own chart can check this table against it.
PLAIN: dict[str, tuple[str, str | None]] = {
    # --- stock and buying ------------------------------------------------
    "inventory": ("1301", "MERCHANDISE"),                 # 1011201001
    "cogs": ("5101", "COGS"),                             # 5010110001
    # The one row in this table that moves a figure rather than relabelling it.
    # The client filed `Potongan Pembelian` under root 8 (other income) out of
    # habit; PSAK 14 makes a trade discount part of the cost of the goods, so it
    # is a CONTRA-COGS category here. Every other pair below leaves its total on
    # the same line of the same statement; this one raises gross margin against
    # their own 2024-2025 reports, and it needs the accountant's word — see
    # `docs/finance-client-decisions.md` §14. Changing it back is this line and
    # one row of `ledger_account_remap`, as long as it is decided before the
    # opening balances land.
    "purchase_discount": ("5101", "PURCHASE_DISCOUNT"),   # 8010110003
    "purchase_price_variance": ("5101", "PURCHASE_DISCOUNT"),  # 8010110003
    "stock_loss": ("5102", "SHRINKAGE"),                  # 8010110006
    # `2101 Hutang usaha` takes no category: which supplier is owed is
    # `journal_line.supplier_id`, which is a foreign key and not a name.
    "trade_payable": ("2101", None),                      # 2012001001
    "non_merchandise_payable": ("2101", None),            # 2012001003
    "supplier_suspend": ("2102", None),                   # 2012001002
    # --- the store's three pots, and the fourth state money can be in -----
    "cash": ("1101", "DRAWER"),                           # 1011001001
    "petty_cash": ("1101", "PETTY"),                      # 1011001002
    "cashier_float": ("1101", "FLOAT"),                   # 1011001003
    # The meaning that had no client account at all — 0243 minted
    # `1011005001 Setoran Dalam Perjalanan` for it and 0277 marked it
    # `PENDING_CLIENT_CODE`. In a chart of forty it needs no account of its
    # own: money out of the drawer and not yet at the bank is cash in a
    # different pot, and `TRANSIT` is that pot. One fewer invented code.
    "cash_in_transit": ("1101", "TRANSIT"),               # 1011005001 (ours)
    # --- receivables -----------------------------------------------------
    "store_manager_receivable": ("1202", "STORE_MANAGER"),  # 1011102002
    # The unqualified card rows, and what they are FOR. A settlement that names
    # its acquirer resolves through the qualified rows below; one that names
    # none falls back to these, and they need a real category rather than a
    # blank — `CREDIT_CARD` and `DEBIT_CARD` are the tender "card receivable,
    # not broken down". Mapping them costs nothing and keeps a day's takings
    # postable when an acquirer nobody has mapped turns up, instead of refusing
    # the whole day.
    "card_receivable_credit": ("1201", "CREDIT_CARD"),    # 1011101001
    "card_receivable_debit": ("1201", "DEBIT_CARD"),      # 1011101002
    # --- selling ---------------------------------------------------------
    "revenue_cash": ("4101", "CASH"),                     # 4010110001
    "revenue_qris": ("4101", "QRIS"),                     # 4010114001 (ours)
    "sales_return": ("4202", None),                   # 4010214001
    "sales_discount": ("4201", None),               # 4010213001
    "card_fee": ("6101", "BIAYA_CREDIT_CARD"),            # 6010110002
    # Voucher money is received before it is earned, so it is a liability with
    # its own deferred-revenue kind — not the `VOUCHER` tender, which is what
    # the same voucher looks like on the day it is SPENT.
    "voucher_liability": ("2401", "VOUCHER_LIABILITY"),   # 2012305001 (ours)
    # --- five meanings on one account, and three of them used to be one ----
    #
    # `8010110007 Pendapatan (Biaya) Lain-Lain` carried `cash_variance`,
    # `asset_disposal_result` and `other_income_expense` at once, and a reader
    # had to guess which was which from the sign. Each is a named category now.
    # That is the argument of the whole collapse in three rows: the account
    # count went down and the number of things a reader can tell apart went up.
    "rounding": ("4301", "ROUNDING"),                     # 8010110002
    "interest_income": ("4301", "INTEREST"),              # 8010110001
    "cash_variance": ("4301", "CASH_VARIANCE"),           # 8010110007
    "asset_disposal_result": ("4301", "ASSET_DISPOSAL"),  # 8010110007
    "other_income_expense": ("4301", "INCOME_OTHER"),     # 8010110007
    # --- and the loss side of the same signed family, since 0296 ----------
    #
    # `Pendapatan dan (Biaya) Lain-lain` was one signed leaf, and a till that
    # came up short was a DEBIT inside a revenue account. The posting rules
    # now pick the side when they compute the result, so each gain meaning
    # above has a loss twin here, on `8301` under root 8. The legacy code is
    # the same signed account read back through `legacy_code_span`.
    "cash_shortage": ("8301", "CASH_SHORTAGE"),           # 8010110007, the short side
    "asset_disposal_loss": ("8301", "ASSET_DISPOSAL_LOSS"),  # 8010110007, the loss side
    "rounding_loss": ("8301", "ROUNDING_LOSS"),           # 8010110002, the loss side
    "other_expense": ("8301", "OTHER_EXPENSE"),           # 8010110007, the expense side
    # --- tax -------------------------------------------------------------
    #
    # `1402` and `2201` are control accounts over `tax_type`/`tax_period`, and
    # they ALSO declare `tax_kind`, so the kind is on the line as well as in
    # the sub-ledger. That is deliberate: a trial balance has to be readable
    # per article without joining the tax module.
    "vat_in": ("1402", "PPN_IN"),                         # 1011302004
    "pph25_credit": ("1402", "PPH25"),                    # 1011302002
    "vat_out": ("2201", "PPN_OUT"),                       # 2012101003
    "pph21_payable": ("2201", "PPH21"),                   # 2012101001
    "pph23_payable": ("2201", "PPH23"),                   # 2012101002
    "pph29_payable": ("2201", "PPH29"),                   # 2012101006
    "pbb_payable": ("2201", "PBB"),                       # 2012101004
    # `pph_final_payable` was DELIBERATELY UNMAPPED before this chart, and the
    # reason is worth keeping: the client's chart had no PPh 4(2) leaf under
    # 20121, and pointing this meaning at the PPh 23 account would have filed a
    # final tax in a creditable one, where somebody claims it back a year
    # later. With forty accounts the leaf is not the thing that distinguishes
    # them — the category is — so `2201 × PPH_FINAL` says exactly what the
    # missing leaf would have said, without inventing an account code. A rent
    # payment that used to refuse now posts.
    "pph_final_payable": ("2201", "PPH_FINAL"),           # (no client leaf)
    # PPh 4(2) on bank interest is FINAL — withheld at source, never recovered
    # — so it is an expense and not the prepaid it looks like. It used to point
    # at `8030112001 Current Tax Inc/Exp PPH Pasal 25`, whose NAME says PPh 25
    # and whose USE was this. The misleading name stays behind with the old
    # chart; `8201 × PPH_FINAL` is what it always meant.
    "tax_on_interest": ("8201", "PPH_FINAL"),             # 8030112001
    # --- owners ----------------------------------------------------------
    #
    # No category: WHICH owner is `principal_id` in the owner sub-ledger, which
    # is a register with names in it and not a list of codes.
    "capital_contributed": ("3101", None),                # 3013001001
    "owner_drawings": ("3102", None),                     # 3013001004
    # --- accrued, and what the store may spend out of a pot ---------------
    "payroll_payable": ("2301", "BIAYA_GAJI_DAN_UPAH_YMHD"),  # 2012201001
    "advance_purchase": ("1403", "ADVANCED_PURCHASE"),    # 1011303002
    "bank_admin_fee": ("6301", "BIAYA_BANK_HO"),          # 6010310004
    # The client's own expense for a receivable going bad. It had an account
    # (`6010310012 Biaya Penyisihan Kerugian Piutang`) and no meaning pointed
    # at it, so a write-off had nowhere to go.
    "bad_debt_expense": ("6301", "BIAYA_PENYISIHAN_KERUGIAN_PIUTANG"),  # 6010310012
    # Nine categories a shop may spend petty cash on, all the client's own
    # words, and the last is the catch-all — a list with no bottom means a
    # genuine receipt eventually has nowhere to go and comes out of the drawer
    # instead. The account is `6301` for every one of them; what used to be
    # nine accounts is nine categories.
    "expense_electricity": ("6301", "BIAYA_PEMAKAIAN_LISTRIK"),         # 6010310006
    "expense_water": ("6301", "BIAYA_PEMAKAIAN_AIR_BERSIH"),            # 6010310007
    "expense_telephone": ("6301", "BIAYA_TELEPHONE_FACSIMILE_MODEM"),   # 6010310005
    "expense_household": ("6301", "BIAYA_RUMAH_TANGGA"),                # 6010310003
    "expense_stationery": ("6301", "ALAT_TULIS_KANTOR_BARANG_CETAKAN"), # 6010310002
    "expense_transport": ("6301", "BIAYA_LOKAL_TRANSPORT"),             # 6010310009
    "expense_cleaning": ("6301", "BIAYA_KEBERSIHAN"),                   # 6010310001
    "expense_misc": ("6301", "MISCELLANEOUS_EXPENCES"),                 # 6010310099
    # Repairs sat in the maintenance family (`60104`), not the office one.
    "expense_repairs": ("6301", "BIAYA_PERBAIKAN_DAN_PERAWATAN_BANGUNAN"),  # 6010410004
    # --- financing -------------------------------------------------------
    #
    # No category: which facility is `financing_facility`, which carries the
    # lender, the schedule and the rate.
    "interest_expense": ("8101", None),                   # 8020111001
}

# Meanings a posting path needs and no account answers. Empty, and for a better
# reason than before: the two that used to sit here were meanings the CLIENT'S
# CHART had no leaf for. A chart of forty accounts plus a category cannot run
# out of leaves, so a gap here from now on would be a gap in this file.
UNANSWERED_MEANINGS: dict[str, str] = {}

# --------------------------------------------------------------------------
# meanings that are narrowed by a qualifier
# --------------------------------------------------------------------------
#
# `resolve_account(key, site, qualifier)` matches the qualifier EXACTLY. What
# the qualifier is depends on what narrows the meaning:
#
#   a bank      the acquirer or the bank the instrument is drawn on
#   a tender    the acquirer, which is what the till sends
#   an asset    the asset CLASS code (`asset_class.class_code`)
#   a facility  BANK or PRINCIPAL — which of the two loan accounts it is
#   an interunit pair  `<KIND>:<counterparty site>`, built by `domain::interunit`
#
# A tender naming an acquirer nothing is mapped for is refused BY NAME at
# posting time, which is the point: it is a gap somebody can close on the
# Account map screen, not a figure quietly filed under "cards".
QUALIFIED: dict[str, list[tuple[str, str, str | None]]] = {
    # --- banks: five leaves became one account plus a foreign key ----------
    #
    # `1102 Bank` declares NO category family: which account this is, is
    # `journal_line.bank_account_id`, and the foreign key
    # `journal_line_bank_account_agrees_with_the_account_posted` keeps the two
    # honest. The qualifier survives because the MAP still has to be narrowed —
    # a giro is drawn on one particular bank and the document says which — but
    # every qualifier now resolves to the same account, which is what makes a
    # bank nobody mapped a question about a bank account rather than about a
    # chart.
    "bank_giro": [
        ("BCA", "1102", None),        # 1011002001
        ("MANDIRI", "1102", None),    # 1011002002
        ("BRI", "1102", None),        # 1011002003
        ("BNI", "1102", None),        # 1011002004
        ("DANAMON", "1102", None),    # 1011002005
    ],
    "bank_savings": [
        ("BCA", "1102", None),        # 1011003001
        ("MANDIRI", "1102", None),    # 1011003002
        ("BRI", "1102", None),        # 1011003003
        ("BNI", "1102", None),        # 1011003004
        ("BTN", "1102", None),        # 1011003005
    ],
    # Money the company has and cannot spend today. Holding money is what makes
    # a deposit a TRANSFER rather than a payment; a time deposit is a CLASS of
    # bank account (`company_bank_account.kind`), not an account of its own.
    "time_deposit": [
        ("BCA", "1102", None),        # 1011004001
        ("MANDIRI", "1102", None),    # 1011004002
        ("BRI", "1102", None),        # 1011004003
        ("BNI", "1102", None),        # 1011004004
    ],
    # A giro written and not yet cleared is a liability of ours drawn on one
    # named bank, so the same argument gives the same shape: one account,
    # `bank_account_id` for the identity.
    "giro_outstanding": [
        ("BCA", "2103", None),        # 2012002001
        ("MANDIRI", "2103", None),    # 2012002002
        ("BRI", "2103", None),        # 2012002003
        ("BNI", "2103", None),        # 2012002004
        ("DANAMON", "2103", None),    # 2012002005
    ],
    # --- takings, by who settled them -------------------------------------
    #
    # A debit card is a named bank's debt and a credit card is a network's, and
    # the difference is a TENDER category now rather than two accounts. The
    # client's chart kept ONE account for all of them, so the split that used to
    # be impossible without a new account is a category away.
    "revenue_debit": [
        ("BCA", "4101", "DEBIT_BCA"),            # 4010111001
        ("MANDIRI", "4101", "DEBIT_MANDIRI"),    # 4010111002
        ("BRI", "4101", "DEBIT_BRI"),
        ("BNI", "4101", "DEBIT_BNI"),
    ],
    "revenue_credit": [
        ("VISA", "4101", "CREDIT_VISA"),         # 4010112001
        ("MASTER", "4101", "CREDIT_MASTER"),     # 4010112002
    ],
    "card_receivable_debit": [
        ("BCA", "1201", "DEBIT_BCA"),            # 1011101002
        ("MANDIRI", "1201", "DEBIT_MANDIRI"),    # 1011101002
        ("BRI", "1201", "DEBIT_BRI"),
        ("BNI", "1201", "DEBIT_BNI"),
    ],
    "card_receivable_credit": [
        ("VISA", "1201", "CREDIT_VISA"),         # 1011101001
        ("MASTER", "1201", "CREDIT_MASTER"),     # 1011101001
    ],
    # Who owes the QRIS money: the acquiring bank or the wallet, whichever the
    # till names. One account, one tender, five acquirers.
    "qris_receivable": [
        ("BCA", "1201", "QRIS"),                 # 1011101003 (ours)
        ("GOPAY", "1201", "QRIS"),
        ("OVO", "1201", "QRIS"),
        ("DANA", "1201", "QRIS"),
        ("SHOPEEPAY", "1201", "QRIS"),
    ],
    # --- documents somebody fills in --------------------------------------
    #
    # These three qualifiers are the ones the finance screens name in their own
    # help text and the ones the integration tests use. The category is the
    # client's own wording for the same thing, which is how a reader checks
    # that a qualifier and a category have not drifted apart.
    "prepaid_expense": [
        ("ASURANSI", "1401", "ASURANSI_BAYAR_DIMUKA"),   # 1011301001
    ],
    "accrued_expense": [
        ("UMUM", "2301", "BIAYA_GAJI_DAN_UPAH_YMHD"),    # 2012201001
    ],
    "advance": [
        ("PERJALANAN", "1403", "ADVANCED_TRAVELLING"),   # 1011303001
    ],
    "goods_in_transit": [
        ("DC", "1302", "MERCHANDISE"),                   # 1011203001
    ],
    # --- two loan accounts, and which one a facility is -------------------
    #
    # `2501 Pinjaman bank` and `2502 Pinjaman pemilik` are two accounts because
    # money owed to an owner is a related-party disclosure and money owed to a
    # bank is not. Neither takes a category: the facility register carries the
    # lender. `PRINCIPAL` is the qualifier `principal.rs` sends — it was
    # unmapped before, so an owner lending the company money was refused.
    "loan_principal": [
        ("BANK", "2501", None),        # 2022402001
        ("PRINCIPAL", "2502", None),   # 2022401001
    ],
}

# --------------------------------------------------------------------------
# the asset half of the map
# --------------------------------------------------------------------------
#
# The register files an asset under an `asset_class` — `FFE_KOMPUTER`,
# `OE_RAK_4`, `SEVENTH_SOFT_APPLICATION` — and the monthly run passes that
# class code as the qualifier (`assets.rs`). So the pair of keys a class
# charges through must be mapped per CLASS, exactly as it was before; what
# changed is that a class is a short name in its own table rather than a
# ten-character account code that could also be spelled with seven.
#
# WHICH pair depends on the charge kind, not on the class alone:
#
#   PPE          depreciates:  1609 accumulated depreciation, 7101 expense
#   OE           does NOT:     1610 replacement reserve, 7101 expense — the
#                              client replaces racks and hangers rather than
#                              writing them down (migration 0159)
#   INTANGIBLE   amortises:    1619 accumulated amortisation, 7101 expense
#   DEFERRED     amortises:    the same pair
#
# None of the six asset accounts takes a category: the identity of an asset
# line is `journal_line.asset_id`, and the class is read from the register.
#
# The class list is READ FROM THE DATABASE rather than written here, because
# 0287 is the thing that decides what classes exist and a second copy of that
# list would be a second answer to the same question.

# Which account a class's cost sits in, by `asset_class.kind`.
COST_ACCOUNT: dict[str, str] = {
    "PPE": "1601",
    "OE": "1601",
    "INTANGIBLE": "1602",
    "DEFERRED": "1602",
}

# (contra account, expense account, charge kind), by `asset_class.kind`.
CHARGE: dict[str, tuple[str, str, str]] = {
    "PPE": ("1609", "7101", "DEPRECIATION"),
    "OE": ("1610", "7101", "REPLACEMENT_RESERVE"),
    "INTANGIBLE": ("1619", "7101", "AMORTISATION"),
    "DEFERRED": ("1619", "7101", "AMORTISATION"),
}

# The pair of meanings each charge kind posts through. Mirrors
# `ChargeKind::charge_keys` in `domain/depreciation.rs`; if the two disagree,
# the seed maps accounts the run never reads and the run refuses on accounts
# the seed never mapped.
CHARGE_KEYS: dict[str, tuple[str, str]] = {
    "DEPRECIATION": ("depreciation_expense", "accumulated_depreciation"),
    "REPLACEMENT_RESERVE": ("replacement_expense", "replacement_reserve"),
    "AMORTISATION": ("amortisation_expense", "accumulated_amortisation"),
}

# Which meaning holds a class's COST, by kind. `1602` has its own meaning
# because it is its own balance-sheet line (PSAK), not a class of fixed asset.
COST_KEY: dict[str, str] = {
    "PPE": "fixed_asset",
    "OE": "fixed_asset",
    "INTANGIBLE": "intangible_asset",
    "DEFERRED": "intangible_asset",
}

# Classes that get a cost account and NO charge, each for its own reason.
#
# `TANAH_HAK_MILIK` — freehold land is not depreciated, and the client's chart
# agrees: under `1021601` the only leaf is the one for HGB, and `70102` had no
# family for land at all. Mapping it to a building's expense account, which
# this table used to do, describes a posting that must never happen.
#
# `CONTRACT_IN_PROGRESS` — work being paid for on something not built yet. It
# charges nothing until it is re-filed as what it became (0213).
NO_CHARGE: set[str] = {"TANAH_HAK_MILIK", "CONTRACT_IN_PROGRESS"}

# A class 0287 created that is not a class of thing: `1031802002 Akumulasi
# Amortisasi Pre Opening` is the CONTRA of `1031802001 Pre Opening`, and it
# became a row in `asset_class` because the generator slugged every ten-digit
# leaf under `1031802`. Nothing is mapped for it, so an asset filed under it is
# refused by name rather than charged against its own contra. Reported, not
# quietly skipped — the fix belongs in the migration.
NOT_A_CLASS: set[str] = {"AKUMULASI_AMORTISASI_PRE_OPENING"}

# The meaning for work still being built. `asset_classes.rs` names the class
# code in Rust as `WORK_IN_PROGRESS_CLASS`; if the two disagree the register
# has a resting place nobody can charge out of.
WORK_IN_PROGRESS_KEY = "work_in_progress"

# 0294's two families. `1601 Aset tetap` separates what is in service from what
# is still being built; `7101` separates wearing out from being replaced.
ASSET_STAGE_IN_SERVICE = "IN_SERVICE"
ASSET_STAGE_IN_PROGRESS = "IN_PROGRESS"
# Keyed by the CHARGE kind, whose names are `CHARGE`'s third element — note
# `REPLACEMENT_RESERVE` there against `REPLACEMENT` here, because one names the
# balance-sheet mechanism and the other the profit-and-loss line.
DEPRECIATION_KIND: dict[str, str] = {
    "DEPRECIATION": "DEPRECIATION",
    "AMORTISATION": "AMORTISATION",
    "REPLACEMENT_RESERVE": "REPLACEMENT",
}

# --------------------------------------------------------------------------
# interunit
# --------------------------------------------------------------------------
#
# One account, `1501`, for every combination of fourteen units against
# fourteen, in both directions, in every family. The client's chart spent 1,176
# leaves on this and our previous chart spent four; the lawful reading is that
# inside ONE legal entity an interunit balance is neither an asset nor a
# liability — it is a clearing line whose company-wide total must be zero, and
# which disappears on consolidation (owner, 18 Sep 2026).
#
# What survives is the identity: WHICH unit is `journal_line.site_id`, WHICH
# counterparty is `journal_line.counter_site_id` (required on `1501`), and WHY
# is the `interunit_reason` category. `domain::interunit` builds the qualifier
# `<KIND>:<counterparty site>`, so a leg the poster adds resolves without the
# poster ever naming a code.
#
# The fifty-two per-pair rows this file used to verify against the client's own
# CSV export are gone with the leaves they verified. There is nothing left to
# check a code against: the account no longer depends on the pair.
# `site.id`, and these are joined to `site` by every endpoint below — the
# account map, the bills and the bank imports all carry a foreign key.
#
# Head office is `dc`, not `ho`. `poster::HEAD_OFFICE_SITE` says so and 0122
# maps the interunit accounts against it. `ho` is an `org_place` id, which is
# a different thing: 0236 records the place `ho` as sitting at site `dc`. The
# migration that would fold both into one `ho` SITE is 0256, and 9b273f83 set
# it aside unlanded because it refuses `dc` — which every demo rig still uses.
SITES = ["dc"] + [f"store-{n:02d}" for n in range(1, 14)]
HEAD_OFFICE = "dc"


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


class Chart:
    """What the migrations put in the chart, read once.

    Three questions, and the answers have to come from the database rather than
    from a table in this file: does this account exist and can it be posted to,
    which family does it declare, and is this category a member of that family.
    The trigger `assert_category_matches_account` asks all three at posting
    time and refuses by name; asking them here turns a typo in the tables above
    into ONE line in the report instead of nine hundred refusals.
    """

    def __init__(self, db: str | None, tolerant: bool = False) -> None:
        self.families: dict[str, str | None] = {}
        self.categories: dict[str, str] = {}
        self.classes: list[tuple[str, str]] = []
        self.unread: str | None = None
        if db is None:
            return
        try:
            self._read(db)
        except Exception as exc:  # noqa: BLE001
            # A rehearsal may be run with no database at all — to read what this
            # file WOULD write. A real run may not: seeding against a chart
            # nobody read is how a map ends up pointing at accounts that are not
            # there.
            if not tolerant:
                raise
            self.unread = str(exc).splitlines()[0][:160]

    def _read(self, db: str) -> None:
        for code, family in psql(
            db,
            "select account_code, coalesce(category_family, '') "
            "from ledger_account where not is_group",
        ):
            self.families[code] = family or None
        for code, family in psql(
            db, "select category_code, family from line_category where is_active"
        ):
            self.categories[code] = family
        self.classes = [
            (code, kind)
            for code, kind in psql(
                db, "select class_code, kind from asset_class where is_active order by class_code"
            )
        ]

    def check(self, account: str, category: str | None) -> str | None:
        """The reason this pair would be refused, or None."""
        if not self.families:
            return None  # nothing was read; let the API be the judge
        if account not in self.families:
            return f"{account} is not a postable account"
        wanted = self.families[account]
        if wanted is None and category is not None:
            return f"{account} takes no category, and {category} was offered"
        if wanted is not None and category is None:
            return f"{account} wants a {wanted} and none was offered"
        if category is not None and self.categories.get(category) != wanted:
            got = self.categories.get(category, "no such category")
            return f"{account} wants a {wanted}; {category} is {got}"
        return None


def month_days(year: int, month: int) -> tuple[date, date]:
    first = date(year, month, 1)
    nxt = date(year + (month == 12), (month % 12) + 1, 1)
    return first, nxt - timedelta(days=1)


# --------------------------------------------------------------------------
# the seed, in the only order that posts
# --------------------------------------------------------------------------


# (component, store leaf, head-office leaf): the allowances seed-hr.py agrees.
PAY_COMPONENT_LINKS = [
    ("TRANSPORT", "6015", "6029"),
    ("MAKAN", "6014", "6028"),
]


def seed_account_map(api: Api, chart: Chart, report: dict) -> None:
    written = 0
    refused: list[str] = []

    def write(key: str, qualifier: str, account: str, category: str | None) -> None:
        nonlocal written
        wrong = chart.check(account, category)
        if wrong is not None:
            refused.append(f"{key}/{qualifier or '-'}: {wrong}")
            return
        ok = api.post(
            "/api/v1/finance/account-links",
            {
                "role": key,
                "source_id": qualifier,
                "scope_type": "ALL",
                "account_code": account,
                "category_code": category,
                "note": "seed",
            },
        )
        written += ok is not None

    for key, (account, category) in PLAIN.items():
        write(key, "", account, category)

    for key, choices in QUALIFIED.items():
        for qualifier, account, category in choices:
            write(key, qualifier, account, category)

    # The asset half: one qualifier per CLASS, and which pair of meanings it
    # charges through comes from the class's kind.
    skipped_classes: list[str] = []
    for class_code, kind in chart.classes:
        if class_code in NOT_A_CLASS:
            skipped_classes.append(f"{class_code} is a contra leaf, not a class of thing")
            continue
        cost_account = COST_ACCOUNT.get(kind)
        if cost_account is None:
            skipped_classes.append(f"{class_code} has kind {kind}, which this seed does not know")
            continue
        in_progress = class_code in ("CIP", "CONTRACT_IN_PROGRESS")
        cost_key = WORK_IN_PROGRESS_KEY if in_progress else COST_KEY[kind]
        # 0294 gave `1601` an `asset_stage` and `7101` a `depreciation_kind`,
        # because collapsing them had cost two things that matter: capitalising
        # work in progress became `Dr 1601 / Cr 1601` for one asset — a journal
        # that says nothing — and the profit and loss lost the split between an
        # asset wearing out and a rack being replaced, which is the whole reason
        # 0159 exists. `1602` and the three contra accounts declare no family,
        # so their rows still carry None; the category there would be a second
        # answer to a question `asset_id` already answers.
        write(cost_key, class_code, cost_account,
              ASSET_STAGE_IN_PROGRESS if in_progress else ASSET_STAGE_IN_SERVICE
              if cost_account == "1601" else None)
        if class_code in NO_CHARGE:
            continue
        contra, expense, charge_kind = CHARGE[kind]
        expense_key, contra_key = CHARGE_KEYS[charge_kind]
        write(contra_key, class_code, contra, None)
        write(expense_key, class_code, expense,
              DEPRECIATION_KIND.get(charge_kind) if expense == "7101" else None)

    # Interunit needs nothing here: 0460 links the affiliate pair once per
    # family and kind of site, and a new shop reaches it with no row of its own.

    # Pay components (0466): the standing allowances seed-hr agrees, each on
    # its own store and head-office leaf, as Finance would link them.
    for component, store_account, head_office_account in PAY_COMPONENT_LINKS:
        for site_kind, account in (("STORE", store_account), ("HO", head_office_account)):
            ok = api.post(
                "/api/v1/finance/account-links",
                {
                    "role": "payroll_expense",
                    "source_type": "PAY_COMPONENT",
                    "source_id": component,
                    "scope_type": "SITE_KIND",
                    "scope_key": site_kind,
                    "account_code": account,
                    "note": "seed",
                },
            )
            written += ok is not None

    report["mappings"] = written
    report["mapping_gaps"] = refused
    report["asset_classes_skipped"] = skipped_classes


def seed_periods(api: Api, months: list[tuple[int, int]], report: dict) -> None:
    opened = 0
    # The month BEFORE the first one too, because that is where the cutover
    # sits: an opening balance is dated the last day of the old system, and
    # `opening.rs` refuses a cutover whose period does not exist — "open it
    # before importing a cutover dated 2026-05-31". Which is right: an entry
    # has to land in a period somebody opened, and the beginning of the books
    # is still an entry.
    year, month = months[0]
    before = (year - 1, 12) if month == 1 else (year, month - 1)
    for year, month in [before, *months]:
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


def seed_assets(api: Api, chart: Chart, months, rng, report) -> None:
    """Assets, filed under the register's own classes.

    `fixed_asset.category_code` points at `asset_class(class_code)` now and not
    at `ledger_account`, which is what closes the ten-versus-seven-character
    qualifier bug: the importer wrote `1021507001` and the seed wrote
    `1021507`, both were valid account codes, and every imported asset resolved
    to nothing while nothing reported a mismatch.
    """
    usable = [
        (code, kind)
        for code, kind in chart.classes
        if code not in NOT_A_CLASS and kind in COST_ACCOUNT
    ]
    if not usable:
        report["assets_registered"] = 0
        report["assets_note"] = "no asset classes in the database — run the migrations"
        return
    registered, assessed = 0, 0
    for index in range(21):
        class_code, kind = usable[index % len(usable)]
        site = SITES[index % len(SITES)]
        year, month = months[0]
        acquired = date(year, month, 1) + timedelta(days=rng.randrange(28))
        asset = api.post(
            "/api/v1/finance/assets",
            {
                "asset_number": f"FA-{index + 1:04d}",
                "name": f"{class_code.replace('_', ' ').title()} {site}",
                "category_code": class_code,
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
        charges = class_code not in NO_CHARGE
        charge_kind = CHARGE[kind][2] if charges else None
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
                useful_life_months=0 if not charges else rng.choice([48, 60, 96, 120]),
                method="NONE" if not charges else "STRAIGHT_LINE",
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


def seed_reserve(api: Api, chart: Chart, months, rng, report) -> None:
    """What each shop puts aside against its operating equipment.

    Six of the thirty-six OE classes, at every location, rather than all of
    them: the point of the seed is that the reserve is visible and posts, and
    504 rates would be 504 rows nobody reads on a screen built to be read. The
    remaining thirty are mapped and unrated, which is the ordinary state of a
    class Finance has not decided about yet — and which `rated_sites = 0` on
    the classes list is there to show.
    """
    rated, runs = 0, []
    operating = [code for code, kind in chart.classes if kind == "OE"][:6]
    for class_code in operating:
        for site in SITES:
            body = {
                "class_code": class_code,
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


def seed_bank(api: Api, months, rng, report) -> None:
    """A statement of a real account of ours, at head office.

    Shops do not hold external accounts; what a shop holds is a DESTINATION for
    its takings (`store_bank_destination`, 0111). Since 0271 a statement must
    name a real company bank account, so inventing "Rekening koran store-01" is
    refused outright, which is the right answer arriving late.

    All fourteen of the client's bank leaves are one account now — `1102` — and
    WHICH account a statement is of is `company_bank_account`, so the statement
    below names the ledger account once and the bank account by its own row.
    """
    imported = 0
    described = api.post(
        "/api/v1/finance/bank-accounts",
        {
            "ledger_account_code": "1102",
            "site_id": HEAD_OFFICE,
            "bank_code": "BCA",
            "account_no": "1234567890",
            "account_holder": "PT Itulah Busana Nusantara",
            "kind": "GIRO",
            "is_primary": True,
        },
    )
    report["bank_accounts"] = 1 if described is not None else 0

    for index, site in enumerate([HEAD_OFFICE]):
        year, month = months[-1]
        first, last = month_days(year, month)
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
                "account_code": "1102",
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


def seed_opening_balances(api: Api, months, rng, report) -> None:
    """Cash and capital, so the balance sheet is not an empty frame.

    Through the OPENING CUTOVER, not through a hand-written journal. It used to
    post `/api/v1/finance/journal`, and every one of those calls is refused:
    cash carries `manual_je_policy = 'OVERRIDE'`, which admits a correction
    somebody approved and nothing else. An opening balance is neither a
    correction nor a hand-keyed entry — it is the beginning of the books, it has
    its own document and its own `source_kind = 'OPENING'`, and `opening.rs` is
    the door the system already provides for it.

    The sheet is the client's own shape, plus one column: `1101 Kas` declares a
    `pot` family, so a line on it that carries no category is REFUSED by
    `assert_category_matches_account`. `opening.rs` ignores columns it does not
    know, so writing `category_code` here is safe before the import reads it and
    correct after — and until it does read it, the refusal names the account and
    the family, which is the failure worth having.
    """
    year, month = months[0]
    # The last day of the old system, which is the day before the books open.
    cutover = date(year, month, 1) - timedelta(days=1)
    # Head office only, and that is the model rather than a shortcut.
    # `3101 Modal disetor` carries `dimension = 'company'`, so the poster
    # refuses it at a shop by name. A shop's cash is not capital it was given,
    # it is the float head office sent, and that arrives as a document. The
    # trial balance also has to agree PER SITE, so a shop's opening cash with no
    # counterpart at the same shop could not be imported anyway.
    amount = rng.randrange(50_000, 250_000) * 1_000
    reference = f"SEED-OB-{cutover.isoformat()}"
    rows = [
        "site_id,account_code,category_code,debit,credit,document_no,memo",
        f"{HEAD_OFFICE},1101,DRAWER,{amount},,{reference},Saldo awal kas (seed)",
        f"{HEAD_OFFICE},3101,,,{amount},{reference},Modal setor awal (seed)",
    ]
    outcome = api.post(
        "/api/v1/finance/opening/balances",
        {"cutover_date": cutover.isoformat(), "csv": "\n".join(rows), "commit": True},
    )
    report["opening_entries"] = len(outcome.get("entries", [])) if outcome else 0
    report["opening_cutover"] = cutover.isoformat()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="inventory_tanstack")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--seed", type=int, default=20260902)
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
    chart = Chart(args.db, tolerant=args.dry_run)
    months = [(2026, m) for m in (6, 7, 8, 9)]
    report: dict = {}

    want = args.stage
    if want in ("all", "map"):
        seed_account_map(api, chart, report)
    if want in ("all", "periods"):
        seed_periods(api, months, report)
    if want in ("all", "opening"):
        seed_opening_balances(api, months, rng, report)
    if want in ("all", "bills"):
        suppliers = [tuple(r) for r in psql(args.db, "select supplier_id, name from supplier order by name limit 12")]
        seed_bills(api, suppliers, months, rng, report)
    if want in ("all", "assets"):
        seed_assets(api, chart, months, rng, report)
        seed_depreciation(api, months, report)
    if want in ("all", "reserve"):
        seed_reserve(api, chart, months, rng, report)
    if want in ("all", "bank"):
        seed_bank(api, months, rng, report)

    if chart.unread is not None:
        report["chart_unread"] = chart.unread
    report["api_calls"] = api.calls
    report["failures"] = api.failures[:10]
    report["failure_count"] = len(api.failures)
    print(json.dumps(report, indent=2))
    # Exit 1 if ANY call was refused. `scripts/seed-everything.sh` reads this
    # and carries on rather than ending the run, because a refusal here is
    # information — an account whose policy says no, a category that has moved
    # — and not a reason to stop the other eight steps.
    return 1 if api.failures else 0


if __name__ == "__main__":
    sys.exit(main())
