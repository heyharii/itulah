#!/usr/bin/env python3
"""Build the goods from the supplier catalogue upwards, so nothing in stock
arrived without being bought.

    python3 scripts/seed-full-chain.py --db "$DATABASE_URL" --articles 500

Sibling of `seed-pricelist-scale.py`, and written because that one takes the
other road. It says so itself: it writes articles and SKUs straight into
Postgres because "there is no endpoint that mints a SKU outside a setup
session". That is true, and the result is a catalogue whose every style is a
style nobody ever ordered — `article.created_by_session_id` is null on all five
hundred of them. For a pricelist screenshot that does not matter. For anybody
asking where a garment came from, it is the whole question.

This script writes the SAME chain the API writes, in full, in bulk:

    supplier              a company we buy from
      supplier_item       a thing they offer, with a photograph and a price
        purchase_order    what we asked them for
        purchase_order_line
          goods_receipt   what turned up, counted blind and verified by a
          goods_receipt_line          second person
            article_setup_session     head office saying what the goods ARE
              article + article_colour        <- created_by_session_id
              sku (article(8) + colour(1) + size(2))
                tagging_job + tagging_job_line     serial ranges per SKU
                  inventory_subject   one row per garment, carrying its EPC
                    movement          how it got from the supplier to a shelf
                      inventory_projection    derived, never authored

Every link is a real foreign key and every row is reachable from the one above
it. Run `--audit` afterwards (or on its own) and it will tell you, per link,
how many rows fail to trace back.

WHAT THIS DOES NOT DO. It does not go through the HTTP API, so it does not
prove the endpoints enforce any of this — `seed-bought-goods.py` is the script
that does that, on a handful of styles, and it remains the honest test of the
flow. What this one guarantees is that the DATA is consistent, at a scale the
API road cannot reach in a reasonable time against a remote database.

The EPCs are real. `encode_epc` below is a transliteration of
`backend/src/cloud/domain/identity.rs`, checked at import time against the same
golden vector that file is checked against — `encode("12345678123", 100) ==
"a01234567812300000000064"` — because a seeded tag that a handheld cannot read
is worse than no tag: in the warehouse it looks like missing stock, not like a
bad fixture.

Deterministic. Every choice comes from a seeded RNG and every id is derived
from a stable name, so a second run against a fresh database produces the same
catalogue rather than a different one.

`--purge-orphans` first deletes the goods that have no purchase order behind
them — in this estate that is the `ART-*` demo set from migration
0002_demo_seed.sql and everything hanging off it. It is not on by default,
because deleting stock is not something a seed script should do quietly.
"""

from __future__ import annotations

import argparse
import io
import os
import random
import subprocess
import sys
import uuid
from datetime import date, datetime, timedelta

# --------------------------------------------------------------------------
# identity: the formats already on garments in the estate
# --------------------------------------------------------------------------

RETAIL_PRIVATE_HEADER = 0xA0
EPC_SERIAL_BITS = 44
EPC_MAX_SERIAL = 1 << EPC_SERIAL_BITS


def sku_code(article_code: str, colour_digit: str, size_code: str) -> str:
    """article(8) + colour(1) + size(2). Derived, never accepted."""
    if len(article_code) != 8 or not article_code.isdigit():
        raise ValueError(f"article code {article_code!r} must be 8 digits")
    if len(colour_digit) != 1 or not colour_digit.isdigit():
        raise ValueError(f"colour {colour_digit!r} must be one digit 0-9")
    if len(size_code) != 2 or not size_code.isdigit():
        raise ValueError(f"size code {size_code!r} must be 2 digits")
    return f"{article_code}{colour_digit}{size_code}"


def encode_epc(sku: str, serial: int) -> str:
    """96 bits: header 0xA0, the 11 SKU digits as BCD, then a 44-bit serial.

    The serial bound is checked BEFORE anything is allocated. The Go original
    checked it after advancing its counter, which refused the last legitimate
    serial and burned the range it had just refused to issue.
    """
    if len(sku) != 11 or not sku.isdigit():
        raise ValueError(f"SKU {sku!r} must be 11 digits")
    if not 0 <= serial < EPC_MAX_SERIAL:
        raise ValueError(f"serial {serial} overflows the {EPC_SERIAL_BITS}-bit field")
    epc = bytearray(12)
    epc[0] = RETAIL_PRIVATE_HEADER
    digits = sku.encode()
    for i, byte in enumerate(digits[:10]):
        digit = byte - 0x30
        index = 1 + i // 2
        if i % 2 == 0:
            epc[index] = digit << 4
        else:
            epc[index] |= digit
    epc[6] = (digits[10] - 0x30) << 4
    epc[6] |= (serial >> 40) & 0x0F
    epc[7] = (serial >> 32) & 0xFF
    epc[8] = (serial >> 24) & 0xFF
    epc[9] = (serial >> 16) & 0xFF
    epc[10] = (serial >> 8) & 0xFF
    epc[11] = serial & 0xFF
    return epc.hex()


# The assertion that makes the rest of this file trustworthy. If it ever fails,
# every tag this script writes is unreadable by the handhelds in the field.
assert encode_epc("12345678123", 100) == "a01234567812300000000064", (
    "EPC encoder does not agree with the one already on garments in the estate"
)


def qr_payload(sku: str) -> str:
    return f"R1:{sku}"


def barcode_payload(sku: str) -> str:
    return f"8{sku}"


NAMESPACE = uuid.UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")


def rid(name: str) -> uuid.UUID:
    """A stable id for a name, so a re-run addresses the same row."""
    return uuid.uuid5(NAMESPACE, name)


# --------------------------------------------------------------------------
# talking to postgres
# --------------------------------------------------------------------------


class Db:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    def rows(self, query: str) -> list[list[str]]:
        done = subprocess.run(
            ["psql", "-d", self.dsn, "-v", "ON_ERROR_STOP=1", "-tAF", "\x1f", "-c", query],
            capture_output=True,
            text=True,
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
            input=sql,
            capture_output=True,
            text=True,
        )
        if done.returncode != 0:
            sys.exit(f"psql write failed:\n{done.stderr.strip()}")
        if done.stdout.strip():
            print(done.stdout.strip())

    def copy(self, table: str, columns: list[str], records: list[tuple]) -> None:
        """Bulk load. COPY rather than INSERT because this runs against a
        database in another country and a round trip per row would take hours.
        """
        if not records:
            return
        buffer = io.StringIO()
        for record in records:
            buffer.write("\t".join(_tsv(value) for value in record))
            buffer.write("\n")
        statement = f"\\copy {table} ({', '.join(columns)}) FROM STDIN"
        done = subprocess.run(
            ["psql", "-d", self.dsn, "-v", "ON_ERROR_STOP=1", "-q", "-c", statement],
            input=buffer.getvalue(),
            capture_output=True,
            text=True,
        )
        if done.returncode != 0:
            sys.exit(f"COPY into {table} failed:\n{done.stderr.strip()}")


def _tsv(value) -> str:
    """COPY text format: backslash escapes, and \\N for null."""
    if value is None:
        return "\\N"
    if isinstance(value, bool):
        return "t" if value else "f"
    text = str(value)
    return (
        text.replace("\\", "\\\\")
        .replace("\t", "\\t")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


# --------------------------------------------------------------------------
# what a garment is offered in
# --------------------------------------------------------------------------

# Sizes follow the division, because this is the part that would look
# obviously wrong otherwise: footwear in "M", or a belt offered in six sizes.
SIZES_BY_DIVISION = {
    "FOOTWEAR": ["11", "12", "13", "14", "15", "16"],
    "ACCESSORY": ["08"],
    "MENSWEAR": ["02", "03", "04", "05", "06"],
    "WOMENSWEAR": ["01", "02", "03", "04", "05"],
    "KIDS": ["01", "02", "03", "04"],
    "DIVIDED": ["02", "03", "04", "05"],
}
DEFAULT_SIZES = ["02", "03", "04", "05"]


def purge_orphans(db: Db) -> None:
    """Delete the goods that no purchase order ever brought in.

    In this estate that is the six `ART-*` articles from 0002_demo_seed.sql and
    the 3,600 units the same migration opened on them. They are the reason the
    database currently answers "where did this come from?" with silence.

    The ledger is append-only and defends itself with a trigger, and a rule in
    a published price book is immutable for the same reason, so those triggers
    come off for the duration and go back on afterwards. That is the only way
    to remove either, and it is deliberately awkward. Both are restored inside
    the same transaction, so a failure anywhere leaves the guards on.
    """
    print("purging goods with no purchase order behind them ...")
    db.run(
        """
BEGIN;

ALTER TABLE movement DISABLE TRIGGER movement_append_only;
ALTER TABLE movement_group DISABLE TRIGGER movement_group_append_only;
ALTER TABLE commercial_price_rule DISABLE TRIGGER commercial_price_rule_immutable;
ALTER TABLE commercial_assortment_rule DISABLE TRIGGER commercial_assortment_rule_immutable;
ALTER TABLE commercial_markdown DISABLE TRIGGER commercial_markdown_immutable;

CREATE TEMP TABLE orphan_article AS
SELECT a.id FROM article a
WHERE a.created_by_session_id IS NULL
   OR NOT EXISTS (SELECT 1 FROM article_setup_session s WHERE s.session_id = a.created_by_session_id);

CREATE TEMP TABLE orphan_sku AS
SELECT k.id FROM sku k WHERE k.article_id IN (SELECT id FROM orphan_article);

CREATE TEMP TABLE orphan_subject AS
SELECT b.id FROM inventory_subject b WHERE b.sku_id IN (SELECT id FROM orphan_sku);

-- Anything that observed or counted these units.
DELETE FROM count_entry           WHERE subject_id IN (SELECT id FROM orphan_subject);
DELETE FROM count_snapshot        WHERE subject_id IN (SELECT id FROM orphan_subject);
DELETE FROM observation_sighting  WHERE subject_id IN (SELECT id FROM orphan_subject);
DELETE FROM inventory_projection  WHERE subject_id IN (SELECT id FROM orphan_subject);

-- The ledger, then the groups left with nothing in them.
DELETE FROM movement WHERE subject_id IN (SELECT id FROM orphan_subject);
DELETE FROM movement_group g
 WHERE NOT EXISTS (SELECT 1 FROM movement m WHERE m.movement_group_id = g.id)
   AND NOT EXISTS (SELECT 1 FROM official_count o WHERE o.approval_movement_group_id = g.id)
   AND NOT EXISTS (SELECT 1 FROM sale s WHERE s.movement_group_id = g.id)
   AND NOT EXISTS (SELECT 1 FROM sale_return r WHERE r.movement_group_id = g.id)
   AND NOT EXISTS (SELECT 1 FROM allotment_event e WHERE e.movement_group_id = g.id);

DELETE FROM inventory_subject WHERE id IN (SELECT id FROM orphan_subject);

-- Prices and assortment quoted against goods that are going away.
DELETE FROM commercial_price_rule      WHERE sku_id IN (SELECT id FROM orphan_sku);
DELETE FROM commercial_assortment_rule WHERE sku_id IN (SELECT id FROM orphan_sku);
DELETE FROM commercial_markdown        WHERE sku_id IN (SELECT id FROM orphan_sku);

DELETE FROM sku     WHERE id IN (SELECT id FROM orphan_sku);
DELETE FROM article WHERE id IN (SELECT id FROM orphan_article);

ALTER TABLE movement ENABLE TRIGGER movement_append_only;
ALTER TABLE movement_group ENABLE TRIGGER movement_group_append_only;
ALTER TABLE commercial_price_rule ENABLE TRIGGER commercial_price_rule_immutable;
ALTER TABLE commercial_assortment_rule ENABLE TRIGGER commercial_assortment_rule_immutable;
ALTER TABLE commercial_markdown ENABLE TRIGGER commercial_markdown_immutable;

COMMIT;
"""
    )


def repair_sourcing_pos(db: Db) -> None:
    """Give the sourcing purchase orders back the supplier they were raised
    against.

    Twenty-five orders carry `supplier_id` as the code `SUP02` and a null
    `supplier_ref_id`, and their lines name an article code with no
    `supplier_item_id`. They were written by an early demo flow that predated
    both columns. The information to repair them is not invented: the code and
    the article code both still resolve, so the link is recovered rather than
    guessed, and anything that does not resolve is left alone to be seen.
    """
    print("repairing sourcing purchase orders that lost their supplier link ...")
    db.run(
        """
BEGIN;

UPDATE purchase_order po
   SET supplier_ref_id = s.supplier_id,
       supplier_code_snapshot = COALESCE(po.supplier_code_snapshot, s.supplier_code),
       supplier_name_snapshot = COALESCE(po.supplier_name_snapshot, s.name)
  FROM supplier s
 WHERE po.supplier_ref_id IS NULL
   AND s.supplier_code = po.supplier_id;

UPDATE purchase_order_line l
   SET supplier_item_id = si.supplier_item_id,
       supplier_item_code_snapshot   = COALESCE(l.supplier_item_code_snapshot, si.supplier_item_code),
       supplier_item_name_snapshot   = COALESCE(l.supplier_item_name_snapshot, si.name),
       supplier_item_image_snapshot  = COALESCE(l.supplier_item_image_snapshot, si.image_url),
       supplier_item_version         = COALESCE(l.supplier_item_version, si.version),
       supplier_item_price_snapshot  = COALESCE(l.supplier_item_price_snapshot, si.unit_price_minor),
       currency                      = COALESCE(l.currency, si.currency)
  FROM supplier_item si, purchase_order po
 WHERE l.supplier_item_id IS NULL
   AND po.purchase_order_id = l.purchase_order_id
   AND si.supplier_id = po.supplier_ref_id
   AND si.supplier_item_code = l.article_code;

-- A line cannot have received more than it ordered. Where a demo run counted
-- in more than it asked for, the ORDER is what was wrong: the goods physically
-- arrived and are on a shelf, so the quantity ordered is raised to match the
-- quantity proven, rather than deleting a receipt that really happened.
UPDATE purchase_order_line l
   SET ordered_quantity = r.received
  FROM (SELECT po_line_id, sum(quantity) AS received
          FROM goods_receipt_line GROUP BY po_line_id) r
 WHERE r.po_line_id = l.po_line_id
   AND r.received > l.ordered_quantity;

UPDATE purchase_order_line
   SET line_amount_minor = ordered_quantity * unit_price_minor
 WHERE line_amount_minor <> ordered_quantity * unit_price_minor;

COMMIT;
"""
    )


def build(db: Db, wanted: int, seed: int) -> None:
    rng = random.Random(seed)

    print(f"reading the supplier catalogue ...")
    catalogue = db.rows(
        """
        SELECT si.supplier_item_id, si.supplier_id, si.supplier_item_code, si.name,
               si.image_url, si.unit_price_minor, si.currency, si.version,
               COALESCE(si.division_code, ''), s.supplier_code, s.name
          FROM supplier_item si
          JOIN supplier s ON s.supplier_id = si.supplier_id
         WHERE si.image_url IS NOT NULL
           AND si.unit_price_minor IS NOT NULL
           AND si.unit_price_minor > 0
           AND COALESCE(si.division_code, '') <> ''
           AND NOT EXISTS (
                 SELECT 1 FROM purchase_order_line l
                  WHERE l.supplier_item_id = si.supplier_item_id)
         ORDER BY si.supplier_item_code
        """
    )
    if len(catalogue) < wanted:
        sys.exit(
            f"only {len(catalogue)} unbought supplier items carry a photograph, a "
            f"price and a division; asked for {wanted}. Run scripts/seed-sourcing.py "
            "first, or lower --articles."
        )
    chosen = rng.sample(catalogue, wanted)
    chosen.sort(key=lambda row: row[2])

    colours = db.rows("SELECT code, label, hex_code FROM colour WHERE active ORDER BY display_order")
    sizes = {code: label for code, label, *_ in db.rows("SELECT code, label FROM size_code WHERE active")}

    # The size runs below are a preference, not a fact: `size_code` is master
    # data somebody edits, and asking for a size it does not carry is a foreign
    # key violation several thousand rows into a COPY. Keep only what exists,
    # and fall back to whatever the master does have.
    available = {
        division: [code for code in codes if code in sizes]
        for division, codes in SIZES_BY_DIVISION.items()
    }
    fallback = [code for code in DEFAULT_SIZES if code in sizes] or sorted(sizes)[:1]
    if not fallback:
        sys.exit("the size_code master is empty; there is no size to mint a SKU in")
    stores = [row[0] for row in db.rows("SELECT id FROM site WHERE kind='STORE' ORDER BY id")]

    # THREE names for the one building, and they are NOT interchangeable.
    #
    #   site.id                          `ho`     since migration 0256
    #   the pool namespace               `dc.…`   0256 left the pools alone
    #   sync_origin_credential.site_id   `dc`     what the edge box runs as
    #
    # Documents — receipts, setup sessions, tagging jobs — are filed against
    # the EDGE NODE that produced them, which is also the sync origin a
    # receipt's foreign key insists on, and the name a delivery is checked
    # against when it reports in. The ledger moves stock between POOLS, whose
    # ids still begin `dc` whatever the site is called this month. Neither is
    # read off `site` any more: asking `site` for either name is what 0256
    # broke, and both are now asked of the table that actually holds them.
    # Writing one in the other's place produces rows that insert cleanly and
    # then show up nowhere.
    doc_site = db.one(
        """
        SELECT c.site_id FROM sync_origin_credential c
         WHERE c.node_role = 'DC' AND c.origin_id = c.site_id
         ORDER BY (SELECT count(*) FROM goods_receipt r WHERE r.origin_id = c.origin_id) DESC,
                  c.site_id
         LIMIT 1
        """
    )
    pool_site = db.one(
        """
        SELECT split_part(op.id, '.', 1) FROM operational_pool op
          JOIN site s ON s.id = op.site_id
         WHERE s.kind = 'HO' AND op.pool_code = 'WAREHOUSE'
           AND EXISTS (SELECT 1 FROM inventory_place p
                        WHERE p.pool_id = op.id AND p.state = 'NORMAL')
         ORDER BY op.id LIMIT 1
        """
    )
    if not doc_site:
        sys.exit(
            "no DC edge origin is registered under its own name; a goods receipt's origin_id "
            "is a foreign key into sync_origin_credential and its site_id is checked against "
            "the same row, so one has to be registered first"
        )
    if not pool_site:
        sys.exit(
            "the head-office site has no warehouse pool with an inventory place behind it; "
            "stock would have nowhere to land"
        )
    print(f"  documents filed against {doc_site}, stock moved through the {pool_site} pools")

    # Article codes continue the sequence the real ones came from, so the
    # catalogue reads as one run of stock rather than two.
    first_code = int(db.one("SELECT nextval('article_code_seq')"))
    db.run(f"DO $$ BEGIN PERFORM setval('article_code_seq', {first_code + wanted - 1}); END $$;")

    today = date.today()

    po_rows, po_line_rows = [], []
    receipt_rows, receipt_line_rows = [], []
    session_rows, session_colour_rows, session_variant_rows = [], [], []
    article_rows, article_colour_rows, sku_rows = [], [], []
    job_rows, job_line_rows, serial_rows = [], [], []
    subject_rows = []
    unit_index: list[tuple] = []  # (subject_id, received_at, tagged_at, site hint)

    # Orders are grouped by supplier and by week, the way a buyer actually
    # raises them: one order covering several styles from one supplier, not one
    # order per style.
    by_supplier: dict[str, list] = {}
    for row in chosen:
        by_supplier.setdefault(row[1], []).append(row)

    po_seq = 0
    receipt_seq = 0
    article_seq = first_code
    serial_book: dict[str, int] = {}

    for supplier_id, items in sorted(by_supplier.items()):
        for start in range(0, len(items), 14):
            batch = items[start : start + 14]
            po_seq += 1
            # Orders spread over the last fifteen months, so "what did we buy
            # last quarter" has an answer and the receipts have somewhere to sit.
            ordered_on = today - timedelta(days=rng.randint(40, 460))
            arrived_on = ordered_on + timedelta(days=rng.randint(9, 35))
            if arrived_on >= today:
                arrived_on = today - timedelta(days=2)
            po_id = rid(f"po:{seed}:{po_seq}")
            po_number = f"PO-{ordered_on:%Y%m}-{po_seq:05d}"
            supplier_code = batch[0][9]
            supplier_name = batch[0][10]
            currency = batch[0][6] or "IDR"

            issued_at = datetime.combine(ordered_on, datetime.min.time()) + timedelta(hours=10)
            po_rows.append(
                (
                    po_id, po_number, supplier_code, supplier_name, doc_site,
                    "SOURCING", "CLOSED", currency,
                    "Seeded from the sourcing catalogue", "seed-full-chain",
                    issued_at, issued_at, supplier_id, supplier_code, supplier_name, 0,
                )
            )

            receipt_seq += 1
            receipt_id = rid(f"receipt:{seed}:{receipt_seq}")
            arrived_at = datetime.combine(arrived_on, datetime.min.time()) + timedelta(hours=8)
            receipt_rows.append(
                (
                    receipt_id, f"GR-{arrived_on:%Y%m}-{receipt_seq:05d}", doc_site, doc_site,
                    supplier_code, arrived_at,
                    f"INV/{arrived_on:%Y%m}/{receipt_seq:05d}", arrived_on,
                    None, None, None, None,
                    # `COMPLETED`, not `CLOSED`. The receipt's own CHECK allows
                    # OPEN / COMPLETED / REJECTED, and a second CHECK insists a
                    # non-OPEN receipt carry a `closed_at` — which the next
                    # field supplies. `CLOSED` is the PURCHASE ORDER's word and
                    # was borrowed here by mistake; every database rejected the
                    # row, so this seed could not build a chain from scratch.
                    "COMPLETED", "wh-receiver", arrived_at,
                    "wh-supervisor", arrived_at + timedelta(hours=3),
                    1, receipt_seq,
                )
            )

            invoice_total = 0

            for line_number, item in enumerate(batch, start=1):
                (
                    supplier_item_id, _sup, item_code, item_name, image_url,
                    unit_price, item_currency, item_version, division, _sc, _sn,
                ) = item
                unit_price = int(unit_price)
                division = division or "MENSWEAR"

                # What this style is offered in. Colour is one digit, so ten is
                # the ceiling and nothing here goes near it.
                colour_count = rng.choices([1, 2, 3, 4, 5], weights=[18, 32, 28, 15, 7])[0]
                picked_colours = rng.sample(colours, colour_count)
                size_codes = available.get(division) or fallback
                if len(size_codes) > 3 and rng.random() < 0.25:
                    size_codes = size_codes[1:-1] or size_codes

                per_variant = rng.randint(3, 11)
                variants = [(c, s) for c in range(colour_count) for s in size_codes]
                ordered_quantity = per_variant * len(variants)

                po_line_id = rid(f"po-line:{seed}:{po_seq}:{line_number}")
                po_line_rows.append(
                    (
                        po_line_id, po_id, line_number, item_code, item_name, image_url,
                        ordered_quantity, unit_price, ordered_quantity * unit_price,
                        arrived_on, "CLOSED", 0, division, supplier_item_id,
                        item_code, item_name, image_url, item_version,
                        item_currency or "IDR", unit_price,
                    )
                )
                invoice_total += ordered_quantity * unit_price

                receipt_line_id = rid(f"receipt-line:{seed}:{po_seq}:{line_number}")
                receipt_group_id = rid(f"receipt-group:{seed}:{po_seq}:{line_number}")
                receipt_line_rows.append(
                    (
                        receipt_line_id, receipt_id, po_line_id, ordered_quantity,
                        "wh-receiver", "wh-supervisor",
                        arrived_at, arrived_at + timedelta(hours=3),
                        receipt_group_id, 1, len(receipt_line_rows) + 1,
                        # Both NOT NULL and neither has a default, so a seed
                        # that omits them cannot write a line at all. Everything
                        # here arrives exactly as ordered — that is what makes
                        # the chain a clean baseline — so the whole quantity is
                        # matched against the order and nothing is over.
                        ordered_quantity, 0,
                    )
                )

                # Head office says what the goods ARE. This is the row that
                # makes an article an article rather than a line on an order.
                article_code = f"{article_seq:08d}"
                article_seq += 1
                session_id = rid(f"session:{seed}:{article_code}")
                setup_on = arrived_on + timedelta(days=rng.randint(1, 6))
                setup_at = datetime.combine(setup_on, datetime.min.time()) + timedelta(hours=11)
                tagged_at = setup_at + timedelta(hours=rng.randint(4, 40))
                retail_price = int(round(unit_price * rng.uniform(2.1, 3.4) / 1000.0) * 1000)

                session_rows.append(
                    (
                        session_id, receipt_line_id, article_code, item_code,
                        ordered_quantity, doc_site, item_name, division, image_url,
                        "IDR", "TAGGED", "merchandiser", setup_at,
                        "merchandiser", setup_at, tagged_at, None, None,
                    )
                )

                article_id = rid(f"article:{seed}:{article_code}")
                article_rows.append(
                    (
                        article_id, article_code, item_name, True, setup_at,
                        division, image_url, session_id, 1, tagged_at, "merchandiser",
                    )
                )

                # Where this style is sent, and when. Replenishment runs on a
                # weekly cycle, so dispatch dates are quantised to the Tuesday
                # after the goods were tagged: without that, every garment gets
                # its own dispatch date and the ledger ends up with one
                # movement group per unit, which is not how a warehouse works.
                dispatch: list[tuple] = [(None, None, None)]  # some stock stays at the DC
                for wave in range(rng.randint(1, 3)):
                    store = rng.choice(stores)
                    ship_on = tagged_at.date() + timedelta(days=7 * wave)
                    ship_on += timedelta(days=(1 - ship_on.weekday()) % 7)
                    floor_on = ship_on + timedelta(days=rng.choice([1, 1, 2, 3]))
                    dispatch.append(
                        (
                            store,
                            datetime.combine(ship_on, datetime.min.time()) + timedelta(hours=7),
                            datetime.combine(floor_on, datetime.min.time()) + timedelta(hours=9)
                            if rng.random() < 0.72
                            else None,
                        )
                    )

                job_id = rid(f"job:{seed}:{article_code}")
                job_rows.append(
                    (
                        job_id, session_id, doc_site, article_code, item_name, image_url,
                        ordered_quantity, "TAGGED", "merchandiser", setup_at,
                        "wh-tagger", tagged_at, None,
                    )
                )

                for colour_index, (colour_code, colour_label, hex_code) in enumerate(picked_colours):
                    digit = str(colour_index)
                    session_colour_rows.append((session_id, digit, colour_label, hex_code, colour_code))
                    article_colour_rows.append(
                        (article_id, digit, colour_label, hex_code, setup_at, colour_code)
                    )

                    for size in size_codes:
                        code = sku_code(article_code, digit, size)
                        sku_id = rid(f"sku:{seed}:{code}")
                        sku_rows.append(
                            (
                                sku_id, article_id, code, colour_label, sizes.get(size, size),
                                True, setup_at, digit, size, None, None,
                                qr_payload(code), session_id,
                            )
                        )
                        session_variant_rows.append(
                            (session_id, digit, size, per_variant, retail_price)
                        )

                        # Serials are per SKU and never reused, which is what
                        # makes an EPC identify one garment rather than a style.
                        serial_from = serial_book.get(code, 0)
                        serial_to = serial_from + per_variant - 1
                        serial_book[code] = serial_to + 1
                        job_line_rows.append(
                            (
                                job_id, code, digit, colour_label, size,
                                sizes.get(size, size), per_variant,
                                serial_from, serial_to,
                                qr_payload(code), barcode_payload(code), retail_price,
                            )
                        )

                        for serial in range(serial_from, serial_to + 1):
                            epc = encode_epc(code, serial)
                            subject_id = rid(f"subject:{seed}:{epc}")
                            subject_rows.append(
                                (subject_id, "UNIT", sku_id, epc, barcode_payload(code), 1, "EA", tagged_at)
                            )
                            # Which shop this one goes to, decided per style
                            # rather than per garment — a dispatcher sends a
                            # carton of an article to a shop, not one shirt.
                            leg = dispatch[serial % len(dispatch)]
                            unit_index.append((subject_id, arrived_at, tagged_at) + leg)

            receipt_rows[-1] = receipt_rows[-1][:8] + (invoice_total,) + receipt_rows[-1][9:]

    for code, used in serial_book.items():
        serial_rows.append((code, used, today))

    print(
        f"  {len(po_rows)} orders, {len(po_line_rows)} lines, {len(article_rows)} articles, "
        f"{len(sku_rows)} SKUs, {len(subject_rows)} units"
    )

    print("writing the buying chain ...")
    db.copy(
        "purchase_order",
        ["purchase_order_id", "po_number", "supplier_id", "supplier_name", "destination_site_id",
         "origin_kind", "order_status", "currency", "notes", "created_by", "created_at",
         "issued_at", "supplier_ref_id", "supplier_code_snapshot", "supplier_name_snapshot",
         "discount_minor"],
        po_rows,
    )
    db.copy(
        "purchase_order_line",
        ["po_line_id", "purchase_order_id", "line_number", "article_code", "article_name",
         "image_url", "ordered_quantity", "unit_price_minor", "line_amount_minor",
         "promised_date", "line_status", "cancelled_quantity", "division_code",
         "supplier_item_id", "supplier_item_code_snapshot", "supplier_item_name_snapshot",
         "supplier_item_image_snapshot", "supplier_item_version", "currency",
         "supplier_item_price_snapshot"],
        po_line_rows,
    )
    db.copy(
        "goods_receipt",
        ["receipt_id", "receipt_number", "origin_id", "site_id", "supplier_id", "arrived_at",
         "invoice_number", "invoice_date", "invoice_total_minor", "invoice_document_ref",
         "invoice_recorded_by", "invoice_recorded_at", "status", "opened_by", "opened_at",
         "closed_by", "closed_at", "generation", "seq"],
        receipt_rows,
    )

    # The receipt's movement group has to exist before the line points at it.
    receipt_groups = []
    seen_groups = set()
    for line in receipt_line_rows:
        group_id = line[8]
        if group_id in seen_groups:
            continue
        seen_groups.add(group_id)
        receipt_groups.append(
            (group_id, "RECEIPT", "Goods received against a purchase order", "GOODS_RECEIPT",
             str(line[1]), "wh-receiver", f"receipt-{group_id}", str(group_id), line[6], line[7])
        )
    db.copy(
        "movement_group",
        ["id", "cause", "reason", "reference_type", "reference_id", "actor_id",
         "idempotency_key", "payload_digest", "occurred_at", "recorded_at"],
        receipt_groups,
    )
    db.copy(
        "goods_receipt_line",
        ["receipt_line_id", "receipt_id", "po_line_id", "quantity", "counted_by", "verified_by",
         "counted_at", "verified_at", "movement_group_id", "generation", "seq",
         "matched_quantity", "excess_quantity"],
        receipt_line_rows,
    )

    print("writing the setup sessions and the catalogue ...")
    db.copy(
        "article_setup_session",
        ["session_id", "receipt_line_id", "article_code", "supplier_article_code",
         "receipt_quantity", "destination_site_id", "article_name", "division_code",
         "image_url", "currency", "status", "created_by", "created_at", "issued_by",
         "issued_at", "tagged_at", "cancelled_at", "tagging_command_id"],
        session_rows,
    )
    db.copy(
        "article_setup_colour",
        ["session_id", "colour_digit", "label", "hex_code", "colour_code"],
        session_colour_rows,
    )
    db.copy(
        "article_setup_variant",
        ["session_id", "colour_digit", "size_code", "target_quantity", "base_price_minor"],
        session_variant_rows,
    )
    db.copy(
        "article",
        ["id", "article_code", "name", "active", "created_at", "division_code", "image_url",
         "created_by_session_id", "version", "updated_at", "updated_by"],
        article_rows,
    )
    db.copy(
        "article_colour",
        ["article_id", "colour_digit", "label", "hex_code", "created_at", "colour_code"],
        article_colour_rows,
    )
    db.copy(
        "sku",
        ["id", "article_id", "sku_code", "color", "size", "active", "created_at",
         "colour_digit", "size_code", "base_price_minor", "currency", "qr_payload",
         "created_by_session_id"],
        sku_rows,
    )

    # An article's tags are the supplier item's tags. Inventing a fresh set
    # here would put a second, disagreeing opinion on the same garment: the
    # sourcing card would say Denim and the article would say Knitwear, and
    # nothing in the data would say which was right. Inheriting them along the
    # purchase order line keeps one answer.
    print("carrying the supplier's tags onto the articles ...")
    db.run(
        """
INSERT INTO article_tag (article_id, tag_code)
SELECT DISTINCT a.id, t.tag_code
  FROM article a
  JOIN article_setup_session s ON s.session_id = a.created_by_session_id
  JOIN goods_receipt_line rl ON rl.receipt_line_id = s.receipt_line_id
  JOIN purchase_order_line l ON l.po_line_id = rl.po_line_id
  JOIN supplier_item_tag t ON t.supplier_item_id = l.supplier_item_id
  JOIN tag ON tag.code = t.tag_code
ON CONFLICT DO NOTHING;
"""
    )

    print("writing the tagging jobs and the units they minted ...")
    db.copy(
        "tagging_job",
        ["job_id", "session_id", "site_id", "article_code", "article_name", "image_url",
         "total_quantity", "status", "issued_by", "issued_at", "confirmed_by",
         "confirmed_at", "command_id"],
        job_rows,
    )
    db.copy(
        "tagging_job_line",
        ["job_id", "sku_code", "colour_digit", "colour_label", "size_code", "size_label",
         "quantity", "serial_from", "serial_to", "qr_payload", "barcode_payload",
         "base_price_minor"],
        job_line_rows,
    )
    if serial_book:
        # The counter is what stops a future tagging run reissuing a serial that
        # is already on a garment, so it has to reflect what this run consumed.
        db.run(
            "INSERT INTO epc_serial_counter (sku_code, last_serial, updated_at) VALUES "
            + ",".join(f"('{code}', {used}, now())" for code, used in serial_book.items())
            + " ON CONFLICT (sku_code) DO UPDATE SET"
            " last_serial = GREATEST(epc_serial_counter.last_serial, EXCLUDED.last_serial);"
        )
    db.copy(
        "inventory_subject",
        ["id", "subject_type", "sku_id", "epc", "barcode", "quantity", "uom", "created_at"],
        subject_rows,
    )

    write_movements(db, unit_index, receipt_line_rows, stores, pool_site, rng, seed)


def write_movements(db, unit_index, receipt_line_rows, stores, pool_site, rng, seed) -> None:
    """How each garment got from the supplier to a shelf.

    Three business steps, one atomic group per step, because that is the shape
    the ledger is built for and the shape 0002_demo_seed.sql already uses:

      1. RECEIPT   external/supplier -> the DC's untagged pending pool
      2. TAGGING   untagged pending  -> the DC warehouse (it has an identity now)
      3. TRANSFER  DC warehouse      -> a shop, and for most of those, its floor

    The unit index carries the receipt and tagging timestamps, so a movement
    never predates the goods arriving.
    """
    print("writing the ledger ...")

    receipt_group_for_line = {line[0]: line[8] for line in receipt_line_rows}
    del receipt_group_for_line  # kept for clarity; units are grouped by day below

    untagged = f"{pool_site}.pending.untagged:on_hand"
    warehouse = f"{pool_site}.warehouse:on_hand"

    groups: dict[str, tuple] = {}
    movements: list[tuple] = []

    def group(key: str, cause: str, reason: str, ref_type: str, ref_id: str, actor: str, when):
        if key not in groups:
            groups[key] = (
                rid(f"group:{seed}:{key}"), cause, reason, ref_type, ref_id, actor,
                f"seed-full-chain:{key}", str(rid(f"group:{seed}:{key}")), when, when,
            )
        return groups[key][0]

    for subject_id, arrived_at, tagged_at, store, shipped_at, floor_at in unit_index:
        day = arrived_at.date().isoformat()
        receipt_group = group(
            f"receipt:{day}", "RECEIPT", "Goods received from the supplier",
            "GOODS_RECEIPT", day, "wh-receiver", arrived_at,
        )
        movements.append(
            (rid(f"mv:recv:{seed}:{subject_id}"), receipt_group, subject_id, 1,
             "external/supplier", untagged, "RECEIPT", "GOODS_RECEIPT", day,
             f"seed-full-chain:receipt:{day}", str(receipt_group), "wh-receiver",
             arrived_at, arrived_at)
        )

        tag_day = tagged_at.date().isoformat()
        tag_group = group(
            f"tagging:{tag_day}", "NORMAL_MOVE", "Tagged and put away into the warehouse",
            "TAGGING_JOB", tag_day, "wh-tagger", tagged_at,
        )
        movements.append(
            (rid(f"mv:tag:{seed}:{subject_id}"), tag_group, subject_id, 1,
             untagged, warehouse, "NORMAL_MOVE", "TAGGING_JOB", tag_day,
             f"seed-full-chain:tagging:{tag_day}", str(tag_group), "wh-tagger",
             tagged_at, tagged_at)
        )

        # Stock that was never dispatched stays in the warehouse, which is what
        # makes "what is still at the DC" a real number rather than a rounding
        # error.
        if store is None:
            continue

        ship_day = shipped_at.date().isoformat()
        transfer_group = group(
            f"transfer:{store}:{ship_day}", "NORMAL_MOVE",
            f"Weekly replenishment from the distribution centre to {store}",
            "TRANSFER", f"{store}:{ship_day}", "dc-dispatcher", shipped_at,
        )
        movements.append(
            (rid(f"mv:ship:{seed}:{subject_id}"), transfer_group, subject_id, 1,
             warehouse, f"{store}.warehouse:on_hand", "NORMAL_MOVE", "TRANSFER",
             f"{store}:{ship_day}", f"seed-full-chain:transfer:{store}:{ship_day}",
             str(transfer_group), "dc-dispatcher", shipped_at, shipped_at)
        )

        # Not everything that reaches a shop reaches its floor: some of it is
        # still in the back. A shop whose stockroom is always empty is the
        # thing nobody in retail has ever seen.
        if floor_at is None:
            continue

        floor_day = floor_at.date().isoformat()
        floor_group = group(
            f"floor:{store}:{floor_day}", "NORMAL_MOVE",
            f"Put out on the sales floor at {store}",
            "REPLENISHMENT", f"{store}:{floor_day}", f"{store}-assistant", floor_at,
        )
        movements.append(
            (rid(f"mv:floor:{seed}:{subject_id}"), floor_group, subject_id, 1,
             f"{store}.warehouse:on_hand", f"{store}.floor:on_hand", "NORMAL_MOVE",
             "REPLENISHMENT", f"{store}:{floor_day}",
             f"seed-full-chain:floor:{store}:{floor_day}", str(floor_group),
             f"{store}-assistant", floor_at, floor_at)
        )

    db.copy(
        "movement_group",
        ["id", "cause", "reason", "reference_type", "reference_id", "actor_id",
         "idempotency_key", "payload_digest", "occurred_at", "recorded_at"],
        list(groups.values()),
    )
    print(f"  {len(groups)} movement groups, {len(movements)} movements")
    for start in range(0, len(movements), 20000):
        db.copy(
            "movement",
            ["movement_id", "movement_group_id", "subject_id", "quantity", "from_place_id",
             "to_place_id", "cause", "reference_type", "reference_id", "idempotency_key",
             "payload_digest", "actor_id", "occurred_at", "recorded_at"],
            movements[start : start + 20000],
        )

    print("rebuilding the projection from the ledger ...")
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
 WHERE quantity > 0
   AND place_id IN (SELECT id FROM inventory_place);
COMMIT;
"""
    )


AUDIT = """
\\pset border 2
SELECT 'articles with no setup session'      AS link, count(*) AS broken FROM article a
  WHERE a.created_by_session_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM article_setup_session s WHERE s.session_id=a.created_by_session_id)
UNION ALL SELECT 'SKUs with no setup session', count(*) FROM sku k
  WHERE k.created_by_session_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM article_setup_session s WHERE s.session_id=k.created_by_session_id)
UNION ALL SELECT 'setup sessions with no receipt line', count(*) FROM article_setup_session s
  WHERE NOT EXISTS (SELECT 1 FROM goods_receipt_line l WHERE l.receipt_line_id=s.receipt_line_id)
UNION ALL SELECT 'receipt lines with no PO line', count(*) FROM goods_receipt_line l
  WHERE NOT EXISTS (SELECT 1 FROM purchase_order_line p WHERE p.po_line_id=l.po_line_id)
UNION ALL SELECT 'PO lines with no supplier item', count(*) FROM purchase_order_line l
  WHERE l.supplier_item_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM supplier_item si WHERE si.supplier_item_id=l.supplier_item_id)
UNION ALL SELECT 'POs with no supplier', count(*) FROM purchase_order po
  WHERE po.supplier_ref_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM supplier s WHERE s.supplier_id=po.supplier_ref_id)
UNION ALL SELECT 'receipt lines exceeding what was ordered', count(*) FROM (
    SELECT l.po_line_id FROM purchase_order_line l
      JOIN goods_receipt_line r ON r.po_line_id=l.po_line_id
     GROUP BY l.po_line_id, l.ordered_quantity
    HAVING sum(r.quantity) > l.ordered_quantity) x
UNION ALL SELECT 'units whose SKU has no PO behind it', count(*) FROM inventory_subject b
  JOIN sku k ON k.id=b.sku_id
  WHERE k.created_by_session_id IS NULL
UNION ALL SELECT 'units with no SKU at all', count(*) FROM inventory_subject WHERE sku_id IS NULL
UNION ALL SELECT 'UNIT subjects with a malformed EPC', count(*) FROM inventory_subject
  WHERE subject_type='UNIT' AND (epc IS NULL OR epc !~ '^[0-9a-f]{24}$' OR left(epc,2) <> 'a0')
UNION ALL SELECT 'SKU codes that are not 11 digits', count(*) FROM sku WHERE sku_code !~ '^[0-9]{11}$'
UNION ALL SELECT 'movements into a place that does not exist', count(*) FROM movement m
  WHERE NOT EXISTS (SELECT 1 FROM inventory_place p WHERE p.id=m.to_place_id)
UNION ALL SELECT 'projection rows disagreeing with the ledger', count(*) FROM (
    SELECT p.subject_id, p.place_id FROM inventory_projection p
      LEFT JOIN (
        SELECT subject_id, place_id, sum(quantity) AS quantity FROM (
            SELECT subject_id, to_place_id AS place_id, quantity FROM movement
            UNION ALL SELECT subject_id, from_place_id, -quantity FROM movement) d
        GROUP BY 1,2) l ON l.subject_id=p.subject_id AND l.place_id=p.place_id
     WHERE coalesce(l.quantity,0) <> p.quantity) y
UNION ALL SELECT 'sale lines priced off an unpublished book', count(*) FROM sale_line sl
  WHERE NOT EXISTS (SELECT 1 FROM commercial_publication c
                     WHERE c.id=sl.commercial_publication_id AND c.status='PUBLISHED')
ORDER BY 2 DESC, 1;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.environ.get("ITULAH_DB", ""), help="psql connection string or database name")
    parser.add_argument("--articles", type=int, default=500)
    parser.add_argument("--seed", type=int, default=20260905)
    parser.add_argument("--purge-orphans", action="store_true", help="delete goods with no purchase order behind them")
    parser.add_argument("--repair", action="store_true", help="reconnect purchase orders that lost their supplier link")
    parser.add_argument("--audit", action="store_true", help="report broken links and exit")
    args = parser.parse_args()

    if not args.db:
        sys.exit("--db is required (or set ITULAH_DB)")
    db = Db(args.db)

    if args.audit:
        subprocess.run(["psql", "-d", args.db, "-q", "-f", "-"], input=AUDIT, text=True)
        return 0

    if args.repair:
        repair_sourcing_pos(db)
    if args.purge_orphans:
        purge_orphans(db)
    if args.articles > 0:
        build(db, args.articles, args.seed)

    print()
    subprocess.run(["psql", "-d", args.db, "-q", "-f", "-"], input=AUDIT, text=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
