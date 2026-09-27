#!/usr/bin/env python3
"""Price the range, promote it, and sell it — so that every sale sold a garment
that was actually standing in that shop.

    python3 scripts/seed-commercial-and-trade.py --db "$DATABASE_URL"

Runs after `seed-full-chain.py`, which is the script that puts goods in the
shops. This one adds the four things a shop needs before it can trade, in the
order the schema insists on:

    1. a price book        every SKU priced and made sellable, then published
    2. promotions          rules, campaigns, markdowns, coupons
    3. members             the shoppers a sale can be attributed to
    4. sales               receipts, tenders, and the stock they took away

WHY THIS IS NOT `seed-sales.sql`. That file writes 21,829 receipts against 200
subjects and moves nothing: in the dev database every one of those sales sold
the same two hundred garments over and over, and the ledger never heard about
any of it. `backend/src/cloud/postgres/sales.rs` does the opposite — completing
a sale moves its units `store floor / on hand -> external/customer` under cause
`SALE` — so a seeded sale that skips the movement is a sale whose stock is
still on the shelf. Here a sale can only sell a unit that

    * belongs to that shop,
    * had already reached the sales floor on the day of the sale, and
    * has not been sold already,

and completing it writes the movement. The consequence is that sales volume is
bounded by stock rather than chosen: this seeds as many receipts as the goods
support, and says how many that was.

TWO INVARIANTS WORTH KNOWING, both learned the expensive way by the scripts
that came before this one:

  * A price with no `commercial_assortment_rule` beside it is invisible.
    `load_site_price_book` INNER JOINs the two, so the shop simply has no
    price — no error, no warning. They are written together here.
  * `sale_line` and `sale_payment` refuse to be written against a sale that is
    not OPEN, and a COMPLETED sale is immutable. So a receipt is opened, filled,
    and only then completed — which is also the order a till does it in.

Deterministic and re-runnable: ids derive from stable names, the price book is
found by name before a new one is minted, and every insert is guarded.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import subprocess
import sys
import uuid
from datetime import date, datetime, timedelta

NAMESPACE = uuid.UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")


def rid(name: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, name)


class Db:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    def rows(self, query: str) -> list[list[str]]:
        done = subprocess.run(
            ["psql", "-d", self.dsn, "-v", "ON_ERROR_STOP=1", "-tAF", "\x1f", "-c", query],
            capture_output=True, text=True,
        )
        if done.returncode != 0:
            sys.exit(f"psql read failed:\n{done.stderr.strip()}")
        return [line.split("\x1f") for line in done.stdout.splitlines() if line]

    def one(self, query: str) -> str:
        got = self.rows(query)
        return got[0][0] if got else ""

    def run(self, sql: str) -> None:
        done = subprocess.run(
            ["psql", "-d", self.dsn, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
            input=sql, capture_output=True, text=True,
        )
        if done.returncode != 0:
            sys.exit(f"psql write failed:\n{done.stderr.strip()}")
        if done.stdout.strip():
            print(done.stdout.strip())

    def copy(self, table: str, columns: list[str], records: list[tuple]) -> None:
        if not records:
            return
        buffer = io.StringIO()
        for record in records:
            buffer.write("\t".join(_tsv(v) for v in record))
            buffer.write("\n")
        done = subprocess.run(
            ["psql", "-d", self.dsn, "-v", "ON_ERROR_STOP=1", "-q",
             "-c", f"\\copy {table} ({', '.join(columns)}) FROM STDIN"],
            input=buffer.getvalue(), capture_output=True, text=True,
        )
        if done.returncode != 0:
            sys.exit(f"COPY into {table} failed:\n{done.stderr.strip()}")


def _tsv(value) -> str:
    if value is None:
        return "\\N"
    if isinstance(value, bool):
        return "t" if value else "f"
    return (
        str(value).replace("\\", "\\\\").replace("\t", "\\t")
        .replace("\n", "\\n").replace("\r", "\\r")
    )


def q(value) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


# --------------------------------------------------------------------------
# 1. the price book
# --------------------------------------------------------------------------

BOOK_NAME = "Range 2026"
TAX_RATE_BPS = 1100  # PPN 11%, tax-inclusive, which is how Indonesian retail quotes


def publish_prices(db: Db, rng: random.Random) -> tuple[str, int]:
    """One published book that prices every SKU, plus the shops that undercut it.

    Three shapes on purpose, because they are the three the Pricelist screen has
    to draw differently: one price for most styles, a per-size price for some
    (an XXL costs more than an S), and a cheaper rung at a handful of shops.
    """
    existing = db.one(
        f"SELECT id::text || ' ' || version::text FROM commercial_publication "
        f"WHERE name = {q(BOOK_NAME)} AND status = 'PUBLISHED'"
    )
    if existing:
        publication, version = existing.split()
        print(f"price book “{BOOK_NAME}” is already published — leaving prices alone")
        return publication, int(version)

    priced = db.rows(
        """
        SELECT k.id, k.sku_code, v.base_price_minor, k.size_code
          FROM sku k
          JOIN article_setup_variant v
            ON v.session_id = k.created_by_session_id
           AND v.colour_digit = k.colour_digit
           AND v.size_code = k.size_code
         WHERE k.active
        """
    )
    if not priced:
        sys.exit("no SKU carries a setup price; run scripts/seed-full-chain.py first")

    stores = [r[0] for r in db.rows("SELECT id FROM site WHERE kind='STORE' ORDER BY id")]

    publication = str(rid("book:range-2026"))
    version = int(db.one("SELECT COALESCE(max(version), 0) + 1 FROM commercial_publication"))
    db.run(
        "INSERT INTO commercial_publication (id, version, name, status, effective_from, created_by, created_at) "
        f"VALUES ({q(publication)}, {version}, {q(BOOK_NAME)}, 'DRAFT', now() - interval '400 days', 'seed', now() - interval '400 days') "
        "ON CONFLICT (id) DO NOTHING"
    )

    price_rows, assortment_rows = [], []

    def add(sku_id: str, site: str | None, amount: int, tag: str) -> None:
        key = f"price:{publication}:{sku_id}:{site or '*'}:{tag}"
        price_rows.append(
            (rid(key), publication, sku_id, site, "STORE", "IDR", amount, "STANDARD", None)
        )
        assortment_rows.append(
            (rid(f"assort:{key}"), publication, sku_id, site, "STORE", True)
        )

    # Per-size pricing is a property of the STYLE, not of one SKU, so the
    # decision is made per article and every SKU under it follows.
    per_size_articles: dict[str, bool] = {}
    for sku_id, code, base, size in priced:
        article = code[:8]
        if article not in per_size_articles:
            per_size_articles[article] = rng.random() < 0.14
        amount = int(base)
        if per_size_articles[article]:
            # Bigger sizes cost more, which is the case where one figure in a
            # cell would be a lie.
            amount += int(size) * 5000
        add(sku_id, None, amount, "chain")

        if rng.random() < 0.18:
            for site in rng.sample(stores, rng.randint(2, 4)):
                add(sku_id, site, int(amount * rng.uniform(0.82, 0.94) // 1000) * 1000, "site")

    print(f"pricing {len(priced)} SKUs — {len(price_rows)} rungs in “{BOOK_NAME}” v{version} ...")
    for start in range(0, len(price_rows), 20000):
        db.copy(
            "commercial_price_rule",
            ["id", "publication_id", "sku_id", "site_id", "channel", "currency",
             "unit_price_minor", "tax_category", "site_ids"],
            price_rows[start:start + 20000],
        )
        db.copy(
            "commercial_assortment_rule",
            ["id", "publication_id", "sku_id", "site_id", "channel", "sellable"],
            assortment_rows[start:start + 20000],
        )

    db.run(
        "INSERT INTO commercial_tax_rule (id, publication_id, tax_category, rate_bps, tax_inclusive) "
        f"VALUES ({q(str(rid('tax:standard:' + publication)))}, {q(publication)}, 'STANDARD', {TAX_RATE_BPS}, true), "
        f"({q(str(rid('tax:zero:' + publication)))}, {q(publication)}, 'ZERO_RATED', 0, true) "
        "ON CONFLICT DO NOTHING"
    )
    # The book stays a DRAFT here on purpose. `protect_commercial_rule` fires
    # on INSERT as well as UPDATE, so a promotion cannot be added to a book that
    # has already been published — everything that belongs in the book goes in
    # first, and `close_book` publishes it once.
    return publication, version


# --------------------------------------------------------------------------
# 2. promotions
# --------------------------------------------------------------------------

def close_book(db: Db, publication: str) -> None:
    """Publish the book, which is also the moment its rules become immutable."""
    db.run(
        "UPDATE commercial_publication SET status='PUBLISHED', "
        "published_at = now() - interval '400 days', published_by='seed' "
        f"WHERE id = {q(publication)} AND status = 'DRAFT'"
    )


def seed_promotions(db: Db, publication: str, rng: random.Random) -> None:
    """What the shop is offering, on top of what it charges.

    A rule, a campaign and a markdown are three different things and the screens
    draw them differently: a RULE is a condition ("three for two"), a CAMPAIGN
    is a budgeted period with a name a shopper would recognise, and a MARKDOWN
    replaces the price of one SKU outright. Seeding only one of the three makes
    two of the three screens look broken.
    """
    if db.one("SELECT count(*) FROM commercial_rule") != "0":
        print("promotions already present — skipping")
        return

    today = date.today()
    campaigns = [
        ("RAMADAN-2026", "Ramadan Sale", "ACTIVE", -30, 20, 450_000_000),
        ("BACK-TO-SCHOOL", "Back to School", "EXPIRED", -160, -110, 220_000_000),
        ("NEW-YEAR-2026", "New Year Clearance", "EXPIRED", -250, -230, 180_000_000),
        ("MIDYEAR-2026", "Mid Year Sale", "EXPIRED", -95, -70, 300_000_000),
        ("WEEKEND-DEALS", "Weekend Deals", "ACTIVE", -14, 45, 90_000_000),
        ("MEMBER-DAYS", "Member Days", "SCHEDULED", 12, 26, 120_000_000),
    ]
    db.copy(
        "commercial_campaign",
        ["id", "publication_id", "campaign_id", "name", "status", "valid_from",
         "valid_to", "budget_minor", "max_uses", "created_at", "headline", "terms"],
        [
            (rid(f"campaign:{cid}"), publication, cid, name, status,
             today + timedelta(days=start), today + timedelta(days=end),
             budget, None, today + timedelta(days=start - 7),
             f"{name} — savings across the range",
             "While stocks last. Cannot be combined with other offers.")
            for cid, name, status, start, end, budget in campaigns
        ],
    )

    rules = [
        ("BUY2GET1-TEES", "Buy 2 get 1 free on tees", {"kind": "BUY_X_GET_Y", "buy": 2, "get": 1, "division": "PRIA"}, 10),
        ("PCT10-KIDS", "10% off kids", {"kind": "PERCENT_OFF", "percent": 10, "division": "ANAK_LAKI"}, 20),
        ("PCT15-WOMENS", "15% off womenswear", {"kind": "PERCENT_OFF", "percent": 15, "division": "WANITA"}, 20),
        ("BASKET-500K", "Rp25.000 off baskets over Rp500.000", {"kind": "BASKET_THRESHOLD", "threshold_minor": 50_000_000, "discount_minor": 2_500_000}, 30),
        ("PCT20-FOOTWEAR", "20% off footwear", {"kind": "PERCENT_OFF", "percent": 20, "division": "SANDAL_SEPATU"}, 20),
        ("MEMBER-5", "Extra 5% for members", {"kind": "PERCENT_OFF", "percent": 5, "member_only": True}, 40),
        ("ACC-2FOR", "Two accessories for Rp99.000", {"kind": "BUNDLE_PRICE", "quantity": 2, "price_minor": 9_900_000, "division": "AKSESORIS"}, 15),
        ("CLEARANCE-30", "30% off clearance lines", {"kind": "PERCENT_OFF", "percent": 30, "tag": "CLEARANCE"}, 25),
    ]
    db.copy(
        "commercial_rule",
        ["id", "publication_id", "rule_id", "name", "definition", "status", "priority", "created_at"],
        [
            (rid(f"rule:{code}"), publication, code, name, json.dumps(definition),
             "ACTIVE" if index % 4 else "PAUSED", priority,
             datetime.now() - timedelta(days=200 - index * 12))
            for index, (code, name, definition, priority) in enumerate(rules)
        ],
    )

    # Markdowns name a real SKU, because a markdown on a SKU that does not exist
    # is a price that can never apply to anything.
    marked = db.rows(
        """
        SELECT k.id, k.sku_code, r.unit_price_minor
          FROM sku k
          JOIN commercial_price_rule r ON r.sku_id = k.id AND r.site_id IS NULL
         ORDER BY k.sku_code
         LIMIT 400
        """
    )
    picked = rng.sample(marked, min(24, len(marked)))
    db.copy(
        "commercial_markdown",
        ["id", "publication_id", "markdown_id", "sku_id", "sku_code", "site_id",
         "replacement_unit_price_minor", "priority", "effective_from", "effective_to",
         "created_at", "campaign_id", "iso_weekdays"],
        [
            (rid(f"markdown:{code}"), publication, f"MD-{index + 1:04d}", sku_id, code, None,
             int(int(price) * rng.uniform(0.55, 0.8) // 1000) * 1000, 10,
             today - timedelta(days=30), today + timedelta(days=20),
             today - timedelta(days=32), "RAMADAN-2026", "{1,2,3,4,5,6,7}")
            for index, (sku_id, code, price) in enumerate(picked)
        ],
    )

    db.copy(
        "commercial_coupon",
        ["id", "publication_id", "code", "rule_id", "active", "customer_id",
         "valid_from", "valid_to", "max_uses", "created_at"],
        [
            (rid("coupon:WELCOME10"), publication, "WELCOME10", "PCT10-KIDS", True, None,
             today - timedelta(days=90), today + timedelta(days=90), 5000, today - timedelta(days=90)),
            (rid("coupon:RAMADAN25"), publication, "RAMADAN25", "PCT15-WOMENS", True, None,
             today - timedelta(days=30), today + timedelta(days=20), 2000, today - timedelta(days=30)),
            (rid("coupon:STAFF20"), publication, "STAFF20", "PCT20-FOOTWEAR", False, None,
             today - timedelta(days=200), today - timedelta(days=100), 300, today - timedelta(days=200)),
        ],
    )
    print(f"  {len(campaigns)} campaigns, {len(rules)} rules, {len(picked)} markdowns, 3 coupons")


# --------------------------------------------------------------------------
# 3. members
# --------------------------------------------------------------------------

FIRST = ["Siti", "Budi", "Dewi", "Andi", "Rina", "Agus", "Fitri", "Joko", "Maya", "Rudi",
         "Lestari", "Bayu", "Indah", "Hendra", "Nadia", "Yusuf", "Ayu", "Rizky", "Putri", "Fajar"]
LAST = ["Nugroho", "Wijaya", "Santoso", "Halim", "Pratama", "Kusuma", "Sari", "Utami",
        "Hidayat", "Permana", "Setiawan", "Anggraini", "Purnomo", "Maulana"]


def seed_members(db: Db, rng: random.Random, wanted: int) -> list[str]:
    existing = [r[0] for r in db.rows("SELECT member_id FROM member ORDER BY member_id")]
    if len(existing) >= wanted:
        print(f"{len(existing)} members already present — skipping")
        return existing

    today = date.today()
    rows = []
    for index in range(len(existing), wanted):
        member_id = f"M{8800000000 + index * 37:010d}"
        rows.append(
            (member_id,
             f"{rng.choice(FIRST)} {rng.choice(LAST)}",
             today - timedelta(days=rng.randint(20, 900)),
             None,
             datetime.now() - timedelta(days=rng.randint(20, 900)))
        )
    db.copy("member", ["member_id", "display_name", "joined_on", "blocked_at", "created_at"], rows)
    print(f"  {len(rows)} members enrolled")
    return existing + [r[0] for r in rows]


# --------------------------------------------------------------------------
# 4. sales that actually take stock away
# --------------------------------------------------------------------------

def seed_sales(db: Db, publication: str, version: int, rng: random.Random,
               sell_through: float) -> None:
    """Receipts, tenders, and the movement each one caused.

    The unit a receipt sells is chosen from what that shop had on its floor at
    the time, so a sale never sells a garment out of another shop's stockroom
    or one that had not been delivered yet.
    """
    if db.one("SELECT count(*) FROM sale") != "0":
        print("sales already present — skipping")
        return

    print("finding what each shop had on its floor ...")
    # A unit is sellable if it reached a floor and is still there. The floor
    # arrival is the earliest the shop could have sold it.
    floor_units = db.rows(
        """
        SELECT p.subject_id, split_part(p.place_id, '.', 1) AS site, k.id AS sku_id,
               to_char(m.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS'),
               COALESCE(r_site.unit_price_minor, r_chain.unit_price_minor)::text
          FROM inventory_projection p
          JOIN inventory_subject b ON b.id = p.subject_id
          JOIN sku k ON k.id = b.sku_id
          JOIN LATERAL (
                SELECT max(occurred_at) AS occurred_at FROM movement m2
                 WHERE m2.subject_id = p.subject_id AND m2.to_place_id = p.place_id
               ) m ON true
          LEFT JOIN commercial_price_rule r_chain
                 ON r_chain.publication_id = %(pub)s AND r_chain.sku_id = k.id
                AND r_chain.site_id IS NULL
          LEFT JOIN commercial_price_rule r_site
                 ON r_site.publication_id = %(pub)s AND r_site.sku_id = k.id
                AND r_site.site_id = split_part(p.place_id, '.', 1)
         WHERE p.place_id LIKE 'store-%%.floor:on_hand'
        """.replace("%(pub)s", q(publication)).replace("%%", "%")
    )
    if not floor_units:
        sys.exit("no unit is standing on any shop floor; run scripts/seed-full-chain.py first")

    by_site: dict[str, list] = {}
    for subject_id, site, sku_id, floored, price in floor_units:
        if not price:
            continue
        by_site.setdefault(site, []).append(
            (subject_id, sku_id, datetime.fromisoformat(floored), int(price))
        )

    today = datetime.now()
    sale_rows, line_rows, payment_rows = [], [], []
    movement_rows, group_rows = [], []
    completions = []
    sale_seq = 0

    for site in sorted(by_site):
        units = by_site[site]
        rng.shuffle(units)
        sellable = units[: int(len(units) * sell_through)]
        # Baskets of one to three garments, which is what a fashion receipt is.
        index = 0
        while index < len(sellable):
            basket = sellable[index : index + rng.choices([1, 2, 3], weights=[62, 27, 11])[0]]
            index += len(basket)
            # The receipt cannot predate the newest garment in it reaching the floor.
            earliest = max(unit[2] for unit in basket)
            span = (today - earliest).days
            if span < 1:
                continue
            sold_at = earliest + timedelta(
                days=rng.randint(0, span), hours=rng.randint(9, 20), minutes=rng.randint(0, 59)
            )
            if sold_at >= today:
                sold_at = today - timedelta(hours=rng.randint(1, 40))

            sale_seq += 1
            sale_id = rid(f"sale:{site}:{sale_seq}")
            gross = sum(unit[3] for unit in basket)
            net = gross * 10000 // (10000 + TAX_RATE_BPS)
            tax = gross - net
            sale_number = f"S-{site}-{sold_at:%Y%m%d}-{sale_seq:06d}"

            sale_rows.append(
                (sale_id, sale_number, site, "STORE", "OPEN", publication, version, "IDR",
                 net, tax, gross, gross, 0, None, f"{site}-till", f"seed-sale:{sale_id}", sold_at)
            )

            for line_no, (subject_id, sku_id, _floored, price) in enumerate(basket, start=1):
                line_net = price * 10000 // (10000 + TAX_RATE_BPS)
                line_rows.append(
                    (rid(f"line:{sale_id}:{line_no}"), sale_id, subject_id, sku_id, 1,
                     price, line_net, price - line_net, price, "IDR",
                     "STANDARD", TAX_RATE_BPS, True, publication, version,
                     f"book-v{version}", f"{site}-till", f"seed-line:{sale_id}:{line_no}", sold_at)
                )

            method = rng.choices(["CASH", "CARD", "QRIS", "OTHER"], weights=[34, 30, 33, 3])[0]
            # Who will pay us. A day's posting resolves both the receivable and
            # the income account per acquirer, so a card payment that names none
            # asks the map for an unqualified `revenue_debit` and the day cannot
            # be posted at all. `classify_card` reads a network name as a credit
            # card and anything else as debit, which is why these are the names
            # the client's own chart keeps accounts for.
            acquirer = None
            if method == "CARD":
                acquirer = rng.choice(["BCA", "MANDIRI", "VISA", "MASTER"])
            elif method == "QRIS":
                acquirer = rng.choice(["BCA", "GOPAY", "OVO", "DANA", "SHOPEEPAY"])
            payment_rows.append(
                (rid(f"pay:{sale_id}"), sale_id, method, gross, None,
                 f"{site}-till", f"seed-pay:{sale_id}", sold_at, acquirer)
            )

            # The stock this receipt took away. One group per shop per day, so
            # a day's trade is one atomic step in the ledger rather than
            # hundreds of unrelated ones.
            day = sold_at.date().isoformat()
            group_key = f"sale:{site}:{day}"
            group_id = rid(f"group:{group_key}")
            group_rows.append(
                (group_id, "SALE", f"Sold over the counter at {site}", "SALE", day,
                 f"{site}-till", f"seed-sale-group:{group_key}", str(group_id), sold_at, sold_at)
            )
            for subject_id, _sku, _floored, _price in basket:
                movement_rows.append(
                    (rid(f"mv:sale:{subject_id}"), group_id, subject_id, 1,
                     f"{site}.floor:on_hand", "external/customer", "SALE", "SALE", day,
                     f"seed-sale-group:{group_key}", str(group_id), f"{site}-till",
                     sold_at, sold_at)
                )
            completions.append((sale_id, sold_at, group_id))

    unique_groups = {row[0]: row for row in group_rows}
    print(f"  {len(sale_rows)} receipts, {len(line_rows)} lines, {len(movement_rows)} units sold")

    db.copy(
        "movement_group",
        ["id", "cause", "reason", "reference_type", "reference_id", "actor_id",
         "idempotency_key", "payload_digest", "occurred_at", "recorded_at"],
        list(unique_groups.values()),
    )
    # OPEN first: sale_line and sale_payment refuse anything else.
    for start in range(0, len(sale_rows), 20000):
        db.copy(
            "sale",
            ["id", "sale_number", "site_id", "channel", "status", "commercial_publication_id",
             "commercial_version", "currency", "net_minor", "tax_minor", "total_minor",
             "paid_minor", "change_minor", "movement_group_id", "actor_id", "idempotency_key",
             "created_at"],
            sale_rows[start:start + 20000],
        )
    for start in range(0, len(line_rows), 20000):
        db.copy(
            "sale_line",
            ["id", "sale_id", "subject_id", "sku_id", "quantity", "unit_price_minor",
             "net_minor", "tax_minor", "total_minor", "currency", "tax_category",
             "tax_rate_bps", "tax_inclusive", "commercial_publication_id",
             "commercial_version", "price_snapshot_digest", "actor_id", "idempotency_key",
             "added_at"],
            line_rows[start:start + 20000],
        )
    for start in range(0, len(payment_rows), 20000):
        db.copy(
            "sale_payment",
            ["id", "sale_id", "method", "amount_minor", "reference", "actor_id",
             "idempotency_key", "recorded_at", "acquirer"],
            payment_rows[start:start + 20000],
        )
    for start in range(0, len(movement_rows), 20000):
        db.copy(
            "movement",
            ["movement_id", "movement_group_id", "subject_id", "quantity", "from_place_id",
             "to_place_id", "cause", "reference_type", "reference_id", "idempotency_key",
             "payload_digest", "actor_id", "occurred_at", "recorded_at"],
            movement_rows[start:start + 20000],
        )

    print("  completing the receipts ...")
    db.run(
        """
CREATE TEMP TABLE sale_completion (sale_id uuid, completed_at timestamptz, group_id uuid);
"""
    )
    # Completion is a separate step because the trigger that makes a sale
    # immutable only bites once it is COMPLETED.
    values = ",".join(
        f"({q(str(sale_id))}, {q(when.isoformat())}, {q(str(group_id))})"
        for sale_id, when, group_id in completions
    )
    for start in range(0, len(completions), 5000):
        chunk = completions[start:start + 5000]
        db.run(
            "UPDATE sale SET status='COMPLETED', completed_at = v.completed_at, "
            "movement_group_id = v.group_id FROM (VALUES "
            + ",".join(
                f"({q(str(s))}::uuid, {q(w.isoformat())}::timestamptz, {q(str(g))}::uuid)"
                for s, w, g in chunk
            )
            + ") AS v(sale_id, completed_at, group_id) WHERE sale.id = v.sale_id;"
        )

    print("  rebuilding the projection so sold stock leaves the shelf ...")
    db.run(
        """
BEGIN;
DELETE FROM inventory_projection;
INSERT INTO inventory_projection (subject_id, place_id, quantity, last_fact_sequence, updated_at)
WITH deltas AS (
    SELECT subject_id, to_place_id AS place_id, quantity, fact_sequence FROM movement
    UNION ALL
    SELECT subject_id, from_place_id AS place_id, -quantity, fact_sequence FROM movement
), balances AS (
    SELECT subject_id, place_id, sum(quantity)::bigint AS quantity,
           max(fact_sequence) AS last_fact_sequence
      FROM deltas GROUP BY subject_id, place_id
)
SELECT subject_id, place_id, quantity, last_fact_sequence, now()
  FROM balances
 WHERE quantity > 0 AND place_id IN (SELECT id FROM inventory_place);
COMMIT;
"""
    )


# --------------------------------------------------------------------------
# 5. vouchers and segments
# --------------------------------------------------------------------------

def seed_vouchers(db: Db, members: list[str], rng: random.Random) -> None:
    """Gift cards and refund vouchers, issued and some of them spent.

    `voucher_movement_consistency` is a DEFERRABLE constraint trigger that
    checks each inserted movement against the voucher header AS IT STANDS AT
    COMMIT. So a voucher cannot be issued and redeemed in one transaction: the
    ISSUE row would be checked against the spent balance and refused. The real
    code never hits this because each redemption is its own request; this seeds
    it the same way, in two passes.
    """
    if db.one("SELECT count(*) FROM voucher") != "0":
        print("vouchers already present — skipping")
        return
    now = datetime.now()
    vouchers, issues, redeems, spent_ids = [], [], [], []
    for index in range(12):
        voucher_id = rid(f"voucher:{index}")
        kind = rng.choice(["GIFT_CARD", "GIFT_CARD", "REFUND", "GOODWILL"])
        issued = rng.choice([1_000_000, 2_500_000, 5_000_000, 10_000_000])
        issued_at = now - timedelta(days=rng.randint(5, 300))
        site = f"store-{rng.randint(1, 13):02d}"
        spent = rng.random() < 0.4
        # Every voucher starts life ACTIVE and fully loaded, because that is
        # the only state its first movement can be checked against.
        vouchers.append(
            (voucher_id, f"GV{index + 1:04d}{rng.randint(100, 999)}", kind, "IDR", issued,
             issued, "ACTIVE",
             rng.choice(members) if members and rng.random() < 0.6 else None,
             now + timedelta(days=365), issued_at, "counter-supervisor", site, None, 1)
        )
        issues.append(
            (rid(f"vm:{index}:0"), voucher_id, 0, "ISSUE", issued, issued, None,
             site, "counter-supervisor", issued_at, None)
        )
        if spent:
            spent_ids.append(str(voucher_id))
            redeems.append(
                (rid(f"vm:{index}:1"), voucher_id, 1, "REDEEM", -issued, 0, None,
                 site, "counter-supervisor",
                 issued_at + timedelta(days=rng.randint(1, 60)), None)
            )

    db.copy(
        "voucher",
        ["voucher_id", "code", "kind", "currency", "issued_minor", "balance_minor", "status",
         "member_id", "expires_at", "issued_at", "issued_by", "issued_site", "note", "version"],
        vouchers,
    )
    db.copy(
        "voucher_movement",
        ["movement_id", "voucher_id", "seq", "kind", "amount_minor", "balance_after_minor",
         "sale_id", "site_id", "actor", "occurred_at", "note"],
        issues,
    )

    if redeems:
        # Second pass: the header is drawn down first, then the movement that
        # proves it. Same transaction, so the deferred check sees both.
        db.run(
            "BEGIN;\nUPDATE voucher SET balance_minor = 0, status = 'SPENT', version = version + 1 "
            "WHERE voucher_id IN (" + ",".join(q(v) + "::uuid" for v in spent_ids) + ");\nCOMMIT;"
        )
        db.copy(
            "voucher_movement",
            ["movement_id", "voucher_id", "seq", "kind", "amount_minor", "balance_after_minor",
             "sale_id", "site_id", "actor", "occurred_at", "note"],
            redeems,
        )
    print(f"  {len(vouchers)} vouchers ({len(redeems)} of them spent), {len(issues) + len(redeems)} movements")


def seed_segments(db: Db) -> None:
    """A saved definition of "which shoppers", and the version that holds it.

    `segment.current_version` points at a `segment_version` row that points back
    at the segment — a cycle the schema resolves by making the forward key
    DEFERRABLE INITIALLY DEFERRED. Both rows therefore have to be written in the
    SAME transaction; two COPYs would be two transactions and the first would be
    refused.
    """
    if db.one("SELECT count(*) FROM segment") != "0":
        print("segments already present — skipping")
        return
    definitions = [
        ("Lapsed high spenders", "Shoppers who spent well and have not been back",
         {"spend_minor": {"gte": 10_000_000}, "last_seen_days": {"gte": 120}}),
        ("New this quarter", "Members enrolled in the last ninety days",
         {"joined_days": {"lte": 90}}),
        ("Footwear buyers", "Anybody who has bought a pair of shoes",
         {"division": "SANDAL_SEPATU", "purchases": {"gte": 1}}),
    ]
    statements = ["BEGIN;"]
    for name, purpose, definition in definitions:
        segment_id = rid(f"segment:{name}")
        statements.append(
            "INSERT INTO segment (segment_id, name, purpose, owner_username, "
            "current_version, created_at, updated_at) VALUES "
            f"({q(segment_id)}, {q(name)}, {q(purpose)}, 'admin', 1, now(), now());"
        )
        statements.append(
            "INSERT INTO segment_version (segment_id, version, definition, "
            "catalogue_version, authored_by, created_at) VALUES "
            f"({q(segment_id)}, 1, {q(json.dumps(definition))}::jsonb, 1, 'admin', now());"
        )
    statements.append("COMMIT;")
    db.run("\n".join(statements))
    print(f"  {len(definitions)} segments")


AUDIT = """
\\pset border 2
SELECT 'prices with no assortment row beside them' AS link, count(*) AS broken
  FROM commercial_price_rule r
 WHERE NOT EXISTS (SELECT 1 FROM commercial_assortment_rule a
                    WHERE a.publication_id=r.publication_id AND a.sku_id=r.sku_id
                      AND a.channel=r.channel AND a.site_id IS NOT DISTINCT FROM r.site_id)
UNION ALL SELECT 'sales quoting an unpublished book', count(*) FROM sale s
  WHERE NOT EXISTS (SELECT 1 FROM commercial_publication c WHERE c.id=s.commercial_publication_id AND c.status='PUBLISHED')
UNION ALL SELECT 'completed sales with no movement group', count(*) FROM sale
  WHERE status='COMPLETED' AND movement_group_id IS NULL
UNION ALL SELECT 'sale lines whose totals do not add up', count(*) FROM sale_line
  WHERE net_minor + tax_minor <> total_minor
UNION ALL SELECT 'sales whose lines do not add to the total', count(*) FROM (
    SELECT s.id FROM sale s JOIN sale_line l ON l.sale_id=s.id
     GROUP BY s.id, s.total_minor HAVING sum(l.total_minor) <> s.total_minor) x
UNION ALL SELECT 'sales not paid for in full', count(*) FROM (
    SELECT s.id FROM sale s JOIN sale_payment p ON p.sale_id=s.id
     WHERE s.status='COMPLETED' GROUP BY s.id, s.total_minor HAVING sum(p.amount_minor) <> s.total_minor) y
UNION ALL SELECT 'sold units still standing on a shop floor', count(*) FROM sale_line l
  JOIN inventory_projection p ON p.subject_id=l.subject_id
 WHERE p.place_id LIKE 'store-%.floor:on_hand'
UNION ALL SELECT 'units sold twice', count(*) FROM (
    SELECT subject_id FROM sale_line GROUP BY subject_id HAVING count(*) > 1) z
UNION ALL SELECT 'sales dated before the unit reached the floor', count(*)
  FROM sale s JOIN sale_line l ON l.sale_id=s.id
  JOIN movement m ON m.subject_id=l.subject_id AND m.to_place_id = s.site_id || '.floor:on_hand'
 WHERE s.completed_at < m.occurred_at
UNION ALL SELECT 'markdowns on a SKU that does not exist', count(*) FROM commercial_markdown d
 WHERE d.sku_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sku k WHERE k.id=d.sku_id)
UNION ALL SELECT 'vouchers whose balance contradicts their ledger', count(*) FROM (
    SELECT v.voucher_id FROM voucher v JOIN voucher_movement m ON m.voucher_id=v.voucher_id
     GROUP BY v.voucher_id, v.balance_minor HAVING sum(m.amount_minor) <> v.balance_minor) w
ORDER BY 2 DESC, 1;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.environ.get("ITULAH_DB", ""))
    parser.add_argument("--members", type=int, default=240)
    parser.add_argument("--sell-through", type=float, default=0.62,
                        help="fraction of floor stock that gets sold")
    parser.add_argument("--seed", type=int, default=20260905)
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()

    if not args.db:
        sys.exit("--db is required (or set ITULAH_DB)")
    db = Db(args.db)

    if args.audit:
        subprocess.run(["psql", "-d", args.db, "-q", "-f", "-"], input=AUDIT, text=True)
        return 0

    rng = random.Random(args.seed)
    publication, version = publish_prices(db, rng)
    seed_promotions(db, publication, rng)
    close_book(db, publication)
    members = seed_members(db, rng, args.members)
    seed_sales(db, publication, version, rng, args.sell_through)
    seed_vouchers(db, members, rng)
    seed_segments(db)

    print()
    subprocess.run(["psql", "-d", args.db, "-q", "-f", "-"], input=AUDIT, text=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
