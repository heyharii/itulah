#!/usr/bin/env python3
"""Give the Commercial overview something true to draw.

The overview asks three questions the module's four lists cannot answer on
their own — what is running, what it gave away, and what came back. All three
are answered from data that a development node has in the wrong shape rather
than not at all:

  * **A campaign has no poster.** `image_url`, `headline` and `terms` are the
    only part of a price book a SHOPPER is meant to read, and 0087 made them
    editable after publication for exactly that reason. Every campaign created
    by hand through the sheet leaves them null, so a board built around the
    photograph draws six grey rectangles.

  * **The trading stops.** The promo sale facts on this node run to a fixed
    day and then end, so a window of "the last thirty days" is mostly empty
    space on the right and the chart reads as a business that shut. The facts
    themselves are fine; there are simply no newer ones.

  * **The voucher book has one card of each kind.** Six cards cannot show the
    difference between money still owed and money already spent, which is the
    whole content of the voucher panel.

Nothing here invents a figure a screen would otherwise compute. The campaign
presentation is copy and a photograph; the trading is sale FACTS, written the
way a till reports them, and every derived counter is rebuilt from those facts
by `seed-commercial-reach.py` afterwards rather than written twice.

    ITULAH_DB=inventory_tanstack python3 scripts/seed-commercial-overview.py
    ITULAH_DB=inventory_tanstack python3 scripts/seed-commercial-reach.py

Re-running is safe. The presentation only fills what is empty unless `--force`
is given, and the trading is keyed by a marker so a second run replaces its own
rows instead of doubling them:

    DELETE FROM edge_sale WHERE actor_id LIKE 'seed-overview%';

takes the trading back out — the lines, promotions and tenders cascade.

The vouchers do NOT come back out the same way, and that is the schema working
rather than a gap: `voucher_movement_is_evidence` refuses a DELETE, because a
movement is what proves a balance. Removing them on a development node means
saying so out loud —

    BEGIN;
    ALTER TABLE voucher_movement DISABLE TRIGGER USER;
    DELETE FROM voucher_movement WHERE actor = 'seed-overview';
    ALTER TABLE voucher_movement ENABLE TRIGGER USER;
    DELETE FROM voucher WHERE issued_by = 'seed-overview';
    COMMIT;

— which is exactly the sort of statement nobody types by accident. This script
skips the voucher step entirely when its own cards are already there, so it
never needs that.
"""

import argparse
import hashlib
import os
import random
import subprocess
import sys
import uuid
from datetime import date, datetime, timedelta

DB = os.environ.get("ITULAH_DB", "inventory_tanstack")

# The marker on every sale this script writes. `actor_id` rather than a column
# of its own: it is the till that reported the sale, and "seed-overview" is an
# honest answer to that question on a development node.
ACTOR = "seed-overview"

# How far back the trading runs. Thirty days is the overview's own default
# window and sixty is that window plus the one it is compared against — a
# "previous period" with nothing in it draws every delta as +100%.
DAYS_BACK = 60


# ── the poster on each campaign ────────────────────────────────────────────
#
# Photographs are Unsplash keys, which is the same host `article.image_url`
# already carries on this node: one origin to allow, and no bytes in the repo.
# A campaign nobody named here still gets a picture from the pool below, so a
# campaign created tomorrow is not a grey rectangle either.
POSTERS = {
    "lebaran": (
        "photo-1596993100471-c3905dafa78e",
        "Lebaran Sale — koleksi raya untuk sekeluarga",
        "Berlaku 13 Agu – 12 Okt 2026 di seluruh toko. Selama persediaan masih "
        "ada. Tidak dapat digabung dengan promo lain.",
    ),
    "lebaran-79ce": (
        "photo-1591604466107-ec97de577aff",
        "Lebaran — tampil rapi di hari yang fitri",
        "Selama persediaan masih ada. Tidak berlaku untuk barang clearance.",
    ),
    "lebaran-2027-b09f": (
        "photo-1483985988355-763728e1935b",
        "Lebaran 2027 — lebih awal, lebih lengkap",
        "Jadwal dan syarat menyusul. Harga dapat berubah sebelum kampanye "
        "dimulai.",
    ),
    "backtoschool": (
        "photo-1503676260728-1c00da094a0b",
        "Back to School — siap masuk sekolah",
        "Berlaku untuk seragam, sepatu dan tas anak. Kode pelajar berlaku satu "
        "kali per pelanggan.",
    ),
    "clearance-q3": (
        "photo-1607083206968-13611e3d76db",
        "Q3 Clearance — harga terakhir",
        "Harga clearance adalah harga akhir. Barang yang sudah dibeli tidak "
        "dapat ditukar atau dikembalikan.",
    ),
}

# For a campaign the table above has never heard of. Shop interiors rather than
# a season, because a picture that names the wrong festival is worse than one
# that names none.
POOL = [
    "photo-1490481651871-ab68de25d43d",
    "photo-1441986300917-64674bd600d8",
    "photo-1567401893414-76b7b1e5a7a5",
    "photo-1445205170230-053b83016050",
    "photo-1555529669-e69e7aa0ba9a",
    "photo-1528698827591-e19ccd7bc23d",
]

# A banner is drawn wide and short on the board and wide and tall in the sheet;
# one crop at a size that survives both beats two URLs to keep in step.
CROP = "?w=1200&h=560&fit=crop&q=80"


def sql(statement, quiet=False):
    done = subprocess.run(
        ["psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-tAc", statement],
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        sys.exit(f"psql failed against {DB}: {done.stderr.strip()}")
    if not quiet and done.stderr.strip():
        print(done.stderr.strip())
    return done.stdout.strip()


def rows(statement):
    out = sql(statement, quiet=True)
    return [line.split("|") for line in out.splitlines() if line]


def q(value):
    """A SQL literal, or NULL. Single quotes doubled, the only escape psql needs."""
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def rid(seed):
    """A stable uuid from a name, so a second run addresses the same rows."""
    return str(uuid.UUID(hashlib.sha256(seed.encode()).hexdigest()[:32]))


# ── 1. what the shop shows ─────────────────────────────────────────────────

def seed_presentation(force):
    """Fill `image_url`, `headline` and `terms` on every campaign.

    Every publication's row for a campaign id is written, not just the newest
    book's — the same reason `switch_campaign` updates them all. The centre
    scopes a campaign per publication and a shop holds exactly one, so leaving
    an older row blank would have the board draw a poster or not depending on
    which book a query happened to rank first.

    Without `--force` a value somebody has already typed into the sheet wins.
    `NULLIF(btrim(...), '')` rather than a plain COALESCE because the sheet
    sends an empty string to CLEAR a banner, and a seed that treated "cleared"
    as "never set" would put the poster back every time it ran.
    """
    campaigns = rows(
        "SELECT DISTINCT campaign_id, name FROM commercial_campaign ORDER BY campaign_id"
    )
    if not campaigns:
        print("no campaigns in any price book — nothing to dress")
        return

    for index, (campaign_id, name) in enumerate(campaigns):
        photo, headline, terms = POSTERS.get(
            campaign_id,
            (
                POOL[index % len(POOL)],
                f"{name} — penawaran terbatas",
                "Selama persediaan masih ada. Tidak dapat digabung dengan "
                "promo lain.",
            ),
        )
        url = f"https://images.unsplash.com/{photo}{CROP}"

        def written(column, value):
            if force:
                return q(value)
            return f"COALESCE(NULLIF(btrim({column}), ''), {q(value)})"

        sql(
            f"""
            UPDATE commercial_campaign
               SET image_url = {written('image_url', url)},
                   headline  = {written('headline', headline)},
                   terms     = {written('terms', terms)}
             WHERE campaign_id = {q(campaign_id)}
            """
        )
    named = sum(1 for one in campaigns if one[0] in POSTERS)
    print(f"dressed {len(campaigns)} campaigns — {named} with a poster chosen "
          f"for the season, the rest from the pool")


# ── 2. trading, up to today ────────────────────────────────────────────────

def seed_trading(rng):
    """Sales as a shop reported them, carrying the offers that fired on them.

    Written against `edge_sale` and not `sale`, and the difference matters: the
    performance endpoint reads the shop's own report, because that is the only
    record that says WHICH offer took money off which basket. A cloud-side sale
    has a total and no idea why it is that number.

    The mix is deliberately uneven — a campaign that outsells the others by
    four to one is what makes a stacked chart worth drawing, and a flat one
    would prove only that the seeder used one random call.
    """
    sql(f"DELETE FROM edge_sale WHERE actor_id LIKE {q(ACTOR + '%')}")

    shops = rows(
        "SELECT origin_id, site_id FROM sync_origin_credential "
        "WHERE node_role='STORE' ORDER BY origin_id LIMIT 6"
    )
    if not shops:
        sys.exit("no shop has a registered sync origin — a fact from an "
                 "unregistered origin is one the ingest would have refused")

    # Rules paired with the campaign that owns them, read out of the rule
    # document rather than assumed: a rule joins a campaign by writing
    # `definition->>'campaign_id'`, and nothing else records the link.
    offers = rows(
        """
        SELECT DISTINCT r.rule_id, COALESCE(r.definition->>'campaign_id', '')
          FROM commercial_rule r
         WHERE r.status = 'ACTIVE'
         ORDER BY 1
        """
    )
    if not offers:
        sys.exit("no active promotion to attribute a discount to")

    coupons = [r[0] for r in rows(
        "SELECT code FROM commercial_coupon WHERE active ORDER BY code"
    )]
    members = [r[0] for r in rows("SELECT member_id FROM member ORDER BY member_id")]
    stock = rows(
        """
        SELECT b.id, b.epc, k.sku_code, COALESCE(p.unit_price_minor, 250000)
          FROM inventory_subject b
          JOIN sku k ON k.id = b.sku_id
          LEFT JOIN LATERAL (
              SELECT unit_price_minor FROM commercial_price_rule
               WHERE sku_id = b.sku_id AND site_id IS NULL
               ORDER BY unit_price_minor LIMIT 1
          ) p ON true
         WHERE b.epc IS NOT NULL
         ORDER BY b.epc
         LIMIT 600
        """
    )
    if not stock:
        sys.exit("no tagged stock to sell")

    version = sql(
        "SELECT max(version) FROM commercial_publication WHERE status='PUBLISHED'"
    )

    # How often each offer fires, relative to the others. Weighted by how big
    # its campaign is meant to look, so the board's ordering is a fact about
    # the trading rather than about alphabetical order.
    def weight(rule_id, campaign_id):
        if campaign_id.startswith("lebaran"):
            return 8
        if campaign_id == "backtoschool":
            return 5
        if campaign_id == "clearance-q3":
            return 3
        return 2

    weights = [weight(*offer) for offer in offers]

    sales, lines, promotions, tenders = [], [], [], []
    seq = {origin: 0 for origin, _ in shops}
    today = date.today()

    for back in range(DAYS_BACK, -1, -1):
        day = today - timedelta(days=back)
        # Trade lifts at the weekend and climbs gently towards today, so a
        # "previous period" comparison has a direction to report.
        lift = 1.45 if day.weekday() >= 5 else 1.0
        trend = 1.0 + (DAYS_BACK - back) * 0.006
        for rank, (origin_id, site_id) in enumerate(shops):
            # The first shops are bigger than the last, which is what makes a
            # per-shop reading of the same window worth having.
            baskets = round(rng.uniform(1, 4) * lift * trend * (1.0 - rank * 0.12))
            for _ in range(max(0, baskets)):
                seq[origin_id] += 1
                sale_id = rid(f"{ACTOR}:{origin_id}:{day}:{seq[origin_id]}")
                subject_id, epc, sku_code, list_price = rng.choice(stock)
                list_price = int(list_price)
                occurred = datetime.combine(day, datetime.min.time()) + timedelta(
                    hours=9, minutes=rng.randint(0, 659)
                )

                # Roughly three baskets in five carry an offer. The rest are
                # full-price trade, and they belong here: a promotion's share
                # of the day is only a number when the day includes the
                # baskets it did not touch.
                rule_id = campaign_id = coupon = None
                benefit = 0
                if rng.random() < 0.6:
                    rule_id, campaign_id = rng.choices(offers, weights=weights)[0]
                    campaign_id = campaign_id or None
                    benefit = int(list_price * rng.uniform(0.08, 0.34) // 1000) * 1000
                    if coupons and rng.random() < 0.18:
                        coupon = rng.choice(coupons)
                total = max(1000, list_price - benefit)
                customer = (
                    rng.choice(members) if members and rng.random() < 0.5 else None
                )

                sales.append(
                    (sale_id, origin_id, 1, seq[origin_id], rid(f"group:{sale_id}"),
                     site_id, ACTOR, occurred.isoformat(sep=" "), "IDR",
                     total, total, 0, occurred.isoformat(sep=" "),
                     benefit, total // 10000, None, customer)
                )
                # `price_source` names the RUNG of the price book the base
                # price came off — never the promotion. A discount is taken off
                # whatever the shirt already costs, so an offer firing on this
                # basket changes `benefit_minor` and leaves this alone.
                lines.append(
                    (sale_id, subject_id, epc, sku_code, 1, total, total,
                     "SITE_PRICE" if rng.random() < 0.2 else "COMPANY_PRICE",
                     version, list_price, None)
                )
                if rule_id:
                    promotions.append((sale_id, rule_id, campaign_id, coupon, benefit))
                tenders.append(
                    (sale_id, 1,
                     rng.choices(["CASH", "CARD", "QRIS", "VOUCHER"],
                                 weights=[34, 30, 32, 4])[0],
                     total, None)
                )

    copy("edge_sale",
         ["sale_id", "origin_id", "generation", "seq", "movement_group_id",
          "site_id", "actor_id", "occurred_at", "currency", "total_minor",
          "paid_minor", "change_minor", "received_at", "discount_total_minor",
          "points_earned", "pricing_trace_id", "customer_id"],
         sales)
    copy("edge_sale_line",
         ["sale_id", "subject_id", "epc", "sku_code", "quantity",
          "unit_price_minor", "line_total_minor", "price_source",
          "publication_version", "base_unit_price_minor", "markdown_id"],
         lines)
    copy("edge_sale_promotion",
         ["sale_id", "rule_id", "campaign_id", "coupon_code", "benefit_minor"],
         promotions)
    copy("edge_sale_tender",
         ["sale_id", "tender_seq", "method", "amount_minor", "reference"],
         tenders)
    given = sum(row[4] for row in promotions)
    print(f"{len(sales)} sales over {DAYS_BACK + 1} days from {len(shops)} shops — "
          f"{len(promotions)} carried an offer, Rp {given:,} given away")


def copy(table, columns, records):
    """Bulk insert through psql's own COPY, in the idiom the other seeds use."""
    if not records:
        return
    body = "\n".join(
        "\t".join("\\N" if value is None else str(value).replace("\t", " ")
                  for value in record)
        for record in records
    )
    done = subprocess.run(
        ["psql", "-d", DB, "-v", "ON_ERROR_STOP=1",
         "-c", f"COPY {table} ({', '.join(columns)}) FROM STDIN"],
        input=body + "\n", capture_output=True, text=True,
    )
    if done.returncode != 0:
        sys.exit(f"COPY {table} failed: {done.stderr.strip()}")


# ── 3. the voucher book ────────────────────────────────────────────────────

def seed_vouchers(rng):
    """Enough cards for the liability to have a shape.

    A voucher is TENDER, not a discount — money the shop owes somebody — so
    what the panel reports is the outstanding balance, and that needs cards in
    every state the book can be in: untouched, part-spent, spent to nothing,
    voided, and still live but past its expiry date. Six cards cannot show
    that.

    Three facts about this schema the seed has to respect, and each one is a
    way to write a book that adds up wrong:

      * **There are three kinds and three statuses**, and EXPIRED is not one of
        them. An expired card is ACTIVE with a balance and an `expires_at` in
        the past — `voucher_ledger` filters for exactly that — because a card
        going stale is the calendar passing, not somebody doing something.
      * **ACTIVE means a balance above zero.** `voucher_status_matches_balance`
        says so, and a spent card must be SPENT.
      * **REDEEM and VOID movements are NEGATIVE.** The ledger reads
        `-sum(amount_minor)`, so a positive redemption would report the book as
        owing more the more it was spent.
    """
    held = int(sql(f"SELECT count(*) FROM voucher WHERE issued_by = {q(ACTOR)}"))
    if held:
        print(f"{held} seeded vouchers already present — skipping")
        return

    members = [r[0] for r in rows("SELECT member_id FROM member ORDER BY member_id")]
    sites = [r[0] for r in rows("SELECT id FROM site WHERE kind='STORE' ORDER BY id")]
    now = datetime.now()

    # (kind, how often it is issued, the face values it is issued at)
    kinds = [
        ("GIFT_CARD", 6, [100_000, 250_000, 500_000, 1_000_000]),
        ("REFUND", 4, [89_000, 149_000, 199_000, 359_000]),
        ("GOODWILL", 2, [50_000, 100_000]),
    ]

    # The alphabet the server mints from: no O/0, no I/1, no S/5, no B/8 —
    # the four pairs somebody reads wrong off a card at the counter.
    alphabet = "ACDEFGHJKLMNPQRTUVWXY3479"
    cards, issues, movements = [], [], []
    for index in range(44):
        kind, _, faces = rng.choices(kinds, weights=[k[1] for k in kinds])[0]
        face = rng.choice(faces)
        code = "SEED" + "".join(rng.choice(alphabet) for _ in range(8))
        voucher_id = rid(f"{ACTOR}:voucher:{index}")
        member = rng.choice(members) if members and rng.random() < 0.7 else None
        site = rng.choice(sites) if sites else None
        issued = now - timedelta(days=rng.randint(1, 150), hours=rng.randint(0, 23))

        roll = rng.random()
        if roll < 0.46:
            balance, status = face, "ACTIVE"
        elif roll < 0.70:
            balance, status = int(face * rng.uniform(0.2, 0.8) // 1000) * 1000, "ACTIVE"
            balance = max(1000, balance)
        elif roll < 0.88:
            balance, status = 0, "SPENT"
        elif roll < 0.95:
            # Live, unspent, and past its date. The one row the panel exists to
            # surface: money still on the books that nobody can spend.
            balance, status = face, "ACTIVE"
            issued = now - timedelta(days=rng.randint(200, 330))
        else:
            balance, status = 0, "VOIDED"
        expires = issued + timedelta(days=180)

        cards.append((voucher_id, code, kind, "IDR", face, balance, status,
                      member, expires.isoformat(sep=" "),
                      issued.isoformat(sep=" "), ACTOR, site, None, 1))
        issues.append((rid(f"{voucher_id}:issue"), voucher_id, 1, "ISSUE",
                       face, face, None, site, ACTOR,
                       issued.isoformat(sep=" "), None))
        if balance < face:
            moved = issued + timedelta(days=rng.randint(1, 60))
            voided = status == "VOIDED"
            movements.append((
                rid(f"{voucher_id}:move"), voucher_id, 2,
                "VOID" if voided else "REDEEM",
                -(face - balance), balance, None, site, ACTOR,
                moved.isoformat(sep=" "),
                "Dibatalkan — kartu rusak sebelum dipakai" if voided else None,
            ))

    # Written in the order a card actually lives, because the schema insists.
    # `voucher_movement_is_consistent` checks each movement against the CARD'S
    # CURRENT BALANCE as it lands — so a card's whole history cannot be
    # inserted after its final balance. Issue every card at its face value,
    # record the issue, settle the header, then record what came off it.
    copy("voucher",
         ["voucher_id", "code", "kind", "currency", "issued_minor",
          "balance_minor", "status", "member_id", "expires_at", "issued_at",
          "issued_by", "issued_site", "note", "version"],
         [card[:5] + (card[4], "ACTIVE") + card[7:] for card in cards])
    copy("voucher_movement",
         ["movement_id", "voucher_id", "seq", "kind", "amount_minor",
          "balance_after_minor", "sale_id", "site_id", "actor",
          "occurred_at", "note"],
         issues)
    for card in cards:
        if card[5] != card[4]:
            sql(f"UPDATE voucher SET balance_minor = {card[5]}, "
                f"status = {q(card[6])} WHERE voucher_id = {q(card[0])}")
    copy("voucher_movement",
         ["movement_id", "voucher_id", "seq", "kind", "amount_minor",
          "balance_after_minor", "sale_id", "site_id", "actor",
          "occurred_at", "note"],
         movements)
    owed = sum(card[5] for card in cards if card[6] == "ACTIVE")
    print(f"{len(cards)} vouchers issued, Rp {owed:,} still owed across them")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true",
                        help="rewrite headlines and posters somebody has already typed")
    parser.add_argument("--seed", type=int, default=20260913,
                        help="the random seed, so two runs agree")
    parser.add_argument("--only", choices=["posters", "trading", "vouchers"],
                        help="run one part of the seed")
    args = parser.parse_args()
    rng = random.Random(args.seed)

    print(f"seeding the commercial overview against {DB}")
    if args.only in (None, "posters"):
        seed_presentation(args.force)
    if args.only in (None, "trading"):
        seed_trading(rng)
    if args.only in (None, "vouchers"):
        seed_vouchers(rng)
    print("\nnow rebuild the counters the ingest would have written:")
    print(f"  ITULAH_DB={DB} python3 scripts/seed-commercial-reach.py")


if __name__ == "__main__":
    main()
